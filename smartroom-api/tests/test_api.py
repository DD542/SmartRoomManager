"""Tests d'intégration : de la requête HTTP jusqu'à la contrainte PostgreSQL.

Le client partage la session transactionnelle des autres tests par surcharge de
la dépendance `get_session` : l'API écrit dans la même transaction, annulée à la
fin du test. Les routes appellent `session.commit()`, ce que le mode
« create_savepoint » transforme en relâchement de point de sauvegarde — la
transaction extérieure reste ouverte et annulable.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from datetime import date, datetime, time, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.orm import Session

from app.api.deps import CONFLICTS_ARBITRATE, ROOMS_MANAGE, SYSTEM_CONFIGURE
from app.db.enums import BookingStatus, RoomStatus, RuleScope, UserStatus
from app.db.session import get_session
from app.main import app
from app.models import (
    AdminAccount,
    AdminPermission,
    Booking,
    OpeningHour,
    Permission,
    User,
)
from app.core.security import hash_password
from tests.conftest import PARIS, creneau

MOT_DE_PASSE = "smartroom2026"


@pytest.fixture
def client(session: Session) -> Iterator[TestClient]:
    """Client HTTP branché sur la session du test.

    `TestClient` n'est pas utilisé comme gestionnaire de contexte : le cycle de
    vie de l'application — donc la boucle de maintenance — ne démarre pas, ce
    qui laisse les tests maîtres de l'horloge.
    """
    app.dependency_overrides[get_session] = lambda: session
    try:
        yield TestClient(app, raise_server_exceptions=False)
    finally:
        app.dependency_overrides.clear()


@pytest.fixture
def compte(session: Session) -> User:
    """Utilisateur avec un mot de passe réellement haché, comme en production."""
    utilisateur = User(
        email=f"api-{uuid.uuid4().hex[:8]}@ece.fr",
        password_hash=hash_password(MOT_DE_PASSE),
        first_name="Camille",
        last_name="Durand",
    )
    session.add(utilisateur)
    session.flush()
    return utilisateur


@pytest.fixture
def administrateur(session: Session, compte: User) -> AdminAccount:
    """Administrateur non propriétaire : ses droits viennent de la matrice seule."""
    autre = User(
        email=f"admin-{uuid.uuid4().hex[:8]}@ece.fr",
        password_hash=hash_password(MOT_DE_PASSE),
        first_name="Léa",
        last_name="Martin",
    )
    session.add(autre)
    session.flush()

    admin = AdminAccount(user_id=autre.id, job_title="Responsable planning")
    session.add(admin)
    session.flush()
    return admin


def accorder(session: Session, admin: AdminAccount, *codes: str) -> None:
    for code in codes:
        permission = session.scalars(
            select(Permission).where(Permission.code == code)
        ).one()
        session.add(
            AdminPermission(admin_user_id=admin.user_id, permission_id=permission.id)
        )
    session.flush()
    session.expire(admin, ["grants", "permissions"])


def connecter(client: TestClient, email: str, *, admin: bool = False) -> dict[str, str]:
    chemin = "/api/auth/admin/login" if admin else "/api/auth/login"
    reponse = client.post(chemin, json={"email": email, "password": MOT_DE_PASSE})
    assert reponse.status_code == 200, reponse.text
    return {"Authorization": f"Bearer {reponse.json()['access_token']}"}


@pytest.fixture
def ouverture(session: Session, salle) -> None:
    """Horaires larges sur la salle de test, pour ne pas buter sur l'ouverture."""
    for jour in range(7):
        session.add(
            OpeningHour(
                scope=RuleScope.SALLE,
                room_id=salle.id,
                weekday=jour,
                opens_at=time(7, 0),
                closes_at=time(22, 0),
            )
        )
    session.flush()


def charge(jour: date, heure: int, duree: int, salle, effectif: int = 4) -> dict:
    plage = creneau(jour, heure, 0, duree)
    return {
        "room_id": str(salle.id),
        "slot": {
            "starts_at": plage.lower.isoformat(),
            "ends_at": plage.upper.isoformat(),
        },
        "title": "Revue de projet",
        "attendee_count": effectif,
    }


# --------------------------------------------------------------------------- #
# Authentification
# --------------------------------------------------------------------------- #


def test_connexion_reussie(client, compte):
    reponse = client.post(
        "/api/auth/login", json={"email": compte.email, "password": MOT_DE_PASSE}
    )
    assert reponse.status_code == 200
    corps = reponse.json()
    assert corps["token_type"] == "bearer"
    assert corps["user"]["email"] == compte.email
    assert corps["admin"] is None
    # Le hachage ne sort jamais, même dans la réponse la plus complète.
    assert "password_hash" not in corps["user"]


def test_mot_de_passe_faux_refuse_sans_indice(client, compte):
    reponse = client.post(
        "/api/auth/login", json={"email": compte.email, "password": "au-hasard"}
    )
    inconnu = client.post(
        "/api/auth/login", json={"email": "personne@ece.fr", "password": "au-hasard"}
    )
    assert reponse.status_code == inconnu.status_code == 401
    # Message identique : la connexion ne sert pas d'annuaire.
    assert reponse.json()["error"]["message"] == inconnu.json()["error"]["message"]


def test_compte_suspendu_refuse(client, session, compte):
    compte.status = UserStatus.SUSPENDU
    session.flush()
    reponse = client.post(
        "/api/auth/login", json={"email": compte.email, "password": MOT_DE_PASSE}
    )
    assert reponse.status_code == 403
    assert reponse.json()["error"]["code"] == "compte_suspendu"


def test_route_protegee_sans_jeton(client):
    assert client.get("/api/bookings").status_code == 401


def test_jeton_altere_refuse(client, compte):
    entetes = connecter(client, compte.email)
    entetes["Authorization"] += "x"
    reponse = client.get("/api/bookings", headers=entetes)
    assert reponse.status_code == 401
    assert reponse.json()["error"]["code"] == "jeton_invalide"


def test_espace_utilisateur_ne_donne_pas_l_administration(client, session, administrateur):
    accorder(session, administrateur, CONFLICTS_ARBITRATE)
    # Connexion sur l'espace public, avec un compte pourtant administrateur.
    entetes = connecter(client, administrateur.user.email)
    reponse = client.get("/api/admin/bookings", headers=entetes)
    assert reponse.status_code == 403
    assert reponse.json()["error"]["code"] == "scope_invalide"


def test_session_courante_liste_les_permissions(client, session, administrateur):
    accorder(session, administrateur, CONFLICTS_ARBITRATE, ROOMS_MANAGE)
    entetes = connecter(client, administrateur.user.email, admin=True)
    corps = client.get("/api/auth/me", headers=entetes).json()
    assert set(corps["permissions"]) == {CONFLICTS_ARBITRATE, ROOMS_MANAGE}


# --------------------------------------------------------------------------- #
# Disponibilité
# --------------------------------------------------------------------------- #


def test_verdict_sur_un_creneau_libre(client, compte, salle, jour_ouvre, ouverture):
    entetes = connecter(client, compte.email)
    plage = creneau(jour_ouvre, 10, 0, 60)
    reponse = client.post(
        f"/api/rooms/{salle.id}/check-slot",
        headers=entetes,
        json={
            "slot": {"starts_at": plage.lower.isoformat(), "ends_at": plage.upper.isoformat()},
            "attendee_count": 4,
        },
    )
    assert reponse.status_code == 200
    corps = reponse.json()
    assert corps["available"] is True
    assert corps["conflicts"] == []


def test_verdict_explique_le_chevauchement(
    client, compte, salle, jour_ouvre, ouverture, poser
):
    poser(creneau(jour_ouvre, 10, 0, 120), "Atelier")
    entetes = connecter(client, compte.email)
    plage = creneau(jour_ouvre, 10, 30, 60)

    corps = client.post(
        f"/api/rooms/{salle.id}/check-slot",
        headers=entetes,
        json={
            "slot": {"starts_at": plage.lower.isoformat(), "ends_at": plage.upper.isoformat()},
            "attendee_count": 4,
        },
    ).json()

    assert corps["available"] is False
    assert corps["blocking"] is True
    assert corps["conflicts"][0]["kind"] == "total"
    assert "Atelier" in corps["conflicts"][0]["message"]


def test_recherche_de_salles_libres(client, compte, salle, jour_ouvre, ouverture):
    entetes = connecter(client, compte.email)
    plage = creneau(jour_ouvre, 14, 0, 60)
    reponse = client.post(
        "/api/rooms/available",
        headers=entetes,
        json={
            "slot": {"starts_at": plage.lower.isoformat(), "ends_at": plage.upper.isoformat()},
            "attendee_count": 4,
        },
    )
    assert reponse.status_code == 200
    assert str(salle.id) in {item["id"] for item in reponse.json()}


def test_salle_occupee_disparait_de_la_recherche(
    client, compte, salle, jour_ouvre, ouverture, poser
):
    poser(creneau(jour_ouvre, 14, 0, 60))
    entetes = connecter(client, compte.email)
    plage = creneau(jour_ouvre, 14, 0, 60)
    resultats = client.post(
        "/api/rooms/available",
        headers=entetes,
        json={
            "slot": {"starts_at": plage.lower.isoformat(), "ends_at": plage.upper.isoformat()},
            "attendee_count": 4,
        },
    ).json()
    assert str(salle.id) not in {item["id"] for item in resultats}


# --------------------------------------------------------------------------- #
# Réservation
# --------------------------------------------------------------------------- #


def test_creation_puis_lecture(client, compte, salle, jour_ouvre, ouverture):
    entetes = connecter(client, compte.email)
    reponse = client.post(
        "/api/bookings", headers=entetes, json=charge(jour_ouvre, 9, 60, salle)
    )
    assert reponse.status_code == 201, reponse.text
    identifiant = reponse.json()["booking"]["id"]

    detail = client.get(f"/api/bookings/{identifiant}", headers=entetes)
    assert detail.status_code == 200
    assert detail.json()["title"] == "Revue de projet"
    # La frise porte déjà l'événement de création.
    assert any(item["event_type"] == "creation" for item in detail.json()["events"])


def test_creation_sur_un_creneau_pris_repond_409(
    client, compte, salle, jour_ouvre, ouverture, poser
):
    poser(creneau(jour_ouvre, 9, 0, 60))
    entetes = connecter(client, compte.email)
    reponse = client.post(
        "/api/bookings", headers=entetes, json=charge(jour_ouvre, 9, 60, salle)
    )
    assert reponse.status_code == 409
    assert reponse.json()["error"]["code"] == "conflit"


def test_capacite_depassee_repond_422(client, compte, salle, jour_ouvre, ouverture):
    entetes = connecter(client, compte.email)
    reponse = client.post(
        "/api/bookings",
        headers=entetes,
        json=charge(jour_ouvre, 9, 60, salle, effectif=salle.capacity + 5),
    )
    assert reponse.status_code == 422
    assert reponse.json()["error"]["code"] == "capacite"


def test_creneau_inverse_refuse_par_le_schema(client, compte, salle, jour_ouvre):
    entetes = connecter(client, compte.email)
    corps = charge(jour_ouvre, 9, 60, salle)
    corps["slot"] = {
        "starts_at": corps["slot"]["ends_at"],
        "ends_at": corps["slot"]["starts_at"],
    }
    reponse = client.post("/api/bookings", headers=entetes, json=corps)
    assert reponse.status_code == 422
    assert reponse.json()["error"]["code"] == "validation"


def test_reservation_d_autrui_invisible(client, session, compte, salle, jour_ouvre, ouverture, poser):
    autre = poser(creneau(jour_ouvre, 9, 0, 60))
    intrus = User(
        email=f"intrus-{uuid.uuid4().hex[:8]}@ece.fr",
        password_hash=hash_password(MOT_DE_PASSE),
        first_name="Sam",
        last_name="Intrus",
    )
    session.add(intrus)
    session.flush()

    entetes = connecter(client, intrus.email)
    reponse = client.get(f"/api/bookings/{autre.id}", headers=entetes)
    # 404 et non 403 : l'existence d'une réservation tierce ne se confirme pas.
    assert reponse.status_code == 404


def test_annulation_exige_un_motif(client, compte, salle, jour_ouvre, ouverture):
    entetes = connecter(client, compte.email)
    identifiant = client.post(
        "/api/bookings", headers=entetes, json=charge(jour_ouvre, 9, 60, salle)
    ).json()["booking"]["id"]

    vide = client.post(
        f"/api/bookings/{identifiant}/cancel", headers=entetes, json={"reason": "  "}
    )
    assert vide.status_code == 422

    annulee = client.post(
        f"/api/bookings/{identifiant}/cancel",
        headers=entetes,
        json={"reason": "Réunion reportée"},
    )
    assert annulee.status_code == 200
    assert annulee.json()["status"] == "annulee"


def test_deplacement_ne_se_conflictue_pas_avec_lui_meme(
    client, compte, salle, jour_ouvre, ouverture
):
    entetes = connecter(client, compte.email)
    identifiant = client.post(
        "/api/bookings", headers=entetes, json=charge(jour_ouvre, 9, 60, salle)
    ).json()["booking"]["id"]

    plage = creneau(jour_ouvre, 9, 30, 60)
    reponse = client.patch(
        f"/api/bookings/{identifiant}",
        headers=entetes,
        json={
            "slot": {"starts_at": plage.lower.isoformat(), "ends_at": plage.upper.isoformat()}
        },
    )
    assert reponse.status_code == 200
    assert reponse.json()["starts_at"].startswith(plage.lower.isoformat()[:16])


def test_liste_ne_montre_que_les_siennes(
    client, session, compte, salle, jour_ouvre, ouverture, poser, utilisateur
):
    poser(creneau(jour_ouvre, 15, 0, 60))  # appartient à `utilisateur`
    entetes = connecter(client, compte.email)
    client.post("/api/bookings", headers=entetes, json=charge(jour_ouvre, 9, 60, salle))

    liste = client.get("/api/bookings", headers=entetes).json()
    assert {item["owner_id"] for item in liste} == {str(compte.id)}


# --------------------------------------------------------------------------- #
# Séries récurrentes
# --------------------------------------------------------------------------- #


def _serie(salle, depart: date) -> dict:
    return {
        "room_id": str(salle.id),
        "freq": "hebdomadaire",
        "interval_count": 1,
        "byweekday": [2],  # mardi, dans la numérotation EXTRACT(DOW)
        "start_date": depart.isoformat(),
        "until_date": (depart + timedelta(weeks=2)).isoformat(),
        "start_time": "10:00:00",
        "end_time": "11:00:00",
        "title": "Comité hebdomadaire",
        "attendee_count": 4,
    }


def test_apercu_puis_creation_de_serie(client, compte, salle, jour_ouvre, ouverture):
    entetes = connecter(client, compte.email)
    corps = _serie(salle, jour_ouvre)

    apercu = client.post("/api/bookings/recurring/preview", headers=entetes, json=corps)
    assert apercu.status_code == 200
    attendues = apercu.json()["accepted_count"]
    assert attendues >= 2

    creation = client.post("/api/bookings/recurring", headers=entetes, json=corps)
    assert creation.status_code == 201, creation.text
    assert len(creation.json()["bookings"]) == attendues


def test_serie_ecarte_la_date_en_conflit(
    client, compte, salle, jour_ouvre, ouverture, poser
):
    poser(creneau(jour_ouvre, 10, 0, 60), "Séminaire")
    entetes = connecter(client, compte.email)

    reponse = client.post(
        "/api/bookings/recurring", headers=entetes, json=_serie(salle, jour_ouvre)
    )
    assert reponse.status_code == 201
    corps = reponse.json()
    assert len(corps["skipped"]) == 1
    assert "Séminaire" in corps["skipped"][0]["reason"]


# --------------------------------------------------------------------------- #
# Administration
# --------------------------------------------------------------------------- #


def test_permission_manquante_refuse(client, session, administrateur, salle, jour_ouvre):
    accorder(session, administrateur, ROOMS_MANAGE)  # mais pas l'arbitrage
    entetes = connecter(client, administrateur.user.email, admin=True)

    reponse = client.get("/api/admin/bookings", headers=entetes)
    assert reponse.status_code == 403
    assert reponse.json()["error"]["code"] == "permission_manquante"


def test_admin_reserve_pour_un_tiers(
    client, session, administrateur, compte, salle, jour_ouvre, ouverture
):
    accorder(session, administrateur, CONFLICTS_ARBITRATE)
    entetes = connecter(client, administrateur.user.email, admin=True)

    corps = charge(jour_ouvre, 11, 60, salle) | {"owner_id": str(compte.id)}
    reponse = client.post("/api/admin/bookings", headers=entetes, json=corps)

    assert reponse.status_code == 201, reponse.text
    assert reponse.json()["owner_id"] == str(compte.id)
    assert reponse.json()["source"] == "admin"


def test_admin_force_les_regles_mais_pas_le_chevauchement(
    client, session, administrateur, compte, salle, jour_ouvre, ouverture, poser
):
    accorder(session, administrateur, CONFLICTS_ARBITRATE)
    entetes = connecter(client, administrateur.user.email, admin=True)

    # Capacité dépassée : forçable.
    forcee = charge(jour_ouvre, 11, 60, salle, effectif=salle.capacity + 10) | {
        "owner_id": str(compte.id),
        "ignore_rules": True,
    }
    assert client.post("/api/admin/bookings", headers=entetes, json=forcee).status_code == 201

    # Chevauchement : jamais forçable, la base l'interdit.
    poser(creneau(jour_ouvre, 16, 0, 60))
    conflit = charge(jour_ouvre, 16, 60, salle) | {
        "owner_id": str(compte.id),
        "ignore_rules": True,
    }
    refus = client.post("/api/admin/bookings", headers=entetes, json=conflit)
    assert refus.status_code == 409
    assert refus.json()["error"]["code"] == "conflit"


def test_blocage_rend_la_salle_indisponible(
    client, session, administrateur, compte, salle, jour_ouvre, ouverture
):
    accorder(session, administrateur, ROOMS_MANAGE)
    entetes_admin = connecter(client, administrateur.user.email, admin=True)

    plage = creneau(jour_ouvre, 8, 0, 600)  # dix heures : hors bornes de durée
    blocage = client.post(
        "/api/admin/blockings",
        headers=entetes_admin,
        json={
            "room_id": str(salle.id),
            "slot": {
                "starts_at": plage.lower.isoformat(),
                "ends_at": plage.upper.isoformat(),
            },
            "reason": "Travaux de peinture",
        },
    )
    assert blocage.status_code == 201, blocage.text
    assert blocage.json()["source"] == "blocage"
    assert blocage.json()["owner_id"] is None

    entetes = connecter(client, compte.email)
    refus = client.post(
        "/api/bookings", headers=entetes, json=charge(jour_ouvre, 10, 60, salle)
    )
    assert refus.status_code == 409


def test_maintenance_libere_les_creneaux_non_valides(
    client, session, administrateur, salle, utilisateur
):
    accorder(session, administrateur, SYSTEM_CONFIGURE)
    entetes = connecter(client, administrateur.user.email, admin=True)

    # Réservation commencée il y a une heure, jamais validée sur place.
    debut = datetime.now(PARIS) - timedelta(hours=1)
    abandonnee = Booking(
        room_id=salle.id,
        owner_id=utilisateur.id,
        title="Réunion fantôme",
        time_range=Range(debut, debut + timedelta(hours=2), bounds="[)"),
        attendee_count=3,
        status=BookingStatus.CONFIRMEE,
    )
    session.add(abandonnee)
    session.flush()

    reponse = client.post("/api/admin/maintenance/run", headers=entetes)
    assert reponse.status_code == 200
    assert reponse.json()["released"] >= 1

    session.refresh(abandonnee)
    assert abandonnee.status is BookingStatus.ANNULEE


def test_salle_archivee_absente_du_parc(client, session, compte, salle):
    salle.status = RoomStatus.ARCHIVEE
    session.flush()
    entetes = connecter(client, compte.email)
    liste = client.get("/api/rooms", headers=entetes).json()
    assert str(salle.id) not in {item["id"] for item in liste}

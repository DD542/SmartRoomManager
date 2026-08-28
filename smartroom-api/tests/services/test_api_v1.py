"""Tests d'intégration de l'API v1 : de la requête HTTP jusqu'à la contrainte."""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.orm import Session

from app.api.deps import CONFLICTS_ARBITRATE
from app.db.enums import BookingStatus
from app.models import Booking, RoomPhoto
from tests.services.conftest import accorder, charge, connecter, creneau


def poser(session: Session, salle, compte, slot, titre="Réunion existante") -> Booking:
    reservation = Booking(
        room_id=salle.id,
        owner_id=compte.id,
        title=titre,
        time_range=Range(slot.start, slot.end, bounds="[)"),
        attendee_count=4,
        status=BookingStatus.CONFIRMEE,
    )
    session.add(reservation)
    session.flush()
    return reservation


class TestDisponibilite:
    def test_creneaux_libres(self, client, compte, salle, jour_ouvre):
        entetes = connecter(client, compte.email)
        reponse = client.get(
            f"/api/v1/availability/rooms/{salle.id}/free-slots",
            headers=entetes,
            params={"first_day": jour_ouvre.isoformat()},
        )
        assert reponse.status_code == 200
        corps = reponse.json()
        assert corps["slots"]
        # L'écriture locale accompagne l'instant UTC, prête à afficher.
        assert "–" in corps["slots"][0]["local_label"]

    def test_periode_trop_longue_refusee(self, client, compte, salle, jour_ouvre):
        entetes = connecter(client, compte.email)
        reponse = client.get(
            f"/api/v1/availability/rooms/{salle.id}/free-slots",
            headers=entetes,
            params={
                "first_day": jour_ouvre.isoformat(),
                "last_day": (jour_ouvre + timedelta(days=60)).isoformat(),
            },
        )
        assert reponse.status_code == 422
        assert reponse.json()["error"]["code"] == "periode"

    def test_verification_d_un_creneau_libre(self, client, compte, salle, jour_ouvre):
        entetes = connecter(client, compte.email)
        reponse = client.post(
            f"/api/v1/availability/rooms/{salle.id}/check",
            headers=entetes,
            json={"slot": charge(creneau(jour_ouvre, 10)), "attendees": 4},
        )
        assert reponse.status_code == 200
        assert reponse.json() == {
            "available": True,
            "forcible": True,
            "requires_validation": False,
            "conflicts": [],
            "violations": [],
        }

    def test_verification_enumere_les_regles_violees(
        self, client, compte, salle, jour_ouvre
    ):
        """Un booléen ne suffirait pas : l'écran doit lister ce qui bloque."""
        entetes = connecter(client, compte.email)
        reponse = client.post(
            f"/api/v1/availability/rooms/{salle.id}/check",
            headers=entetes,
            json={"slot": charge(creneau(jour_ouvre, 22, 0, 20)), "attendees": 300},
        )
        corps = reponse.json()
        assert corps["available"] is False
        codes = {item["code"] for item in corps["violations"]}
        assert {"duree_min", "hors_ouverture", "capacite"} <= codes

    def test_chevauchement_qualifie(self, client, session, compte, salle, jour_ouvre):
        poser(session, salle, compte, creneau(jour_ouvre, 10, 0, 120), "Atelier")
        entetes = connecter(client, compte.email)

        corps = client.post(
            f"/api/v1/availability/rooms/{salle.id}/check",
            headers=entetes,
            json={"slot": charge(creneau(jour_ouvre, 10, 30)), "attendees": 4},
        ).json()

        assert corps["available"] is False
        assert corps["forcible"] is False
        conflit = corps["conflicts"][0]
        assert conflit["kind"] == "englobant"
        assert conflit["blocking"] is True
        assert "Atelier" in conflit["message"]

    def test_creneau_sans_fuseau_refuse(self, client, compte, salle, jour_ouvre):
        entetes = connecter(client, compte.email)
        reponse = client.post(
            f"/api/v1/availability/rooms/{salle.id}/check",
            headers=entetes,
            json={
                "slot": {"starts_at": "2026-08-25T10:00:00", "ends_at": "2026-08-25T11:00:00"},
                "attendees": 4,
            },
        )
        assert reponse.status_code == 422
        assert reponse.json()["error"]["code"] == "validation"

    def test_recherche_multicritere(self, client, compte, creer_salle, video, jour_ouvre):
        equipee = creer_salle("Equipee", capacity=12, equipements=[video])
        creer_salle("Nue", capacity=12)
        entetes = connecter(client, compte.email)

        reponse = client.post(
            "/api/v1/availability/search",
            headers=entetes,
            json={
                "slot": charge(creneau(jour_ouvre, 10)),
                "attendees": 8,
                "equipment_ids": [str(video.id)],
            },
        )
        assert reponse.status_code == 200
        identifiants = {item["room"]["id"] for item in reponse.json()}
        assert str(equipee.id) in identifiants

    def test_session_requise(self, client, salle, jour_ouvre):
        assert (
            client.post(
                f"/api/v1/availability/rooms/{salle.id}/check",
                json={"slot": charge(creneau(jour_ouvre, 10))},
            ).status_code
            == 401
        )


class TestReservation:
    def test_creation_puis_relecture(self, client, compte, salle, jour_ouvre):
        entetes = connecter(client, compte.email)
        reponse = client.post(
            "/api/v1/bookings",
            headers=entetes,
            json={
                "room_id": str(salle.id),
                "slot": charge(creneau(jour_ouvre, 10)),
                "title": "Revue de projet",
                "attendees": 4,
            },
        )
        assert reponse.status_code == 201, reponse.text
        corps = reponse.json()
        identifiant = corps["booking"]["id"]
        assert corps["booking"]["slot"]["duration_minutes"] == 60

        detail = client.get(f"/api/v1/bookings/{identifiant}", headers=entetes)
        assert detail.status_code == 200
        assert detail.json()["title"] == "Revue de projet"

    def test_creneau_pris_repond_409(self, client, session, compte, salle, jour_ouvre):
        poser(session, salle, compte, creneau(jour_ouvre, 10))
        entetes = connecter(client, compte.email)

        reponse = client.post(
            "/api/v1/bookings",
            headers=entetes,
            json={
                "room_id": str(salle.id),
                "slot": charge(creneau(jour_ouvre, 10)),
                "attendees": 4,
            },
        )
        assert reponse.status_code == 409
        assert reponse.json()["error"]["code"] == "conflit"

    def test_regle_violee_repond_422(self, client, compte, salle, jour_ouvre):
        entetes = connecter(client, compte.email)
        reponse = client.post(
            "/api/v1/bookings",
            headers=entetes,
            json={
                "room_id": str(salle.id),
                "slot": charge(creneau(jour_ouvre, 10, 0, 20)),
                "attendees": 4,
            },
        )
        assert reponse.status_code == 422
        assert reponse.json()["error"]["code"] == "duree_min"

    def test_annulation_motivee(self, client, session, compte, salle, jour_ouvre):
        reservation = poser(session, salle, compte, creneau(jour_ouvre, 10))
        entetes = connecter(client, compte.email)

        reponse = client.post(
            f"/api/v1/bookings/{reservation.id}/cancel",
            headers=entetes,
            json={"reason": "Réunion reportée"},
        )
        assert reponse.status_code == 200
        assert reponse.json()["status"] == "annulee"

    def test_reservation_d_autrui_invisible(
        self, client, session, compte, creer_compte, salle, jour_ouvre
    ):
        autre = poser(session, salle, compte, creneau(jour_ouvre, 10))
        intrus = creer_compte("Sam")
        entetes = connecter(client, intrus.email)

        # 404 et non 403 : l'existence d'une réservation tierce ne se confirme pas.
        assert client.get(f"/api/v1/bookings/{autre.id}", headers=entetes).status_code == 404

    def test_liste_ne_montre_que_les_siennes(
        self, client, session, compte, creer_compte, salle, jour_ouvre
    ):
        autre = creer_compte("Sam")
        poser(session, salle, compte, creneau(jour_ouvre, 10))
        poser(session, salle, autre, creneau(jour_ouvre, 12))

        entetes = connecter(client, compte.email)
        corps = client.get("/api/v1/bookings", headers=entetes).json()
        assert {item["owner_id"] for item in corps["items"]} == {str(compte.id)}
        assert corps["total"] == 1

    def test_alternatives_d_une_reservation(
        self, client, session, compte, salle, creer_salle, jour_ouvre
    ):
        creer_salle("Curie", capacity=12)
        reservation = poser(session, salle, compte, creneau(jour_ouvre, 10))
        entetes = connecter(client, compte.email)

        reponse = client.get(
            f"/api/v1/bookings/{reservation.id}/alternatives", headers=entetes
        )
        assert reponse.status_code == 200
        for item in reponse.json():
            assert item["kind"] in {
                "meme_salle_autre_creneau",
                "autre_salle_meme_creneau",
                "proche",
            }
            assert item["justification"]


class TestRecommandation:
    def test_classement_avec_le_detail_du_score(self, client, compte, salle, jour_ouvre):
        entetes = connecter(client, compte.email)
        reponse = client.post(
            "/api/v1/recommendations",
            headers=entetes,
            json={"slot": charge(creneau(jour_ouvre, 10)), "attendees": 8, "limit": 10},
        )
        assert reponse.status_code == 200
        propose = next(item for item in reponse.json() if item["room"]["id"] == str(salle.id))
        assert 0 <= propose["score"] <= 100
        assert {item["key"] for item in propose["breakdown"]} == {
            "capacity",
            "equipment",
            "building",
            "floor",
            "occupancy",
            "history",
        }

    def test_la_salle_classee_porte_de_quoi_dessiner_sa_carte(
        self, client, session, compte, salle, jour_ouvre
    ):
        """Photo, bâtiment, étage et surface, que le domaine ne connaît pas.

        Le tunnel de réservation rend la carte du catalogue à partir de cette
        réponse : sans ces champs, elle affichait un cadre d'image vide et
        « undefined m² » sous chaque salle proposée.
        """
        session.add(
            RoomPhoto(
                room_id=salle.id,
                file_url="/media/photos/vinci-2.jpg",
                position=1,
                alt_text="Vue de côté",
            )
        )
        session.add(
            RoomPhoto(
                room_id=salle.id,
                file_url="/media/photos/vinci-1.jpg",
                position=0,
                alt_text="Vue d'ensemble",
            )
        )
        session.flush()
        entetes = connecter(client, compte.email)

        corps = client.post(
            "/api/v1/recommendations",
            headers=entetes,
            json={"slot": charge(creneau(jour_ouvre, 10)), "attendees": 4, "limit": 20},
        ).json()

        vue = next(item["room"] for item in corps if item["room"]["id"] == str(salle.id))
        # Celle de position 0 : l'ordre est celui qu'a choisi l'administration.
        assert vue["photo_url"] == "/media/photos/vinci-1.jpg"
        assert vue["building_name"] == salle.floor.building.name
        assert vue["floor_label"] == salle.floor.label
        assert float(vue["area_m2"]) == float(salle.area_m2)

    def test_une_salle_sans_photo_le_dit_au_lieu_de_l_omettre(
        self, client, compte, salle, jour_ouvre
    ):
        entetes = connecter(client, compte.email)

        corps = client.post(
            "/api/v1/recommendations",
            headers=entetes,
            json={"slot": charge(creneau(jour_ouvre, 10)), "attendees": 4, "limit": 20},
        ).json()

        vue = next(item["room"] for item in corps if item["room"]["id"] == str(salle.id))
        assert vue["photo_url"] is None
        assert vue["building_name"]

    def test_salle_prise_reste_classee_mais_marquee(
        self, client, session, compte, salle, jour_ouvre
    ):
        poser(session, salle, compte, creneau(jour_ouvre, 10))
        entetes = connecter(client, compte.email)

        corps = client.post(
            "/api/v1/recommendations",
            headers=entetes,
            json={"slot": charge(creneau(jour_ouvre, 10)), "attendees": 4, "limit": 20},
        ).json()
        propose = next(item for item in corps if item["room"]["id"] == str(salle.id))
        assert propose["eligible"] is False
        assert "créneau déjà pris" in propose["justification"]

    def test_meilleure_salle_ou_null(self, client, compte, salle, jour_ouvre):
        entetes = connecter(client, compte.email)
        trouvee = client.post(
            "/api/v1/recommendations/best",
            headers=entetes,
            json={"slot": charge(creneau(jour_ouvre, 10)), "attendees": 4},
        )
        assert trouvee.status_code == 200
        assert trouvee.json()["eligible"] is True

        aucune = client.post(
            "/api/v1/recommendations/best", headers=entetes, json={"attendees": 500}
        )
        assert aucune.status_code == 200
        assert aucune.json() is None

    def test_alternatives_exigent_un_creneau(self, client, compte, salle):
        entetes = connecter(client, compte.email)
        reponse = client.post(
            f"/api/v1/recommendations/rooms/{salle.id}/alternatives",
            headers=entetes,
            json={"attendees": 4},
        )
        assert reponse.status_code == 422
        assert reponse.json()["error"]["code"] == "creneau_requis"


class TestArbitrage:
    def test_permission_requise(self, client, compte, salle, jour_ouvre):
        entetes = connecter(client, compte.email)
        reponse = client.post(
            f"/api/v1/recommendations/rooms/{salle.id}/arbitration",
            headers=entetes,
            json=charge(creneau(jour_ouvre, 10)),
        )
        assert reponse.status_code == 403

    def test_dossier_expose_les_criteres_sans_trancher(
        self, client, session, administrateur, compte, salle, jour_ouvre
    ):
        accorder(session, administrateur, CONFLICTS_ARBITRATE)
        poser(session, salle, compte, creneau(jour_ouvre, 10), "Titulaire")
        entetes = connecter(client, administrateur.user.email, admin=True)

        reponse = client.post(
            f"/api/v1/recommendations/rooms/{salle.id}/arbitration",
            headers=entetes,
            json=charge(creneau(jour_ouvre, 10)),
        )
        assert reponse.status_code == 200
        corps = reponse.json()
        assert len(corps["claimants"]) == 1

        facteurs = {item["key"] for item in corps["claimants"][0]["factors"]}
        assert facteurs == {"anteriorite", "quota", "absence"}
        # Aucun gagnant désigné, aucun score global : la décision reste humaine.
        assert "winner" not in corps
        assert "score" not in corps["claimants"][0]


class TestAuthentification:
    def test_connexion_et_session(self, client, compte):
        entetes = connecter(client, compte.email)
        reponse = client.get("/api/v1/auth/me", headers=entetes)
        assert reponse.status_code == 200
        assert reponse.json()["user"]["email"] == compte.email

    def test_message_identique_quel_que_soit_le_motif(self, client, compte):
        """La connexion ne sert pas d'annuaire d'adresses."""
        faux = client.post(
            "/api/v1/auth/login", json={"email": compte.email, "password": "au-hasard"}
        )
        inconnu = client.post(
            "/api/v1/auth/login", json={"email": "personne@ece.fr", "password": "au-hasard"}
        )
        assert faux.status_code == inconnu.status_code == 401
        assert faux.json()["error"]["message"] == inconnu.json()["error"]["message"]

    def test_espace_utilisateur_ne_donne_pas_l_administration(
        self, client, session, administrateur
    ):
        accorder(session, administrateur, CONFLICTS_ARBITRATE)
        entetes = connecter(client, administrateur.user.email)
        reponse = client.get("/api/v1/admin/bookings", headers=entetes)
        assert reponse.status_code == 403
        assert reponse.json()["error"]["code"] == "scope_invalide"


class TestAdministration:
    def test_permission_manquante(self, client, session, administrateur):
        accorder(session, administrateur, "rooms.manage")
        entetes = connecter(client, administrateur.user.email, admin=True)
        reponse = client.get("/api/v1/admin/bookings", headers=entetes)
        assert reponse.status_code == 403
        assert reponse.json()["error"]["code"] == "permission_manquante"

    def test_reserver_pour_un_tiers(
        self, client, session, administrateur, compte, salle, jour_ouvre
    ):
        accorder(session, administrateur, CONFLICTS_ARBITRATE)
        entetes = connecter(client, administrateur.user.email, admin=True)

        reponse = client.post(
            "/api/v1/admin/bookings",
            headers=entetes,
            json={
                "room_id": str(salle.id),
                "owner_id": str(compte.id),
                "slot": charge(creneau(jour_ouvre, 11)),
                "attendees": 4,
            },
        )
        assert reponse.status_code == 201, reponse.text
        assert reponse.json()["owner_id"] == str(compte.id)
        assert reponse.json()["source"] == "admin"

    def test_forcer_une_regle_mais_jamais_un_conflit(
        self, client, session, administrateur, compte, salle, jour_ouvre
    ):
        accorder(session, administrateur, CONFLICTS_ARBITRATE)
        entetes = connecter(client, administrateur.user.email, admin=True)
        corps = {
            "room_id": str(salle.id),
            "owner_id": str(compte.id),
            "slot": charge(creneau(jour_ouvre, 22)),
            "attendees": 4,
            "ignore_rules": True,
        }
        # Hors horaires : forcable.
        premiere = client.post("/api/v1/admin/bookings", headers=entetes, json=corps)
        assert premiere.status_code == 201, premiere.text
        # Le meme creneau une seconde fois : la base refuse, permission ou non.
        refus = client.post("/api/v1/admin/bookings", headers=entetes, json=corps)
        assert refus.status_code == 409
        assert refus.json()["error"]["code"] == "conflit"

    def test_blocage_rend_la_salle_indisponible(
        self, client, session, administrateur, compte, salle, jour_ouvre
    ):
        accorder(session, administrateur, "rooms.manage")
        entetes_admin = connecter(client, administrateur.user.email, admin=True)

        blocage = client.post(
            "/api/v1/admin/blockings",
            headers=entetes_admin,
            json={
                "room_id": str(salle.id),
                # Dix heures : bien au-dela de la duree maximale d'une reservation.
                "slot": charge(creneau(jour_ouvre, 8, 0, 600)),
                "reason": "Travaux de peinture",
            },
        )
        assert blocage.status_code == 201, blocage.text
        assert blocage.json()["source"] == "blocage"
        assert blocage.json()["owner_id"] is None

        entetes = connecter(client, compte.email)
        refus = client.post(
            "/api/v1/bookings",
            headers=entetes,
            json={
                "room_id": str(salle.id),
                "slot": charge(creneau(jour_ouvre, 10)),
                "attendees": 4,
            },
        )
        assert refus.status_code == 409

    def test_maintenance_libere_les_creneaux_non_valides(
        self, client, session, administrateur, compte, salle, maintenant
    ):
        accorder(session, administrateur, "system.configure")
        debut = maintenant - timedelta(minutes=30)
        session.add(
            Booking(
                room_id=salle.id,
                owner_id=compte.id,
                title="Reunion fantome",
                time_range=Range(debut, debut + timedelta(hours=2), bounds="[)"),
                attendee_count=3,
                status=BookingStatus.CONFIRMEE,
            )
        )
        session.flush()

        entetes = connecter(client, administrateur.user.email, admin=True)
        reponse = client.post("/api/v1/admin/maintenance/run", headers=entetes)
        assert reponse.status_code == 200
        assert reponse.json()["released"] >= 1


class TestRecurrence:
    def _serie(self, salle, depart) -> dict:
        return {
            "room_id": str(salle.id),
            "freq": "hebdomadaire",
            "interval_count": 1,
            "byweekday": [2],
            "start_date": depart.isoformat(),
            "until_date": (depart + timedelta(weeks=2)).isoformat(),
            "start_time": "10:00:00",
            "end_time": "11:00:00",
            "title": "Comite hebdomadaire",
            "attendees": 4,
        }

    def test_apercu_puis_creation(self, client, compte, salle, jour_ouvre):
        entetes = connecter(client, compte.email)
        corps = self._serie(salle, jour_ouvre)

        apercu = client.post(
            "/api/v1/bookings/recurring/preview", headers=entetes, json=corps
        )
        assert apercu.status_code == 200, apercu.text
        attendues = apercu.json()["accepted_count"]
        assert attendues >= 2

        creation = client.post("/api/v1/bookings/recurring", headers=entetes, json=corps)
        assert creation.status_code == 201, creation.text
        assert len(creation.json()["bookings"]) == attendues

    def test_la_date_en_conflit_est_ecartee(
        self, client, session, compte, salle, jour_ouvre
    ):
        poser(session, salle, compte, creneau(jour_ouvre, 10), "Seminaire")
        entetes = connecter(client, compte.email)

        reponse = client.post(
            "/api/v1/bookings/recurring", headers=entetes, json=self._serie(salle, jour_ouvre)
        )
        assert reponse.status_code == 201, reponse.text
        corps = reponse.json()
        assert len(corps["skipped"]) == 1
        assert "Seminaire" in corps["skipped"][0]["reason"]

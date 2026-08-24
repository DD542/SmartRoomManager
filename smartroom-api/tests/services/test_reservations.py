"""Domaine réservation : conflit enrichi, participants, dérogations, règles."""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select

from app.api.deps import CONFLICTS_ARBITRATE, RULES_CONFIGURE
from app.db.enums import BookingStatus, ParticipantResponse, RequestStatus
from app.models import AccessRequest, Booking, BookingParticipant, BookingRule, OpeningHour
from tests.services.conftest import accorder, charge, connecter, creneau
from tests.services.test_api_v1 import poser


def reserver(client, entetes, salle, slot, **extra) -> dict:
    corps = {
        "room_id": str(salle.id),
        "slot": charge(slot),
        "attendees": 4,
    } | extra
    return client.post("/api/v1/bookings", headers=entetes, json=corps)


class TestConflitEnrichi:
    def test_le_409_porte_le_conflit_qualifie(
        self, client, session, compte, salle, jour_ouvre
    ):
        """L'écran de conflit doit pouvoir tout afficher sans second appel."""
        poser(session, salle, compte, creneau(jour_ouvre, 10, 0, 120), "Atelier")
        entetes = connecter(client, compte.email)

        reponse = reserver(client, entetes, salle, creneau(jour_ouvre, 10, 30))
        assert reponse.status_code == 409

        erreur = reponse.json()["error"]
        assert erreur["code"] == "conflit"
        assert erreur["conflict"]["title"] == "Atelier"
        assert erreur["conflict"]["kind"] == "englobant"
        assert erreur["conflict"]["blocking"] is True
        assert "local_label" in erreur["conflict"]["slot"]

    def test_le_409_porte_des_alternatives(
        self, client, session, compte, salle, creer_salle, jour_ouvre
    ):
        creer_salle("Curie", capacity=12)
        poser(session, salle, compte, creneau(jour_ouvre, 10))
        entetes = connecter(client, compte.email)

        erreur = reserver(client, entetes, salle, creneau(jour_ouvre, 10)).json()["error"]
        assert erreur["alternatives"]
        for item in erreur["alternatives"]:
            assert item["kind"] in {
                "meme_salle_autre_creneau",
                "autre_salle_meme_creneau",
                "proche",
            }
            assert item["justification"]
            assert 0 <= item["score"] <= 100

    def test_une_regle_violee_ne_porte_pas_d_alternatives(
        self, client, compte, salle, jour_ouvre
    ):
        """Une durée trop courte se corrige sur place : proposer une autre
        salle n'aiderait pas."""
        entetes = connecter(client, compte.email)
        erreur = reserver(
            client, entetes, salle, creneau(jour_ouvre, 10, 0, 20)
        ).json()["error"]

        assert erreur["code"] == "duree_min"
        assert "alternatives" not in erreur


class TestParticipants:
    def test_invitation_puis_reponse(self, client, session, compte, salle, jour_ouvre):
        entetes = connecter(client, compte.email)
        identifiant = reserver(client, entetes, salle, creneau(jour_ouvre, 10)).json()[
            "booking"
        ]["id"]

        invitation = client.post(
            f"/api/v1/bookings/{identifiant}/participants",
            headers=entetes,
            json={"email": "invite@ece.fr", "display_name": "Alex Invité"},
        )
        assert invitation.status_code == 201, invitation.text
        jeton = invitation.json()["invitation_token"]

        # Réponse sans session : l'invité n'a pas de compte.
        reponse = client.post(
            "/api/v1/bookings/participants/respond",
            json={"token": jeton, "response": "accepte"},
        )
        assert reponse.status_code == 200
        assert reponse.json()["response"] == "accepte"
        assert reponse.json()["responded_at"] is not None

    def test_l_organisateur_figure_parmi_les_participants(
        self, client, compte, salle, jour_ouvre
    ):
        entetes = connecter(client, compte.email)
        identifiant = reserver(client, entetes, salle, creneau(jour_ouvre, 10)).json()[
            "booking"
        ]["id"]

        corps = client.get(
            f"/api/v1/bookings/{identifiant}/participants", headers=entetes
        ).json()
        assert corps[0]["is_organizer"] is True
        assert corps[0]["email"] == compte.email

    def test_double_invitation_refusee(self, client, compte, salle, jour_ouvre):
        entetes = connecter(client, compte.email)
        identifiant = reserver(client, entetes, salle, creneau(jour_ouvre, 10)).json()[
            "booking"
        ]["id"]
        corps = {"email": "invite@ece.fr", "display_name": "Alex"}

        client.post(f"/api/v1/bookings/{identifiant}/participants", headers=entetes, json=corps)
        seconde = client.post(
            f"/api/v1/bookings/{identifiant}/participants", headers=entetes, json=corps
        )
        assert seconde.status_code == 422
        assert seconde.json()["error"]["code"] == "doublon"

    def test_l_organisateur_ne_se_retire_pas(
        self, client, session, compte, salle, jour_ouvre
    ):
        entetes = connecter(client, compte.email)
        identifiant = reserver(client, entetes, salle, creneau(jour_ouvre, 10)).json()[
            "booking"
        ]["id"]
        organisateur = session.scalars(
            select(BookingParticipant).where(
                BookingParticipant.booking_id == identifiant,
                BookingParticipant.is_organizer.is_(True),
            )
        ).one()

        reponse = client.delete(
            f"/api/v1/bookings/{identifiant}/participants/{organisateur.id}",
            headers=entetes,
        )
        assert reponse.status_code == 422
        assert reponse.json()["error"]["code"] == "organisateur"

    def test_jeton_d_invitation_invalide(self, client):
        reponse = client.post(
            "/api/v1/bookings/participants/respond",
            json={"token": "a" * 40, "response": "accepte"},
        )
        assert reponse.status_code == 404
        assert reponse.json()["error"]["code"] == "jeton_invalide"


class TestRetard:
    def test_le_retard_vaut_validation(self, client, session, compte, salle, maintenant):
        from sqlalchemy.dialects.postgresql import Range

        debut = maintenant - timedelta(minutes=30)
        reservation = Booking(
            room_id=salle.id,
            owner_id=compte.id,
            title="Réunion tardive",
            time_range=Range(debut, debut + timedelta(hours=2), bounds="[)"),
            attendee_count=3,
            status=BookingStatus.CONFIRMEE,
        )
        session.add(reservation)
        session.flush()

        entetes = connecter(client, compte.email)
        reponse = client.post(f"/api/v1/bookings/{reservation.id}/late", headers=entetes)
        assert reponse.status_code == 200
        assert reponse.json()["checked_in_at"] is not None

    def test_retard_avant_le_debut_refuse(self, client, compte, salle, jour_ouvre):
        entetes = connecter(client, compte.email)
        identifiant = reserver(client, entetes, salle, creneau(jour_ouvre, 10)).json()[
            "booking"
        ]["id"]

        reponse = client.post(f"/api/v1/bookings/{identifiant}/late", headers=entetes)
        assert reponse.status_code == 422
        assert reponse.json()["error"]["code"] == "trop_tot"


class TestDemandesDAcces:
    def test_creneau_libre_refuse_la_demande(self, client, compte, salle, jour_ouvre):
        """Déposer une demande sur un créneau libre n'aurait aucun sens."""
        entetes = connecter(client, compte.email)
        reponse = client.post(
            "/api/v1/access-requests",
            headers=entetes,
            json={"room_id": str(salle.id), "slot": charge(creneau(jour_ouvre, 10))},
        )
        assert reponse.status_code == 422
        assert reponse.json()["error"]["code"] == "creneau_libre"

    def test_le_type_de_derogation_est_deduit(self, client, compte, salle, jour_ouvre):
        entetes = connecter(client, compte.email)
        reponse = client.post(
            "/api/v1/access-requests",
            headers=entetes,
            json={
                # 22:00 : hors des horaires d'ouverture de la salle.
                "room_id": str(salle.id),
                "slot": charge(creneau(jour_ouvre, 22)),
                "reason": "Répétition de soutenance",
            },
        )
        assert reponse.status_code == 201, reponse.text
        corps = reponse.json()
        assert corps["access_type"] == "hors_horaire"
        assert corps["status"] == "ouvert"
        assert corps["reference"].startswith("#CONF-")

    def test_conflit_de_reservation(self, client, session, compte, salle, jour_ouvre):
        poser(session, salle, compte, creneau(jour_ouvre, 10))
        entetes = connecter(client, compte.email)

        corps = client.post(
            "/api/v1/access-requests",
            headers=entetes,
            json={"room_id": str(salle.id), "slot": charge(creneau(jour_ouvre, 10))},
        ).json()
        assert corps["access_type"] == "conflit_reservation"

    def test_la_demande_d_autrui_est_invisible(
        self, client, session, compte, creer_compte, salle, jour_ouvre
    ):
        entetes = connecter(client, compte.email)
        demande = client.post(
            "/api/v1/access-requests",
            headers=entetes,
            json={"room_id": str(salle.id), "slot": charge(creneau(jour_ouvre, 22))},
        ).json()

        intrus = creer_compte("Sam")
        autres = connecter(client, intrus.email)
        assert client.get(
            f"/api/v1/access-requests/{demande['id']}", headers=autres
        ).status_code == 404

    def test_accorder_cree_la_reservation(
        self, client, session, administrateur, compte, salle, jour_ouvre
    ):
        """Accorder sans réserver laisserait l'utilisateur devant un refus."""
        entetes = connecter(client, compte.email)
        demande = client.post(
            "/api/v1/access-requests",
            headers=entetes,
            json={"room_id": str(salle.id), "slot": charge(creneau(jour_ouvre, 22))},
        ).json()

        accorder(session, administrateur, CONFLICTS_ARBITRATE)
        admin = connecter(client, administrateur.user.email, admin=True)

        decision = client.post(
            f"/api/v1/admin/access-requests/{demande['id']}/decide",
            headers=admin,
            json={"decision": "accorde", "comment": "Cas justifié"},
        )
        assert decision.status_code == 200, decision.text
        corps = decision.json()
        assert corps["status"] == "accorde"
        assert corps["booking_id"] is not None

        reservation = session.get(Booking, corps["booking_id"])
        assert reservation.is_forced is True
        assert reservation.owner_id == compte.id

    def test_refuser_ne_cree_rien(
        self, client, session, administrateur, compte, salle, jour_ouvre
    ):
        entetes = connecter(client, compte.email)
        demande = client.post(
            "/api/v1/access-requests",
            headers=entetes,
            json={"room_id": str(salle.id), "slot": charge(creneau(jour_ouvre, 22))},
        ).json()

        accorder(session, administrateur, CONFLICTS_ARBITRATE)
        admin = connecter(client, administrateur.user.email, admin=True)

        corps = client.post(
            f"/api/v1/admin/access-requests/{demande['id']}/decide",
            headers=admin,
            json={"decision": "refuse", "comment": "Hors cadre"},
        ).json()
        assert corps["status"] == "refuse"
        assert corps["booking_id"] is None

    def test_reorientation_sans_salle_refusee(
        self, client, session, administrateur, compte, salle, jour_ouvre
    ):
        entetes = connecter(client, compte.email)
        demande = client.post(
            "/api/v1/access-requests",
            headers=entetes,
            json={"room_id": str(salle.id), "slot": charge(creneau(jour_ouvre, 22))},
        ).json()

        accorder(session, administrateur, CONFLICTS_ARBITRATE)
        admin = connecter(client, administrateur.user.email, admin=True)

        reponse = client.post(
            f"/api/v1/admin/access-requests/{demande['id']}/decide",
            headers=admin,
            json={"decision": "reoriente"},
        )
        assert reponse.status_code == 422
        assert reponse.json()["error"]["code"] == "alternative_requise"

    def test_une_demande_ne_se_tranche_qu_une_fois(
        self, client, session, administrateur, compte, salle, jour_ouvre
    ):
        entetes = connecter(client, compte.email)
        demande = client.post(
            "/api/v1/access-requests",
            headers=entetes,
            json={"room_id": str(salle.id), "slot": charge(creneau(jour_ouvre, 22))},
        ).json()

        accorder(session, administrateur, CONFLICTS_ARBITRATE)
        admin = connecter(client, administrateur.user.email, admin=True)
        corps = {"decision": "refuse", "comment": "Hors cadre"}

        client.post(
            f"/api/v1/admin/access-requests/{demande['id']}/decide", headers=admin, json=corps
        )
        seconde = client.post(
            f"/api/v1/admin/access-requests/{demande['id']}/decide", headers=admin, json=corps
        )
        assert seconde.status_code == 422
        assert seconde.json()["error"]["code"] == "deja_decidee"


class TestRegles:
    def test_la_regle_de_salle_coiffe_la_globale(
        self, client, session, administrateur, salle
    ):
        accorder(session, administrateur, RULES_CONFIGURE)
        entetes = connecter(client, administrateur.user.email, admin=True)

        client.put(
            "/api/v1/booking-rules/salle",
            headers=entetes,
            params={"room_id": str(salle.id)},
            json={"min_duration_min": 60, "buffer_min": 5},
        )
        corps = client.get(
            f"/api/v1/rooms/{salle.id}/booking-rules", headers=entetes
        ).json()
        assert corps["min_duration_min"] == 60
        assert corps["scope"] == "salle"

    def test_portee_et_cible_doivent_concorder(self, client, session, administrateur):
        accorder(session, administrateur, RULES_CONFIGURE)
        entetes = connecter(client, administrateur.user.email, admin=True)

        reponse = client.put(
            "/api/v1/booking-rules/salle", headers=entetes, json={"min_duration_min": 60}
        )
        assert reponse.status_code == 422
        assert reponse.json()["error"]["code"] == "cible"

    def test_apercu_sans_ecriture(self, client, session, administrateur, compte, salle, jour_ouvre):
        poser(session, salle, compte, creneau(jour_ouvre, 10, 0, 60))
        accorder(session, administrateur, RULES_CONFIGURE)
        entetes = connecter(client, administrateur.user.email, admin=True)

        avant = session.scalars(select(BookingRule)).all()
        corps = client.post(
            "/api/v1/booking-rules/preview",
            headers=entetes,
            json={"min_duration_min": 120},
        ).json()

        assert corps["examined"] >= 1
        assert corps["too_short"] >= 1
        assert len(session.scalars(select(BookingRule)).all()) == len(avant)

    def test_les_horaires_sont_remplaces_en_bloc(
        self, client, session, administrateur, salle
    ):
        from datetime import time as heure

        accorder(session, administrateur, RULES_CONFIGURE)
        entetes = connecter(client, administrateur.user.email, admin=True)

        corps = client.put(
            "/api/v1/opening-hours/salle",
            headers=entetes,
            params={"room_id": str(salle.id)},
            json=[
                {"weekday": jour, "opens_at": "09:00:00", "closes_at": "18:00:00"}
                for jour in range(5)
            ],
        )
        assert corps.status_code == 200
        assert len(corps.json()) == 5

        restants = session.scalars(
            select(OpeningHour).where(OpeningHour.room_id == salle.id)
        ).all()
        assert len(restants) == 5
        assert all(item.opens_at == heure(9, 0) for item in restants)

    def test_horaires_resolus_pour_une_salle(
        self, client, session, administrateur, salle, compte
    ):
        """La fiche salle lit l'amplitude résolue, pas les lignes brutes : sans
        cela, elle afficherait les horaires du campus pour une salle qui a les
        siens."""
        accorder(session, administrateur, RULES_CONFIGURE)
        entetes = connecter(client, administrateur.user.email, admin=True)
        client.put(
            "/api/v1/opening-hours/salle",
            headers=entetes,
            params={"room_id": str(salle.id)},
            json=[
                {"weekday": jour, "opens_at": "09:00:00", "closes_at": "18:00:00"}
                for jour in range(1, 6)
            ],
        )

        corps = client.get(
            f"/api/v1/rooms/{salle.id}/opening-hours",
            headers=connecter(client, compte.email),
        ).json()
        assert {item["weekday"] for item in corps} == {1, 2, 3, 4, 5}
        assert all(item["scope"] == "salle" for item in corps)

    def test_jour_duplique_refuse(self, client, session, administrateur, salle):
        accorder(session, administrateur, RULES_CONFIGURE)
        entetes = connecter(client, administrateur.user.email, admin=True)

        reponse = client.put(
            "/api/v1/opening-hours/salle",
            headers=entetes,
            params={"room_id": str(salle.id)},
            json=[
                {"weekday": 1, "opens_at": "09:00:00", "closes_at": "18:00:00"},
                {"weekday": 1, "opens_at": "19:00:00", "closes_at": "20:00:00"},
            ],
        )
        assert reponse.status_code == 422
        assert reponse.json()["error"]["code"] == "doublon"


class TestFermetures:
    def test_fermeture_globale_sans_cible(self, client, session, administrateur, jour_ouvre):
        accorder(session, administrateur, RULES_CONFIGURE)
        entetes = connecter(client, administrateur.user.email, admin=True)

        reponse = client.post(
            "/api/v1/closures",
            headers=entetes,
            json={
                "label": "Journée pédagogique",
                "first_day": jour_ouvre.isoformat(),
                "last_day": jour_ouvre.isoformat(),
                "is_global": True,
            },
        )
        assert reponse.status_code == 201, reponse.text
        corps = reponse.json()
        # DATERANGE stocké en [début, fin[ : le dernier jour rendu doit être
        # celui qui a été demandé.
        assert corps["last_day"] == jour_ouvre.isoformat()

    def test_globale_avec_cible_refusee(
        self, client, session, administrateur, salle, jour_ouvre
    ):
        accorder(session, administrateur, RULES_CONFIGURE)
        entetes = connecter(client, administrateur.user.email, admin=True)

        reponse = client.post(
            "/api/v1/closures",
            headers=entetes,
            json={
                "label": "Contradictoire",
                "first_day": jour_ouvre.isoformat(),
                "last_day": jour_ouvre.isoformat(),
                "is_global": True,
                "room_ids": [str(salle.id)],
            },
        )
        assert reponse.status_code == 422
        assert reponse.json()["error"]["code"] == "cible"

    def test_ciblee_sans_cible_refusee(self, client, session, administrateur, jour_ouvre):
        accorder(session, administrateur, RULES_CONFIGURE)
        entetes = connecter(client, administrateur.user.email, admin=True)

        reponse = client.post(
            "/api/v1/closures",
            headers=entetes,
            json={
                "label": "Sans cible",
                "first_day": jour_ouvre.isoformat(),
                "last_day": jour_ouvre.isoformat(),
                "is_global": False,
            },
        )
        assert reponse.status_code == 422

    def test_impact_avant_de_fermer(
        self, client, session, administrateur, compte, salle, jour_ouvre
    ):
        """Fermer sans voir les réunions du jour serait décider à l'aveugle."""
        poser(session, salle, compte, creneau(jour_ouvre, 10))
        accorder(session, administrateur, RULES_CONFIGURE)
        entetes = connecter(client, administrateur.user.email, admin=True)

        fermeture = client.post(
            "/api/v1/closures",
            headers=entetes,
            json={
                "label": "Travaux",
                "first_day": jour_ouvre.isoformat(),
                "last_day": jour_ouvre.isoformat(),
                "is_global": False,
                "room_ids": [str(salle.id)],
            },
        ).json()

        impact = client.get(
            f"/api/v1/closures/{fermeture['id']}/impact", headers=entetes
        ).json()
        assert len(impact) == 1

    def test_la_fermeture_rend_le_creneau_impossible(
        self, client, session, administrateur, compte, salle, jour_ouvre
    ):
        accorder(session, administrateur, RULES_CONFIGURE)
        admin = connecter(client, administrateur.user.email, admin=True)
        client.post(
            "/api/v1/closures",
            headers=admin,
            json={
                "label": "Jour férié",
                "first_day": jour_ouvre.isoformat(),
                "last_day": jour_ouvre.isoformat(),
                "is_global": True,
            },
        )

        entetes = connecter(client, compte.email)
        reponse = reserver(client, entetes, salle, creneau(jour_ouvre, 10))
        assert reponse.status_code == 422
        assert reponse.json()["error"]["code"] == "fermeture"

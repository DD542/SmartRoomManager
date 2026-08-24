"""Tests d'intégration du parc et du calendrier de disponibilité."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import ROOMS_MANAGE
from app.db.enums import AuditAction, RoomStatus
from app.models import AuditLog, Equipment, Room, RoomEquipment
from tests.services.conftest import accorder, charge, connecter, creneau
from tests.services.test_api_v1 import poser


def salle_utile(client, entetes, salle) -> dict:
    return client.get(f"/api/v1/rooms/{salle.id}", headers=entetes).json()


class TestBatiments:
    def test_liste_avec_decomptes(self, client, compte, salle, batiment):
        entetes = connecter(client, compte.email)
        corps = client.get("/api/v1/buildings", headers=entetes).json()

        vise = next(item for item in corps if item["id"] == str(batiment.id))
        assert vise["floor_count"] == 1
        assert vise["room_count"] >= 1

    def test_etages_d_un_batiment(self, client, compte, salle, batiment, etage):
        entetes = connecter(client, compte.email)
        corps = client.get(f"/api/v1/buildings/{batiment.id}/floors", headers=entetes).json()

        assert [item["id"] for item in corps] == [str(etage.id)]
        assert corps[0]["room_count"] >= 1

    def test_batiment_inconnu(self, client, compte):
        import uuid

        entetes = connecter(client, compte.email)
        reponse = client.get(f"/api/v1/buildings/{uuid.uuid4()}", headers=entetes)
        assert reponse.status_code == 404
        assert reponse.json()["error"]["code"] == "introuvable"


class TestSalles:
    def test_liste_paginee(self, client, compte, creer_salle):
        for index in range(5):
            creer_salle(f"Salle{index}", capacity=10 + index)
        entetes = connecter(client, compte.email)

        corps = client.get("/api/v1/rooms", headers=entetes, params={"size": 2}).json()
        assert len(corps["items"]) == 2
        assert corps["total"] >= 5
        assert corps["pagination"]["has_next"] is True
        assert corps["pagination"]["page"] == 1

    def test_tri_descendant(self, client, compte, creer_salle):
        creer_salle("Petite", capacity=4)
        creer_salle("Grande", capacity=90)
        entetes = connecter(client, compte.email)

        corps = client.get(
            "/api/v1/rooms", headers=entetes, params={"sort": "-capacity", "size": 50}
        ).json()
        capacites = [item["capacity"] for item in corps["items"]]
        assert capacites == sorted(capacites, reverse=True)

    def test_tri_inconnu_refuse(self, client, compte):
        """Un tri silencieusement ignoré produit un écran qui ment sur son état."""
        entetes = connecter(client, compte.email)
        reponse = client.get("/api/v1/rooms", headers=entetes, params={"sort": "couleur"})
        assert reponse.status_code == 422
        assert reponse.json()["error"]["code"] == "validation"
        assert reponse.json()["error"]["fields"][0]["field"] == "sort"

    def test_filtre_par_equipement(self, client, compte, creer_salle, video):
        equipee = creer_salle("Equipee", equipements=[video])
        creer_salle("Nue")
        entetes = connecter(client, compte.email)

        corps = client.get(
            "/api/v1/rooms",
            headers=entetes,
            params={"equipment_ids": str(video.id), "size": 50},
        ).json()
        assert str(equipee.id) in {item["id"] for item in corps["items"]}
        assert corps["total"] == 1

    def test_la_fiche_aplatit_l_etage_et_le_batiment(
        self, client, compte, salle, batiment, video
    ):
        entetes = connecter(client, compte.email)
        corps = salle_utile(client, entetes, salle)

        assert corps["building_name"] == batiment.name
        assert corps["floor_level"] == 3
        assert isinstance(corps["equipments"], list)

    def test_filtres_proposes(self, client, compte, salle, video):
        entetes = connecter(client, compte.email)
        corps = client.get("/api/v1/rooms/filters", headers=entetes).json()

        assert corps["capacity_max"] >= corps["capacity_min"] > 0
        assert "disponible" in corps["statuses"]
        assert any(item["code"] == video.code for item in corps["equipments"])


class TestAdministrationDuParc:
    def test_creation_derive_l_identifiant_lisible(
        self, client, session, administrateur, etage
    ):
        accorder(session, administrateur, ROOMS_MANAGE)
        entetes = connecter(client, administrateur.user.email, admin=True)

        reponse = client.post(
            "/api/v1/rooms",
            headers=entetes,
            json={
                "floor_id": str(etage.id),
                "name": "Salle Léonard de Vinci",
                "capacity": 12,
                "area_m2": "28.50",
            },
        )
        assert reponse.status_code == 201, reponse.text
        assert reponse.json()["slug"] == "salle-leonard-de-vinci"

    def test_ecriture_sans_permission(self, client, session, administrateur, etage):
        entetes = connecter(client, administrateur.user.email, admin=True)
        reponse = client.post(
            "/api/v1/rooms",
            headers=entetes,
            json={"floor_id": str(etage.id), "name": "Interdite", "capacity": 8,
                  "area_m2": "20.00"},
        )
        assert reponse.status_code == 403
        assert reponse.json()["error"]["code"] == "permission_manquante"

    def test_la_modification_est_auditee_avec_avant_et_apres(
        self, client, session, administrateur, salle
    ):
        accorder(session, administrateur, ROOMS_MANAGE)
        entetes = connecter(client, administrateur.user.email, admin=True)

        client.patch(
            f"/api/v1/rooms/{salle.id}", headers=entetes, json={"capacity": 30}
        )
        trace = session.scalars(
            select(AuditLog).where(
                AuditLog.target_id == salle.id, AuditLog.action == AuditAction.MODIFICATION
            )
        ).one()
        assert trace.diff_before["capacity"] == 12
        assert trace.diff_after["capacity"] == 30
        assert trace.actor_label.startswith("Lea")

    def test_les_equipements_sont_remplaces_pas_ajoutes(
        self, client, session, administrateur, salle, video, marque
    ):
        accorder(session, administrateur, ROOMS_MANAGE)
        autre = Equipment(
            code=f"tableau-{marque}", label="Tableau", category="mobilier", icon="pen"
        )
        session.add(autre)
        session.flush()
        entetes = connecter(client, administrateur.user.email, admin=True)

        client.patch(
            f"/api/v1/rooms/{salle.id}",
            headers=entetes,
            json={"equipments": [{"equipment_id": str(video.id), "quantity": 1}]},
        )
        corps = client.patch(
            f"/api/v1/rooms/{salle.id}",
            headers=entetes,
            json={"equipments": [{"equipment_id": str(autre.id), "quantity": 2}]},
        ).json()

        assert [item["equipment_id"] for item in corps["equipments"]] == [str(autre.id)]

    def test_archivage_refuse_avec_reservations_a_venir(
        self, client, session, administrateur, compte, salle, jour_ouvre
    ):
        accorder(session, administrateur, ROOMS_MANAGE)
        poser(session, salle, compte, creneau(jour_ouvre, 10))
        entetes = connecter(client, administrateur.user.email, admin=True)

        reponse = client.delete(f"/api/v1/rooms/{salle.id}", headers=entetes)
        assert reponse.status_code == 422
        assert reponse.json()["error"]["code"] == "reservations_actives"

    def test_archivage_sans_reservation(self, client, session, administrateur, salle):
        accorder(session, administrateur, ROOMS_MANAGE)
        entetes = connecter(client, administrateur.user.email, admin=True)

        assert client.delete(f"/api/v1/rooms/{salle.id}", headers=entetes).status_code == 204
        session.refresh(salle)
        assert salle.status is RoomStatus.ARCHIVEE
        assert salle.deleted_at is not None

    def test_action_groupee_isole_les_echecs(
        self, client, session, administrateur, compte, creer_salle, jour_ouvre
    ):
        """Une salle en échec n'annule pas les autres."""
        accorder(session, administrateur, ROOMS_MANAGE)
        libre = creer_salle("Libre")
        occupee = creer_salle("Occupee")
        poser(session, occupee, compte, creneau(jour_ouvre, 10))
        entetes = connecter(client, administrateur.user.email, admin=True)

        corps = client.post(
            "/api/v1/rooms/bulk",
            headers=entetes,
            json={"room_ids": [str(libre.id), str(occupee.id)], "action": "archive"},
        ).json()

        assert corps["succeeded"] == [str(libre.id)]
        assert len(corps["failed"]) == 1
        assert corps["failed"][0]["room_id"] == str(occupee.id)

    def test_action_groupee_incoherente_refusee(self, client, session, administrateur, salle):
        accorder(session, administrateur, ROOMS_MANAGE)
        entetes = connecter(client, administrateur.user.email, admin=True)

        reponse = client.post(
            "/api/v1/rooms/bulk",
            headers=entetes,
            json={"room_ids": [str(salle.id)], "action": "status"},
        )
        assert reponse.status_code == 422


class TestEquipements:
    def test_liste_avec_decompte_de_salles(self, client, compte, creer_salle, video):
        creer_salle("Equipee", equipements=[video])
        entetes = connecter(client, compte.email)

        corps = client.get("/api/v1/equipments", headers=entetes, params={"size": 50}).json()
        vise = next(item for item in corps["items"] if item["id"] == str(video.id))
        assert vise["room_count"] == 1

    def test_suppression_refusee_si_utilise(
        self, client, session, administrateur, creer_salle, video
    ):
        accorder(session, administrateur, ROOMS_MANAGE)
        creer_salle("Equipee", equipements=[video])
        entetes = connecter(client, administrateur.user.email, admin=True)

        reponse = client.delete(f"/api/v1/equipments/{video.id}", headers=entetes)
        assert reponse.status_code == 422
        assert reponse.json()["error"]["code"] == "reference"

    def test_suppression_d_un_equipement_libre(self, client, session, administrateur, video):
        accorder(session, administrateur, ROOMS_MANAGE)
        entetes = connecter(client, administrateur.user.email, admin=True)

        assert client.delete(f"/api/v1/equipments/{video.id}", headers=entetes).status_code == 204
        assert session.get(Equipment, video.id) is None


class TestPlan:
    def test_placement_hors_du_plan_refuse(self, client, session, administrateur, salle, etage):
        accorder(session, administrateur, ROOMS_MANAGE)
        entetes = connecter(client, administrateur.user.email, admin=True)

        reponse = client.patch(
            f"/api/v1/floors/{etage.id}/placements",
            headers=entetes,
            json=[
                {
                    "room_id": str(salle.id),
                    "pos_x": "90.0", "pos_y": "10.0",
                    "width": "30.0", "height": "10.0",
                }
            ],
        )
        assert reponse.status_code == 422
        assert "déborde" in reponse.json()["error"]["message"]

    def test_placement_puis_retrait(self, client, session, administrateur, salle, etage):
        accorder(session, administrateur, ROOMS_MANAGE)
        entetes = connecter(client, administrateur.user.email, admin=True)

        pose = client.patch(
            f"/api/v1/floors/{etage.id}/placements",
            headers=entetes,
            json=[
                {
                    "room_id": str(salle.id),
                    "pos_x": "10.0", "pos_y": "10.0",
                    "width": "20.0", "height": "15.0",
                    "is_entrance_marked": True,
                }
            ],
        )
        assert pose.status_code == 200
        assert Decimal(pose.json()[0]["pos_x"]) == Decimal("10.0")

        assert client.post(
            f"/api/v1/rooms/{salle.id}/unplace", headers=entetes
        ).status_code == 204

    def test_salle_archivee_non_placable(
        self, client, session, administrateur, creer_salle, etage
    ):
        accorder(session, administrateur, ROOMS_MANAGE)
        archivee = creer_salle("Archivee", statut=RoomStatus.ARCHIVEE)
        entetes = connecter(client, administrateur.user.email, admin=True)

        reponse = client.patch(
            f"/api/v1/floors/{etage.id}/placements",
            headers=entetes,
            json=[
                {
                    "room_id": str(archivee.id),
                    "pos_x": "5.0", "pos_y": "5.0", "width": "10.0", "height": "10.0",
                }
            ],
        )
        assert reponse.status_code == 422
        assert reponse.json()["error"]["code"] == "salle_archivee"


class TestCalendrier:
    def test_chargement_par_plage_visible(
        self, client, session, compte, salle, jour_ouvre
    ):
        poser(session, salle, compte, creneau(jour_ouvre, 10), "Atelier")
        entetes = connecter(client, compte.email)

        debut = creneau(jour_ouvre, 8).start
        fin = creneau(jour_ouvre, 20).end
        corps = client.get(
            "/api/v1/availability/calendar",
            headers=entetes,
            params={"from_date": debut.isoformat(), "to_date": fin.isoformat()},
        ).json()

        evenement = next(item for item in corps["events"] if item["title"] == "Atelier")
        # Les noms sont ceux de FullCalendar : les renommer imposerait un
        # adaptateur côté front pour aucun gain.
        assert set(evenement) >= {"id", "title", "start", "end", "room_name"}
        assert evenement["is_mine"] is True
        assert evenement["is_blocking"] is False

    def test_la_reservation_d_autrui_n_est_pas_mienne(
        self, client, session, compte, creer_compte, salle, jour_ouvre
    ):
        autre = creer_compte("Sam")
        poser(session, salle, autre, creneau(jour_ouvre, 10), "Chez Sam")
        entetes = connecter(client, compte.email)

        corps = client.get(
            "/api/v1/availability/calendar",
            headers=entetes,
            params={
                "from_date": creneau(jour_ouvre, 8).start.isoformat(),
                "to_date": creneau(jour_ouvre, 20).end.isoformat(),
            },
        ).json()
        evenement = next(item for item in corps["events"] if item["title"] == "Chez Sam")
        assert evenement["is_mine"] is False

    def test_les_plages_fermees_accompagnent_une_salle_unique(
        self, client, compte, salle, jour_ouvre
    ):
        entetes = connecter(client, compte.email)
        corps = client.get(
            "/api/v1/availability/calendar",
            headers=entetes,
            params={
                "from_date": creneau(jour_ouvre, 0).start.isoformat(),
                "to_date": creneau(jour_ouvre, 23).end.isoformat(),
                "room_ids": str(salle.id),
            },
        ).json()
        # La salle ouvre de 08:00 à 20:00 : le matin et le soir sont fermés.
        assert len(corps["closed"]) == 2

    def test_plage_trop_large_refusee(self, client, compte, jour_ouvre):
        entetes = connecter(client, compte.email)
        reponse = client.get(
            "/api/v1/availability/calendar",
            headers=entetes,
            params={
                "from_date": creneau(jour_ouvre, 8).start.isoformat(),
                "to_date": (creneau(jour_ouvre, 8).start + timedelta(days=60)).isoformat(),
            },
        )
        assert reponse.status_code == 422
        assert reponse.json()["error"]["code"] == "periode"

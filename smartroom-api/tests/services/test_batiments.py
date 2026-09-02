"""Administration du parc : bâtiments, étages et visuels.

L'API ne savait que *lire* les bâtiments et les étages. Les déclarer se faisait
par le seed, donc jamais depuis l'application — un parc réel change pourtant :
un bâtiment ouvre, un niveau se rénove, une aile ferme.

Ce module éprouve les écritures nouvelles. Deux garanties y reviennent :

* **Rien ne se supprime en cascade.** Un bâtiment ou un étage encore peuplé se
  refuse, et le message dit combien de salles s'y trouvent. Archiver les salles
  d'office serait pire qu'un refus : une salle archivée reste citée dans les
  réservations passées, et son bâtiment doit rester lisible.
* **Un visuel remplacé efface celui qu'il remplace.** Sans cela, chaque
  changement laisse sur le disque un fichier que plus rien ne référence, et
  rien dans l'application ne signale jamais le volume perdu.
"""

from __future__ import annotations

import base64
import zlib

import pytest

from app.api.deps import ROOMS_MANAGE
from app.core import storage
from tests.services.conftest import accorder, connecter

pytestmark = pytest.mark.integration


def _png(largeur: int = 1) -> bytes:
    """PNG minuscule mais valide, sans dependance d'imagerie."""

    def bloc(nom: bytes, donnees: bytes) -> bytes:
        corps = nom + donnees
        return (
            len(donnees).to_bytes(4, "big")
            + corps
            + zlib.crc32(corps).to_bytes(4, "big")
        )

    entete = (
        largeur.to_bytes(4, "big") + (1).to_bytes(4, "big") + bytes([8, 2, 0, 0, 0])
    )
    return (
        b"\x89PNG\r\n\x1a\n"
        + bloc(b"IHDR", entete)
        + bloc(b"IDAT", zlib.compress(b"\x00" + b"\x00\x00\x00" * largeur))
        + bloc(b"IEND", b"")
    )


def _visuel(contenu: bytes | None = None, content_type: str = "image/png") -> dict:
    return {
        "content_type": content_type,
        "content": base64.b64encode(
            contenu if contenu is not None else _png()
        ).decode(),
    }


def _sur_disque(url: str) -> bool:
    return (storage.racine() / url.split("/media/", 1)[1]).exists()


@pytest.fixture
def gestionnaire(client, session, administrateur):
    accorder(session, administrateur, ROOMS_MANAGE)
    return connecter(client, administrateur.user.email, admin=True)


@pytest.fixture
def batiment_cree(client, gestionnaire, marque):
    reponse = client.post(
        "/api/v1/buildings",
        headers=gestionnaire,
        json={
            "code": marque[:4].upper(),
            "name": f"Eiffel {marque}",
            "address": "1 rue du test",
        },
    )
    assert reponse.status_code == 201, reponse.text
    return reponse.json()


class TestBatiments:
    def test_un_batiment_se_declare_depuis_l_application(self, batiment_cree):
        assert batiment_cree["name"].startswith("Eiffel")
        # Un bâtiment naît vide : les niveaux s'ajoutent ensuite, et une salle
        # ne se rattache qu'à un étage.
        assert batiment_cree["floor_count"] == 0
        assert batiment_cree["room_count"] == 0

    def test_un_code_deja_pris_est_refuse_lisiblement(
        self, client, gestionnaire, batiment_cree
    ):
        """Le doublon est traduit ici plutôt que laissé à PostgreSQL, dont le
        message nomme une contrainte et pas un bâtiment."""
        reponse = client.post(
            "/api/v1/buildings",
            headers=gestionnaire,
            json={"code": batiment_cree["code"], "name": "Autre bâtiment"},
        )

        assert reponse.status_code == 422, reponse.text
        assert reponse.json()["error"]["code"] == "code_pris"
        assert batiment_cree["code"] in reponse.json()["error"]["message"]

    def test_le_nom_et_l_adresse_se_modifient(
        self, client, gestionnaire, batiment_cree
    ):
        reponse = client.patch(
            f"/api/v1/buildings/{batiment_cree['id']}",
            headers=gestionnaire,
            json={"name": "Eiffel 1 — aile nord", "address": "2 rue du test"},
        )

        assert reponse.status_code == 200, reponse.text
        assert reponse.json()["name"] == "Eiffel 1 — aile nord"
        # Le code n'est pas modifiable : il est cité dans les exports déjà
        # produits et dans le journal d'audit.
        assert reponse.json()["code"] == batiment_cree["code"]

    def test_un_batiment_vide_se_supprime(self, client, gestionnaire, batiment_cree):
        reponse = client.delete(
            f"/api/v1/buildings/{batiment_cree['id']}", headers=gestionnaire
        )
        assert reponse.status_code == 204, reponse.text
        assert (
            client.get(
                f"/api/v1/buildings/{batiment_cree['id']}", headers=gestionnaire
            ).status_code
            == 404
        )

    def test_un_batiment_peuple_ne_se_supprime_pas(self, client, gestionnaire, salle):
        """Le message dit combien de salles s'y trouvent : « violation de clé
        étrangère » n'aiderait personne à agir."""
        reponse = client.delete(
            f"/api/v1/buildings/{salle.floor.building_id}", headers=gestionnaire
        )

        assert reponse.status_code == 422, reponse.text
        assert reponse.json()["error"]["code"] == "batiment_occupe"
        assert "salle" in reponse.json()["error"]["message"]

    def test_la_lecture_reste_ouverte_a_tout_compte_connecte(
        self, client, creer_compte, batiment_cree
    ):
        """Consulter le parc n'est pas un acte d'administration : le tunnel de
        réservation en a besoin."""
        entetes = connecter(client, creer_compte("Sami").email)
        assert client.get("/api/v1/buildings", headers=entetes).status_code == 200

    def test_l_ecriture_exige_la_permission(self, client, creer_compte):
        entetes = connecter(client, creer_compte("Tom").email)
        reponse = client.post(
            "/api/v1/buildings", headers=entetes, json={"code": "ZZ", "name": "Pirate"}
        )
        assert reponse.status_code == 403


class TestEtages:
    def test_un_etage_s_ajoute_a_son_batiment(
        self, client, gestionnaire, batiment_cree
    ):
        reponse = client.post(
            f"/api/v1/buildings/{batiment_cree['id']}/floors",
            headers=gestionnaire,
            json={"code": "R0", "label": "Rez-de-chaussée", "level": 0},
        )

        assert reponse.status_code == 201, reponse.text
        assert reponse.json()["building_id"] == batiment_cree["id"]
        assert reponse.json()["room_count"] == 0

    def test_deux_etages_ne_partagent_ni_code_ni_niveau(
        self, client, gestionnaire, batiment_cree
    ):
        corps = {"code": "R0", "label": "Rez-de-chaussée", "level": 0}
        client.post(
            f"/api/v1/buildings/{batiment_cree['id']}/floors",
            headers=gestionnaire,
            json=corps,
        )

        reponse = client.post(
            f"/api/v1/buildings/{batiment_cree['id']}/floors",
            headers=gestionnaire,
            json=corps,
        )

        assert reponse.status_code == 422, reponse.text
        assert reponse.json()["error"]["code"] == "etage_en_double"

    def test_les_etages_se_lisent_dans_l_ordre_des_niveaux(
        self, client, gestionnaire, batiment_cree
    ):
        """`level` est un entier de tri distinct de `code` : « RDC », « 1er » et
        « 2e » ne s'ordonnent pas comme du texte."""
        for code, label, niveau in (
            ("R2", "2e", 2),
            ("R0", "RDC", 0),
            ("R1", "1er", 1),
        ):
            client.post(
                f"/api/v1/buildings/{batiment_cree['id']}/floors",
                headers=gestionnaire,
                json={"code": code, "label": label, "level": niveau},
            )

        etages = client.get(
            f"/api/v1/buildings/{batiment_cree['id']}/floors", headers=gestionnaire
        ).json()

        assert [item["level"] for item in etages] == [0, 1, 2]

    def test_un_etage_peuple_ne_se_supprime_pas(self, client, gestionnaire, salle):
        reponse = client.delete(
            f"/api/v1/floors/{salle.floor_id}", headers=gestionnaire
        )

        assert reponse.status_code == 422, reponse.text
        assert reponse.json()["error"]["code"] == "etage_occupe"

    def test_un_etage_vide_se_supprime(self, client, gestionnaire, batiment_cree):
        etage = client.post(
            f"/api/v1/buildings/{batiment_cree['id']}/floors",
            headers=gestionnaire,
            json={"code": "R9", "label": "9e", "level": 9},
        ).json()

        assert (
            client.delete(
                f"/api/v1/floors/{etage['id']}", headers=gestionnaire
            ).status_code
            == 204
        )


class TestVisuels:
    def test_la_photographie_du_batiment_se_depose_et_s_efface(
        self, client, gestionnaire, batiment_cree
    ):
        depose = client.put(
            f"/api/v1/buildings/{batiment_cree['id']}/image",
            headers=gestionnaire,
            json=_visuel(),
        )

        assert depose.status_code == 200, depose.text
        url = depose.json()["image_url"]
        assert _sur_disque(url)

        retire = client.delete(
            f"/api/v1/buildings/{batiment_cree['id']}/image", headers=gestionnaire
        )
        assert retire.json()["image_url"] is None
        assert not _sur_disque(url)

    def test_un_visuel_remplace_efface_le_precedent(
        self, client, gestionnaire, batiment_cree
    ):
        premier = client.put(
            f"/api/v1/buildings/{batiment_cree['id']}/image",
            headers=gestionnaire,
            json=_visuel(),
        ).json()["image_url"]
        assert _sur_disque(premier)

        second = client.put(
            f"/api/v1/buildings/{batiment_cree['id']}/image",
            headers=gestionnaire,
            json=_visuel(_png(2)),
        ).json()["image_url"]

        assert second != premier
        assert not _sur_disque(premier)

    @pytest.mark.parametrize("type_refuse", ["image/svg+xml", "application/pdf"])
    def test_les_formats_hors_image_sont_refuses(
        self, client, gestionnaire, batiment_cree, type_refuse
    ):
        """Le magasin de médias les accepte pour les plans d'étage ; ces
        visuels-ci s'affichent dans une carte, et le SVG porte du script."""
        reponse = client.put(
            f"/api/v1/buildings/{batiment_cree['id']}/image",
            headers=gestionnaire,
            json=_visuel(content_type=type_refuse),
        )

        assert reponse.status_code == 422
        assert reponse.json()["error"]["code"] == "format_invalide"

    def test_le_plan_de_localisation_accompagne_la_salle(
        self, client, gestionnaire, salle
    ):
        depose = client.put(
            f"/api/v1/rooms/{salle.id}/location-plan",
            headers=gestionnaire,
            json=_visuel(),
        )

        assert depose.status_code == 200, depose.text
        assert depose.json()["location_plan_url"] is not None
        # Il ne se confond pas avec les photos, qui montrent la salle et non
        # l'endroit où elle se trouve.
        assert depose.json()["photos"] == []

        lue = client.get(f"/api/v1/rooms/{salle.id}", headers=gestionnaire).json()
        assert lue["location_plan_url"] == depose.json()["location_plan_url"]

    def test_le_plan_de_localisation_se_retire(self, client, gestionnaire, salle):
        url = client.put(
            f"/api/v1/rooms/{salle.id}/location-plan",
            headers=gestionnaire,
            json=_visuel(),
        ).json()["location_plan_url"]

        reponse = client.delete(
            f"/api/v1/rooms/{salle.id}/location-plan", headers=gestionnaire
        )

        assert reponse.status_code == 200, reponse.text
        assert reponse.json()["location_plan_url"] is None
        assert not _sur_disque(url)

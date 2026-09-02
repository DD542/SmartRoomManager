"""Filtrer les salles par plusieurs bâtiments, plusieurs étages.

L'écran d'exploration propose des cases à cocher : on peut vouloir les salles
d'Eiffel 1 **et** d'Eiffel 3. La route n'acceptait qu'un `building_id` unique,
donc l'écran ne pouvait rien en faire d'exact — et de fait, il n'envoyait rien.

Les listes rejoignent `equipment_ids`, qui en acceptait déjà une. Les
paramètres au singulier restent : ils servent aux appels qui ne visent qu'un
bâtiment, et les retirer casserait ce qui marche.
"""

from __future__ import annotations

import pytest

from tests.services.conftest import connecter

pytestmark = pytest.mark.integration


@pytest.fixture
def parc(session, creer_salle, batiment, etage, marque):
    """Trois salles : deux dans le bâtiment de référence, une ailleurs."""
    from tests.fabriques import FabriqueBatiment, FabriqueEtage

    autre_batiment = FabriqueBatiment(name=f"Curie {marque}")
    autre_etage = FabriqueEtage(
        building=autre_batiment, code="C", label="1er étage", level=1
    )
    session.flush()

    a = creer_salle("Alpha")
    b = creer_salle("Beta")
    c = creer_salle("Gamma")
    c.floor_id = autre_etage.id
    session.flush()
    return {
        "a": a,
        "b": b,
        "c": c,
        "batiment": batiment,
        "autre": autre_batiment,
        "etage": etage,
        "autre_etage": autre_etage,
    }


def noms(reponse):
    return {item["name"] for item in reponse.json()["items"]}


class TestPlusieursBatiments:
    def test_un_seul_batiment_ecarte_les_autres(self, client, session, compte, parc):
        session.commit()
        entetes = connecter(client, compte.email)

        reponse = client.get(
            "/api/v1/rooms",
            headers=entetes,
            params={"building_ids": [str(parc["autre"].id)], "size": 100},
        )

        assert reponse.status_code == 200, reponse.text
        assert parc["c"].name in noms(reponse)
        assert parc["a"].name not in noms(reponse)

    def test_deux_batiments_rendent_les_deux(self, client, session, compte, parc):
        session.commit()
        entetes = connecter(client, compte.email)

        reponse = client.get(
            "/api/v1/rooms",
            headers=entetes,
            params={
                "building_ids": [str(parc["batiment"].id), str(parc["autre"].id)],
                "size": 100,
            },
        )

        rendus = noms(reponse)
        assert {parc["a"].name, parc["b"].name, parc["c"].name} <= rendus

    def test_sans_liste_rien_n_est_ecarte(self, client, session, compte, parc):
        # Une liste vide veut dire « aucune préférence », pas « aucune salle ».
        session.commit()
        entetes = connecter(client, compte.email)

        reponse = client.get("/api/v1/rooms", headers=entetes, params={"size": 100})

        assert {parc["a"].name, parc["c"].name} <= noms(reponse)


class TestPlusieursEtages:
    def test_filtre_sur_une_liste_d_etages(self, client, session, compte, parc):
        session.commit()
        entetes = connecter(client, compte.email)

        reponse = client.get(
            "/api/v1/rooms",
            headers=entetes,
            params={"floor_ids": [str(parc["autre_etage"].id)], "size": 100},
        )

        assert noms(reponse) == {parc["c"].name}


class TestAccessibilite:
    def test_n_rend_que_les_salles_accessibles(self, client, session, compte, parc):
        """Le filtre le plus important, et celui qui ne partait pas.

        Quelqu'un qui demande une salle accessible et reçoit tout le parc n'a
        pas un écran incomplet : il a un écran faux.
        """
        parc["a"].is_accessible = False
        session.flush()
        session.commit()
        entetes = connecter(client, compte.email)

        reponse = client.get(
            "/api/v1/rooms",
            headers=entetes,
            params={"accessible_only": True, "size": 100},
        )

        assert parc["a"].name not in noms(reponse)
        assert parc["b"].name in noms(reponse)

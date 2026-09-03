"""Des chiffres personnels ne se gardent pas dans un cache partagé.

`/stats/me` portait `private, max-age=300`. La directive semblait suffisante :
`private` interdit aux intermédiaires de garder la réponse, seul le navigateur
du destinataire la conserve.

Mais un cache navigateur est indexé par **URL**, et `/stats/me` est la même URL
pour tout le monde. Deux comptes ouverts successivement sur le même poste, à
moins de cinq minutes d'intervalle, et le second lisait les chiffres du
premier : nombre de réservations, heures réservées, annulations, salles
fréquentées.

Constaté sur deux comptes distincts affichant les mêmes dix réservations et les
mêmes huit annulations — alors que l'un des deux n'en avait aucune.

`Vary: Authorization` isolerait les réponses, mais le jeton tourne à chaque
rafraîchissement : le cache serait manqué à tous les coups. Autant ne rien
garder.

Les chiffres publics, eux, sont anonymes et identiques pour tous. Ils gardent
leur cache, et ce fichier le vérifie : supprimer les deux d'un même geste
rechargerait la page d'accueil à chaque visite pour rien.
"""

from __future__ import annotations

import pytest

from tests.services.conftest import connecter

pytestmark = pytest.mark.integration


class TestChiffresPersonnels:
    def test_ils_ne_sont_jamais_gardes(self, client, compte):
        entetes = connecter(client, compte.email)

        reponse = client.get("/api/v1/stats/me", headers=entetes)

        assert reponse.status_code == 200
        cache = reponse.headers["cache-control"]
        assert "no-store" in cache
        assert "max-age" not in cache

    def test_l_export_personnel_non_plus(self, client, compte):
        """Le CSV porte les mêmes données, ligne à ligne."""
        entetes = connecter(client, compte.email)

        reponse = client.get("/api/v1/stats/me/export", headers=entetes)

        assert reponse.status_code == 200
        assert "no-store" in reponse.headers["cache-control"]


class TestChiffresPublics:
    def test_ils_gardent_leur_cache(self, client):
        """Contre-épreuve : rien n'y désigne personne.

        Sans elle, on supprimerait les deux caches d'un même geste et la page
        d'accueil rechargerait ses agrégats à chaque visite, pour rien.
        """
        reponse = client.get("/api/v1/stats/public")

        assert reponse.status_code == 200
        assert "max-age" in reponse.headers["cache-control"]
        assert "no-store" not in reponse.headers["cache-control"]

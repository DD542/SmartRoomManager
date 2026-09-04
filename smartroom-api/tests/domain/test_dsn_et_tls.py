"""Le DSN porte un mode TLS hors environnement local.

`libpq` applique `prefer` par défaut : il tente le chiffrement, puis se rabat
en clair si la négociation échoue. Un hébergeur qui exige TLS refuse alors la
connexion, et son message ne dit pas toujours pourquoi :

    ERROR: password authentication failed for user 'neondb_owner'
    ERROR: connection is insecure (try using `sslmode=require`)

Constaté sur Neon depuis Render. La bascule IPv6 vers IPv4 avait bien lieu,
les trois adresses répondaient, et toutes refusaient une session non chiffrée.
La première ligne désignait le mauvais coupable — on cherchait un mot de passe
faux là où il manquait un mode de connexion.

En local rien n'est ajouté : la base tourne dans un conteneur voisin, sans
certificat. L'exiger empêcherait tout démarrage, et ce fichier le vérifie —
sans quoi on « sécuriserait » l'application jusqu'à ce qu'elle ne démarre plus
nulle part.

Ces tests ne touchent ni la base ni le réseau : ils lisent une chaîne.
"""

from __future__ import annotations

import pytest

from app.core.config import Settings

PRODUCTION = {
    "ENVIRONMENT": "production",
    "JWT_SECRET": "un-secret-suffisamment-long-pour-passer-le-controle",
    "POSTGRES_PASSWORD": "mot-de-passe-distant",
    "REFRESH_COOKIE_SECURE": "true",
    "CORS_ORIGINS": '["https://exemple.test"]',
}


@pytest.fixture
def reglages(monkeypatch):
    def fabriquer(**variables: str) -> Settings:
        for cle in (*PRODUCTION, "POSTGRES_SSLMODE"):
            monkeypatch.delenv(cle, raising=False)
        for cle, valeur in variables.items():
            monkeypatch.setenv(cle, valeur)
        return Settings()

    return fabriquer


class TestModeDeduit:
    def test_le_local_reste_en_clair(self, reglages):
        """La base de développement n'a pas de certificat."""
        assert "sslmode" not in reglages(ENVIRONMENT="local").database_url

    def test_hors_local_le_chiffrement_est_impose(self, reglages):
        assert "sslmode=require" in reglages(**PRODUCTION).database_url


class TestModeExplicite:
    def test_il_prime_sur_la_deduction(self, reglages):
        """Là où l'autorité de certification est connue, `verify-full` vaut
        mieux que `require` — qui chiffre sans vérifier à qui il parle."""
        dsn = reglages(**PRODUCTION, POSTGRES_SSLMODE="verify-full").database_url

        assert "sslmode=verify-full" in dsn
        assert "sslmode=require" not in dsn

    def test_il_permet_aussi_de_s_en_passer(self, reglages):
        """Contre-épreuve : sur un réseau privé où le chiffrement est déjà
        assuré, l'imposer coûte sans rien protéger. Le réglage doit pouvoir
        annuler la déduction, sinon il ne sert qu'à moitié."""
        assert (
            "sslmode=disable"
            in reglages(**PRODUCTION, POSTGRES_SSLMODE="disable").database_url
        )

"""Connexion par compte Google.

Le jeton d'identité arrive **par le client**. N'importe qui peut en fabriquer
un et le poster : tout l'intérêt de ces tests est de vérifier qu'un jeton non
vérifié n'ouvre rien.

Les jetons sont ici signés par une paire de clés fabriquée pour le test, et le
service croit lire celles de Google. Cela vérifie la chaîne complète —
signature, émetteur, destinataire, adresse confirmée — sans dépendre d'un appel
réseau, donc sans qu'un test échoue le jour où Google tourne ses clés.
"""

from __future__ import annotations

import time

import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from jose import jwk, jwt
from sqlalchemy import select

from app.core.errors import AuthenticationError, PermissionError_, RuleViolationError
from app.db.enums import UserStatus
from app.models import User
from app.services import auth_service, google_service

CLIENT = "test-client.apps.googleusercontent.com"


@pytest.fixture(scope="module")
def paire():
    """Clé RSA du test, et le JWKS que le service croira venir de Google."""
    privee = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    publique = jwk.construct(privee.public_key(), algorithm="RS256").to_dict()
    publique["kid"] = "test"
    publique["use"] = "sig"
    publique["alg"] = "RS256"
    return privee, {"keys": [publique]}


@pytest.fixture(autouse=True)
def google_configure(paire, monkeypatch):
    _, jwks = paire
    monkeypatch.setattr(google_service.get_settings(), "google_client_id", CLIENT)
    monkeypatch.setattr(google_service.get_settings(), "google_allowed_domains", "")
    monkeypatch.setattr(google_service, "_obtenir_cles", lambda **_: jwks)


def forger(paire, **remplacements) -> str:
    privee, _ = paire
    charge = {
        "iss": "https://accounts.google.com",
        "aud": CLIENT,
        "sub": "1234567890",
        "email": "nouvelle.personne@gmail.com",
        "email_verified": True,
        "given_name": "Nouvelle",
        "family_name": "Personne",
        "picture": "https://exemple.test/photo.png",
        "iat": int(time.time()),
        "exp": int(time.time()) + 600,
    }
    charge.update(remplacements)
    return jwt.encode(
        charge,
        jwk.construct(privee, algorithm="RS256").to_dict(),
        algorithm="RS256",
        headers={"kid": "test"},
    )


class TestVerification:
    def test_un_jeton_valide_est_accepte(self, paire):
        identite = google_service.verifier(forger(paire))

        assert identite.email == "nouvelle.personne@gmail.com"
        assert identite.prenom == "Nouvelle"
        assert identite.photo == "https://exemple.test/photo.png"

    def test_un_jeton_pour_une_autre_application_est_refuse(self, paire):
        """Confusion de destinataire : la faute classique de l'authentification
        déléguée. Sans ce contrôle, un jeton émis pour n'importe quelle autre
        application Google ouvrirait une session ici."""
        with pytest.raises(AuthenticationError):
            google_service.verifier(forger(paire, aud="une-autre-application"))

    def test_un_jeton_d_un_autre_emetteur_est_refuse(self, paire):
        with pytest.raises(AuthenticationError):
            google_service.verifier(forger(paire, iss="https://exemple-malveillant.test"))

    def test_un_jeton_expire_est_refuse(self, paire):
        with pytest.raises(AuthenticationError):
            google_service.verifier(forger(paire, exp=int(time.time()) - 60))

    def test_une_adresse_non_verifiee_est_refusee(self, paire):
        """Google laisse créer un compte avec une adresse non confirmée :
        l'accepter reviendrait à laisser quelqu'un s'attribuer celle d'un
        autre."""
        with pytest.raises(AuthenticationError):
            google_service.verifier(forger(paire, email_verified=False))

    def test_un_jeton_signe_par_une_autre_cle_est_refuse(self, paire):
        autre = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        jeton = jwt.encode(
            {
                "iss": "https://accounts.google.com",
                "aud": CLIENT,
                "email": "intrus@gmail.com",
                "email_verified": True,
                "exp": int(time.time()) + 600,
            },
            jwk.construct(autre, algorithm="RS256").to_dict(),
            algorithm="RS256",
            headers={"kid": "test"},
        )

        with pytest.raises(AuthenticationError):
            google_service.verifier(jeton)

    def test_sans_identifiant_de_client_la_connexion_est_refusee(self, paire, monkeypatch):
        # Mieux vaut ce refus explicite qu'un échec de vérification
        # incompréhensible sur un serveur mal configuré.
        monkeypatch.setattr(google_service.get_settings(), "google_client_id", "")

        with pytest.raises(RuleViolationError):
            google_service.verifier(forger(paire))

    def test_un_domaine_hors_liste_est_refuse(self, paire, monkeypatch):
        monkeypatch.setattr(google_service.get_settings(), "google_allowed_domains", "ece.fr")

        with pytest.raises(RuleViolationError):
            google_service.verifier(forger(paire))

    def test_le_domaine_autorise_passe(self, paire, monkeypatch):
        monkeypatch.setattr(
            google_service.get_settings(), "google_allowed_domains", "gmail.com, ece.fr"
        )

        assert google_service.verifier(forger(paire)).email.endswith("@gmail.com")


class TestOuvertureDeSession:
    def test_cree_le_compte_a_la_premiere_connexion(self, session, paire):
        resultat, creation = auth_service.login_google(session, jeton=forger(paire))

        assert creation is True
        assert resultat.user.email == "nouvelle.personne@gmail.com"
        assert resultat.scope == "user"
        assert resultat.access_token

    def test_aucun_mot_de_passe_ne_permet_d_y_entrer(self, session, paire):
        """La colonne ne peut pas être nulle ; un mot de passe vide serait une
        porte ouverte. Le compte reçoit l'empreinte d'un secret que personne ne
        conserve."""
        auth_service.login_google(session, jeton=forger(paire))
        compte = session.scalars(
            select(User).where(User.email == "nouvelle.personne@gmail.com")
        ).one()

        assert compte.password_hash
        for tentative in ("", " ", "motdepasse", compte.email):
            with pytest.raises(AuthenticationError):
                auth_service.login(session, email=compte.email, password=tentative)

    def test_retrouve_le_compte_a_la_seconde(self, session, paire):
        auth_service.login_google(session, jeton=forger(paire))
        _, creation = auth_service.login_google(session, jeton=forger(paire))

        assert creation is False
        assert (
            len(
                session.scalars(
                    select(User).where(User.email == "nouvelle.personne@gmail.com")
                ).all()
            )
            == 1
        )

    def test_rattache_un_compte_existant_par_son_adresse(self, session, paire, compte):
        """Un utilisateur inscrit par mot de passe qui passe par Google
        retrouve son compte, ses réservations et ses droits."""
        resultat, creation = auth_service.login_google(
            session, jeton=forger(paire, email=compte.email)
        )

        assert creation is False
        assert resultat.user.id == compte.id

    def test_un_compte_suspendu_le_reste(self, session, paire, compte):
        """Déléguer l'identité ne délègue pas la décision d'ouvrir la porte."""
        compte.status = UserStatus.SUSPENDU
        session.flush()

        with pytest.raises(PermissionError_):
            auth_service.login_google(session, jeton=forger(paire, email=compte.email))

    def test_la_photo_de_google_ne_remplace_pas_celle_du_profil(
        self, session, paire, compte
    ):
        compte.avatar_url = "/media/avatars/choisie-par-lutilisateur.png"
        session.flush()

        auth_service.login_google(session, jeton=forger(paire, email=compte.email))

        assert compte.avatar_url == "/media/avatars/choisie-par-lutilisateur.png"


class TestRoute:
    def test_la_route_ouvre_une_session(self, client, paire):
        reponse = client.post(
            "/api/v1/auth/google", json={"credential": forger(paire)}
        )

        assert reponse.status_code == 200, reponse.text
        corps = reponse.json()
        assert corps["scope"] == "user"
        assert corps["created"] is True
        assert corps["user"]["email"] == "nouvelle.personne@gmail.com"

    def test_un_jeton_fabrique_est_refuse(self, client):
        reponse = client.post("/api/v1/auth/google", json={"credential": "a" * 64})

        assert reponse.status_code == 401
        assert reponse.json()["error"]["code"] == "google_jeton_invalide"

"""Cycle de vie d'une session : ouverture, rotation, révocation, mot de passe."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.limiter import limiter
from app.core.security import fingerprint, verify_password
from app.db.enums import AuditAction, UserStatus
from app.models import AuditLog, PasswordResetToken, RefreshToken
from app.services import auth_service
from tests.services.conftest import MOT_DE_PASSE, connecter

settings = get_settings()
COOKIE = settings.refresh_cookie_name


def ouvrir(client, compte, admin: bool = False):
    chemin = "/api/v1/auth/admin/login" if admin else "/api/v1/auth/login"
    return client.post(chemin, json={"email": compte.email, "password": MOT_DE_PASSE})


class TestConnexion:
    def test_le_rafraichissement_part_en_cookie_httponly(self, client, compte):
        reponse = ouvrir(client, compte)
        assert reponse.status_code == 200

        corps = reponse.json()
        assert corps["scope"] == "user"
        assert corps["expires_in"] == settings.access_ttl_minutes * 60
        # Le jeton de rafraîchissement ne figure pas dans le corps : le
        # JavaScript ne doit jamais pouvoir le lire.
        assert "refresh_token" not in corps

        entete = reponse.headers["set-cookie"]
        assert COOKIE in entete
        assert "HttpOnly" in entete
        assert f"Path={settings.refresh_cookie_path}" in entete

    def test_le_mot_de_passe_n_est_jamais_renvoye(self, client, compte):
        corps = ouvrir(client, compte).json()
        assert "password_hash" not in corps["user"]
        assert "password" not in corps["user"]

    def test_compte_suspendu_refuse(self, client, session, compte):
        compte.status = UserStatus.SUSPENDU
        session.flush()
        reponse = ouvrir(client, compte)
        assert reponse.status_code == 403
        assert reponse.json()["error"]["code"] == "compte_suspendu"

    def test_la_connexion_est_tracee_dans_l_audit(self, client, session, compte):
        ouvrir(client, compte)
        traces = session.scalars(
            select(AuditLog).where(AuditLog.action == AuditAction.CONNEXION)
        ).all()
        assert any(item.diff_after.get("success") is True for item in traces)

    def test_un_echec_est_trace_aussi(self, client, session, compte):
        """Une série de refus sur un même compte est le premier signe d'une attaque."""
        client.post(
            "/api/v1/auth/login",
            json={"email": compte.email, "password": "au-hasard"},
        )
        traces = session.scalars(
            select(AuditLog).where(AuditLog.action == AuditAction.CONNEXION)
        ).all()
        assert any(item.diff_after.get("success") is False for item in traces)


class TestRotation:
    def test_le_renouvellement_fait_tourner_le_jeton(self, client, session, compte):
        premiere = ouvrir(client, compte)
        ancien = premiere.cookies[COOKIE]

        seconde = client.post("/api/v1/auth/refresh")
        assert seconde.status_code == 200
        nouveau = seconde.cookies[COOKIE]
        assert nouveau != ancien

        consomme = session.scalars(
            select(RefreshToken).where(RefreshToken.token_hash == fingerprint(ancien))
        ).one()
        assert consomme.used_at is not None

    def test_les_rotations_partagent_une_famille(self, client, session, compte):
        ouvrir(client, compte)
        client.post("/api/v1/auth/refresh")

        familles = {
            item.family_id
            for item in session.scalars(
                select(RefreshToken).where(RefreshToken.user_id == compte.id)
            )
        }
        assert len(familles) == 1

    def test_un_jeton_rejoue_revoque_toute_la_famille(self, client, session, compte):
        """Un jeton déjà consommé qui reparaît ne peut venir que d'une copie."""
        ouvrir(client, compte)
        ancien = client.cookies[COOKIE]
        client.post("/api/v1/auth/refresh")

        client.cookies.set(COOKIE, ancien, path=settings.refresh_cookie_path)
        rejoue = client.post("/api/v1/auth/refresh")

        assert rejoue.status_code == 401
        assert rejoue.json()["error"]["code"] == "jeton_rejoue"

        actifs = session.scalars(
            select(RefreshToken).where(
                RefreshToken.user_id == compte.id, RefreshToken.revoked_at.is_(None)
            )
        ).all()
        assert actifs == []

    def test_jeton_expire_refuse(self, client, session, compte):
        ouvrir(client, compte)
        ligne = session.scalars(
            select(RefreshToken).where(RefreshToken.user_id == compte.id)
        ).one()
        # La contrainte exige `expires_at > created_at` : un jeton réellement
        # expiré a aussi été créé il y a longtemps.
        ligne.created_at = datetime.now(UTC) - timedelta(days=40)
        ligne.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        session.flush()

        reponse = client.post("/api/v1/auth/refresh")
        assert reponse.status_code == 401
        assert reponse.json()["error"]["code"] == "session_expiree"

    def test_sans_cookie_le_renouvellement_ne_signale_pas_d_erreur(self, client):
        """Sans cookie, il n'y a pas d'échec : il n'y a pas de session.

        Le front pose cette question à chaque chargement de page, avant de
        savoir s'il y a quelqu'un. Y répondre par un 401 décrivait comme une
        erreur d'authentification l'état le plus banal qui soit — un visiteur
        déconnecté devant l'écran de connexion — et le navigateur, qui
        journalise toute réponse 4xx avant que le code ne la voie, en faisait
        une ligne rouge en console que rien côté client ne pouvait effacer.
        """
        reponse = client.post("/api/v1/auth/refresh")

        assert reponse.status_code == 204
        assert reponse.content == b""

    def test_un_cookie_refuse_reste_une_erreur(self, client):
        """Le 204 ne vaut que pour l'absence de cookie.

        Ce test est le garde-fou du précédent : dès qu'un jeton est présenté,
        son refus est un vrai échec d'authentification et doit le rester.
        Sans lui, élargir le 204 « pour faire taire la console » passerait
        inaperçu.
        """
        client.cookies.set(COOKIE, "jeton-invente", path=settings.refresh_cookie_path)

        reponse = client.post("/api/v1/auth/refresh")

        assert reponse.status_code == 401
        assert reponse.json()["error"]["code"]

    def test_un_jeton_refuse_efface_le_cookie(self, client, compte):
        """Un cookie refusé doit disparaître, sinon la session morte est sans issue.

        Le retrait était posé sur l'objet `Response` injecté dans la route,
        que FastAPI abandonne dès qu'elle lève : le gestionnaire d'erreurs
        fabrique sa propre réponse, qui ne sait rien de la précédente. Le
        navigateur gardait donc un cookie que le serveur refusait, le
        représentait à chaque chargement, recevait un 401 à chaque fois, et
        rien ne pouvait rompre la boucle — sinon vider ses cookies à la main.
        """
        ouvrir(client, compte)
        ancien = client.cookies[COOKIE]
        client.post("/api/v1/auth/refresh")

        client.cookies.set(COOKIE, ancien, path=settings.refresh_cookie_path)
        rejoue = client.post("/api/v1/auth/refresh")

        assert rejoue.status_code == 401
        # L'assertion porte sur l'en-tête effectivement renvoyé, et non sur le
        # bocal à cookies du client de test : le cookie y a été injecté à la
        # main, sans domaine, et n'y répond donc pas aux mêmes règles
        # d'appariement qu'un cookie posé par le serveur.
        retrait = rejoue.headers.get("set-cookie", "")
        assert COOKIE in retrait
        assert "Max-Age=0" in retrait
        assert f"Path={settings.refresh_cookie_path}" in retrait

    def test_la_deconnexion_efface_le_cookie(self, client, compte):
        """« Révoque la famille et efface le cookie » : la seconde moitié aussi.

        La route posait le retrait sur l'objet `Response` injecté, puis
        retournait un `Response` neuf : celui qui partait n'emportait pas
        l'en-tête. Le compte était bien déconnecté côté serveur, mais le
        navigateur conservait un cookie mort qu'il représentait ensuite.
        """
        ouvrir(client, compte)
        assert COOKIE in client.cookies

        assert client.post("/api/v1/auth/logout").status_code == 204

        assert COOKIE not in client.cookies
        assert client.post("/api/v1/auth/refresh").status_code == 204

    def test_la_deconnexion_revoque_la_famille(self, client, session, compte):
        ouvrir(client, compte)
        assert client.post("/api/v1/auth/logout").status_code == 204

        actifs = session.scalars(
            select(RefreshToken).where(
                RefreshToken.user_id == compte.id, RefreshToken.revoked_at.is_(None)
            )
        ).all()
        assert actifs == []

    def test_la_deconnexion_sans_session_reussit(self, client):
        """Le front doit pouvoir oublier sa session dans tous les cas."""
        assert client.post("/api/v1/auth/logout").status_code == 204


class TestPermissions:
    def test_les_permissions_sont_relues_en_base(
        self, client, session, administrateur, creer_salle
    ):
        """Une révocation prend effet immédiatement, pas au jeton suivant."""
        from tests.services.conftest import accorder
        from app.api.deps import CONFLICTS_ARBITRATE
        from app.models import AdminPermission

        accorder(session, administrateur, CONFLICTS_ARBITRATE)
        entetes = connecter(client, administrateur.user.email, admin=True)
        assert client.get("/api/v1/admin/bookings", headers=entetes).status_code == 200

        session.execute(
            AdminPermission.__table__.delete().where(
                AdminPermission.admin_user_id == administrateur.user_id
            )
        )
        session.flush()
        session.expire(administrateur, ["grants", "permissions"])

        # Le même jeton, la permission en moins.
        refus = client.get("/api/v1/admin/bookings", headers=entetes)
        assert refus.status_code == 403
        assert refus.json()["error"]["code"] == "permission_manquante"


class TestMotDePasse:
    def test_demande_de_reinitialisation(self, client, session, compte):
        reponse = client.post(
            "/api/v1/auth/forgot-password", json={"email": compte.email}
        )
        assert reponse.status_code == 202

        lien = session.scalars(
            select(PasswordResetToken).where(PasswordResetToken.user_id == compte.id)
        ).one()
        assert lien.used_at is None
        assert len(lien.token_hash) == 64

    def test_adresse_inconnue_repond_pareil(self, client):
        """Un 404 transformerait cette route en énumérateur de comptes."""
        reponse = client.post(
            "/api/v1/auth/forgot-password", json={"email": "personne@ece.fr"}
        )
        assert reponse.status_code == 202

    def test_reinitialisation_complete(self, client, session, compte):
        _, clair = auth_service.request_password_reset(session, email=compte.email)
        session.flush()

        reponse = client.post(
            "/api/v1/auth/reset-password",
            json={"token": clair, "password": "nouveau-mot-de-passe"},
        )
        assert reponse.status_code == 204

        session.refresh(compte)
        assert verify_password("nouveau-mot-de-passe", compte.password_hash)

    def test_le_lien_ne_sert_qu_une_fois(self, client, session, compte):
        _, clair = auth_service.request_password_reset(session, email=compte.email)
        session.flush()

        corps = {"token": clair, "password": "premier-mot-de-passe"}
        assert client.post("/api/v1/auth/reset-password", json=corps).status_code == 204

        seconde = client.post("/api/v1/auth/reset-password", json=corps)
        assert seconde.status_code == 401
        assert seconde.json()["error"]["code"] == "jeton_consomme"

    def test_lien_expire_refuse(self, client, session, compte):
        _, clair = auth_service.request_password_reset(session, email=compte.email)
        ligne = session.scalars(
            select(PasswordResetToken).where(PasswordResetToken.user_id == compte.id)
        ).one()
        ligne.created_at = datetime.now(UTC) - timedelta(hours=2)
        ligne.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        session.flush()

        reponse = client.post(
            "/api/v1/auth/reset-password", json={"token": clair, "password": "peu-importe"}
        )
        assert reponse.status_code == 401
        assert reponse.json()["error"]["code"] == "jeton_expire"

    def test_une_nouvelle_demande_perime_la_precedente(self, client, session, compte):
        _, premier = auth_service.request_password_reset(session, email=compte.email)
        auth_service.request_password_reset(session, email=compte.email)
        session.flush()

        reponse = client.post(
            "/api/v1/auth/reset-password",
            json={"token": premier, "password": "peu-importe"},
        )
        assert reponse.status_code == 401

    def test_la_reinitialisation_ferme_les_sessions(self, client, session, compte):
        ouvrir(client, compte)
        _, clair = auth_service.request_password_reset(session, email=compte.email)
        session.flush()

        client.post(
            "/api/v1/auth/reset-password",
            json={"token": clair, "password": "nouveau-mot-de-passe"},
        )
        actifs = session.scalars(
            select(RefreshToken).where(
                RefreshToken.user_id == compte.id, RefreshToken.revoked_at.is_(None)
            )
        ).all()
        assert actifs == []

    def test_changement_avec_ancien_mot_de_passe(self, client, session, compte):
        entetes = connecter(client, compte.email)
        reponse = client.post(
            "/api/v1/auth/change-password",
            headers=entetes,
            json={"current_password": MOT_DE_PASSE, "new_password": "encore-un-autre"},
        )
        assert reponse.status_code == 204
        session.refresh(compte)
        assert verify_password("encore-un-autre", compte.password_hash)

    def test_ancien_mot_de_passe_faux(self, client, compte):
        entetes = connecter(client, compte.email)
        reponse = client.post(
            "/api/v1/auth/change-password",
            headers=entetes,
            json={"current_password": "au-hasard", "new_password": "peu-importe-ici"},
        )
        assert reponse.status_code == 401
        assert reponse.json()["error"]["code"] == "mot_de_passe_invalide"


class TestLimitationDeDebit:
    """Le seul test qui réactive le limiteur : ailleurs il fausserait tout."""

    @pytest.fixture(autouse=True)
    def _activer(self, client):
        # Dépend de `client` pour s'exécuter après lui : c'est la fixture du
        # client qui neutralise le limiteur pour le reste de la suite.
        limiter.reset()
        limiter.enabled = True
        yield
        limiter.enabled = False
        limiter.reset()

    def test_le_bourrage_d_identifiants_est_plafonne(self, client, compte):
        codes = [
            client.post(
                "/api/v1/auth/login",
                json={"email": compte.email, "password": "au-hasard"},
            ).status_code
            for _ in range(7)
        ]
        assert 429 in codes, codes
        # Les premières tentatives passent : un humain qui se trompe deux fois
        # ne doit pas être bloqué.
        assert codes[0] == 401


class TestPurge:
    def test_les_jetons_expires_sont_supprimes(self, session: Session, compte):
        auth_service.request_password_reset(session, email=compte.email)
        ligne = session.scalars(
            select(PasswordResetToken).where(PasswordResetToken.user_id == compte.id)
        ).one()
        ligne.created_at = datetime.now(UTC) - timedelta(days=2)
        ligne.expires_at = datetime.now(UTC) - timedelta(days=1)
        session.flush()

        assert auth_service.purge_expired(session) >= 1

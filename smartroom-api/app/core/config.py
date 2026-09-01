"""Configuration de l'application, lue depuis l'environnement.

Aucune valeur secrète n'est écrite en dur : le fichier `.env` reste hors du
dépôt, et le docker-compose fournit les variables du service local. Les valeurs
par défaut ne valent que pour le poste de développement — `Settings` refuse de
démarrer avec le secret d'usine dès que l'environnement n'est plus `local`.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, PostgresDsn, SecretStr, computed_field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    app_name: str = "SmartRoom Manager API"
    environment: str = Field(default="local")

    postgres_host: str = "localhost"
    postgres_port: int = 5432
    postgres_db: str = "smartroom"
    postgres_user: str = "smartroom"
    postgres_password: str = "smartroom"

    #: Fuseau de référence des tableaux de bord, aligné sur smartroom_timezone().
    timezone: str = "Europe/Paris"

    # ----------------------------------------------------------------- jetons

    jwt_secret: SecretStr = SecretStr("changez-moi-en-production")
    jwt_algorithm: str = "HS256"

    #: Court par construction : une fuite de jeton d'accès expire en un quart
    #: d'heure, et le rafraîchissement rend cette brièveté indolore.
    access_ttl_minutes: int = 15

    #: Le rafraîchissement vit en cookie httpOnly : ni le XSS ni le front n'y
    #: accèdent, sa durée peut donc être longue.
    refresh_ttl_days: int = 30

    refresh_cookie_name: str = "smartroom_refresh"
    #: Restreint au chemin d'authentification : le cookie n'est pas envoyé sur
    #: les appels métier, qui n'en ont aucun usage.
    refresh_cookie_path: str = "/api/v1/auth"
    refresh_cookie_samesite: Literal["lax", "strict", "none"] = "lax"
    #: Faux en local seulement : sans HTTPS, un cookie `Secure` ne serait
    #: jamais transmis et la session ne tiendrait pas.
    refresh_cookie_secure: bool = False

    #: Réinitialisation de mot de passe : assez long pour relever ses e-mails,
    #: assez court pour qu'un lien oublié dans une boîte ne serve plus.
    reset_ttl_minutes: int = 30

    # ------------------------------------------------------------ Google

    #: Identifiant du client OAuth, tel que la console Google le donne. Vide,
    #: la connexion Google est refusée avec un message clair plutôt qu'un
    #: échec de vérification incompréhensible.
    google_client_id: str = ""
    #: Domaines autorisés à ouvrir un compte, séparés par des virgules. Vide,
    #: tout compte Google est accepté. `ece.fr` fermerait l'application à la
    #: seule école — c'est une décision d'exploitation, pas de code.
    google_allowed_domains: str = ""

    # --------------------------------------------------------- organisation

    #: Domaines de l'établissement, séparés par des virgules. Un compte dont
    #: l'adresse n'en relève pas est signalé aux administrateurs : il a le
    #: droit d'être là — c'est ce que dit `GOOGLE_ALLOWED_DOMAINS` — mais
    #: l'administration doit pouvoir le distinguer d'un membre de l'école sans
    #: relire chaque adresse.
    organisation_domains: str = "ece.fr,edu.ece.fr"

    # ------------------------------------------------------------ limitation

    #: Rend le bourrage d'identifiants impraticable sans gêner un humain.
    rate_limit_login: str = "5/minute"
    rate_limit_reset: str = "3/hour"

    # ------------------------------------------------------------------ CORS

    #: Liste explicite plutôt que `*` : avec `allow_credentials`, le joker est
    #: refusé par les navigateurs.
    cors_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173"]
    )

    # ---------------------------------------------------------- planification

    #: Période de la tâche de maintenance : libération des créneaux non validés,
    #: clôture des réservations écoulées, rafraîchissement des statistiques.
    maintenance_interval_seconds: int = 300
    #: Fenêtre du rappel envoyé avant le début d'un créneau.
    reminder_lead_minutes: int = 30

    # --------------------------------------------------------------- courriel

    smtp_host: str = "localhost"
    smtp_port: int = 1025
    smtp_user: str | None = None
    smtp_password: SecretStr | None = None
    smtp_use_tls: bool = False
    mail_from: str = "no-reply@smartroom.ece.fr"
    #: En local, les e-mails sont écrits dans le journal plutôt qu'envoyés :
    #: aucune boîte réelle ne reçoit les données du jeu de démonstration.
    mail_enabled: bool = False

    # ------------------------------------------------------------- fichiers

    #: Répertoire des fichiers téléversés — plans d'étage, photos de salles.
    #: Un volume monté en production ; sans cela, un redéploiement effacerait
    #: les plans déposés par l'administration.
    media_root: str = "media"
    #: Préfixe public correspondant, monté en statique par l'application.
    media_url: str = "/media"

    # ---------------------------------------------------------- journalisation

    log_level: str = "INFO"
    #: JSON en production, texte lisible en local. Un développeur lit son
    #: terminal ; un exploitant interroge son journal.
    log_json: bool = True

    # ------------------------------------------------------------ agrégations

    #: Durée de validité des agrégats de tableau de bord, en secondes. Cinq
    #: minutes : au-delà, un administrateur verrait des chiffres périmés ;
    #: en deçà, la vue matérialisée serait relue pour rien.
    stats_cache_seconds: int = 300

    @computed_field
    @property
    def database_url(self) -> str:
        """DSN SQLAlchemy. `psycopg` désigne bien psycopg 3, pas psycopg2."""
        return str(
            PostgresDsn.build(
                scheme="postgresql+psycopg",
                username=self.postgres_user,
                password=self.postgres_password,
                host=self.postgres_host,
                port=self.postgres_port,
                path=self.postgres_db,
            )
        )

    @computed_field
    @property
    def is_local(self) -> bool:
        return self.environment == "local"

    @model_validator(mode="after")
    def _configuration_utilisable(self) -> Settings:
        """Refuse de démarrer plutôt que d'échouer plus tard.

        Une configuration incomplète qui laisse l'application démarrer produit
        une panne à la première requête, en production, devant un utilisateur.
        Mieux vaut un conteneur qui ne démarre pas et un message explicite dans
        le journal de déploiement.

        Ces contrôles ne s'appliquent qu'hors de l'environnement local : le
        poste de développement doit rester utilisable sans cérémonie.
        """
        if self.is_local:
            return self

        manques: list[str] = []

        if self.jwt_secret.get_secret_value().startswith("changez-moi"):
            manques.append(
                "JWT_SECRET porte encore la valeur d'usine : tout jeton serait falsifiable."
            )
        if len(self.jwt_secret.get_secret_value()) < 32:
            manques.append("JWT_SECRET doit compter au moins 32 caractères.")
        if self.postgres_password in {"smartroom", "postgres", ""}:
            manques.append("POSTGRES_PASSWORD porte une valeur par défaut.")
        if not self.refresh_cookie_secure:
            manques.append(
                "REFRESH_COOKIE_SECURE doit valoir true : sans HTTPS le cookie "
                "de session voyagerait en clair."
            )
        if not self.cors_origins:
            manques.append("CORS_ORIGINS doit lister l'origine du front.")
        if any("localhost" in origine for origine in self.cors_origins):
            manques.append(
                "CORS_ORIGINS contient une origine locale, sans effet en production."
            )
        if self.mail_enabled and self.smtp_host in {"localhost", ""}:
            manques.append("SMTP_HOST doit désigner un relais joignable.")

        if manques:
            details = ("\n  - ").join(manques)
            raise ValueError(
                f"Configuration inutilisable pour l'environnement « {self.environment} » :"
                f"\n  - {details}"
            )
        return self

    @model_validator(mode="after")
    def _cookie_sur_https_hors_local(self) -> Settings:
        """`SameSite=none` sans `Secure` est refusé par les navigateurs."""
        if self.refresh_cookie_samesite == "none" and not self.refresh_cookie_secure:
            raise ValueError(
                "REFRESH_COOKIE_SAMESITE=none exige REFRESH_COOKIE_SECURE=true."
            )
        return self


@lru_cache
def get_settings() -> Settings:
    """Instance unique, mise en cache : la configuration se lit une fois."""
    return Settings()

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
    def _secret_obligatoire_hors_local(self) -> Settings:
        """Un secret par défaut en production rendrait tout jeton falsifiable."""
        if self.environment != "local" and self.jwt_secret.get_secret_value().startswith(
            "changez-moi"
        ):
            raise ValueError("JWT_SECRET doit être défini hors de l'environnement local.")
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

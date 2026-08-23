"""Configuration de l'application, lue depuis l'environnement.

Aucune valeur secrète n'est écrite en dur : le fichier `.env` reste hors du
dépôt, et le docker-compose fournit les variables du service local.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field, PostgresDsn, SecretStr, computed_field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "SmartRoom Manager API"
    environment: str = Field(default="local")

    postgres_host: str = "localhost"
    postgres_port: int = 5432
    postgres_db: str = "smartroom"
    postgres_user: str = "smartroom"
    postgres_password: str = "smartroom"

    #: Fuseau de référence des tableaux de bord, aligné sur smartroom_timezone().
    timezone: str = "Europe/Paris"

    #: Signature des jetons. La valeur par défaut ne vaut que pour le poste de
    #: développement : `Settings` refuse de démarrer sans secret hors de `local`.
    jwt_secret: SecretStr = SecretStr("changez-moi-en-production")
    jwt_algorithm: str = "HS256"
    jwt_ttl_minutes: int = 480

    #: Période de la tâche de maintenance : libération des créneaux non validés,
    #: clôture des réservations écoulées, rafraîchissement des statistiques.
    maintenance_interval_seconds: int = 300

    #: Origines autorisées pour le front. Liste explicite plutôt que `*` : avec
    #: `allow_credentials`, le joker est refusé par les navigateurs.
    cors_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173"]
    )

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


    @model_validator(mode="after")
    def _secret_obligatoire_hors_local(self) -> "Settings":
        """Un secret par défaut en production rendrait tout jeton falsifiable."""
        if self.environment != "local" and self.jwt_secret.get_secret_value().startswith(
            "changez-moi"
        ):
            raise ValueError(
                "JWT_SECRET doit être défini hors de l'environnement local."
            )
        return self


@lru_cache
def get_settings() -> Settings:
    """Mise en cache : la configuration est lue une seule fois par processus."""
    return Settings()

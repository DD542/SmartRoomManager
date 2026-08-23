"""Configuration de l'application, lue depuis l'environnement.

Aucune valeur secrète n'est écrite en dur : le fichier `.env` reste hors du
dépôt, et le docker-compose fournit les variables du service local.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field, PostgresDsn, computed_field
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


@lru_cache
def get_settings() -> Settings:
    """Mise en cache : la configuration est lue une seule fois par processus."""
    return Settings()

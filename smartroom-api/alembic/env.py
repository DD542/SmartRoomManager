"""Environnement Alembic.

Les modèles sont importés depuis `app.models` : un modèle absent de cet import
serait invisible pour l'autogénération, sans le moindre avertissement.
"""

from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.core.config import get_settings
from app.models import Base  # noqa: F401 - enregistre les 39 tables

config = context.config
config.set_main_option("sqlalchemy.url", get_settings().database_url)

if config.config_file_name is not None:
    # `disable_existing_loggers=False` : par défaut, `fileConfig` **désactive**
    # tous les journaux déjà créés. Dans un processus qui migre puis sert — la
    # suite de tests, un point d'entrée de conteneur qui enchaîne les deux —,
    # chaque `logging.getLogger(__name__)` de l'application se retrouve muet,
    # sans erreur ni trace. Un journal qui disparaît en silence est pire que
    # pas de journal du tout : on continue de compter dessus.
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def include_object(objet, nom, type_, reflete, comparaison) -> bool:
    """Écarte les objets qu'Alembic ne sait pas comparer.

    La vue matérialisée et ses index sont créés par la migration initiale en SQL
    brut ; sans ce filtre, chaque autogénération proposerait de les supprimer,
    ne les trouvant pas dans les métadonnées ORM.
    """
    if type_ == "table" and nom.startswith(("mv_", "v_")):
        return False
    if type_ == "index" and nom.startswith(("idx_mv_", "uq_mv_")):
        return False
    return True


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        include_object=include_object,
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            include_object=include_object,
            compare_type=True,
            compare_server_default=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()

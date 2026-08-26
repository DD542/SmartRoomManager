"""Photo de profil : une adresse de fichier sur le compte.

Le fichier lui-même vit sur le disque, sous `MEDIA_ROOT`, comme les plans
d'étage et les photos de salle. Seule son adresse est stockée : ranger cinq
mégaoctets dans une colonne ferait payer le poids de l'image à chaque lecture
de l'annuaire, qui n'en a pas besoin.

La colonne est nullable et le restera : un compte sans photo est l'état normal,
et l'écran retombe alors sur les initiales. Une chaîne vide serait un troisième
état à distinguer de `NULL` sans rien apporter — la contrainte l'interdit.

Revision ID: 0005_avatar
Revises: 0004_photo_order
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0005_avatar'
down_revision: str | None = '0004_photo_order'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('users', sa.Column('avatar_url', sa.String(length=255), nullable=True))
    # Nom écrit en clair plutôt que dérivé : la convention de nommage vit dans
    # les métadonnées du modèle, et une migration qui la suppose applicable
    # produirait ici un nom différent de celui qu'`alembic check` attend.
    op.execute(
        'ALTER TABLE users ADD CONSTRAINT ck_users_avatar_url_non_vide '
        'CHECK (avatar_url IS NULL OR length(avatar_url) > 0)'
    )


def downgrade() -> None:
    op.execute('ALTER TABLE users DROP CONSTRAINT ck_users_avatar_url_non_vide')
    op.drop_column('users', 'avatar_url')

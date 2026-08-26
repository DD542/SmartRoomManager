"""Visuels du parc : image de bâtiment et plan de localisation de salle.

Deux adresses de fichier, sur le modèle de `users.avatar_url` : le fichier vit
sous `MEDIA_ROOT`, la base ne garde que son adresse.

Le plan de localisation d'une salle est distinct de ses photos. Une photo
montre la salle ; le plan montre *où elle est*, l'image portant déjà le repère.
Il est aussi distinct du plan d'étage — qui vaut pour tout un niveau et sert à
placer les salles les unes par rapport aux autres — parce qu'une salle peut
être documentée sans que son étage ait reçu de plan, et l'inverse.

Revision ID: 0006_visuels_parc
Revises: 0005_avatar
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0006_visuels_parc'
down_revision: str | None = '0005_avatar'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('buildings', sa.Column('image_url', sa.String(length=255), nullable=True))
    op.add_column('rooms', sa.Column('location_plan_url', sa.String(length=255), nullable=True))
    op.execute(
        'ALTER TABLE buildings ADD CONSTRAINT ck_buildings_image_url_non_vide '
        'CHECK (image_url IS NULL OR length(image_url) > 0)'
    )
    op.execute(
        'ALTER TABLE rooms ADD CONSTRAINT ck_rooms_location_plan_url_non_vide '
        'CHECK (location_plan_url IS NULL OR length(location_plan_url) > 0)'
    )


def downgrade() -> None:
    op.execute('ALTER TABLE rooms DROP CONSTRAINT ck_rooms_location_plan_url_non_vide')
    op.execute('ALTER TABLE buildings DROP CONSTRAINT ck_buildings_image_url_non_vide')
    op.drop_column('rooms', 'location_plan_url')
    op.drop_column('buildings', 'image_url')

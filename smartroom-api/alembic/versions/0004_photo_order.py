"""Ordre des photos de salle : unicité différée jusqu'à la validation.

Réordonner des positions, c'est en permuter deux. `UNIQUE (room_id, position)`
est vérifiée ligne à ligne, y compris à l'intérieur d'un seul `UPDATE` : passer
la photo 1 en position 0 échoue tant que l'ancienne position 0 existe encore,
alors même que l'état final est valide. Il faudrait sinon garer les lignes sur
des positions libres avant de les replacer — mais la contrainte de plage n'en
laisse aucune, les six positions étant toutes occupées quand la salle est
pleine.

`DEFERRABLE INITIALLY DEFERRED` déplace le contrôle à la validation de la
transaction. L'unicité reste garantie : c'est le moment de sa vérification qui
change, pas la règle.

Revision ID: 0004_photo_order
Revises: 0003_auth_tokens
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = '0004_photo_order'
down_revision: str | None = '0003_auth_tokens'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        'ALTER TABLE room_photos DROP CONSTRAINT uq_room_photos_position'
    )
    op.execute(
        'ALTER TABLE room_photos ADD CONSTRAINT uq_room_photos_position '
        'UNIQUE (room_id, "position") DEFERRABLE INITIALLY DEFERRED'
    )


def downgrade() -> None:
    op.execute(
        'ALTER TABLE room_photos DROP CONSTRAINT uq_room_photos_position'
    )
    op.execute(
        'ALTER TABLE room_photos ADD CONSTRAINT uq_room_photos_position '
        'UNIQUE (room_id, "position")'
    )

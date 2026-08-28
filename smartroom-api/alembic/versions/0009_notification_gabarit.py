"""Le gabarit qui a produit une notification.

Sans lui, l'écran ne peut pas savoir ce qu'une notification propose de faire :
la liste affiche un lien d'action quand la notification en porte un, et rien
n'en produisait jamais. Le code du gabarit est déjà connu à l'écriture — c'est
lui qui a rendu le titre et le corps —, il suffisait de le garder.

Nullable : les notifications déjà écrites n'ont pas d'origine identifiable, et
leur en inventer une serait pire que de l'admettre.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "0009_notification_gabarit"
down_revision: str | None = "0008_conversations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "notifications",
        sa.Column("template_code", sa.String(length=60), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("notifications", "template_code")

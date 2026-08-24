"""Délai minimal d'anticipation, configurable comme les autres règles.

Le sujet impose « anticipation minimale 15 minutes ». La valeur vivait dans
`RuleSet.defaults()` faute de colonne : elle n'était donc pas configurable,
contrairement à toutes les autres règles. Cette migration la rend modifiable
en base, avec la valeur du sujet pour défaut.

Revision ID: 0002_min_advance
Revises: 0001_schema_initial
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0002_min_advance'
down_revision: str | None = '0001_schema_initial'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "booking_rules",
        sa.Column(
            "min_advance_min",
            sa.SmallInteger(),
            server_default=sa.text("15"),
            nullable=False,
        ),
    )
    op.create_check_constraint(
        "min_advance",
        "booking_rules",
        "min_advance_min BETWEEN 0 AND 1440",
    )


def downgrade() -> None:
    op.drop_constraint("ck_booking_rules_min_advance", "booking_rules", type_="check")
    op.drop_column("booking_rules", "min_advance_min")

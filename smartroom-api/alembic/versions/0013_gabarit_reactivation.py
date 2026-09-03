"""Gabarit du courriel de réactivation de compte.

Pendant de `0012`. La suspension prévenait ; la levée de la suspension, non.
Quelqu'un dont le compte était rétabli continuait de croire qu'il était bloqué
jusqu'à ce qu'il retente une réservation — s'il retentait.

Le motif voyage aussi dans ce sens : « situation régularisée », « justificatif
reçu ». C'est ce qui distingue une réactivation d'une erreur d'administration
corrigée en silence.

Posé par une migration et non par le seul `seed.py`, pour la même raison que
`0012` : `notify` ignore en silence un code absent, et la fonctionnalité
n'aurait rien fait sur une base déjà installée.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "0013_gabarit_reactivation"
down_revision: str | None = "0012_gabarit_suspension"
branch_labels = None
depends_on = None

CODE = "compte_reactive"

SUJET = "Votre compte SmartRoom Manager est réactivé"

CORPS = "\n".join(
    [
        "Bonjour {{prenom}},",
        "",
        "Votre compte SmartRoom Manager a été réactivé par l'administration.",
        "",
        "Motif : {{motif}}",
        "",
        "Vous pouvez de nouveau réserver une salle. Vos réservations à venir,",
        "conservées pendant la suspension, restent valables.",
        "",
        "L'équipe Support.",
    ]
)


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            INSERT INTO email_templates (id, code, name, trigger_label, subject, body)
            VALUES (gen_random_uuid(), :code, :nom, :declencheur, :sujet, :corps)
            ON CONFLICT (code) DO NOTHING
            """
        ).bindparams(
            code=CODE,
            nom="Réactivation de compte",
            declencheur="Déclenché lorsqu'un administrateur lève une suspension",
            sujet=SUJET,
            corps=CORPS,
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text("DELETE FROM email_templates WHERE code = :code").bindparams(code=CODE)
    )

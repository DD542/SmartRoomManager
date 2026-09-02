"""Gabarit du courriel de suspension de compte.

Suspendre un compte fermait les sessions ouvertes et journalisait le motif dans
l'audit. Il n'en disait rien à la personne concernée : elle découvrait la
suspension en tentant de réserver, sans savoir pourquoi ni à qui s'adresser.

Le gabarit est posé ici plutôt que laissé au seul `seed.py`. `notify` ignore en
silence un code absent — « un gabarit absent ou désactivé ne bloque rien :
l'action a eu lieu », dit son commentaire — et sur une base déjà installée la
fonctionnalité n'aurait donc rien fait, sans la moindre erreur pour le
signaler.

`ON CONFLICT DO NOTHING` : la migration doit pouvoir se rejouer, et `seed.py`
pose le même code sur une base neuve.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "0012_gabarit_suspension"
down_revision: str | None = "0011_nom_contrainte_consigne"
branch_labels = None
depends_on = None

CODE = "compte_suspendu"

SUJET = "Votre compte SmartRoom Manager est suspendu"

CORPS = "\n".join(
    [
        "Bonjour {{prenom}},",
        "",
        "Votre compte SmartRoom Manager a été suspendu par l'administration.",
        "",
        "Motif : {{motif}}",
        "",
        "Vos réservations à venir sont conservées, mais vous ne pouvez plus en",
        "créer de nouvelle tant que la suspension dure.",
        "",
        "Pour toute question, contactez le support depuis l'application.",
        "",
        "L'équipe Support.",
    ]
)


def upgrade() -> None:
    # Paramètres liés plutôt qu'interpolés : le corps contient des apostrophes,
    # et une concaténation de chaînes SQL finit toujours par en casser une.
    op.execute(
        sa.text(
            """
            INSERT INTO email_templates (id, code, name, trigger_label, subject, body)
            VALUES (gen_random_uuid(), :code, :nom, :declencheur, :sujet, :corps)
            ON CONFLICT (code) DO NOTHING
            """
        ).bindparams(
            code=CODE,
            nom="Suspension de compte",
            declencheur="Déclenché lorsqu'un administrateur suspend un compte",
            sujet=SUJET,
            corps=CORPS,
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text("DELETE FROM email_templates WHERE code = :code").bindparams(code=CODE)
    )

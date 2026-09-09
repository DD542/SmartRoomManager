"""Gabarits des notifications de ticket : réponse du support et résolution.

L'onglet « Aide » du fil de notifications était vide par construction. Sa
catégorie se déduit du `ticket_id` porté par la notification — `notify()`
accepte d'ailleurs ce paramètre depuis l'origine — mais aucun appelant ne le
passait : les trois seuls étaient les réservations, les comptes et
l'ordonnanceur. Le support ne notifiait rien.

Conséquence pour l'utilisateur : il ouvrait un ticket, le support répondait, et
rien ne le lui disait. Il fallait retourner sur la page d'aide et rouvrir la
demande pour découvrir la réponse.

Deux moments méritent une notification, et deux seulement :

- **la réponse du support**, parce qu'elle appelle une lecture ;
- **la résolution**, parce qu'elle clôt l'attente.

Les notes internes n'en produisent pas : elles ne sont pas destinées au
demandeur, et le contraire trahirait leur objet. La création du ticket non
plus — on ne prévient pas quelqu'un de ce qu'il vient de faire.

Posés par une migration et non par le seul `seed.py`, pour la raison déjà
rencontrée en `0012` et `0013` : `notify` ignore en silence un code absent, et
la fonctionnalité n'aurait rien fait sur une base déjà installée, sans la
moindre erreur pour le signaler.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "0014_gabarits_ticket"
down_revision: str | None = "0013_gabarit_reactivation"
branch_labels = None
depends_on = None


GABARITS = (
    {
        "code": "ticket_reponse",
        "nom": "Réponse du support",
        "declencheur": "Déclenché lorsque le support répond à une demande d'aide",
        "sujet": "Réponse à votre demande {{reference}}",
        "corps": "\n".join(
            [
                "Bonjour {{prenom}},",
                "",
                "Le support a répondu à votre demande « {{sujet_demande}} »",
                "({{reference}}).",
                "",
                "{{extrait}}",
                "",
                "Pour lire la réponse complète et poursuivre l'échange :",
                "{{lien}}",
                "",
                "L'équipe Support.",
            ]
        ),
    },
    {
        "code": "ticket_resolu",
        "nom": "Demande résolue",
        "declencheur": "Déclenché lorsqu'une demande d'aide passe au statut résolu",
        "sujet": "Votre demande {{reference}} est résolue",
        "corps": "\n".join(
            [
                "Bonjour {{prenom}},",
                "",
                "Votre demande « {{sujet_demande}} » ({{reference}}) est marquée",
                "comme résolue.",
                "",
                "Si le problème persiste, répondez sur la demande : elle sera",
                "rouverte et reprise par le support.",
                "",
                "{{lien}}",
                "",
                "L'équipe Support.",
            ]
        ),
    },
)


def upgrade() -> None:
    for gabarit in GABARITS:
        op.execute(
            sa.text(
                """
                INSERT INTO email_templates (id, code, name, trigger_label, subject, body)
                VALUES (gen_random_uuid(), :code, :nom, :declencheur, :sujet, :corps)
                ON CONFLICT (code) DO NOTHING
                """
            ).bindparams(**gabarit)
        )


def downgrade() -> None:
    for gabarit in GABARITS:
        op.execute(
            sa.text("DELETE FROM email_templates WHERE code = :code").bindparams(
                code=gabarit["code"]
            )
        )

"""Consigne écrite par l'administration, portée par la règle de réservation.

Les dix réglages du sujet sont des nombres. Ils disent combien de temps, à
partir de quand, combien de fois — jamais *pourquoi*, ni ce qui n'entre dans
aucun champ : « laissez la salle rangée », « la clé se retire à l'accueil »,
« pas de nourriture en salle Curie ». Sans endroit pour l'écrire,
l'administration n'avait que le nom de la salle pour faire passer une consigne.

La consigne suit la portée des règles — salle, bâtiment, global — parce que
c'est la même résolution : la plus spécifique gagne, et une consigne de salle
remplace celle du bâtiment plutôt que de s'y ajouter. Deux consignes affichées
ensemble se contrediraient tôt ou tard sans que personne ne sache laquelle
prime.

Bornée à 500 caractères : c'est un encadré dans un tunnel de réservation, pas
un règlement intérieur. Au-delà, plus personne ne le lit.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "0010_consigne_regles"
down_revision: str | None = "0009_notification_gabarit"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("booking_rules", sa.Column("notice", sa.String(length=500), nullable=True))
    # Une consigne vide n'est pas une consigne : sans cette contrainte, un champ
    # effacé mais enregistré produirait un encadré blanc dans le tunnel.
    op.create_check_constraint(
        "ck_booking_rules_notice_non_vide",
        "booking_rules",
        "notice IS NULL OR btrim(notice) <> ''",
    )


def downgrade() -> None:
    op.drop_constraint("ck_booking_rules_notice_non_vide", "booking_rules", type_="check")
    op.drop_column("booking_rules", "notice")

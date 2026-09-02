"""Nom de la contrainte de consigne : le prefixe avait ete applique deux fois.

`0010` a passe le nom complet a `create_check_constraint` :

    op.create_check_constraint("ck_booking_rules_notice_non_vide", ...)

Or la convention de nommage porte deja `ck_%(table_name)s_%(constraint_name)s`.
Elle a donc prefixe un nom qui l'etait deja, et la base porte
`ck_booking_rules_ck_booking_rules_notice_non_vide` tandis que le modele
declare `name="notice_non_vide"`, soit `ck_booking_rules_notice_non_vide`.

Rien ne casse a l'usage : la contrainte fait son travail sous l'un ou l'autre
nom. Ce qui casse, c'est `alembic check`, qui compare le modele au schema et
voit une contrainte a retirer et une a creer. La chaine d'integration s'arrete
la, et elle a raison : un ecart entre le modele et la base est exactement ce
qu'elle est chargee de trouver.

`0010` n'est pas corrigee. Elle est appliquee partout — postes de
developpement et base hebergee — et la reecrire ne changerait rien a ces
bases-la tout en desynchronisant celles qui la rejoueraient. Une migration
deja passee se corrige par la suivante, jamais en la reecrivant.

Le renommage est donc inconditionnel : toute base ayant joue `0010` porte le
nom double, sans exception.
"""

from __future__ import annotations

from alembic import op

revision: str = "0011_nom_contrainte_consigne"
down_revision: str | None = "0010_consigne_regles"
branch_labels = None
depends_on = None

DOUBLE = "ck_booking_rules_ck_booking_rules_notice_non_vide"
ATTENDU = "ck_booking_rules_notice_non_vide"


def upgrade() -> None:
    op.execute(f"ALTER TABLE booking_rules RENAME CONSTRAINT {DOUBLE} TO {ATTENDU}")


def downgrade() -> None:
    # Le nom double est retabli : le `downgrade` de `0010` supprime la
    # contrainte sous ce nom-la, et echouerait sur l'autre.
    op.execute(f"ALTER TABLE booking_rules RENAME CONSTRAINT {ATTENDU} TO {DOUBLE}")

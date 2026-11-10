"""Photos de profil rangées en base.

Les photos étaient écrites sur le disque du serveur, sous `media/avatars`. Sur
l'hébergement de démonstration, ce disque est éphémère : il est effacé chaque
fois que le service se rendort puis se réveille. La photo disparaissait donc au
bout de quelques minutes, alors que le compte gardait son adresse — d'où un
404 à chaque affichage, puis le retour aux initiales.

Les octets vont désormais dans `user_avatars`, une ligne par compte, et
`users.avatar_url` désigne la route qui les sert. Une table à part plutôt
qu'une colonne de `users` : l'annuaire lit des dizaines de comptes à la fois
et n'affiche que des initiales, il n'a pas à transporter les images.

Les adresses existantes vers `/media/avatars/` ne sont pas reprises : sur la
base de démonstration, leurs fichiers ont déjà disparu, et l'API ne les
annonce plus depuis qu'elle vérifie leur présence. Les comptes concernés
reviennent aux initiales et déposent à nouveau leur photo.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "0015_photos_en_base"
down_revision: str | None = "0014_gabarits_ticket"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_avatars",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("content_type", sa.String(length=32), nullable=False),
        sa.Column("content", sa.LargeBinary(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "content_type IN ('image/png', 'image/jpeg', 'image/webp')",
            name=op.f("ck_user_avatars_content_type"),
        ),
        sa.CheckConstraint(
            "octet_length(content) > 0", name=op.f("ck_user_avatars_content_non_vide")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_user_avatars_user", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("user_id", name=op.f("pk_user_avatars")),
    )
    op.execute(
        "CREATE TRIGGER trg_user_avatars_updated BEFORE UPDATE ON user_avatars "
        "FOR EACH ROW EXECUTE FUNCTION set_updated_at()"
    )


def downgrade() -> None:
    op.drop_table("user_avatars")

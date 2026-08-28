"""Conversations de l'assistant, leurs messages, et le journal des tours.

Trois tables, trois durées de vie :

  * `chat_conversations` — le fil, avec son résumé. Il survit au rechargement
    de la page : sans persistance, chaque `F5` effacerait le contexte, et
    l'utilisateur devrait tout réexpliquer.
  * `chat_messages` — ce qui s'est dit, cartes comprises. La carte est
    conservée avec le message : la reconstruire à la relecture demanderait de
    rappeler les outils, dont les résultats auraient changé.
  * `chat_tours` — le journal d'exploitation : latences, outils, modèle,
    repli, étayage. Séparé des messages parce qu'il ne se lit pas de la même
    façon — l'un se relit dans le fil, l'autre s'agrège dans A-13 — et parce
    qu'il se purge à un autre rythme.

Aucune de ces tables ne conserve de jeton ni de code d'accès : le message est
du texte, les cartes sont des données métier déjà accessibles à l'utilisateur.

Revision ID: 0008_conversations
Revises: 0007_rag_pgvector
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = '0008_conversations'
down_revision: str | None = '0007_rag_pgvector'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TYPE chat_role AS ENUM ('utilisateur', 'assistant', 'systeme')
        """
    )

    op.execute(
        """
        CREATE TABLE chat_conversations (
            id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            titre            VARCHAR(120) NOT NULL DEFAULT 'Nouvelle conversation',
            -- Résumé des tours anciens, réécrit à chaque dépassement du budget
            -- de contexte. Jamais empilé : il remplace le précédent.
            resume           TEXT NOT NULL DEFAULT '',
            derniere_activite TIMESTAMPTZ NOT NULL DEFAULT now(),
            created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

            CONSTRAINT ck_chat_conversations_titre_non_vide CHECK (length(btrim(titre)) > 0)
        )
        """
    )
    op.execute(
        'CREATE INDEX idx_chat_conversations_user ON chat_conversations '
        '(user_id, derniere_activite DESC)'
    )

    op.execute(
        """
        CREATE TABLE chat_messages (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
            role            chat_role NOT NULL,
            contenu         TEXT NOT NULL DEFAULT '',
            -- Sorte de carte et sa charge utile : « salles », « reservation »,
            -- « article »… Nulles pour un message de texte simple.
            carte           VARCHAR(24),
            donnees         JSONB,
            sources         TEXT[] NOT NULL DEFAULT '{}',
            created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

            -- Un message vide sans carte ne serait rien : ni texte à lire, ni
            -- donnée à afficher.
            CONSTRAINT ck_chat_messages_non_vide CHECK (
                length(btrim(contenu)) > 0 OR carte IS NOT NULL
            )
        )
        """
    )
    op.execute(
        'CREATE INDEX idx_chat_messages_conversation ON chat_messages '
        '(conversation_id, created_at)'
    )

    op.execute(
        """
        CREATE TABLE chat_tours (
            id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            conversation_id   UUID REFERENCES chat_conversations(id) ON DELETE CASCADE,
            user_id           UUID REFERENCES users(id) ON DELETE SET NULL,
            mode              VARCHAR(16) NOT NULL,
            modele            VARCHAR(80),
            repli             BOOLEAN NOT NULL DEFAULT false,
            declencheur_repli VARCHAR(48),
            iterations        SMALLINT NOT NULL DEFAULT 0,
            outils            TEXT[] NOT NULL DEFAULT '{}',
            duree_ms          INTEGER NOT NULL DEFAULT 0,
            premier_jeton_ms  INTEGER,
            jetons_invite     INTEGER NOT NULL DEFAULT 0,
            jetons_reponse    INTEGER NOT NULL DEFAULT 0,
            jetons_contexte   INTEGER NOT NULL DEFAULT 0,
            injection_suspectee BOOLEAN NOT NULL DEFAULT false,
            etaye             BOOLEAN NOT NULL DEFAULT true,
            transfert_humain  BOOLEAN NOT NULL DEFAULT false,
            created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute('CREATE INDEX idx_chat_tours_date ON chat_tours (created_at DESC)')
    # Sert le taux de repli et le taux de transfert du tableau de bord A-13,
    # qui sont les deux chiffres qui disent si la démonstration tiendra.
    op.execute('CREATE INDEX idx_chat_tours_repli ON chat_tours (repli, created_at DESC)')

    for table in ("chat_conversations", "chat_messages", "chat_tours"):
        op.execute(
            f"""
            CREATE TRIGGER trg_{table}_updated
            BEFORE UPDATE ON {table}
            FOR EACH ROW EXECUTE FUNCTION set_updated_at()
            """
        )


def downgrade() -> None:
    op.execute('DROP TABLE IF EXISTS chat_tours')
    op.execute('DROP TABLE IF EXISTS chat_messages')
    op.execute('DROP TABLE IF EXISTS chat_conversations')
    op.execute('DROP TYPE IF EXISTS chat_role')

"""Base de connaissances vectorisée : extension pgvector et table de fragments.

Un article de la base de connaissances est trop long pour être vectorisé d'un
bloc : un vecteur unique moyenne tout le document et ne retrouve plus le
paragraphe précis qui répond à la question. Il est donc découpé, et c'est le
fragment qui porte le vecteur.

Deux index, deux usages, et c'est tout l'intérêt de la recherche hybride :

  * `hnsw` sur le vecteur, pour la proximité de sens — « je n'arrive pas à
    entrer dans la salle » retrouve l'article sur les codes d'accès, alors
    qu'aucun mot n'est commun ;
  * `gin` sur le vecteur lexical français, pour les termes exacts — un numéro,
    un nom propre, un mot rare que l'embedding dilue.

`hnsw` plutôt qu'`ivfflat` : ce dernier exige un entraînement sur des données
déjà présentes, et un index construit sur une table vide reste inutilisable
jusqu'à sa reconstruction. Sur un corpus de cette taille, la différence de
vitesse est nulle et la différence d'exploitation est totale.

La colonne lexicale est **générée** : elle ne peut pas se désynchroniser du
texte, ce qu'un déclencheur ou un appel oublié dans le service permettraient.

Elle utilise une configuration `french_unaccent` et non `french`. Mesuré avant
de l'ajouter : `to_tsvector('french', 'réservation')` ne répond pas à
`websearch_to_tsquery('french', 'reservation')`. Or personne ne tape les
accents dans une barre de recherche, et l'assistant reçoit ce que
l'utilisateur écrit. Sans cette configuration, la moitié lexicale de la
recherche hybride ne trouvait **jamais rien** — silencieusement, la moitié
vectorielle donnant l'illusion que tout fonctionnait.

Revision ID: 0007_rag_pgvector
Revises: 0006_visuels_parc
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0007_rag_pgvector'
down_revision: str | None = '0006_visuels_parc'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: Dimension de `nomic-embed-text`. Changer de modèle de vecteurs impose une
#: migration : la colonne est typée, et un vecteur de taille différente est
#: refusé par PostgreSQL — ce qui vaut mieux qu'un index silencieusement faux.
DIMENSION = 768


def upgrade() -> None:
    op.execute('CREATE EXTENSION IF NOT EXISTS vector')
    op.execute('CREATE EXTENSION IF NOT EXISTS unaccent')

    # `to_tsvector(regconfig, text)` reste immuable quand la configuration est
    # donnée en littéral : c'est ce qui autorise son emploi dans une colonne
    # générée, là où un appel direct à `unaccent()` — seulement STABLE — serait
    # refusé.
    op.execute("CREATE TEXT SEARCH CONFIGURATION french_unaccent (COPY = french)")
    op.execute(
        "ALTER TEXT SEARCH CONFIGURATION french_unaccent "
        "ALTER MAPPING FOR hword, hword_part, word WITH unaccent, french_stem"
    )

    op.execute(
        f"""
        CREATE TABLE faq_fragments (
            id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            article_id    UUID NOT NULL REFERENCES faq_articles(id) ON DELETE CASCADE,
            position      SMALLINT NOT NULL,
            contenu       TEXT NOT NULL,
            -- Empreinte du contenu du fragment. L'indexation incrémentale la
            -- compare avant de vectoriser : un article republié sans changement
            -- de texte ne redemande rien au modèle.
            empreinte     CHAR(32) NOT NULL,
            vecteur       vector({DIMENSION}),
            -- Le modèle qui a produit le vecteur. Deux modèles ne partagent pas
            -- le même espace : mélanger leurs vecteurs donnerait des distances
            -- qui ne veulent rien dire.
            modele        VARCHAR(80),
            lexical       tsvector GENERATED ALWAYS AS (
                              to_tsvector('french_unaccent', contenu)
                          ) STORED,
            vectorise_le  TIMESTAMPTZ,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

            CONSTRAINT uq_faq_fragments_article_position UNIQUE (article_id, position),
            CONSTRAINT ck_faq_fragments_contenu_non_vide CHECK (length(contenu) > 0),
            CONSTRAINT ck_faq_fragments_position_positive CHECK (position >= 0),
            -- Un vecteur sans modèle serait inexploitable : on ne saurait pas
            -- s'il est comparable à celui d'à côté.
            CONSTRAINT ck_faq_fragments_vecteur_modele CHECK (
                (vecteur IS NULL AND modele IS NULL AND vectorise_le IS NULL)
                OR (vecteur IS NOT NULL AND modele IS NOT NULL AND vectorise_le IS NOT NULL)
            )
        )
        """
    )

    op.execute('CREATE INDEX idx_faq_fragments_article ON faq_fragments (article_id)')
    op.execute('CREATE INDEX idx_faq_fragments_lexical ON faq_fragments USING gin (lexical)')
    op.execute(
        'CREATE INDEX idx_faq_fragments_vecteur ON faq_fragments '
        'USING hnsw (vecteur vector_cosine_ops)'
    )
    # Sert la réindexation : trouver les fragments non vectorisés, ou ceux
    # produits par un modèle qu'on vient de changer.
    op.execute(
        'CREATE INDEX idx_faq_fragments_a_vectoriser ON faq_fragments (modele) '
        'WHERE vecteur IS NULL'
    )

    op.execute(
        """
        CREATE TRIGGER trg_faq_fragments_updated
        BEFORE UPDATE ON faq_fragments
        FOR EACH ROW EXECUTE FUNCTION set_updated_at()
        """
    )


def downgrade() -> None:
    op.execute('DROP TABLE IF EXISTS faq_fragments')
    op.execute('DROP TEXT SEARCH CONFIGURATION IF EXISTS french_unaccent')
    # L'extension n'est pas retirée : une autre table pourrait s'en servir, et
    # la supprimer emporterait ses données sans avertissement.

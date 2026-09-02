"""Indexation incrémentale de la base de connaissances.

Appelée au moment de l'écriture depuis l'écran A-13 : publier, modifier ou
retirer un article met l'index à jour dans la foulée, sans redémarrage et sans
tâche planifiée.

Trois principes qui évitent le piège habituel du RAG — un index qui dit autre
chose que la source :

  1. **L'index suit la publication.** Un article repassé en brouillon voit ses
     fragments retirés : sinon l'assistant citerait un article que l'écran
     d'aide n'affiche plus.
  2. **Rien n'est revectorisé sans raison.** L'empreinte du fragment est
     comparée avant l'appel au modèle ; un article republié sans changement de
     texte ne coûte rien.
  3. **Un fragment sans vecteur reste indexé.** Le modèle peut être absent au
     moment de l'écriture ; le fragment est alors écrit sans vecteur, trouvable
     par la recherche lexicale, et la passe de rattrapage le vectorisera plus
     tard. Refuser l'écriture ferait dépendre l'administration d'Ollama.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.ai.rag.decoupage import decouper
from app.ai.rag.vecteurs import Vectoriseur, vectoriseur_partage
from app.ai.reglages import get_reglages_ia
from app.db.enums import ArticleStatus
from app.models import FaqArticle, FaqFragment

logger = logging.getLogger("app.ai.rag.indexation")


@dataclass(frozen=True, slots=True)
class Rapport:
    """Ce qu'a fait une passe d'indexation. Journalisé, et affiché par A-13."""

    articles: int = 0
    fragments_ecrits: int = 0
    fragments_retires: int = 0
    fragments_vectorises: int = 0
    fragments_inchanges: int = 0
    sans_vecteurs: bool = False

    def fusion(self, autre: Rapport) -> Rapport:
        return Rapport(
            articles=self.articles + autre.articles,
            fragments_ecrits=self.fragments_ecrits + autre.fragments_ecrits,
            fragments_retires=self.fragments_retires + autre.fragments_retires,
            fragments_vectorises=self.fragments_vectorises + autre.fragments_vectorises,
            fragments_inchanges=self.fragments_inchanges + autre.fragments_inchanges,
            sans_vecteurs=self.sans_vecteurs or autre.sans_vecteurs,
        )


async def indexer_article(
    session: Session, article: FaqArticle, *, vectoriseur: Vectoriseur | None = None
) -> Rapport:
    """Met l'index à jour pour un article. Ne valide pas la transaction."""
    reglages = get_reglages_ia()
    vectoriseur = vectoriseur or vectoriseur_partage()

    existants = {
        fragment.position: fragment
        for fragment in session.scalars(
            select(FaqFragment).where(FaqFragment.article_id == article.id)
        )
    }

    if article.status is not ArticleStatus.PUBLIE:
        # Un brouillon n'est pas consultable : le laisser dans l'index ferait
        # citer par l'assistant un article que personne ne peut ouvrir.
        session.execute(delete(FaqFragment).where(FaqFragment.article_id == article.id))
        return Rapport(articles=1, fragments_retires=len(existants))

    fragments = decouper(
        titre=article.title,
        corps=article.body,
        taille=reglages.rag_taille_fragment,
        recouvrement=reglages.rag_recouvrement,
    )
    if not fragments:
        session.execute(delete(FaqFragment).where(FaqFragment.article_id == article.id))
        return Rapport(articles=1, fragments_retires=len(existants))

    modele = await vectoriseur.modele_courant()

    a_vectoriser: list[int] = []
    lignes: list[FaqFragment] = []

    for fragment in fragments:
        ancien = existants.pop(fragment.position, None)
        inchange = (
            ancien is not None
            and ancien.empreinte == fragment.empreinte
            and ancien.vecteur is not None
            and ancien.modele == modele
        )
        if inchange:
            lignes.append(ancien)
            continue

        if ancien is None:
            ancien = FaqFragment(
                article_id=article.id,
                position=fragment.position,
                contenu=fragment.contenu,
                empreinte=fragment.empreinte,
            )
            session.add(ancien)
        else:
            ancien.contenu = fragment.contenu
            ancien.empreinte = fragment.empreinte
            ancien.vecteur = None
            ancien.modele = None
            ancien.vectorise_le = None

        lignes.append(ancien)
        a_vectoriser.append(fragment.position)

    # Les positions disparues — article raccourci — sortent de l'index.
    retires = len(existants)
    for reste in existants.values():
        session.delete(reste)

    inchanges = len(fragments) - len(a_vectoriser)
    vectorises = 0
    sans_vecteurs = False

    if a_vectoriser:
        cibles = [ligne for ligne in lignes if ligne.position in set(a_vectoriser)]
        vecteurs = await vectoriseur.vectoriser([ligne.contenu for ligne in cibles])
        if vecteurs is None or modele is None:
            # Écrit sans vecteur : trouvable en lexical dès maintenant,
            # vectorisé plus tard par `rattraper`.
            sans_vecteurs = True
            logger.info(
                "Fragments écrits sans vecteur",
                extra={"article": article.slug, "n": len(cibles)},
            )
        else:
            maintenant = datetime.now(UTC)
            for ligne, vecteur in zip(cibles, vecteurs, strict=True):
                ligne.vecteur = vecteur
                ligne.modele = modele
                ligne.vectorise_le = maintenant
            vectorises = len(cibles)

    session.flush()
    return Rapport(
        articles=1,
        fragments_ecrits=len(a_vectoriser),
        fragments_retires=retires,
        fragments_vectorises=vectorises,
        fragments_inchanges=inchanges,
        sans_vecteurs=sans_vecteurs,
    )


async def desindexer_article(session: Session, article_id: uuid.UUID) -> Rapport:
    """Retire un article de l'index. Appelé à la suppression."""
    retires = session.scalar(
        select(FaqFragment.id).where(FaqFragment.article_id == article_id).limit(1)
    )
    resultat = session.execute(
        delete(FaqFragment).where(FaqFragment.article_id == article_id)
    )
    return Rapport(articles=1, fragments_retires=resultat.rowcount if retires else 0)


async def reindexer_tout(
    session: Session, *, vectoriseur: Vectoriseur | None = None
) -> Rapport:
    """Reconstruit l'index complet. Commande d'administration, pas de routine."""
    vectoriseur = vectoriseur or vectoriseur_partage()
    rapport = Rapport()
    for article in session.scalars(select(FaqArticle).order_by(FaqArticle.slug)):
        rapport = rapport.fusion(
            await indexer_article(session, article, vectoriseur=vectoriseur)
        )
    return rapport


async def rattraper(
    session: Session, *, vectoriseur: Vectoriseur | None = None, lot: int = 32
) -> Rapport:
    """Vectorise les fragments écrits pendant une absence du modèle.

    Sans cette passe, un article publié alors qu'Ollama était éteint resterait
    définitivement invisible à la recherche sémantique — trouvable en lexical,
    donc jamais tout à fait perdu, mais silencieusement dégradé.
    """
    vectoriseur = vectoriseur or vectoriseur_partage()
    modele = await vectoriseur.modele_courant()
    if modele is None:
        return Rapport(sans_vecteurs=True)

    en_attente = list(
        session.scalars(
            select(FaqFragment).where(FaqFragment.vecteur.is_(None)).limit(lot)
        )
    )
    if not en_attente:
        return Rapport()

    vecteurs = await vectoriseur.vectoriser([ligne.contenu for ligne in en_attente])
    if vecteurs is None:
        return Rapport(sans_vecteurs=True)

    maintenant = datetime.now(UTC)
    for ligne, vecteur in zip(en_attente, vecteurs, strict=True):
        ligne.vecteur = vecteur
        ligne.modele = modele
        ligne.vectorise_le = maintenant

    session.flush()
    return Rapport(fragments_vectorises=len(en_attente))


def etat_index(session: Session) -> dict[str, int | str | None]:
    """État de l'index, pour le tableau de bord A-13."""
    return {
        "fragments": session.scalar(select(func.count()).select_from(FaqFragment)) or 0,
        "vectorises": session.scalar(
            select(func.count())
            .select_from(FaqFragment)
            .where(FaqFragment.vecteur.is_not(None))
        )
        or 0,
        "articles_indexes": session.scalar(
            select(func.count(func.distinct(FaqFragment.article_id))).select_from(
                FaqFragment
            )
        )
        or 0,
        "modele": session.scalar(
            select(FaqFragment.modele).where(FaqFragment.modele.is_not(None)).limit(1)
        ),
    }

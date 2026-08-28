"""Recherche hybride : proximité de sens et termes exacts, fusionnés.

Les deux recherches échouent différemment, et c'est pour cela qu'on les
additionne :

  * la **vectorielle** retrouve « je n'arrive pas à entrer dans la salle » sous
    l'article « Code d'accès », sans partager un seul mot ; elle rate en
    revanche un identifiant, un nom propre, un mot rare, que l'embedding dilue ;
  * la **lexicale** trouve le mot exact et rien d'autre ; elle ne sait pas
    qu'annuler et supprimer sont proches.

La fusion se fait par rangs réciproques (RRF) plutôt que par somme de scores.
Une similarité cosinus et un `ts_rank` ne vivent pas sur la même échelle : les
additionner reviendrait à comparer des degrés et des kilomètres. Les rangs, eux,
sont comparables par construction.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.ai.rag.vecteurs import Vectoriseur, vectoriseur_partage
from app.ai.reglages import get_reglages_ia
from app.db.enums import ArticleStatus
from app.models import FaqArticle, FaqFragment

logger = logging.getLogger("app.ai.rag.recherche")


@dataclass(frozen=True, slots=True)
class Extrait:
    """Un fragment retrouvé, avec de quoi le citer."""

    article_slug: str
    article_titre: str
    contenu: str
    score: float
    rang_vectoriel: int | None
    rang_lexical: int | None

    @property
    def voie(self) -> str:
        """Comment il a été trouvé. Sert au tableau de bord et au diagnostic."""
        if self.rang_vectoriel is not None and self.rang_lexical is not None:
            return "hybride"
        return "vectorielle" if self.rang_vectoriel is not None else "lexicale"


async def rechercher(
    session: Session,
    question: str,
    *,
    limite: int | None = None,
    categorie_id=None,
    vectoriseur: Vectoriseur | None = None,
) -> list[Extrait]:
    """Rend les meilleurs extraits pour une question, sources comprises.

    Sans modèle de vecteurs joignable, la recherche se poursuit sur son seul
    volet lexical : le rappel baisse, la réponse reste sourcée, et l'assistant
    ne perd pas la parole parce qu'Ollama est éteint.
    """
    reglages = get_reglages_ia()
    limite = limite or reglages.rag_top_k
    vectoriseur = vectoriseur or vectoriseur_partage()

    # Chaque voie ramène plus large que la limite finale : la fusion a besoin
    # de rangs sur lesquels travailler, pas de deux listes déjà tronquées.
    profondeur = max(limite * 4, 12)

    vecteurs = await vectoriseur.vectoriser([question])
    vectoriels = (
        _par_vecteur(session, vecteurs[0], profondeur, categorie_id) if vecteurs else []
    )
    lexicaux = _par_lexique(session, question, profondeur, categorie_id)

    if not vectoriels and not lexicaux:
        return []

    return _fusionner(
        session,
        vectoriels=vectoriels,
        lexicaux=lexicaux,
        limite=limite,
        k=reglages.rag_poids_fusion,
        seuil=reglages.rag_seuil_similarite,
    )


def _requete_base(categorie_id):
    requete = (
        select(FaqFragment.id, FaqFragment.article_id, FaqFragment.contenu)
        .join(FaqArticle, FaqArticle.id == FaqFragment.article_id)
        # L'index ne sert que ce qui est publié : citer un brouillon serait
        # renvoyer l'utilisateur vers une page qu'il ne peut pas ouvrir.
        .where(FaqArticle.status == ArticleStatus.PUBLIE)
    )
    if categorie_id is not None:
        requete = requete.where(FaqArticle.category_id == categorie_id)
    return requete


def _par_vecteur(session: Session, vecteur, profondeur: int, categorie_id):
    """Les `profondeur` fragments les plus proches, distance cosinus croissante."""
    distance = FaqFragment.vecteur.cosine_distance(vecteur).label("distance")
    lignes = session.execute(
        _requete_base(categorie_id)
        .add_columns(distance)
        .where(FaqFragment.vecteur.is_not(None))
        .order_by(distance)
        .limit(profondeur)
    ).all()
    # La similarité est rendue plutôt que la distance : elle se lit dans le sens
    # attendu — 1 vaut « identique » — et c'est elle que le seuil compare.
    return [(ligne.id, ligne.article_id, ligne.contenu, 1.0 - float(ligne.distance)) for ligne in lignes]


def _par_lexique(session: Session, question: str, profondeur: int, categorie_id):
    """Recherche plein texte française, insensible aux accents.

    `french_unaccent` des deux côtés : la colonne générée l'emploie, la requête
    aussi. Les faire diverger produirait une recherche qui ne trouve rien sans
    lever la moindre erreur.
    """
    termes = _termes(question)
    if not termes:
        return []

    requete_texte = func.to_tsquery("french_unaccent", termes)
    rang = func.ts_rank(FaqFragment.lexical, requete_texte).label("rang")

    lignes = session.execute(
        _requete_base(categorie_id)
        .add_columns(rang)
        .where(FaqFragment.lexical.op("@@")(requete_texte))
        .order_by(rang.desc())
        .limit(profondeur)
    ).all()
    return [(ligne.id, ligne.article_id, ligne.contenu, float(ligne.rang)) for ligne in lignes]


#: Mots trop courants pour distinguer un article d'un autre dans ce corpus.
_VIDES = frozenset(
    """
    comment pourquoi quand quel quelle quels quelles est-ce que qui quoi dans
    pour avec sans une des les mon mes ton tes son ses nos vos leur leurs
    je tu il elle nous vous ils elles ceci cela cette cet aux par sur sous
    plus moins tres bien faire fait peut peux puis dois doit etre suis sont
    ai as avons avez ont mais donc car ne pas plus rien tout tous toute
    """.split()
)


def _termes(question: str) -> str:
    """Transforme la question en disjonction de lexèmes.

    `websearch_to_tsquery` conjugue les termes : « Comment annuler une
    reservation ? » devient `comment & annul & reserv`, et aucun fragment ne
    contient « comment ». Mesuré sur le corpus : zéro résultat pour la
    conjonction, quinze pour la disjonction.

    La conjonction convient à une barre de recherche, où l'utilisateur affine.
    Ici la moitié lexicale sert le rappel — c'est la fusion des rangs, puis le
    modèle, qui trient. Un mot de trop ne doit pas faire disparaître la réponse.

    Les termes sont réduits aux lettres et aux chiffres avant d'entrer dans
    `to_tsquery`, qui interpréterait autrement `&`, `|` ou `!`.
    """
    mots: list[str] = []
    for brut in question.split():
        mot = "".join(caractere for caractere in brut if caractere.isalnum())
        if len(mot) >= 3 and mot.lower() not in _VIDES:
            mots.append(mot.lower())
    return " | ".join(dict.fromkeys(mots))


def _fusionner(session: Session, *, vectoriels, lexicaux, limite: int, k: int, seuil: float):
    """Fusion par rangs réciproques, puis filtrage par le seuil de similarité."""
    scores: dict = {}
    contenus: dict = {}
    articles: dict = {}
    rang_vec: dict = {}
    rang_lex: dict = {}
    similarite: dict = {}

    for position, (fid, article_id, contenu, valeur) in enumerate(vectoriels, start=1):
        scores[fid] = scores.get(fid, 0.0) + 1.0 / (k + position)
        contenus[fid] = contenu
        articles[fid] = article_id
        rang_vec[fid] = position
        similarite[fid] = valeur

    for position, (fid, article_id, contenu, _) in enumerate(lexicaux, start=1):
        scores[fid] = scores.get(fid, 0.0) + 1.0 / (k + position)
        contenus[fid] = contenu
        articles[fid] = article_id
        rang_lex[fid] = position

    retenus = sorted(scores, key=lambda fid: scores[fid], reverse=True)

    # Le seuil ne s'applique qu'aux fragments venus du vectoriel seul : un
    # fragment trouvé par les mots exacts est pertinent par construction, et le
    # rejeter sur une similarité cosinus médiocre reviendrait à écarter la
    # bonne réponse parce qu'elle est formulée autrement.
    filtres = [
        fid
        for fid in retenus
        if fid in rang_lex or similarite.get(fid, 0.0) >= seuil
    ]

    if not filtres:
        return []

    entetes = {
        ligne.id: (ligne.slug, ligne.title)
        for ligne in session.execute(
            select(FaqArticle.id, FaqArticle.slug, FaqArticle.title).where(
                FaqArticle.id.in_({articles[fid] for fid in filtres[:limite]})
            )
        ).all()
    }

    extraits: list[Extrait] = []
    for fid in filtres[:limite]:
        slug, titre = entetes.get(articles[fid], ("", ""))
        extraits.append(
            Extrait(
                article_slug=slug,
                article_titre=titre,
                contenu=contenus[fid],
                score=round(scores[fid], 5),
                rang_vectoriel=rang_vec.get(fid),
                rang_lexical=rang_lex.get(fid),
            )
        )
    return extraits

"""Pagination et tri, appliqués en SQL.

Une seule enveloppe pour toutes les collections : le front écrit un composant
de pagination, pas un par écran. Le comptage et le découpage se font en base —
charger la collection entière pour en compter les éléments annulerait l'intérêt
de la pagination.
"""

from __future__ import annotations

from typing import Annotated, Generic, TypeVar

from fastapi import Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.core.errors import ValidationError

T = TypeVar("T")

#: Plafond dur : une page plus grande ne sert aucun écran et ouvre la porte à
#: une extraction de masse déguisée en consultation.
TAILLE_MAX = 100


class PageParams(BaseModel):
    """Paramètres communs à toutes les collections."""

    model_config = ConfigDict(extra="forbid")

    page: Annotated[int, Field(ge=1)] = 1
    size: Annotated[int, Field(ge=1, le=TAILLE_MAX)] = 20
    #: `champ` ou `-champ` pour l'ordre décroissant.
    sort: str | None = None

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.size


def page_params(
    page: Annotated[int, Query(ge=1, description="Numéro de page, à partir de 1.")] = 1,
    size: Annotated[
        int, Query(ge=1, le=TAILLE_MAX, description="Éléments par page.")
    ] = 20,
    sort: Annotated[
        str | None, Query(description="Champ de tri, préfixé de `-` pour décroissant.")
    ] = None,
) -> PageParams:
    """Dépendance FastAPI : les paramètres sont validés par le schéma, jamais
    relus à la main dans le routeur."""
    return PageParams(page=page, size=size, sort=sort)


PageParamsDep = Annotated[PageParams, Query()]


class Pagination(BaseModel):
    page: int
    size: int
    pages: int
    has_next: bool
    has_previous: bool


class Page(BaseModel, Generic[T]):
    """Enveloppe constante de toute collection."""

    model_config = ConfigDict(from_attributes=True)

    items: list[T]
    total: int
    pagination: Pagination

    @classmethod
    def build(cls, items: list[T], total: int, params: PageParams) -> Page[T]:
        pages = max(1, -(-total // params.size))
        return cls(
            items=items,
            total=total,
            pagination=Pagination(
                page=params.page,
                size=params.size,
                pages=pages,
                has_next=params.page < pages,
                has_previous=params.page > 1,
            ),
        )


def _cle_stable(requete: Select) -> object | None:
    """Clé primaire de l'entité interrogée, pour départager les ex æquo.

    Trier sur une colonne non unique puis découper en pages laisse PostgreSQL
    libre de l'ordre entre valeurs égales : deux pages consécutives peuvent
    alors répéter une ligne et en omettre une autre, sans que rien ne le
    signale. La clé primaire rend le découpage déterministe.
    """
    descriptions = requete.column_descriptions
    entite = descriptions[0].get("entity") if descriptions else None
    return getattr(entite, "id", None)


def apply_sort(
    requete: Select, params: PageParams, colonnes: dict[str, object]
) -> Select:
    """Applique le tri demandé, refusé s'il ne figure pas dans la liste blanche.

    Un champ inconnu lève 422 plutôt que d'être ignoré : un tri silencieusement
    abandonné produit un écran qui ment sur son propre état.

    Le tri **remplace** celui de la requête reçue, il ne s'y ajoute pas.
    `Select.order_by()` empile les clauses : sur une requête déjà ordonnée — et
    la plupart le sont, par date décroissante — la colonne demandée se serait
    retrouvée en second rang, à départager des horodatages quasi uniques. Le
    paramètre était accepté, validé, et sans effet observable : le pire des
    trois états possibles.
    """
    if params.sort is None:
        return requete

    descendant = params.sort.startswith("-")
    nom = params.sort.lstrip("-")

    colonne = colonnes.get(nom)
    if colonne is None:
        autorises = ", ".join(sorted(colonnes))
        raise ValidationError(
            f"Tri « {nom} » inconnu. Champs autorisés : {autorises}.",
            fields=[{"field": "sort", "message": "Champ de tri inconnu."}],
        )

    voulu = colonne.desc() if descendant else colonne.asc()
    stable = _cle_stable(requete)
    clauses = [voulu] if stable is None else [voulu, stable.asc()]
    return requete.order_by(None).order_by(*clauses)


def paginate(
    session: Session,
    requete: Select,
    params: PageParams,
    *,
    colonnes: dict[str, object] | None = None,
) -> tuple[list, int]:
    """Compte puis découpe, en deux requêtes SQL et sans chargement complet.

    Le comptage réutilise la requête filtrée comme sous-requête : les filtres
    et le total restent cohérents même quand la clause `WHERE` se complique.
    """
    if colonnes:
        requete = apply_sort(requete, params, colonnes)

    total = (
        session.scalar(
            select(func.count()).select_from(requete.order_by(None).subquery())
        )
        or 0
    )

    lignes = (
        session.scalars(requete.limit(params.size).offset(params.offset)).unique().all()
    )
    return list(lignes), total

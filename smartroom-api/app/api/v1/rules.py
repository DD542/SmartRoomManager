"""Règles de réservation, horaires d'ouverture et fermetures exceptionnelles.

Trois référentiels, une même hiérarchie de portée : salle, puis bâtiment, puis
global. Le moteur la résout à chaque vérification ; ces routes la tiennent à jour.
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Body, Depends, Query, status

from app.api.deps import (
    RULES_CONFIGURE,
    CurrentPrincipal,
    PageDep,
    SessionDep,
    require_permission,
)
from app.api.v1.schemas import (
    BookingRuleIn,
    BookingRuleOut,
    ClosureIn,
    ClosureOut,
    OpeningWindowIn,
    OpeningWindowOut,
    RulePreviewOut,
)
from app.core.errors import NotFoundError
from app.core.pagination import Page
from app.db.enums import RuleScope
from app.models import ClosurePeriod
from app.services import rules_service as service

router = APIRouter(tags=["règles"])

Ecriture = Depends(require_permission(RULES_CONFIGURE))


def _fermeture_sortie(fermeture: ClosurePeriod) -> ClosureOut:
    from datetime import timedelta

    return ClosureOut(
        id=fermeture.id,
        label=fermeture.label,
        first_day=fermeture.date_span.lower,
        # DATERANGE est stocké en [début, fin[ : le dernier jour fermé est la
        # veille de la borne supérieure.
        last_day=fermeture.date_span.upper - timedelta(days=1),
        kind=fermeture.kind,
        is_global=fermeture.is_global,
        building_ids=[lien.building_id for lien in fermeture.buildings],
        room_ids=[lien.room_id for lien in fermeture.rooms],
        created_at=fermeture.created_at,
    )


# --------------------------------------------------------------------------- #
# Règles de réservation
# --------------------------------------------------------------------------- #


@router.get(
    "/booking-rules",
    response_model=list[BookingRuleOut],
    summary="Lister les règles",
    description=(
        "Toutes les valeurs du sujet — durées, anticipation, quota, délai "
        "d'annulation, fenêtre de validation, seuil de validation — vivent en "
        "base et se modifient sans toucher au code."
    ),
)
def list_rules(
    session: SessionDep,
    _admin=Ecriture,
    scope: RuleScope | None = None,
    building_id: uuid.UUID | None = None,
    room_id: uuid.UUID | None = None,
) -> list[BookingRuleOut]:
    return [
        BookingRuleOut.model_validate(item)
        for item in service.list_rules(
            session, scope=scope, building_id=building_id, room_id=room_id
        )
    ]


@router.get(
    "/rooms/{room_id}/booking-rules",
    response_model=BookingRuleOut,
    summary="Règles appliquées à une salle",
    description=(
        "La règle effectivement retenue, la plus spécifique d'abord : salle, "
        "puis bâtiment, puis globale. C'est ce que l'écran de réservation "
        "affiche pour expliquer ses contraintes."
    ),
    responses={404: {"description": "Aucune règle configurée."}},
)
def rules_for_room(
    room_id: uuid.UUID, session: SessionDep, _: CurrentPrincipal
) -> BookingRuleOut:
    regle = service.resolve_rule_for_room(session, room_id)
    if regle is None:
        raise NotFoundError("Aucune règle configurée.")
    return BookingRuleOut.model_validate(regle)


@router.put(
    "/booking-rules/{scope}",
    response_model=BookingRuleOut,
    summary="Créer ou remplacer la règle d'une portée",
    description=(
        "`PUT` plutôt que `POST` : il n'existe qu'une règle par portée, et la "
        "contrainte d'unicité en base le garantit. Créer ou modifier n'exige "
        "donc pas deux appels différents."
    ),
    responses={422: {"description": "Portée et cible incohérentes."}},
)
def upsert_rule(
    scope: RuleScope,
    payload: BookingRuleIn,
    session: SessionDep,
    _admin=Ecriture,
    building_id: uuid.UUID | None = None,
    room_id: uuid.UUID | None = None,
) -> BookingRuleOut:
    regle = service.upsert_rule(
        session, payload, scope=scope, building_id=building_id, room_id=room_id
    )
    session.commit()
    return BookingRuleOut.model_validate(regle)


@router.post(
    "/booking-rules/preview",
    response_model=RulePreviewOut,
    summary="Mesurer l'effet d'une règle avant de l'appliquer",
    description=(
        "Compte, sur les réservations réelles de la fenêtre, celles qui "
        "deviendraient non conformes. Rien n'est écrit."
    ),
)
def preview_rule(
    payload: BookingRuleIn,
    session: SessionDep,
    _admin=Ecriture,
    days: Annotated[int, Query(ge=1, le=365)] = 30,
) -> RulePreviewOut:
    return RulePreviewOut(**service.preview_rule(session, payload, days=days))


# --------------------------------------------------------------------------- #
# Horaires d'ouverture
# --------------------------------------------------------------------------- #


@router.get(
    "/opening-hours",
    response_model=list[OpeningWindowOut],
    summary="Lister les horaires d'ouverture",
)
def list_openings(
    session: SessionDep,
    _: CurrentPrincipal,
    scope: RuleScope | None = None,
    building_id: uuid.UUID | None = None,
    room_id: uuid.UUID | None = None,
) -> list[OpeningWindowOut]:
    return [
        OpeningWindowOut.model_validate(item)
        for item in service.list_openings(
            session, scope=scope, building_id=building_id, room_id=room_id
        )
    ]


@router.put(
    "/opening-hours/{scope}",
    response_model=list[OpeningWindowOut],
    summary="Remplacer les horaires d'une portée",
    description=(
        "Remplacement total et non incrémental : la résolution se fait par "
        "portée entière, et un jour manquant hériterait du bâtiment, créant "
        "une amplitude incohérente avec le reste de la semaine."
    ),
    responses={422: {"description": "Jour dupliqué, ou cible incohérente."}},
)
def replace_openings(
    scope: RuleScope,
    session: SessionDep,
    windows: Annotated[list[OpeningWindowIn], Body(max_length=7)],
    _admin=Ecriture,
    building_id: uuid.UUID | None = None,
    room_id: uuid.UUID | None = None,
) -> list[OpeningWindowOut]:
    creees = service.replace_openings(
        session, windows, scope=scope, building_id=building_id, room_id=room_id
    )
    session.commit()
    return [OpeningWindowOut.model_validate(item) for item in creees]


# --------------------------------------------------------------------------- #
# Fermetures exceptionnelles
# --------------------------------------------------------------------------- #


@router.get(
    "/closures",
    response_model=Page[ClosureOut],
    summary="Lister les fermetures",
    description="Filtrable par période : seules celles qui la recoupent remontent.",
)
def list_closures(
    session: SessionDep,
    _: CurrentPrincipal,
    params: PageDep,
    first_day: date | None = None,
    last_day: date | None = None,
) -> Page[ClosureOut]:
    fermetures, total = service.list_closures(
        session, params, first_day=first_day, last_day=last_day
    )
    return Page.build([_fermeture_sortie(item) for item in fermetures], total, params)


@router.get(
    "/closures/{closure_id}/impact",
    response_model=list[uuid.UUID],
    summary="Réservations que la fermeture empêcherait",
    description=(
        "À consulter avant de fermer : fermer un bâtiment sans voir les vingt "
        "réunions du jour serait une décision prise à l'aveugle."
    ),
)
def closure_impact(
    closure_id: uuid.UUID, session: SessionDep, _admin=Ecriture
) -> list[uuid.UUID]:
    return [item.id for item in service.impacted_bookings(session, closure_id)]


@router.post(
    "/closures",
    response_model=ClosureOut,
    status_code=status.HTTP_201_CREATED,
    summary="Déclarer une fermeture",
    description=(
        "Globale, ou ciblant des bâtiments et des salles — jamais les deux : "
        "cocher « tout le campus » puis désigner deux salles décrirait deux "
        "intentions contradictoires."
    ),
    responses={422: {"description": "Cible incohérente avec la portée."}},
)
def create_closure(
    payload: ClosureIn, session: SessionDep, _admin=Ecriture
) -> ClosureOut:
    fermeture = service.create_closure(session, payload)
    session.commit()
    return _fermeture_sortie(fermeture)


@router.delete(
    "/closures/{closure_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Lever une fermeture",
)
def delete_closure(closure_id: uuid.UUID, session: SessionDep, _admin=Ecriture) -> None:
    service.delete_closure(session, closure_id)
    session.commit()

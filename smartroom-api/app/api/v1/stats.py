"""Statistiques et journal d'audit.

Tous les agrégats sont calculés en SQL. `Cache-Control` porte leur durée de
validité : cinq minutes par défaut, alignées sur la cadence de rafraîchissement
de la vue matérialisée. Rafraîchir plus vite ne servirait qu'à relire une vue
dont personne n'a encore vu la version précédente.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from fastapi.responses import PlainTextResponse

from app.api.deps import (
    DATA_EXPORT,
    SYSTEM_CONFIGURE,
    CurrentPrincipal,
    PageDep,
    SessionDep,
    require_any,
    require_permission,
)
from app.api.v1.schemas.support import (
    AuditEntryOut,
    AuditFlagIn,
    MyStatsOut,
    OccupancyPointOut,
    OverviewOut,
    PeakHourOut,
    PublicStatsOut,
    RoomStatsOut,
)
from app.core.config import get_settings
from app.core.pagination import Page
from app.db.enums import AuditAction
from app.services import audit_service
from app.services import stats_service as service

settings = get_settings()
router = APIRouter(tags=["statistiques"])

Export = Depends(require_any(DATA_EXPORT, SYSTEM_CONFIGURE))
Systeme = Depends(require_permission(SYSTEM_CONFIGURE))

#: Chiffres personnels : jamais gardes, meme par le navigateur de leur
#: destinataire.
#:
#: `private, max-age=300` semblait suffire — le cache est celui du poste, pas
#: celui d'un intermediaire. Mais un cache navigateur est indexe par URL, et
#: `/stats/me` est la meme URL pour tout le monde. Deux comptes ouverts
#: successivement dans le meme navigateur, a moins de cinq minutes d'intervalle,
#: et le second lisait les chiffres du premier : nombre de reservations, heures,
#: annulations, salles frequentees.
#:
#: Constate sur deux comptes distincts affichant les memes dix reservations et
#: les memes huit annulations, alors que l'un d'eux n'en avait aucune.
#:
#: `Vary: Authorization` isolerait les reponses, mais le jeton tourne a chaque
#: rafraichissement : le cache serait manque a tous les coups. Autant ne rien
#: garder, et le dire.
PRIVE = "private, no-store"

#: Chiffres publics : anonymes, identiques pour tous, affiches sur la page
#: d'accueil. Rien n'y designe personne, le cache est donc sans risque.
#:
#: Deux fenetres plutot qu'une. `max-age` seul gardait la reponse cinq
#: minutes : une salle passee en maintenance depuis l'administration ne
#: changeait pas le compteur de la vitrine avant l'expiration, et cela se
#: lisait comme une panne.
#:
#: `stale-while-revalidate` sert la copie immediatement puis la renouvelle en
#: arriere-plan. Le visiteur n'attend jamais, et l'ecart se compte desormais en
#: dizaines de secondes. La fenetre totale reste celle que `STATS_CACHE_SECONDS`
#: gouverne ; seule la part fraiche est plus courte.
FRAIS = max(1, settings.stats_cache_seconds // 5)
PUBLIC = (
    f"public, max-age={FRAIS}, "
    f"stale-while-revalidate={settings.stats_cache_seconds - FRAIS}"
)


@router.get(
    "/stats/me",
    response_model=MyStatsOut,
    summary="Mes chiffres",
    description=(
        "Une seule requête, sept agrégats. Le taux d'absence ne compte que les "
        "réservations écoulées : une réunion de demain n'est ni honorée ni "
        "manquée, et vaut donc `null` tant qu'aucune n'est passée."
    ),
)
def my_stats(
    session: SessionDep,
    principal: CurrentPrincipal,
    response: Response,
    days: Annotated[int, Query(ge=1, le=365)] = 30,
) -> MyStatsOut:
    response.headers["Cache-Control"] = PRIVE
    return MyStatsOut(**service.me(session, principal.user.id, days=days))


@router.get(
    "/stats/me/export",
    response_class=PlainTextResponse,
    summary="Exporter mes réservations",
    description="CSV séparé par points-virgules, formaté en SQL.",
)
def export_mine(session: SessionDep, principal: CurrentPrincipal) -> PlainTextResponse:
    return PlainTextResponse(
        service.my_bookings_csv(session, principal.user.id),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": 'attachment; filename="mes-reservations.csv"',
            # Sans en-tete, un navigateur decide seul de garder la reponse
            # — et ce fichier porte les memes donnees que `/stats/me`, ligne
            # a ligne, sous la meme URL pour tout le monde.
            "Cache-Control": PRIVE,
        },
    )


@router.get(
    "/stats/public",
    response_model=PublicStatsOut,
    summary="Chiffres publics",
    description="Sans donnée personnelle : c'est la seule route de ce module ouverte.",
)
def public_stats(session: SessionDep, response: Response) -> PublicStatsOut:
    response.headers["Cache-Control"] = PUBLIC
    return PublicStatsOut(**service.public(session))


@router.get(
    "/admin/stats/overview",
    response_model=OverviewOut,
    summary="Vue d'ensemble",
    description="Sept indicateurs, une requête, sept sous-requêtes agrégées.",
)
def overview(
    session: SessionDep,
    response: Response,
    _admin=Export,
    days: Annotated[int, Query(ge=1, le=365)] = 7,
) -> OverviewOut:
    response.headers["Cache-Control"] = PRIVE
    return OverviewOut(**service.overview(session, days=days))


@router.get(
    "/admin/stats/occupancy",
    response_model=list[OccupancyPointOut],
    summary="Série d'occupation",
    description=(
        "Agrégée au jour, à la semaine ou au mois par `date_trunc` en base : "
        "produire une série journalière puis la replier côté serveur "
        "transporterait trente fois plus de lignes."
    ),
    responses={422: {"description": "Granularité inconnue."}},
)
def occupancy(
    session: SessionDep,
    response: Response,
    _admin=Export,
    first_day: date | None = None,
    last_day: date | None = None,
    building_ids: Annotated[list[uuid.UUID] | None, Query()] = None,
    granularity: Annotated[str, Query(pattern=r"^(day|week|month)$")] = "day",
) -> list[OccupancyPointOut]:
    response.headers["Cache-Control"] = PRIVE
    return [
        OccupancyPointOut(**item)
        for item in service.occupancy(
            session,
            first_day=first_day,
            last_day=last_day,
            building_ids=building_ids,
            granularity=granularity,
        )
    ]


@router.get(
    "/admin/stats/rooms",
    response_model=list[RoomStatsOut],
    summary="Classement des salles",
    description=(
        "Occupation, heures, réservations et absences par salle. Deux CTE "
        "gardent le décompte de réservations et l'occupation séparés : les "
        "joindre directement multiplierait les lignes."
    ),
)
def room_stats(
    session: SessionDep,
    response: Response,
    _admin=Export,
    first_day: date | None = None,
    last_day: date | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 20,
) -> list[RoomStatsOut]:
    response.headers["Cache-Control"] = PRIVE
    return [
        RoomStatsOut(**item)
        for item in service.rooms(
            session, first_day=first_day, last_day=last_day, limit=limit
        )
    ]


@router.get(
    "/admin/stats/peak-hours",
    response_model=list[PeakHourOut],
    summary="Heures de pointe",
    description="Répartition horaire, jour de semaine par jour de semaine.",
)
def peak_hours(
    session: SessionDep,
    response: Response,
    _admin=Export,
    first_day: date | None = None,
    last_day: date | None = None,
) -> list[PeakHourOut]:
    response.headers["Cache-Control"] = PRIVE
    return [
        PeakHourOut(**item)
        for item in service.peak_hours(session, first_day=first_day, last_day=last_day)
    ]


@router.get(
    "/admin/stats/export",
    response_class=PlainTextResponse,
    summary="Exporter les statistiques d'occupation",
)
def export_stats(
    session: SessionDep,
    _admin=Export,
    first_day: date | None = None,
    last_day: date | None = None,
) -> PlainTextResponse:
    return PlainTextResponse(
        service.occupancy_csv(session, first_day=first_day, last_day=last_day),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="occupation.csv"'},
    )


# --------------------------------------------------------------------------- #
# Journal d'audit
# --------------------------------------------------------------------------- #


@router.get(
    "/admin/audit-logs",
    response_model=Page[AuditEntryOut],
    summary="Journal des écritures sensibles",
    description=(
        "Du plus récent au plus ancien, toujours : le tri n'est pas exposé, un "
        "journal d'audit ne se lit pas à l'envers. Chaque entrée porte les "
        "valeurs avant et après, les secrets masqués."
    ),
    tags=["audit"],
)
def list_audit(
    session: SessionDep,
    params: PageDep,
    _admin=Systeme,
    since: datetime | None = None,
    until: datetime | None = None,
    actor_id: uuid.UUID | None = None,
    action: AuditAction | None = None,
    target_type: Annotated[str | None, Query(max_length=60)] = None,
    q: Annotated[str | None, Query(max_length=120)] = None,
) -> Page[AuditEntryOut]:
    entrees, total = audit_service.search(
        session,
        params,
        since=since,
        until=until,
        actor_id=actor_id,
        action=action,
        target_type=target_type,
        query=q,
    )
    return Page.build(
        [AuditEntryOut.model_validate(item) for item in entrees], total, params
    )


@router.get(
    "/admin/audit-logs/{entry_id}",
    response_model=AuditEntryOut,
    summary="Détail d'une entrée",
    tags=["audit"],
)
def get_audit(
    entry_id: uuid.UUID, session: SessionDep, _admin=Systeme
) -> AuditEntryOut:
    return AuditEntryOut.model_validate(audit_service.get(session, entry_id))


@router.post(
    "/admin/audit-logs/{entry_id}/flag",
    response_model=AuditEntryOut,
    summary="Signaler une entrée pour relecture",
    description=(
        "Signaler n'est pas réécrire : le déclencheur d'ajout seul autorise "
        "cette seule colonne, le reste de l'entrée reste immuable."
    ),
    responses={422: {"description": "Motif requis pour signaler."}},
    tags=["audit"],
)
def flag_audit(
    entry_id: uuid.UUID, payload: AuditFlagIn, session: SessionDep, _admin=Systeme
) -> AuditEntryOut:
    entree = audit_service.flag(
        session, entry_id, flagged=payload.flagged, reason=payload.reason
    )
    session.commit()
    return AuditEntryOut.model_validate(entree)


@router.get(
    "/admin/audit-logs/export/csv",
    response_class=PlainTextResponse,
    summary="Exporter le journal",
    description=(
        "Borné à cent entrées : un journal complet se lit dans un outil "
        "d'analyse, et l'exporter entièrement offrirait une extraction de masse "
        "déguisée en consultation."
    ),
    tags=["audit"],
)
def export_audit(
    session: SessionDep,
    _admin=Export,
    since: datetime | None = None,
    until: datetime | None = None,
    action: AuditAction | None = None,
) -> PlainTextResponse:
    return PlainTextResponse(
        audit_service.export_csv(session, since=since, until=until, action=action),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="journal-audit.csv"'},
    )

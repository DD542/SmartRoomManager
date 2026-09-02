"""Orchestration du moteur de recommandation.

Une requête filtrante, puis un scoring en mémoire : le domaine reçoit un
ensemble déjà réduit de `RoomProfile` et n'interroge jamais la base. Le profil
utilisateur est chargé en deux agrégats, pas en parcourant son historique.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import NotFoundError
from app.db.enums import BookingStatus
from app.domain import conflicts as dom_conflicts
from app.domain import recommendation as dom_reco
from app.domain.types import (
    Alternative,
    RoomProfile,
    ScoredRoom,
    SearchCriteria,
    TimeSlot,
    UserProfile,
)
from app.models import Booking, Floor, Room, User, UserPreference
from app.services.availability_service import (
    en_utc,
    free_slots,
    room_profile,
    search_rooms,
)

FUSEAU = ZoneInfo(get_settings().timezone)

#: Profondeur d'historique retenue pour le critère d'habitude.
FENETRE_HISTORIQUE = 90

#: Nombre de jours explorés pour proposer un report dans la même salle.
HORIZON_REPORT = 2


def load_user_profile(
    session: Session, user_id: uuid.UUID, *, now: datetime | None = None
) -> UserProfile:
    """Préférences, quota consommé et habitudes, en trois requêtes agrégées.

    L'historique remonte sous forme de comptes par salle : charger les
    réservations pour les compter en Python serait un N+1 déguisé en boucle.
    """
    now = en_utc(now or datetime.now(UTC))

    compte = session.get(User, user_id)
    if compte is None or compte.deleted_at is not None:
        raise NotFoundError("Utilisateur introuvable.")

    preferences = session.scalars(
        select(UserPreference).where(UserPreference.user_id == user_id)
    ).one_or_none()

    actives = (
        session.scalar(
            select(func.count())
            .select_from(Booking)
            .where(
                Booking.owner_id == user_id,
                Booking.status != BookingStatus.ANNULEE,
                Booking.deleted_at.is_(None),
                Booking.time_range.op("&&")(Range(now, None, bounds="[)")),
            )
        )
        or 0
    )

    depuis = now - timedelta(days=FENETRE_HISTORIQUE)
    lignes = session.execute(
        select(Booking.room_id, func.count())
        .where(
            Booking.owner_id == user_id,
            Booking.status != BookingStatus.ANNULEE,
            Booking.deleted_at.is_(None),
            Booking.time_range.op("&&")(Range(depuis, now, bounds="[)")),
        )
        .group_by(Booking.room_id)
    ).all()

    honorees, total = session.execute(
        select(
            func.count().filter(Booking.checked_in_at.is_not(None)),
            func.count(),
        ).where(
            Booking.owner_id == user_id,
            Booking.deleted_at.is_(None),
            Booking.time_range.op("<<")(Range(now, None, bounds="[)")),
            Booking.time_range.op("&&")(Range(depuis, None, bounds="[)")),
        )
    ).one()

    habitudes = {salle: nombre for salle, nombre in lignes}

    return UserProfile(
        id=user_id,
        preferred_building_id=preferences.preferred_building_id
        if preferences
        else None,
        preferred_floor_level=_etage_habituel(session, habitudes),
        active_bookings=actives,
        no_show_rate=(1 - honorees / total) if total else 0.0,
        booked_room_counts=habitudes,
    )


def _etage_habituel(session: Session, habitudes: dict[uuid.UUID, int]) -> int | None:
    """Étage de la salle la plus réservée sur la fenêtre d'historique.

    Aucune table ne stocke un « étage préféré » : le déduire de l'usage réel
    vaut mieux que d'ajouter une préférence que personne ne renseignerait.
    """
    if not habitudes:
        return None
    favorite = max(habitudes, key=lambda salle: habitudes[salle])
    return session.scalar(
        select(Floor.level)
        .join(Room, Room.floor_id == Floor.id)
        .where(Room.id == favorite)
    )


def rank_rooms(
    session: Session,
    criteria: SearchCriteria,
    *,
    user_id: uuid.UUID | None = None,
    limit: int | None = None,
    now: datetime | None = None,
) -> tuple[ScoredRoom, ...]:
    """Classement complet : éligibles d'abord, score décroissant.

    Une salle prise sur le créneau conserve son score et reste dans la réponse,
    marquée : l'utilisateur voit que la salle qu'il visait était la bonne, et
    pourquoi elle n'est pas disponible.
    """
    candidates = search_rooms(session, criteria)
    if not candidates:
        return ()

    profil = load_user_profile(session, user_id, now=now) if user_id else None
    empechements = {
        salle.id: "créneau déjà pris" for salle, libre in candidates if not libre
    }

    return dom_reco.rank(
        [salle for salle, _ in candidates],
        criteria,
        profil,
        blockers=empechements,
        limit=limit,
    )


def best_room(
    session: Session,
    criteria: SearchCriteria,
    *,
    user_id: uuid.UUID | None = None,
    now: datetime | None = None,
) -> ScoredRoom | None:
    """Meilleure salle réellement réservable, ou None.

    Renvoyer None plutôt qu'une liste vide : l'appelant veut une réponse, et
    « aucune salle ne convient » en est une.
    """
    for proposition in rank_rooms(session, criteria, user_id=user_id, now=now):
        if proposition.eligible:
            return proposition
    return None


def suggest_alternatives(
    session: Session,
    *,
    room_id: uuid.UUID,
    slot: TimeSlot,
    attendees: int | None = None,
    user_id: uuid.UUID | None = None,
    limit: int = 5,
    now: datetime | None = None,
) -> tuple[Alternative, ...]:
    """Alternatives à un créneau refusé, dans les trois familles du sujet.

    Le besoin est déduit de la salle visée — c'est le meilleur portrait de ce
    que l'utilisateur cherchait — à ceci près que le matériel y devient une
    préférence notée : exiger l'équipement exact ne proposerait qu'un clone, que
    le parc ne contient presque jamais.
    """
    visee = room_profile(session, room_id)
    besoin = SearchCriteria(
        slot=slot,
        attendees=attendees or visee.capacity,
        equipment_ids=visee.equipment_ids,
        building_id=visee.building_id,
        accessible_only=visee.is_accessible,
        equipment_strict=False,
    )

    autres = [
        (proposition.room, proposition.score)
        for proposition in rank_rooms(session, besoin, user_id=user_id, now=now)
        if proposition.eligible and proposition.room.id != room_id
    ]

    jour = slot.start.astimezone(FUSEAU).date()
    trous = free_slots(
        session,
        room_id,
        jour,
        jour + timedelta(days=HORIZON_REPORT),
        min_duration=slot.duration,
    )

    proches = _reports_ailleurs(session, besoin, jour, slot, exclure=room_id, now=now)

    return dom_conflicts.propose_alternatives(
        slot,
        visee,
        same_room_free=trous,
        other_rooms=autres,
        nearby=proches,
        tz=FUSEAU,
        limit=limit,
    )


def _reports_ailleurs(
    session: Session,
    besoin: SearchCriteria,
    jour: date,
    slot: TimeSlot,
    *,
    exclure: uuid.UUID,
    now: datetime | None,
    profondeur: int = 3,
) -> tuple[tuple[RoomProfile, TimeSlot, object], ...]:
    """Salles voisines proposant un autre horaire le même jour.

    L'exploration est bornée à quelques salles : chacune coûte trois requêtes de
    créneaux libres, et une liste plus longue n'aiderait pas l'utilisateur.
    """
    sans_creneau = SearchCriteria(
        attendees=besoin.attendees,
        equipment_ids=besoin.equipment_ids,
        building_id=besoin.building_id,
        accessible_only=besoin.accessible_only,
        equipment_strict=False,
    )
    classement = rank_rooms(session, sans_creneau, now=now, limit=profondeur + 1)

    propositions: list[tuple[RoomProfile, TimeSlot, object]] = []
    for proposition in classement:
        if proposition.room.id == exclure or len(propositions) >= profondeur:
            continue
        for trou in free_slots(
            session, proposition.room.id, jour, jour, min_duration=slot.duration
        ):
            if trou.start != slot.start:
                propositions.append(
                    (
                        proposition.room,
                        TimeSlot.of(trou.start, slot.duration),
                        proposition.score,
                    )
                )
                break
    return tuple(propositions)


def occupancy_of(session: Session, room_id: uuid.UUID) -> float:
    """Taux d'occupation observé d'une salle, pour un affichage isolé."""
    return room_profile(session, room_id).occupancy_rate

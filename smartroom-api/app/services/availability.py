"""Moteur de disponibilité : qualifier un créneau avant de l'écrire.

Deux garanties se répartissent le travail.

La base interdit physiquement le chevauchement, par `ex_bookings_no_overlap` :
aucune vérification applicative n'apporterait cette garantie sous concurrence.
Ce module ne la remplace pas — il *qualifie* ce que la contrainte se contente de
refuser, et couvre ce qu'elle ne voit pas : le battement entre deux réunions,
les horaires d'ouverture, les fermetures, les quotas.

Un conflit ne se force jamais. Une règle, si — c'est toute la différence entre
`blocking` et `rule_errors` dans le verdict rendu.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.orm import Session, selectinload

from app.core.config import get_settings
from app.db.enums import BookingStatus, RoomStatus
from app.models import Booking, Floor, Room, RoomEquipment
from app.services.rules import (
    ResolvedRules,
    charger_salle,
    find_closure,
    resolve_opening,
    resolve_rules,
    weekly_minutes,
    active_bookings,
)

FUSEAU = ZoneInfo(get_settings().timezone)

JOURS = ("dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi")


def fmt_heure(moment: datetime) -> str:
    return moment.astimezone(FUSEAU).strftime("%H:%M")


def fmt_duree(minutes: int) -> str:
    heures, reste = divmod(minutes, 60)
    if heures and reste:
        return f"{heures} h {reste:02d}"
    if heures:
        return f"{heures} h"
    return f"{minutes} min"


@dataclass(frozen=True, slots=True)
class Conflict:
    """Conflit qualifié entre le créneau demandé et une réservation existante."""

    booking_id: uuid.UUID
    title: str
    starts_at: datetime
    ends_at: datetime
    kind: str  # 'total' | 'partiel' | 'adjacent'
    overlap_minutes: int
    gap_minutes: int
    #: Un recouvrement est bloquant sans appel ; un battement court se force.
    blocking: bool
    message: str


@dataclass(slots=True)
class SlotVerdict:
    """Réponse du moteur, image du schéma `SlotCheckRead`."""

    conflicts: list[Conflict] = field(default_factory=list)
    rule_errors: list[str] = field(default_factory=list)
    capacity_error: str | None = None
    closure_error: str | None = None
    requires_validation: bool = False
    rules: ResolvedRules | None = None

    @property
    def blocking(self) -> bool:
        """Vrai si un chevauchement interdit l'écriture, quoi qu'il arrive."""
        return any(conflit.blocking for conflit in self.conflicts)

    @property
    def available(self) -> bool:
        return not (
            self.blocking
            or self.conflicts
            or self.rule_errors
            or self.capacity_error
            or self.closure_error
        )

    @property
    def forcable(self) -> bool:
        """Un administrateur peut passer outre tout sauf un chevauchement."""
        return not self.blocking


def qualifier(
    reservation: Booking, creneau: Range[datetime], buffer_min: int
) -> Conflict:
    """Distingue recouvrement total, partiel et battement insuffisant.

    Le troisième cas échappe à la contrainte EXCLUDE : les créneaux ne se
    touchent pas, seule la règle de battement les oppose.
    """
    plage = reservation.time_range
    debut, fin = plage.lower, plage.upper
    intitule = f"« {reservation.title} » ({fmt_heure(debut)}-{fmt_heure(fin)})"

    recouvre = debut < creneau.upper and creneau.lower < fin

    if recouvre:
        chevauchement = int(
            (min(fin, creneau.upper) - max(debut, creneau.lower)).total_seconds() // 60
        )
        if debut <= creneau.lower and creneau.upper <= fin:
            return Conflict(
                booking_id=reservation.id,
                title=reservation.title,
                starts_at=debut,
                ends_at=fin,
                kind="total",
                overlap_minutes=chevauchement,
                gap_minutes=0,
                blocking=True,
                message=f"Créneau déjà entièrement pris par {intitule}.",
            )
        return Conflict(
            booking_id=reservation.id,
            title=reservation.title,
            starts_at=debut,
            ends_at=fin,
            kind="partiel",
            overlap_minutes=chevauchement,
            gap_minutes=0,
            blocking=True,
            message=f"Chevauchement de {chevauchement} min avec {intitule}.",
        )

    # Sans recouvrement : seul le battement peut être insuffisant.
    if fin <= creneau.lower:
        ecart = int((creneau.lower - fin).total_seconds() // 60)
        message = (
            f"« {reservation.title} » se termine à {fmt_heure(fin)} : il ne reste que "
            f"{ecart} min de battement au lieu des {buffer_min} min exigées."
        )
    else:
        ecart = int((debut - creneau.upper).total_seconds() // 60)
        message = (
            f"« {reservation.title} » commence à {fmt_heure(debut)} : il ne reste que "
            f"{ecart} min de battement au lieu des {buffer_min} min exigées."
        )

    return Conflict(
        booking_id=reservation.id,
        title=reservation.title,
        starts_at=debut,
        ends_at=fin,
        kind="adjacent",
        overlap_minutes=0,
        gap_minutes=ecart,
        blocking=False,
        message=message,
    )


def detect_conflicts(
    session: Session,
    salle: Room,
    creneau: Range[datetime],
    regles: ResolvedRules,
    *,
    ignore_booking_id: uuid.UUID | None = None,
) -> list[Conflict]:
    """Réservations gênant le créneau, battement compris.

    La fenêtre interrogée est élargie du battement : c'est ce qui fait remonter
    la réunion qui finit cinq minutes trop tard, invisible pour un simple `&&`.
    """
    fenetre = Range(
        creneau.lower - regles.buffer,
        creneau.upper + regles.buffer,
        bounds="[)",
    )

    conditions = [
        Booking.room_id == salle.id,
        Booking.status != BookingStatus.ANNULEE,
        Booking.deleted_at.is_(None),
        Booking.time_range.op("&&")(fenetre),
    ]
    if ignore_booking_id is not None:
        conditions.append(Booking.id != ignore_booking_id)

    voisines = session.scalars(
        select(Booking).where(*conditions).order_by(func.lower(Booking.time_range))
    ).all()

    conflits = [qualifier(voisine, creneau, regles.buffer_min) for voisine in voisines]
    # Un battement de zéro minute désactive la règle : seuls les recouvrements
    # restent des conflits.
    if regles.buffer_min == 0:
        conflits = [c for c in conflits if c.kind != "adjacent"]
    return conflits


def verifier_regles(
    salle: Room,
    creneau: Range[datetime],
    regles: ResolvedRules,
    maintenant: datetime,
) -> list[str]:
    """Contrôles ne dépendant que du créneau, de la salle et des règles."""
    erreurs: list[str] = []
    duree = creneau.upper - creneau.lower

    if creneau.upper <= maintenant:
        erreurs.append("Le créneau est déjà passé.")
    if duree < regles.min_duration:
        erreurs.append(f"La durée minimale est de {fmt_duree(regles.min_duration_min)}.")
    if duree > regles.max_duration:
        erreurs.append(f"La durée maximale est de {fmt_duree(regles.max_duration_min)}.")

    horizon = maintenant + timedelta(days=regles.max_advance_days)
    if creneau.lower > horizon:
        erreurs.append(
            f"Réservation possible jusqu'à {regles.max_advance_days} jours à l'avance."
        )

    if salle.status is RoomStatus.MAINTENANCE:
        erreurs.append(f"{salle.name} est en maintenance.")
    elif salle.status is RoomStatus.ARCHIVEE:
        erreurs.append(f"{salle.name} est archivée.")

    return erreurs


def verifier_ouverture(
    session: Session, salle: Room, creneau: Range[datetime]
) -> list[str]:
    """Le créneau tient-il dans l'amplitude d'ouverture du jour ?"""
    debut_local = creneau.lower.astimezone(FUSEAU)
    fin_local = creneau.upper.astimezone(FUSEAU)

    fenetre = resolve_opening(session, salle, debut_local.date())
    if fenetre is None:
        return ["Aucun horaire d'ouverture n'est configuré pour cette salle."]

    nom_jour = JOURS[fenetre.weekday]
    if not fenetre.is_open:
        return [f"{salle.name} est fermée le {nom_jour}."]

    # Un créneau à cheval sur deux jours sort forcément de l'amplitude.
    if fin_local.date() != debut_local.date():
        return [f"Le créneau dépasse la fermeture de {fenetre.closes_at:%H:%M}."]

    if not fenetre.contains(debut_local.time(), fin_local.time()):
        return [
            f"{salle.name} ouvre de {fenetre.opens_at:%H:%M} à {fenetre.closes_at:%H:%M} "
            f"le {nom_jour}."
        ]
    return []


def verifier_quotas(
    session: Session,
    requester_id: uuid.UUID,
    creneau: Range[datetime],
    regles: ResolvedRules,
    maintenant: datetime,
    *,
    ignore_booking_id: uuid.UUID | None = None,
) -> list[str]:
    """Quota hebdomadaire et nombre de réservations actives."""
    erreurs: list[str] = []
    duree_min = int((creneau.upper - creneau.lower).total_seconds() // 60)

    deja = weekly_minutes(
        session, requester_id, creneau.lower, ignore_booking_id=ignore_booking_id
    )
    plafond = regles.weekly_quota_hours * 60
    if deja + duree_min > plafond:
        erreurs.append(
            f"Quota hebdomadaire dépassé : {fmt_duree(deja)} déjà réservées sur "
            f"{fmt_duree(plafond)}, cette réservation en ajouterait {fmt_duree(duree_min)}."
        )

    detenues = active_bookings(
        session, requester_id, maintenant, ignore_booking_id=ignore_booking_id
    )
    if detenues >= regles.max_active_bookings:
        erreurs.append(
            f"Vous détenez déjà {detenues} réservations à venir, "
            f"le maximum est de {regles.max_active_bookings}."
        )
    return erreurs


def check_slot(
    session: Session,
    *,
    room_id: uuid.UUID,
    creneau: Range[datetime],
    attendee_count: int = 1,
    requester_id: uuid.UUID | None = None,
    ignore_booking_id: uuid.UUID | None = None,
    maintenant: datetime | None = None,
) -> SlotVerdict:
    """Verdict complet sur un créneau.

    `ignore_booking_id` sert au déplacement d'une réservation : elle ne doit pas
    entrer en conflit avec elle-même, ni compter deux fois dans le quota.

    Le verdict ne décide rien : il rapporte. C'est l'appelant qui choisit de
    forcer les règles, et lui seul — jamais un conflit.
    """
    maintenant = maintenant or datetime.now(FUSEAU)
    salle = charger_salle(session, room_id)
    regles = resolve_rules(session, salle)

    verdict = SlotVerdict(rules=regles)
    verdict.conflicts = detect_conflicts(
        session, salle, creneau, regles, ignore_booking_id=ignore_booking_id
    )
    verdict.rule_errors = verifier_regles(salle, creneau, regles, maintenant)
    verdict.rule_errors += verifier_ouverture(session, salle, creneau)

    fermeture = find_closure(session, salle, creneau.lower.astimezone(FUSEAU).date())
    if fermeture is not None:
        verdict.closure_error = (
            f"{salle.name} est fermée ce jour-là : {fermeture.label}."
        )

    if attendee_count > salle.capacity:
        verdict.capacity_error = (
            f"Capacité dépassée : {salle.capacity} places pour {attendee_count} personnes."
        )

    seuil = regles.validation_capacity_threshold
    verdict.requires_validation = seuil is not None and attendee_count >= seuil

    if requester_id is not None:
        verdict.rule_errors += verifier_quotas(
            session,
            requester_id,
            creneau,
            regles,
            maintenant,
            ignore_booking_id=ignore_booking_id,
        )

    return verdict


def find_available_rooms(
    session: Session,
    *,
    creneau: Range[datetime],
    attendee_count: int = 1,
    building_id: uuid.UUID | None = None,
    equipment_ids: list[uuid.UUID] | None = None,
    include_ineligible: bool = False,
) -> list[Room]:
    """Salles libres sur le créneau, filtrées par capacité et équipements.

    Le filtrage grossier est fait en SQL — statut, capacité, bâtiment,
    équipements, recouvrement — et l'ordonnancement fin par `check_slot`, qui
    seul connaît le battement et les fermetures. Interroger `check_slot` pour
    tout le catalogue serait un N+1 déguisé ; le faire pour les seules
    candidates coûte une requête par salle réellement plausible.

    `include_ineligible` conserve les salles à capacité juste insuffisante :
    l'écran de recherche les affiche grisées plutôt que de les faire disparaître
    sans explication.
    """
    equipment_ids = equipment_ids or []
    plancher = 1 if include_ineligible else attendee_count

    requete = (
        select(Room)
        .join(Floor, Floor.id == Room.floor_id)
        .options(selectinload(Room.floor))
        .where(
            Room.deleted_at.is_(None),
            Room.status == RoomStatus.DISPONIBLE,
            Room.capacity >= plancher,
        )
    )
    if building_id is not None:
        requete = requete.where(Floor.building_id == building_id)

    # Tous les équipements exigés doivent être présents : un COUNT sur la table
    # de liaison évite autant de sous-requêtes que d'équipements demandés.
    if equipment_ids:
        requete = requete.where(
            select(func.count())
            .select_from(RoomEquipment)
            .where(
                RoomEquipment.room_id == Room.id,
                RoomEquipment.equipment_id.in_(equipment_ids),
            )
            .scalar_subquery()
            == len(set(equipment_ids))
        )

    # Élimine d'emblée les salles physiquement occupées : c'est l'index de la
    # contrainte EXCLUDE qui sert ici.
    occupee = (
        select(Booking.id)
        .where(
            Booking.room_id == Room.id,
            Booking.status != BookingStatus.ANNULEE,
            Booking.deleted_at.is_(None),
            Booking.time_range.op("&&")(creneau),
        )
        .exists()
    )
    requete = requete.where(~occupee).order_by(Room.capacity, Room.name)

    candidates = list(session.scalars(requete).unique())

    retenues: list[Room] = []
    for salle in candidates:
        verdict = check_slot(
            session,
            room_id=salle.id,
            creneau=creneau,
            attendee_count=attendee_count,
        )
        if verdict.available or (include_ineligible and verdict.forcable):
            retenues.append(salle)
    return retenues

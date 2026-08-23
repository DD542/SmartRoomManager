"""Évaluation des règles de réservation.

Chaque vérificateur renvoie une liste de violations, jamais un booléen : l'écran
de conflit doit pouvoir énumérer ce qui bloque, et l'administration doit savoir
ce qu'elle force. Aucune valeur n'est écrite ici — toutes viennent du `RuleSet`,
lui-même résolu depuis `booking_rules`.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.domain.availability import is_within
from app.domain.types import (
    BookingRef,
    Closure,
    RuleCode,
    RuleSet,
    RuleViolation,
    TimeSlot,
)


def _minutes(valeur: timedelta) -> int:
    return int(valeur.total_seconds() // 60)


def format_duree(valeur: timedelta) -> str:
    """Durée en français : « 30 min », « 4 h », « 1 h 30 »."""
    total = _minutes(valeur)
    heures, minutes = divmod(abs(total), 60)
    if heures and minutes:
        return f"{heures} h {minutes:02d}"
    if heures:
        return f"{heures} h"
    return f"{minutes} min"


def format_heure(moment: datetime, tz: ZoneInfo) -> str:
    return f"{moment.astimezone(tz):%H:%M}"


def check_duration(slot: TimeSlot, rules: RuleSet) -> tuple[RuleViolation, ...]:
    if slot.duration < rules.min_duration:
        return (
            RuleViolation(
                code=RuleCode.DUREE_MIN,
                message=(
                    f"Durée trop courte : {format_duree(slot.duration)} "
                    f"pour un minimum de {format_duree(rules.min_duration)}."
                ),
            ),
        )
    if slot.duration > rules.max_duration:
        return (
            RuleViolation(
                code=RuleCode.DUREE_MAX,
                message=(
                    f"Durée trop longue : {format_duree(slot.duration)} "
                    f"pour un maximum de {format_duree(rules.max_duration)}."
                ),
            ),
        )
    return ()


def check_horizon(
    slot: TimeSlot, now: datetime, rules: RuleSet
) -> tuple[RuleViolation, ...]:
    """Anticipation minimale et maximale, bornes incluses.

    Réserver exactement soixante jours à l'avance est accepté : la borne est la
    dernière valeur permise, pas la première refusée.
    """
    if slot.end <= now:
        return (
            RuleViolation(
                code=RuleCode.PASSE,
                message="Ce créneau est écoulé : il n'y a plus rien à réserver.",
                # Seule règle non forçable : forcer ne rendrait la salle à personne.
                forcible=False,
            ),
        )

    anticipation = slot.start - now
    if anticipation > rules.max_advance:
        return (
            RuleViolation(
                code=RuleCode.HORIZON_MAX,
                message=(
                    "Réservation trop lointaine : "
                    f"{anticipation.days} jours pour un maximum de {rules.max_advance.days}."
                ),
            ),
        )
    if anticipation < rules.min_advance:
        return (
            RuleViolation(
                code=RuleCode.HORIZON_MIN,
                message=(
                    "Réservation trop tardive : il faut réserver au moins "
                    f"{format_duree(rules.min_advance)} à l'avance."
                ),
            ),
        )
    return ()


def check_quota(active_bookings: int, rules: RuleSet) -> tuple[RuleViolation, ...]:
    if active_bookings >= rules.max_active_bookings:
        return (
            RuleViolation(
                code=RuleCode.QUOTA,
                message=(
                    f"Quota atteint : {active_bookings} réservations actives "
                    f"sur {rules.max_active_bookings} autorisées."
                ),
            ),
        )
    return ()


def check_capacity(attendees: int, capacity: int) -> tuple[RuleViolation, ...]:
    if attendees > capacity:
        return (
            RuleViolation(
                code=RuleCode.CAPACITE,
                message=(
                    f"Capacité dépassée : {capacity} places pour {attendees} personnes."
                ),
            ),
        )
    return ()


def check_opening(
    slot: TimeSlot, open_windows: Sequence[TimeSlot], tz: ZoneInfo
) -> tuple[RuleViolation, ...]:
    if is_within(slot, open_windows):
        return ()

    if not open_windows:
        message = "La salle n'est pas ouverte ce jour-là."
    else:
        amplitude = ", ".join(
            f"{format_heure(fenetre.start, tz)}–{format_heure(fenetre.end, tz)}"
            for fenetre in open_windows
        )
        message = (
            f"Hors des horaires d'ouverture : {format_heure(slot.start, tz)}–"
            f"{format_heure(slot.end, tz)} demandé, ouverture {amplitude}."
        )
    return (RuleViolation(code=RuleCode.HORS_OUVERTURE, message=message),)


def check_closure(
    slot: TimeSlot, closures: Sequence[Closure], tz: ZoneInfo
) -> tuple[RuleViolation, ...]:
    """Fermeture couvrant l'un des jours locaux que le créneau traverse.

    La borne de fin étant exclue, un créneau qui s'arrête à minuit pile ne
    touche pas le jour suivant.
    """
    for jour in local_days(slot, tz):
        for fermeture in closures:
            if fermeture.covers(jour):
                return (
                    RuleViolation(
                        code=RuleCode.FERMETURE,
                        message=f"Fermeture le {jour:%d/%m/%Y} : {fermeture.label}.",
                    ),
                )
    return ()


def check_buffer(
    slot: TimeSlot,
    neighbours: Sequence[BookingRef],
    rules: RuleSet,
    tz: ZoneInfo,
) -> tuple[RuleViolation, ...]:
    """Battement insuffisant avec une réservation voisine.

    Ce cas échappe à la contrainte `EXCLUDE` : les créneaux ne se touchent pas,
    seule la règle métier les oppose. Les recouvrements réels sont exclus ici,
    ils relèvent de la détection de conflits.
    """
    if rules.buffer <= timedelta(0):
        return ()

    violations: list[RuleViolation] = []
    for voisine in neighbours:
        if voisine.slot.overlaps(slot):
            continue
        ecart = slot.gap_to(voisine.slot)
        if ecart >= rules.buffer:
            continue

        if voisine.slot.end <= slot.start:
            situation = f"« {voisine.title} » se termine à {format_heure(voisine.slot.end, tz)}"
        else:
            situation = f"« {voisine.title} » commence à {format_heure(voisine.slot.start, tz)}"

        violations.append(
            RuleViolation(
                code=RuleCode.BATTEMENT,
                message=(
                    f"{situation} : il ne reste que {format_duree(ecart)} de battement "
                    f"au lieu des {format_duree(rules.buffer)} exigées."
                ),
            )
        )
    return tuple(violations)


def evaluate(
    slot: TimeSlot,
    *,
    rules: RuleSet,
    now: datetime,
    tz: ZoneInfo,
    attendees: int = 1,
    capacity: int | None = None,
    active_bookings: int = 0,
    open_windows: Sequence[TimeSlot] = (),
    closures: Sequence[Closure] = (),
    neighbours: Sequence[BookingRef] = (),
    check_quotas: bool = True,
) -> tuple[RuleViolation, ...]:
    """Toutes les violations d'un créneau, dans un ordre stable.

    L'ordre suit la gravité perçue : ce qui rend la réservation impossible
    d'abord, ce qui la rend seulement inconfortable ensuite.
    """
    horizon = check_horizon(slot, now, rules)
    if any(item.code is RuleCode.PASSE for item in horizon):
        # Sur un créneau écoulé, les autres règles n'apprennent rien : les
        # énumérer noierait le seul motif qui compte.
        return horizon

    violations: list[RuleViolation] = list(horizon)
    violations.extend(check_duration(slot, rules))
    violations.extend(check_closure(slot, closures, tz))
    violations.extend(check_opening(slot, open_windows, tz))
    if capacity is not None:
        violations.extend(check_capacity(attendees, capacity))
    if check_quotas:
        violations.extend(check_quota(active_bookings, rules))
    violations.extend(check_buffer(slot, neighbours, rules, tz))
    return tuple(violations)


def requires_validation(attendees: int, rules: RuleSet) -> bool:
    """Au-delà du seuil, la réservation attend un accord humain."""
    seuil = rules.validation_capacity_threshold
    return seuil is not None and attendees >= seuil


def can_cancel(slot: TimeSlot, now: datetime, rules: RuleSet) -> bool:
    """Une annulation tardive reste possible : le créneau doit être rendu même
    au dernier moment. Cette fonction dit seulement si elle est dans les délais."""
    return now <= slot.start - rules.cancel_deadline


def is_releasable(
    slot: TimeSlot, now: datetime, checked_in_at: datetime | None, rules: RuleSet
) -> bool:
    """Créneau commencé, présence jamais validée, fenêtre de validation écoulée.

    Un créneau déjà terminé n'est pas libérable : le rendre ne servirait plus.
    """
    if checked_in_at is not None:
        return False
    if now < slot.start + rules.checkin_window:
        return False
    return now < slot.end


def local_days(slot: TimeSlot, tz: ZoneInfo):
    """Jours locaux traversés par un créneau, bornes de fin exclue comprise."""
    premier = slot.start.astimezone(tz).date()
    # La borne de fin est exclue : un créneau qui s'arrête à minuit pile
    # appartient au jour précédent, pas au suivant.
    dernier = (slot.end - timedelta(microseconds=1)).astimezone(tz).date()

    jours = []
    jour = premier
    while jour <= dernier:
        jours.append(jour)
        jour += timedelta(days=1)
    return tuple(jours)

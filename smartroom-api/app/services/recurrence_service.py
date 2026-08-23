"""Séries récurrentes : générer les dates, puis les écrire une à une.

Une série n'est pas une réservation, c'est une règle. Mais elle ne produit
d'effet qu'en devenant des lignes de `bookings` : seule cette matérialisation
soumet chaque occurrence à la contrainte anti-chevauchement. Une règle stockée
sans occurrences repousserait la détection des conflits au moment de la lecture,
c'est-à-dire trop tard.
"""

from __future__ import annotations

import calendar
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import RuleViolationError
from app.db.enums import BookingSource, RecurrenceFreq
from app.domain.types import TimeSlot
from app.models import Booking, RecurrenceRule
from app.services import booking_service
from app.services.availability_service import check_slot, describe_conflicts, en_utc

FUSEAU = ZoneInfo(get_settings().timezone)

#: Au-delà, la série devient ingérable pour l'utilisateur comme pour le quota.
MAX_OCCURRENCES = 60


@dataclass(frozen=True, slots=True)
class Occurrence:
    """Date candidate d'une série, avec le motif d'un éventuel rejet."""

    slot: TimeSlot
    accepted: bool
    reason: str | None = None


@dataclass(frozen=True, slots=True)
class SeriesPreview:
    occurrences: tuple[Occurrence, ...]

    @property
    def accepted(self) -> tuple[Occurrence, ...]:
        return tuple(item for item in self.occurrences if item.accepted)

    @property
    def rejected(self) -> tuple[Occurrence, ...]:
        return tuple(item for item in self.occurrences if not item.accepted)


def _rang_dans_le_mois(jour: date) -> int:
    """Rang du jour de semaine dans son mois : 2 pour « le 2e mardi »."""
    return (jour.day - 1) // 7 + 1


def _nieme_jour_du_mois(annee: int, mois: int, jour_semaine: int, rang: int) -> date | None:
    """Nième occurrence d'un jour de semaine dans un mois, ou None si absente.

    Un mois n'a pas toujours cinq mardis : la série saute alors ce mois plutôt
    que de glisser sur le suivant, ce qui décalerait toute la suite.
    """
    premier = date(annee, mois, 1)
    # `date.weekday()` compte lundi = 0 ; le modèle suit EXTRACT(DOW), dimanche = 0.
    decalage = (jour_semaine - ((premier.weekday() + 1) % 7)) % 7
    candidat = premier + timedelta(days=decalage + (rang - 1) * 7)
    return candidat if candidat.month == mois else None


def generate_dates(
    *,
    freq: RecurrenceFreq,
    interval_count: int,
    byweekday: list[int],
    start_date: date,
    until_date: date,
) -> tuple[date, ...]:
    """Dates d'une série, bornes comprises, dans l'ordre chronologique."""
    if until_date < start_date:
        raise RuleViolationError("La date de fin précède la date de début.", code="ordre_dates")
    if not byweekday:
        raise RuleViolationError("Aucun jour de la semaine sélectionné.", code="jours_requis")

    jours = sorted(set(byweekday))
    dates: list[date] = []

    if freq is RecurrenceFreq.MENSUELLE:
        rang = _rang_dans_le_mois(start_date)
        annee, mois = start_date.year, start_date.month
        while len(dates) < MAX_OCCURRENCES:
            for jour_semaine in jours:
                candidat = _nieme_jour_du_mois(annee, mois, jour_semaine, rang)
                if candidat and start_date <= candidat <= until_date:
                    dates.append(candidat)
            mois += interval_count
            while mois > 12:
                mois -= 12
                annee += 1
            if date(annee, mois, 1) > until_date:
                break
        return tuple(sorted(dates)[:MAX_OCCURRENCES])

    # Hebdomadaire et bihebdomadaire : un pas en semaines, appliqué au lundi de
    # la semaine de départ pour que le rythme ne dépende pas du jour choisi.
    semaines = 2 if freq is RecurrenceFreq.BIHEBDOMADAIRE else 1
    pas = timedelta(weeks=semaines * interval_count)

    lundi = start_date - timedelta(days=start_date.weekday())
    while lundi <= until_date and len(dates) < MAX_OCCURRENCES:
        for jour_semaine in jours:
            # Conversion inverse : dimanche = 0 vers lundi = 0.
            candidat = lundi + timedelta(days=(jour_semaine - 1) % 7)
            if start_date <= candidat <= until_date:
                dates.append(candidat)
        lundi += pas

    return tuple(sorted(dates)[:MAX_OCCURRENCES])


def _creneau(jour: date, start_time: time, duree: timedelta) -> TimeSlot:
    """Le créneau est bâti en heure locale : une série à 14:00 reste à 14:00
    des deux côtés du changement d'heure, quel que soit l'instant UTC."""
    depart = datetime.combine(jour, start_time, tzinfo=FUSEAU)
    return TimeSlot(start=depart, end=depart + duree)


def preview_series(
    session: Session,
    *,
    room_id: uuid.UUID,
    freq: RecurrenceFreq,
    interval_count: int,
    byweekday: list[int],
    start_date: date,
    until_date: date,
    start_time: time,
    end_time: time,
    attendees: int = 1,
    now: datetime | None = None,
) -> SeriesPreview:
    """Confronte chaque date au moteur de disponibilité, sans rien écrire.

    Le quota hebdomadaire n'est pas évalué ici : il porterait sur une semaine à
    la fois alors que la série s'étale, et rejetterait des occurrences que la
    création espacera. Il reste vérifié à l'écriture, occurrence par occurrence.
    """
    if end_time <= start_time:
        raise RuleViolationError(
            "L'heure de fin doit suivre l'heure de début.", code="ordre_heures"
        )

    now = en_utc(now or datetime.now(UTC))
    duree = datetime.combine(date.min, end_time) - datetime.combine(date.min, start_time)

    occurrences: list[Occurrence] = []
    for jour in generate_dates(
        freq=freq,
        interval_count=interval_count,
        byweekday=byweekday,
        start_date=start_date,
        until_date=until_date,
    ):
        creneau = _creneau(jour, start_time, duree)
        rapport = check_slot(
            session, room_id=room_id, slot=creneau, attendees=attendees, now=now
        )

        if rapport.available:
            occurrences.append(Occurrence(slot=creneau, accepted=True))
            continue

        bloquants = rapport.blocking
        motif = (
            describe_conflicts(bloquants)[0]
            if bloquants
            else (rapport.violations[0].message if rapport.violations else "Créneau indisponible.")
        )
        occurrences.append(Occurrence(slot=creneau, accepted=False, reason=motif))

    return SeriesPreview(occurrences=tuple(occurrences))


def create_series(
    session: Session,
    *,
    room_id: uuid.UUID,
    owner_id: uuid.UUID,
    freq: RecurrenceFreq,
    interval_count: int,
    byweekday: list[int],
    start_date: date,
    until_date: date,
    start_time: time,
    end_time: time,
    title: str = "Réunion récurrente",
    attendees: int = 1,
    skip_conflicts: bool = True,
    now: datetime | None = None,
) -> tuple[RecurrenceRule, list[Booking], list[Occurrence]]:
    """Crée la règle et ses occurrences réservables.

    `skip_conflicts` traduit un choix de produit : une série de treize dates
    dont deux butent sur un conflit doit produire onze réservations, pas zéro.
    L'appelant reçoit la liste des dates écartées pour les afficher.
    """
    apercu = preview_series(
        session,
        room_id=room_id,
        freq=freq,
        interval_count=interval_count,
        byweekday=byweekday,
        start_date=start_date,
        until_date=until_date,
        start_time=start_time,
        end_time=end_time,
        attendees=attendees,
        now=now,
    )

    if not apercu.accepted:
        raise RuleViolationError("Aucune date de la série n'est disponible.", code="serie_vide")
    if apercu.rejected and not skip_conflicts:
        raise RuleViolationError(
            apercu.rejected[0].reason or "Série en conflit.", code="conflit"
        )

    regle = RecurrenceRule(
        owner_id=owner_id,
        room_id=room_id,
        freq=freq,
        interval_count=interval_count,
        byweekday=sorted(set(byweekday)),
        start_date=start_date,
        until_date=until_date,
        start_time=start_time,
        end_time=end_time,
    )
    session.add(regle)
    session.flush()

    creees: list[Booking] = []
    ecartees: list[Occurrence] = list(apercu.rejected)

    for occurrence in apercu.accepted:
        try:
            reservation, _ = booking_service.create_booking(
                session,
                room_id=room_id,
                owner_id=owner_id,
                slot=occurrence.slot,
                title=title,
                attendees=attendees,
                source=BookingSource.RECURRENTE,
                now=now,
            )
            reservation.recurrence_rule_id = regle.id
            creees.append(reservation)
        except RuleViolationError as erreur:
            # Le quota se consomme au fil des occurrences : les dernières dates
            # d'une longue série peuvent le dépasser alors que l'aperçu, qui
            # raisonne à base constante, les annonçait libres.
            ecartees.append(
                Occurrence(slot=occurrence.slot, accepted=False, reason=erreur.message)
            )

    session.flush()
    return regle, creees, ecartees

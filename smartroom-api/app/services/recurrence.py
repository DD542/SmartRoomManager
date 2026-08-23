"""Séries récurrentes : générer les occurrences, puis les écrire une à une.

Une série n'est pas une réservation : c'est une règle. Mais elle ne produit
d'effet qu'en devenant des lignes de `bookings` — seule façon de soumettre
chaque occurrence à la contrainte anti-chevauchement. Une règle stockée sans
occurrences repousserait la détection de conflits au moment de la lecture,
c'est-à-dire trop tard.

L'aperçu précède toujours l'écriture : l'utilisateur voit quelles dates passent
et lesquelles butent sur un conflit, avant de valider.
"""

from __future__ import annotations

import calendar
import uuid
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import RuleViolationError
from app.db.enums import BookingSource, RecurrenceFreq
from app.models import Booking, RecurrenceRule
from app.services.availability import check_slot
from app.services.booking import create_booking

FUSEAU = ZoneInfo(get_settings().timezone)

#: Au-delà, la série devient ingérable pour l'utilisateur comme pour le quota.
MAX_OCCURRENCES = 60


@dataclass(frozen=True, slots=True)
class Occurrence:
    """Date candidate d'une série, avec le motif d'un éventuel rejet."""

    creneau: Range[datetime]
    accepted: bool
    reason: str | None = None


@dataclass(frozen=True, slots=True)
class SeriesPreview:
    """Aperçu complet : ce qui passera, ce qui ne passera pas, et pourquoi."""

    occurrences: list[Occurrence]

    @property
    def accepted(self) -> list[Occurrence]:
        return [item for item in self.occurrences if item.accepted]

    @property
    def rejected(self) -> list[Occurrence]:
        return [item for item in self.occurrences if not item.accepted]


def _rang_dans_le_mois(jour: date) -> int:
    """Rang du jour de semaine dans son mois : 2 pour « le 2e mardi »."""
    return (jour.day - 1) // 7 + 1


def _nieme_jour_du_mois(annee: int, mois: int, jour_semaine: int, rang: int) -> date | None:
    """Nième occurrence d'un jour de semaine dans un mois, ou None si absente.

    Un mois n'a pas toujours cinq mardis : la série saute alors ce mois plutôt
    que de glisser sur le mois suivant, ce qui décalerait toute la suite.
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
) -> list[date]:
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
        return sorted(dates)[:MAX_OCCURRENCES]

    # Hebdomadaire et bihebdomadaire : un pas en semaines, appliqué au lundi de
    # la semaine de départ pour que le rythme ne dépende pas du jour choisi.
    semaines = 2 if freq is RecurrenceFreq.BIHEBDOMADAIRE else 1
    pas = timedelta(weeks=semaines * interval_count)

    lundi = start_date - timedelta(days=start_date.weekday())
    while lundi <= until_date and len(dates) < MAX_OCCURRENCES:
        for jour_semaine in jours:
            # Conversion inverse : dimanche = 0 vers lundi = 0.
            decalage = (jour_semaine - 1) % 7
            candidat = lundi + timedelta(days=decalage)
            if start_date <= candidat <= until_date:
                dates.append(candidat)
        lundi += pas

    return sorted(dates)[:MAX_OCCURRENCES]


def preview_series(
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
    attendee_count: int = 1,
    maintenant: datetime | None = None,
) -> SeriesPreview:
    """Confronte chaque date au moteur de disponibilité, sans rien écrire.

    Le quota hebdomadaire n'est pas évalué ici : il porterait sur une semaine à
    la fois alors que la série s'étale, et rejetterait des occurrences que la
    création espacera. Il reste vérifié à l'écriture, occurrence par occurrence.
    """
    if end_time <= start_time:
        raise RuleViolationError("L'heure de fin doit suivre l'heure de début.", code="ordre_heures")

    maintenant = maintenant or datetime.now(FUSEAU)
    duree = datetime.combine(date.min, end_time) - datetime.combine(date.min, start_time)

    occurrences: list[Occurrence] = []
    for jour in generate_dates(
        freq=freq,
        interval_count=interval_count,
        byweekday=byweekday,
        start_date=start_date,
        until_date=until_date,
    ):
        depart = datetime.combine(jour, start_time, tzinfo=FUSEAU)
        creneau = Range(depart, depart + duree, bounds="[)")

        verdict = check_slot(
            session,
            room_id=room_id,
            creneau=creneau,
            attendee_count=attendee_count,
            maintenant=maintenant,
        )

        if verdict.available:
            occurrences.append(Occurrence(creneau=creneau, accepted=True))
            continue

        motif = (
            next((c.message for c in verdict.conflicts if c.blocking), None)
            or verdict.closure_error
            or verdict.capacity_error
            or (verdict.rule_errors[0] if verdict.rule_errors else None)
            or (verdict.conflicts[0].message if verdict.conflicts else "Créneau indisponible.")
        )
        occurrences.append(Occurrence(creneau=creneau, accepted=False, reason=motif))

    return SeriesPreview(occurrences=occurrences)


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
    attendee_count: int = 1,
    skip_conflicts: bool = True,
    maintenant: datetime | None = None,
) -> tuple[RecurrenceRule, list[Booking], list[Occurrence]]:
    """Crée la série et ses occurrences réservables.

    `skip_conflicts` traduit un choix de produit : une série de treize dates
    dont deux butent sur un conflit doit produire onze réservations, pas zéro.
    L'appelant reçoit la liste des dates écartées pour les afficher.
    """
    apercu = preview_series(
        session,
        room_id=room_id,
        owner_id=owner_id,
        freq=freq,
        interval_count=interval_count,
        byweekday=byweekday,
        start_date=start_date,
        until_date=until_date,
        start_time=start_time,
        end_time=end_time,
        attendee_count=attendee_count,
        maintenant=maintenant,
    )

    if not apercu.accepted:
        raise RuleViolationError(
            "Aucune date de la série n'est disponible.", code="serie_vide"
        )
    if apercu.rejected and not skip_conflicts:
        raise RuleViolationError(apercu.rejected[0].reason or "Série en conflit.", code="conflit")

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
            reservation, _ = create_booking(
                session,
                room_id=room_id,
                owner_id=owner_id,
                creneau=occurrence.creneau,
                title=title,
                attendee_count=attendee_count,
                source=BookingSource.RECURRENTE,
                recurrence_rule_id=regle.id,
                maintenant=maintenant,
            )
            creees.append(reservation)
        except RuleViolationError as erreur:
            # Le quota se consomme au fil des occurrences : les dernières dates
            # d'une longue série peuvent le dépasser alors que l'aperçu, qui
            # raisonne à base vide, les annonçait libres.
            ecartees.append(
                Occurrence(creneau=occurrence.creneau, accepted=False, reason=erreur.message)
            )

    session.flush()
    return regle, creees, ecartees

"""Calcul des créneaux libres.

Tout repose sur un balayage d'intervalles triés : trier une fois, parcourir une
fois. Comparer chaque paire coûterait O(n²) là où une journée de salle compte
déjà quelques dizaines de réservations, et des milliers à l'échelle du parc.

Les fenêtres d'ouverture sont décrites en heure locale et converties instant par
instant : un jour de changement d'heure ne dure pas vingt-quatre heures, et
additionner un décalage constant ferait disparaître ou dupliquer une heure.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from app.domain.types import Closure, OpeningWindow, TimeSlot

_ZERO = timedelta(0)


def merge(slots: Iterable[TimeSlot]) -> tuple[TimeSlot, ...]:
    """Fusionne les intervalles qui se chevauchent ou se touchent.

    Les jointifs fusionnent aussi : deux réservations 09:00–10:00 et 10:00–11:00
    forment un seul bloc occupé, sans trou de durée nulle entre elles.
    """
    ordonnes = sorted(slots, key=lambda item: (item.start, item.end))
    if not ordonnes:
        return ()

    fusionnes: list[TimeSlot] = []
    courant = ordonnes[0]
    for suivant in ordonnes[1:]:
        if suivant.start <= courant.end:
            if suivant.end > courant.end:
                courant = TimeSlot(start=courant.start, end=suivant.end)
        else:
            fusionnes.append(courant)
            courant = suivant
    fusionnes.append(courant)
    return tuple(fusionnes)


def subtract(base: TimeSlot, busy: Sequence[TimeSlot]) -> tuple[TimeSlot, ...]:
    """Retranche les intervalles occupés d'une fenêtre, par balayage.

    `busy` n'a pas besoin d'être trié ni disjoint : la fusion préalable s'en
    charge, ce qui rend le parcours linéaire et le résultat déterministe.
    """
    restes: list[TimeSlot] = []
    curseur = base.start

    for occupe in merge(busy):
        if occupe.end <= base.start:
            continue
        if occupe.start >= base.end:
            break
        if occupe.start > curseur:
            restes.append(TimeSlot(start=curseur, end=min(occupe.start, base.end)))
        curseur = max(curseur, occupe.end)

    if curseur < base.end:
        restes.append(TimeSlot(start=curseur, end=base.end))
    return tuple(restes)


def subtract_all(
    bases: Sequence[TimeSlot], busy: Sequence[TimeSlot]
) -> tuple[TimeSlot, ...]:
    """Retranche une même occupation de plusieurs fenêtres."""
    occupes = merge(busy)
    resultat: list[TimeSlot] = []
    for base in bases:
        resultat.extend(subtract(base, occupes))
    return tuple(resultat)


def free_slots(
    windows: Sequence[TimeSlot],
    busy: Sequence[TimeSlot],
    *,
    min_duration: timedelta,
    buffer: timedelta = _ZERO,
) -> tuple[TimeSlot, ...]:
    """Trous réellement réservables d'une période.

    Le battement est appliqué en élargissant l'occupation, jamais en rognant le
    résultat : une salle occupée jusqu'à 13:55 n'est pas libre à 14:00 si la
    règle exige quinze minutes, et le trou renvoyé commence donc à 14:10.
    """
    if buffer < _ZERO:
        raise ValueError("Le battement ne peut pas être négatif.")

    elargis = [item.expanded(buffer) for item in busy] if buffer > _ZERO else list(busy)
    trous = subtract_all(merge(windows), elargis)
    return tuple(item for item in trous if item.duration >= min_duration)


def daily_windows(
    day: date, openings: Sequence[OpeningWindow], tz: ZoneInfo
) -> tuple[TimeSlot, ...]:
    """Convertit les horaires locaux d'un jour donné en intervalles UTC.

    Une amplitude dont l'heure de fermeture n'est pas postérieure à l'heure
    d'ouverture se referme le lendemain : c'est le cas d'une salle ouverte
    jusqu'à minuit ou au-delà.
    """
    jour_semaine = (day.weekday() + 1) % 7
    fenetres: list[TimeSlot] = []

    for ouverture in openings:
        if ouverture.weekday != jour_semaine:
            continue

        # `combine` avec tzinfo laisse zoneinfo choisir le décalage propre à cet
        # instant. Sur l'heure locale répétée du retour à l'heure d'hiver, fold=0
        # retient la première occurrence, celle de l'heure d'été.
        debut = datetime.combine(day, ouverture.opens_at, tzinfo=tz)
        jour_fin = (
            day if ouverture.closes_at > ouverture.opens_at else day + timedelta(days=1)
        )
        fin = datetime.combine(jour_fin, ouverture.closes_at, tzinfo=tz)

        fenetres.append(TimeSlot(start=debut, end=fin))

    return merge(fenetres)


def open_windows(
    first_day: date,
    last_day: date,
    openings: Sequence[OpeningWindow],
    closures: Sequence[Closure],
    tz: ZoneInfo,
) -> tuple[TimeSlot, ...]:
    """Amplitude ouverte d'une période, fermetures exceptionnelles déduites.

    La veille du premier jour est balayée elle aussi : une amplitude ouverte la
    veille au soir et refermée après minuit déborde sur la période demandée.
    """
    if last_day < first_day:
        raise ValueError("Le dernier jour précède le premier.")

    fenetres: list[TimeSlot] = []
    fermes: list[TimeSlot] = []

    jour = first_day - timedelta(days=1)
    while jour <= last_day:
        if any(fermeture.covers(jour) for fermeture in closures):
            # La journée fermée est retranchée plutôt que sautée : sans cela, une
            # amplitude ouverte la veille au soir déborderait sur elle.
            fermes.append(_journee_utc(jour, tz))
        else:
            fenetres.extend(daily_windows(jour, openings, tz))
        jour += timedelta(days=1)

    periode = TimeSlot(
        start=_journee_utc(first_day, tz).start,
        end=_journee_utc(last_day, tz).end,
    )
    dans_la_periode = [
        recoupe
        for fenetre in merge(fenetres)
        if (recoupe := fenetre.intersection(periode)) is not None
    ]
    return merge(subtract_all(dans_la_periode, fermes))


def is_free(
    slot: TimeSlot, busy: Sequence[TimeSlot], *, buffer: timedelta = _ZERO
) -> bool:
    """Vrai si aucune occupation ne touche le créneau élargi du battement."""
    if buffer < _ZERO:
        raise ValueError("Le battement ne peut pas être négatif.")

    teste = slot.expanded(buffer) if buffer > _ZERO else slot
    return not any(teste.overlaps(occupe) for occupe in busy)


def is_within(slot: TimeSlot, windows: Sequence[TimeSlot]) -> bool:
    """Vrai si le créneau tient entièrement dans une amplitude d'ouverture.

    L'appartenance est testée après fusion : un créneau à cheval sur deux
    amplitudes jointives — 22:00–00:00 puis 00:00–02:00 — tient dans leur union.
    """
    return any(fenetre.contains(slot) for fenetre in merge(windows))


def _journee_utc(day: date, tz: ZoneInfo) -> TimeSlot:
    """Journée locale complète, exprimée en UTC.

    Sa durée vaut 23, 24 ou 25 heures selon le changement d'heure : la borne de
    fin est celle du jour suivant à minuit local, jamais « début + 24 h ».
    """
    debut = datetime.combine(day, datetime.min.time(), tzinfo=tz)
    fin = datetime.combine(day + timedelta(days=1), datetime.min.time(), tzinfo=tz)
    return TimeSlot(start=debut, end=fin)

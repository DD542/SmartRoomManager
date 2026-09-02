"""Détection, qualification et résolution des chevauchements.

La qualification est purement géométrique : `classify` ne connaît ni règle, ni
battement, ni salle. C'est ce qui rend la matrice des sept cas testable
exhaustivement, sans base ni configuration.

Le battement n'est pas un type de chevauchement : deux créneaux séparés de cinq
minutes ne se recouvrent pas, la contrainte `EXCLUDE` les accepterait, et seule
une règle configurable les oppose. Il est donc traité dans `rules`, pas ici.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from app.domain.recommendation import justify
from app.domain.rules import format_duree, format_heure
from app.domain.types import (
    Alternative,
    AlternativeKind,
    ArbitrationBrief,
    ArbitrationFactor,
    BookingRef,
    ClaimantFile,
    Conflict,
    OverlapKind,
    RoomProfile,
    Score,
    TimeSlot,
)

_ZERO = timedelta(0)

#: Au-delà de ce décalage, proposer la même salle « un peu plus tard » n'aide
#: plus personne : la réunion aurait changé de demi-journée.
DECALAGE_MAX = timedelta(hours=8)

#: Ordre d'affichage : ce qui empêche de réserver d'abord, ce qui gêne ensuite.
GRAVITE: dict[OverlapKind, int] = {
    OverlapKind.IDENTIQUE: 0,
    OverlapKind.ENGLOBANT: 1,
    OverlapKind.ENGLOBE: 2,
    OverlapKind.PARTIEL_DEBUT: 3,
    OverlapKind.PARTIEL_FIN: 4,
    OverlapKind.ADJACENT: 5,
    OverlapKind.AUCUN: 6,
}

#: À score égal, garder la salle ou garder l'heure vaut mieux que changer les deux.
GRAVITE_ALTERNATIVE: dict[AlternativeKind, int] = {
    AlternativeKind.MEME_SALLE_AUTRE_CRENEAU: 0,
    AlternativeKind.AUTRE_SALLE_MEME_CRENEAU: 1,
    AlternativeKind.PROCHE: 2,
}


def classify(candidate: TimeSlot, existing: TimeSlot) -> OverlapKind:
    """Qualification géométrique de deux intervalles fermés-ouverts.

    Les prédicats sont ordonnés du plus spécifique au plus général : l'identité
    est un cas particulier d'englobement, et doit être reconnue avant lui.
    """
    if existing.start == candidate.start and existing.end == candidate.end:
        return OverlapKind.IDENTIQUE
    if existing.start <= candidate.start and existing.end >= candidate.end:
        return OverlapKind.ENGLOBANT
    if existing.start >= candidate.start and existing.end <= candidate.end:
        return OverlapKind.ENGLOBE
    if existing.start < candidate.start < existing.end < candidate.end:
        return OverlapKind.PARTIEL_DEBUT
    if candidate.start < existing.start < candidate.end < existing.end:
        return OverlapKind.PARTIEL_FIN
    if existing.end == candidate.start or candidate.end == existing.start:
        return OverlapKind.ADJACENT
    return OverlapKind.AUCUN


def qualify(candidate: TimeSlot, existing: BookingRef) -> Conflict:
    """Type, recouvrement mesuré et écart, pour une réservation existante."""
    kind = classify(candidate, existing.slot)
    recoupe = candidate.intersection(existing.slot)
    return Conflict(
        existing=existing,
        kind=kind,
        overlap=recoupe.duration if recoupe is not None else _ZERO,
        gap=candidate.gap_to(existing.slot),
    )


def detect(
    candidate: TimeSlot,
    existing: Sequence[BookingRef],
    *,
    buffer: timedelta = _ZERO,
) -> tuple[Conflict, ...]:
    """Conflits et quasi-conflits d'un créneau, triés par gravité puis par heure.

    La fenêtre examinée est élargie du battement : une réservation qui ne
    recouvre rien mais s'arrête cinq minutes avant doit remonter, sans quoi la
    règle de battement n'aurait aucune réservation à citer.
    """
    if buffer < _ZERO:
        raise ValueError("Le battement ne peut pas être négatif.")

    fenetre = candidate.expanded(buffer) if buffer > _ZERO else candidate
    retenus = [
        qualify(candidate, reservation)
        for reservation in existing
        if fenetre.overlaps(reservation.slot) or fenetre.touches(reservation.slot)
    ]
    retenus.sort(key=lambda item: (GRAVITE[item.kind], item.existing.slot.start))
    return tuple(retenus)


def blocking(conflicts: Sequence[Conflict]) -> tuple[Conflict, ...]:
    """Les seuls conflits que rien ne permet de forcer."""
    return tuple(item for item in conflicts if item.is_blocking)


def has_blocking(conflicts: Sequence[Conflict]) -> bool:
    return any(item.is_blocking for item in conflicts)


def describe(conflict: Conflict, tz: ZoneInfo) -> str:
    """Phrase construite depuis le type et les durées mesurées."""
    titre = conflict.existing.title
    plage = (
        f"{format_heure(conflict.existing.slot.start, tz)}–"
        f"{format_heure(conflict.existing.slot.end, tz)}"
    )
    kind = conflict.kind

    if kind is OverlapKind.IDENTIQUE:
        return f"Créneau déjà entièrement pris par « {titre} » ({plage})."
    if kind is OverlapKind.ENGLOBANT:
        return f"« {titre} » ({plage}) couvre tout le créneau demandé."
    if kind is OverlapKind.ENGLOBE:
        return (
            f"« {titre} » ({plage}) occupe {format_duree(conflict.overlap)} "
            "à l'intérieur du créneau."
        )
    if kind is OverlapKind.PARTIEL_DEBUT:
        return (
            f"« {titre} » ({plage}) empiète de {format_duree(conflict.overlap)} "
            "sur le début du créneau."
        )
    if kind is OverlapKind.PARTIEL_FIN:
        return (
            f"« {titre} » ({plage}) empiète de {format_duree(conflict.overlap)} "
            "sur la fin du créneau."
        )
    if kind is OverlapKind.ADJACENT:
        return f"« {titre} » ({plage}) est jointive : aucun battement entre les deux."
    return f"« {titre} » ({plage}) laisse {format_duree(conflict.gap)} de battement."


def report(conflicts: Sequence[Conflict], tz: ZoneInfo) -> tuple[str, ...]:
    return tuple(describe(item, tz) for item in conflicts)


def _report_dans(candidate: TimeSlot, trou: TimeSlot) -> TimeSlot | None:
    """Place un créneau de même durée dans un trou, au plus près de l'heure visée."""
    if trou.duration < candidate.duration:
        return None
    dernier_depart = trou.end - candidate.duration
    depart = min(max(candidate.start, trou.start), dernier_depart)
    return TimeSlot(start=depart, end=depart + candidate.duration)


def _note_decalage(candidate: TimeSlot, propose: TimeSlot, horizon: timedelta) -> int:
    """100 pour le même horaire, décroissant linéairement jusqu'à l'horizon."""
    ecart = abs(propose.start - candidate.start)
    if ecart >= horizon:
        return 0
    return round(100 * (1 - ecart / horizon))


def propose_alternatives(
    candidate: TimeSlot,
    room: RoomProfile,
    *,
    same_room_free: Sequence[TimeSlot] = (),
    other_rooms: Sequence[tuple[RoomProfile, Score]] = (),
    nearby: Sequence[tuple[RoomProfile, TimeSlot, Score]] = (),
    tz: ZoneInfo,
    horizon: timedelta = DECALAGE_MAX,
    limit: int = 5,
) -> tuple[Alternative, ...]:
    """Trois familles d'alternatives, fondues en un seul classement.

    Chaque famille est notée sur la même échelle : garder la salle vaut par la
    proximité horaire, changer de salle vaut par le score de la salle proposée,
    et une proposition qui change les deux cumule les deux pertes.
    """
    propositions: list[Alternative] = []

    for trou in same_room_free:
        report_possible = _report_dans(candidate, trou)
        if report_possible is None or report_possible == candidate:
            continue
        ecart = abs(report_possible.start - candidate.start)
        propositions.append(
            Alternative(
                kind=AlternativeKind.MEME_SALLE_AUTRE_CRENEAU,
                room_id=room.id,
                slot=report_possible,
                score=_note_decalage(candidate, report_possible, horizon),
                justification=(
                    f"Même salle, décalée de {format_duree(ecart)} : {room.name} de "
                    f"{format_heure(report_possible.start, tz)} à "
                    f"{format_heure(report_possible.end, tz)}."
                ),
            )
        )

    for autre, score in other_rooms:
        if autre.id == room.id:
            continue
        propositions.append(
            Alternative(
                kind=AlternativeKind.AUTRE_SALLE_MEME_CRENEAU,
                room_id=autre.id,
                slot=candidate,
                score=score.total,
                justification=f"Même créneau dans {autre.name}. {justify(score)}",
            )
        )

    for autre, creneau, score in nearby:
        if autre.id == room.id and creneau == candidate:
            continue
        facteur = _note_decalage(candidate, creneau, horizon) / 100
        ecart = abs(creneau.start - candidate.start)
        propositions.append(
            Alternative(
                kind=AlternativeKind.PROCHE,
                room_id=autre.id,
                slot=creneau,
                score=round(score.total * facteur),
                justification=(
                    f"{autre.name} de {format_heure(creneau.start, tz)} à "
                    f"{format_heure(creneau.end, tz)}, soit {format_duree(ecart)} "
                    f"de décalage. {justify(score)}"
                ),
            )
        )

    propositions.sort(
        key=lambda item: (-item.score, GRAVITE_ALTERNATIVE[item.kind], item.slot.start)
    )
    return tuple(propositions[:limit])


def _facteur(valeur: float, meilleures: set[float]) -> bool | None:
    """Oriente vers ce dossier si sa valeur est la meilleure et qu'elle départage.

    Quand tous les dossiers affichent la même valeur, le critère ne dit rien :
    l'annoncer favorable pour tout le monde serait trompeur.
    """
    if len(meilleures) <= 1:
        return None
    return valeur == min(meilleures)


def arbitration_brief(
    slot: TimeSlot,
    room_id: UUID,
    claimants: Sequence[ClaimantFile],
    *,
    tz: ZoneInfo,
) -> ArbitrationBrief:
    """Ordonne les prétendants par antériorité et expose trois critères séparés.

    Aucun gagnant n'est désigné et aucun score global n'est calculé : agréger
    ces trois critères reviendrait à trancher, alors que le sujet demande
    explicitement que la décision reste humaine.
    """
    ordonnes = sorted(claimants, key=lambda item: item.requested_at)

    anciennetes = {item.requested_at.timestamp() for item in ordonnes}
    quotas = {
        item.active_bookings / item.max_active_bookings
        if item.max_active_bookings
        else 0.0
        for item in ordonnes
    }
    absences = {item.no_show_rate for item in ordonnes}

    dossiers: list[ClaimantFile] = []
    for dossier in ordonnes:
        quota = (
            dossier.active_bookings / dossier.max_active_bookings
            if dossier.max_active_bookings
            else 0.0
        )
        depot = dossier.requested_at.astimezone(tz)

        facteurs = (
            ArbitrationFactor(
                key="anteriorite",
                label="Antériorité",
                value=dossier.requested_at.timestamp(),
                detail=f"demande déposée le {depot:%d/%m/%Y} à {depot:%H:%M}",
                favours=_facteur(dossier.requested_at.timestamp(), anciennetes),
            ),
            ArbitrationFactor(
                key="quota",
                label="Quota consommé",
                value=quota,
                detail=(
                    f"{dossier.active_bookings} réservations actives "
                    f"sur {dossier.max_active_bookings}"
                ),
                favours=_facteur(quota, quotas),
            ),
            ArbitrationFactor(
                key="absence",
                label="Taux d'absence",
                value=dossier.no_show_rate,
                detail=f"{round(dossier.no_show_rate * 100)} % d'absences constatées",
                favours=_facteur(dossier.no_show_rate, absences),
            ),
        )
        dossiers.append(
            ClaimantFile(
                user_id=dossier.user_id,
                requested_at=dossier.requested_at,
                booking_id=dossier.booking_id,
                active_bookings=dossier.active_bookings,
                max_active_bookings=dossier.max_active_bookings,
                no_show_rate=dossier.no_show_rate,
                display_name=dossier.display_name,
                factors=facteurs,
            )
        )

    return ArbitrationBrief(slot=slot, room_id=room_id, claimants=tuple(dossiers))


def seniority(conflicts: Sequence[Conflict]) -> BookingRef | None:
    """Réservation la plus ancienne parmi celles qui bloquent réellement.

    L'antériorité se mesure sur la date de création, pas sur l'heure du créneau :
    c'est l'ordre d'arrivée des demandes qui fait foi.
    """
    datees = [
        (item.existing.created_at, item.existing)
        for item in conflicts
        if item.is_blocking and item.existing.created_at is not None
    ]
    if not datees:
        return None
    return min(datees, key=lambda paire: paire[0])[1]

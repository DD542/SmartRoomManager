"""Scoring des salles et justification explicable.

Six critères pondérés, dont la somme vaut exactement 100 : sans cela, deux
salles évaluées sur des critères différents ne seraient pas comparables. Les
pondérations vivent dans `Weights` et nulle part ailleurs — les modifier ne
touche pas une ligne d'algorithme.

La justification est assemblée à partir des composantes calculées. Aucune phrase
n'est écrite à l'avance : c'est ce qui distingue une recommandation explicable
d'un classement décoré d'un texte générique.
"""

from __future__ import annotations

import unicodedata
from collections.abc import Sequence
from dataclasses import dataclass, fields
from uuid import UUID

from app.domain.types import (
    RoomProfile,
    Score,
    ScoreComponent,
    ScoredRoom,
    SearchCriteria,
    UserProfile,
)

#: Au-delà, une salle déjà fréquentée n'est pas « plus habituelle ».
HISTORIQUE_PLEIN = 3

#: Tolérance de surdimensionnement : douze places pour dix personnes reste un
#: bon ajustement, pas un gâchis.
TOLERANCE_CAPACITE = 1.15

#: Note neutre d'un critère sans référence. Elle ne départage personne, ce qui
#: est le comportement voulu : un critère non renseigné ne doit pas trancher.
NEUTRE = 0.5

LIBELLES: dict[str, str] = {
    "capacity": "Capacité",
    "equipment": "Équipements",
    "building": "Bâtiment",
    "floor": "Étage",
    "occupancy": "Disponibilité",
    "history": "Habitude",
}


@dataclass(frozen=True, slots=True)
class Weights:
    capacity: int = 30
    equipment: int = 25
    building: int = 15
    floor: int = 10
    occupancy: int = 12
    history: int = 8

    def __post_init__(self) -> None:
        total = sum(getattr(self, champ.name) for champ in fields(self))
        if total != 100:
            raise ValueError(f"Les pondérations doivent totaliser 100, pas {total}.")

    def of(self, key: str) -> int:
        return int(getattr(self, key))


DEFAULT_WEIGHTS = Weights()


def capacity_fit(attendees: int | None, capacity: int) -> float:
    """Sous-capacité éliminatoire, surdimensionnement pénalisé."""
    if attendees is None:
        return 0.8
    if capacity < attendees:
        return 0.0
    if capacity <= 0:
        return 0.0
    return min(1.0, (attendees / capacity) * TOLERANCE_CAPACITE)


def equipment_fit(required: frozenset[UUID], present: frozenset[UUID]) -> float:
    if not required:
        return 1.0
    return len(required & present) / len(required)


def building_fit(
    room: RoomProfile, criteria: SearchCriteria, user: UserProfile | None
) -> float:
    """Le bâtiment demandé prime sur le bâtiment habituel de l'utilisateur."""
    reference = criteria.building_id or (user.preferred_building_id if user else None)
    if reference is None:
        return NEUTRE
    return 1.0 if room.building_id == reference else 0.0


def floor_fit(room: RoomProfile, user: UserProfile | None) -> float:
    """Décroît avec l'écart d'étages : même étage 1, un étage 0,5, deux 0,33."""
    if user is None or user.preferred_floor_level is None:
        return NEUTRE
    return 1.0 / (1 + abs(room.floor_level - user.preferred_floor_level))


def occupancy_fit(room: RoomProfile) -> float:
    """Favoriser les salles sous-utilisées sert l'objectif métier du sujet."""
    return 1.0 - min(1.0, max(0.0, room.occupancy_rate))


def history_fit(room: RoomProfile, user: UserProfile | None) -> float:
    if user is None or not user.booked_room_counts:
        return NEUTRE
    return min(1.0, user.booked_room_counts.get(room.id, 0) / HISTORIQUE_PLEIN)


def _composante(key: str, valeur: float, detail: str, weights: Weights) -> ScoreComponent:
    maximum = weights.of(key)
    return ScoreComponent(
        key=key,
        label=LIBELLES[key],
        points=round(valeur * maximum),
        max_points=maximum,
        detail=detail,
    )


def _detail_capacite(attendees: int | None, capacity: int) -> str:
    if attendees is None:
        return f"{capacity} places, effectif non précisé"
    return f"{capacity} places pour {attendees} personnes"


def _detail_equipements(required: frozenset[UUID], present: frozenset[UUID]) -> str:
    if not required:
        return "aucun équipement imposé"
    return f"{len(required & present)}/{len(required)} demandés présents"


def _detail_batiment(
    room: RoomProfile, criteria: SearchCriteria, user: UserProfile | None
) -> str:
    reference = criteria.building_id or (user.preferred_building_id if user else None)
    if reference is None:
        return "aucun bâtiment de préférence"
    return "bâtiment de préférence" if room.building_id == reference else "autre bâtiment"


def _detail_etage(room: RoomProfile, user: UserProfile | None) -> str:
    if user is None or user.preferred_floor_level is None:
        return "aucun étage de préférence"
    ecart = abs(room.floor_level - user.preferred_floor_level)
    if ecart == 0:
        return "même étage"
    return f"{ecart} étage d'écart" if ecart == 1 else f"{ecart} étages d'écart"


def _detail_occupation(room: RoomProfile) -> str:
    return f"occupée à {round(min(1.0, max(0.0, room.occupancy_rate)) * 100)} %"


def _detail_historique(room: RoomProfile, user: UserProfile | None) -> str:
    if user is None or not user.booked_room_counts:
        return "aucun historique"
    fois = user.booked_room_counts.get(room.id, 0)
    if fois == 0:
        return "jamais réservée"
    return "déjà réservée une fois" if fois == 1 else f"déjà réservée {fois} fois"


def score_room(
    room: RoomProfile,
    criteria: SearchCriteria,
    user: UserProfile | None = None,
    *,
    weights: Weights = DEFAULT_WEIGHTS,
) -> Score:
    present = room.equipment_ids
    required = criteria.equipment_ids

    return Score(
        components=(
            _composante(
                "capacity",
                capacity_fit(criteria.attendees, room.capacity),
                _detail_capacite(criteria.attendees, room.capacity),
                weights,
            ),
            _composante(
                "equipment",
                equipment_fit(required, present),
                _detail_equipements(required, present),
                weights,
            ),
            _composante(
                "building",
                building_fit(room, criteria, user),
                _detail_batiment(room, criteria, user),
                weights,
            ),
            _composante(
                "floor",
                floor_fit(room, user),
                _detail_etage(room, user),
                weights,
            ),
            _composante(
                "occupancy",
                occupancy_fit(room),
                _detail_occupation(room),
                weights,
            ),
            _composante(
                "history",
                history_fit(room, user),
                _detail_historique(room, user),
                weights,
            ),
        )
    )


def eligibility_issues(room: RoomProfile, criteria: SearchCriteria) -> tuple[str, ...]:
    """Ce qui rend la salle non réservable, en clair.

    Une salle inéligible garde son score et reste affichée : l'écran explique
    pourquoi elle ne convient pas plutôt que de la faire disparaître.
    """
    motifs: list[str] = []

    if not room.is_available:
        motifs.append("salle indisponible")
    if criteria.attendees is not None and room.capacity < criteria.attendees:
        motifs.append(
            f"capacité insuffisante ({room.capacity} places pour {criteria.attendees} personnes)"
        )
    if criteria.equipment_strict:
        manquants = criteria.equipment_ids - room.equipment_ids
        if manquants:
            pluriel = "s" if len(manquants) > 1 else ""
            motifs.append(f"{len(manquants)} équipement{pluriel} manquant{pluriel}")
    if criteria.accessible_only and not room.is_accessible:
        motifs.append("accès PMR absent")

    return tuple(motifs)


def is_eligible(room: RoomProfile, criteria: SearchCriteria) -> bool:
    return not eligibility_issues(room, criteria)


def _sans_accent(valeur: str) -> str:
    plat = unicodedata.normalize("NFD", valeur.lower())
    return "".join(lettre for lettre in plat if not unicodedata.combining(lettre))


def _phrase(composante: ScoreComponent) -> str:
    key = composante.key
    if key == "capacity":
        return f"capacité ajustée ({composante.detail})"
    if key == "equipment":
        if composante.detail == "aucun équipement imposé":
            return "sans contrainte matérielle"
        if composante.ratio >= 1.0:
            return "tous les équipements demandés"
        return f"la plupart des équipements ({composante.detail})"
    if key == "building":
        return "dans votre bâtiment habituel"
    if key == "floor":
        return "au même étage" if composante.detail == "même étage" else f"proche ({composante.detail})"
    if key == "occupancy":
        return f"peu sollicitée ({composante.detail})"
    return f"salle habituelle ({composante.detail})"


def justify(score: Score, blocker: str | None = None) -> str:
    """Assemble une phrase depuis les deux composantes les mieux notées.

    La plus faible devient une réserve, pour que la proposition reste honnête.
    Les composantes neutres — critère non renseigné — n'apparaissent ni comme
    force ni comme réserve : leur ratio de 0,5 les laisse hors des deux seuils.
    """
    if not score.components:
        return "Aucun critère renseigné." if blocker is None else f"Indisponible : {blocker}"

    classes = sorted(score.components, key=lambda item: item.ratio, reverse=True)
    forts = [item for item in classes if item.ratio >= 0.6][:2]
    faible = classes[-1]

    if forts:
        assemblee = ", ".join(_phrase(item) for item in forts)
        base = assemblee[0].upper() + assemblee[1:]
    else:
        base = f"Compromis : {faible.label.lower()} {faible.detail}"

    if forts and faible.ratio < 0.4:
        # « réserve : bâtiment, autre bâtiment » : quand le détail reprend déjà
        # le critère, le rappeler devant produit une répétition.
        redondant = _sans_accent(faible.label) in _sans_accent(faible.detail)
        reserve = faible.detail if redondant else f"{faible.label.lower()}, {faible.detail}"
        base += f" — réserve : {reserve}"

    if blocker:
        return f"{base}. Indisponible : {blocker}"
    return f"{base}."


def evaluate_room(
    room: RoomProfile,
    criteria: SearchCriteria,
    user: UserProfile | None = None,
    *,
    weights: Weights = DEFAULT_WEIGHTS,
    blocker: str | None = None,
) -> ScoredRoom:
    """Salle notée, éligibilité tranchée et justification assemblée.

    `blocker` porte un empêchement que seul l'appelant connaît — un conflit de
    créneau, par exemple, que le domaine du scoring n'a pas à découvrir.
    """
    score = score_room(room, criteria, user, weights=weights)
    motifs = eligibility_issues(room, criteria)
    empechement = blocker or (motifs[0] if motifs else None)

    return ScoredRoom(
        room=room,
        score=score,
        eligible=not motifs and blocker is None,
        justification=justify(score, empechement),
    )


def rank(
    rooms: Sequence[RoomProfile],
    criteria: SearchCriteria,
    user: UserProfile | None = None,
    *,
    weights: Weights = DEFAULT_WEIGHTS,
    blockers: dict[UUID, str] | None = None,
    limit: int | None = None,
) -> tuple[ScoredRoom, ...]:
    """Éligibles d'abord, score décroissant, capacité croissante à égalité.

    Le tri place les salles réservables devant, quel que soit leur score : une
    salle à 96 points mais occupée ne doit pas coiffer une salle libre à 66.
    """
    empechements = blockers or {}
    notees = [
        evaluate_room(
            salle, criteria, user, weights=weights, blocker=empechements.get(salle.id)
        )
        for salle in rooms
    ]
    notees.sort(
        key=lambda item: (
            not item.eligible,
            -item.score.total,
            item.room.capacity,
            item.room.name,
        )
    )
    return tuple(notees if limit is None else notees[:limit])

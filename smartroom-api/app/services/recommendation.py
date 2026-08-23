"""Moteur de recommandation : classer les salles pour un besoin donné.

Score sur 100, réparti en quatre critères pondérés :

    capacité 35    — l'ajustement compte, le surdimensionnement est pénalisé ;
    équipements 30 — proportion des équipements demandés réellement présents ;
    bâtiment 15    — bâtiment de préférence de l'utilisateur ;
    occupation 20  — plus la salle est libre, mieux elle est notée.

La justification est **construite** à partir du détail du score : elle change
avec les données, aucun texte n'est figé. C'est ce qui distingue une
recommandation d'un tri — l'utilisateur voit pourquoi cette salle-là.

Le classement et la disponibilité sont deux choses différentes : une salle peut
obtenir 92/100 et rester inéligible parce qu'elle est prise sur le créneau. Le
moteur ne les confond pas, il les rapporte séparément.
"""

from __future__ import annotations

import unicodedata
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.orm import Session, selectinload

from app.core.config import get_settings
from app.core.errors import NotFoundError
from app.db.enums import RoomStatus
from app.models import Floor, Room, RoomEquipment
from app.services.availability import check_slot

FUSEAU = ZoneInfo(get_settings().timezone)

#: Somme exactement égale à 100 : un score qui ne totaliserait pas 100 rendrait
#: la comparaison entre deux salles dépendante des critères renseignés.
WEIGHTS = {"capacity": 35, "equipment": 30, "building": 15, "occupancy": 20}

#: Fenêtre d'observation de l'occupation passée. Trente jours lissent les
#: vacances d'une semaine sans remonter à un semestre qui n'a plus cours.
FENETRE_OCCUPATION = 30

LIBELLES = {
    "capacity": "Capacité",
    "equipment": "Équipements",
    "building": "Bâtiment",
    "occupancy": "Disponibilité",
}


@dataclass(frozen=True, slots=True)
class Criterion:
    """Un critère noté, avec le détail affichable qui l'explique."""

    key: str
    points: int
    detail: str

    @property
    def label(self) -> str:
        return LIBELLES[self.key]

    @property
    def max_points(self) -> int:
        return WEIGHTS[self.key]

    @property
    def ratio(self) -> float:
        return self.points / self.max_points


@dataclass(slots=True)
class Suggestion:
    """Une salle classée : son score, son détail, et si elle est réservable."""

    room: Room
    breakdown: list[Criterion] = field(default_factory=list)
    eligible: bool = True
    occupancy_rate: float = 0.0
    #: Renseigné quand le créneau est fourni : pourquoi la salle est écartée.
    blocker: str | None = None

    @property
    def score(self) -> int:
        return sum(critere.points for critere in self.breakdown)

    @property
    def occupancy_percent(self) -> int:
        return round(self.occupancy_rate * 100)

    @property
    def justification(self) -> str:
        return construire_justification(self.breakdown, self.blocker)


@dataclass(frozen=True, slots=True)
class Need:
    """Besoin exprimé. Tous les champs sont facultatifs sauf par convention."""

    creneau: Range[datetime] | None = None
    attendee_count: int | None = None
    equipment_ids: tuple[uuid.UUID, ...] = ()
    building_id: uuid.UUID | None = None
    accessible: bool = False
    include_maintenance: bool = False
    #: Le matériel manquant rend-il la salle inéligible, ou seulement moins bien
    #: notée ? Strict pour une recherche — l'utilisateur a demandé un écran —
    #: souple pour une alternative, où proposer autre chose vaut mieux que rien.
    equipment_strict: bool = True


# --------------------------------------------------------------------------- #
# Les quatre critères
# --------------------------------------------------------------------------- #


def capacity_fit(attendees: int | None, capacity: int) -> float:
    """1 quand la salle colle au besoin, décroît quand elle est trop grande.

    Douze places pour huit personnes vaut 0,92 ; trente places, 0,31. Le
    facteur 1,15 tolère un léger surdimensionnement : réserver douze places
    pour dix personnes est raisonnable, pas un gâchis.
    """
    if attendees is None:
        # Sans effectif annoncé, la capacité ne discrimine pas : une note neutre
        # évite de faire remonter mécaniquement les plus petites salles.
        return 0.8
    if capacity < attendees:
        return 0.0
    return min(1.0, (attendees / capacity) * 1.15)


def equipment_fit(exiges: tuple[uuid.UUID, ...], presents: set[uuid.UUID]) -> float:
    """Proportion des équipements demandés réellement présents."""
    if not exiges:
        return 1.0
    return len([item for item in exiges if item in presents]) / len(exiges)


def _pourcentage(taux: float) -> str:
    """Format du front : « 37 % », virgule décimale, espace insécable exclue."""
    return f"{round(taux * 100)} %"


def noter(salle: Room, besoin: Need, taux_occupation: float) -> list[Criterion]:
    """Détaille les quatre critères pour une salle."""
    presents = {lien.equipment_id for lien in salle.room_equipments}
    exiges = besoin.equipment_ids

    ajustement = capacity_fit(besoin.attendee_count, salle.capacity)
    materiel = equipment_fit(exiges, presents)
    bon_batiment = (
        besoin.building_id is not None and salle.floor.building_id == besoin.building_id
    )

    effectif = besoin.attendee_count if besoin.attendee_count is not None else "—"
    trouves = len([item for item in exiges if item in presents])

    return [
        Criterion(
            key="capacity",
            points=round(ajustement * WEIGHTS["capacity"]),
            detail=f"{salle.capacity} places pour {effectif} personnes",
        ),
        Criterion(
            key="equipment",
            points=round(materiel * WEIGHTS["equipment"]),
            detail=(
                "aucun équipement imposé"
                if not exiges
                else f"{trouves}/{len(exiges)} demandés présents"
            ),
        ),
        Criterion(
            key="building",
            points=WEIGHTS["building"] if bon_batiment else 0,
            detail="bâtiment de préférence" if bon_batiment else "autre bâtiment",
        ),
        Criterion(
            key="occupancy",
            points=round((1 - taux_occupation) * WEIGHTS["occupancy"]),
            detail=f"occupée à {_pourcentage(taux_occupation)}",
        ),
    ]


# --------------------------------------------------------------------------- #
# Justification
# --------------------------------------------------------------------------- #


def _sans_accent(valeur: str) -> str:
    plat = unicodedata.normalize("NFD", valeur.lower())
    return "".join(lettre for lettre in plat if not unicodedata.combining(lettre))


def construire_justification(breakdown: list[Criterion], blocker: str | None = None) -> str:
    """Assemble une phrase à partir des deux critères les mieux notés.

    Le critère le plus faible devient une réserve, pour que la proposition reste
    honnête : « tous les équipements demandés — réserve : autre bâtiment ».
    """
    if not breakdown:
        return "Aucun critère renseigné."

    classes = sorted(breakdown, key=lambda item: item.ratio, reverse=True)
    forts = [item for item in classes if item.ratio >= 0.6][:2]
    faible = classes[-1]

    phrases: list[str] = []
    for critere in forts:
        if critere.key == "capacity":
            phrases.append(f"capacité ajustée ({critere.detail})")
        elif critere.key == "equipment":
            phrases.append(
                "tous les équipements demandés"
                if "demandés présents" in critere.detail
                else "sans contrainte matérielle"
            )
        elif critere.key == "building":
            phrases.append("dans votre bâtiment habituel")
        else:
            phrases.append(f"peu sollicitée ({critere.detail})")

    if not phrases:
        base = f"Compromis : {faible.label.lower()} {faible.detail}"
    else:
        assemblee = ", ".join(phrases)
        base = assemblee[0].upper() + assemblee[1:]

    if faible.ratio < 0.4 and phrases:
        # « réserve : bâtiment, autre bâtiment » : quand le détail reprend déjà
        # le critère, le rappeler devant produit une répétition.
        redondant = _sans_accent(faible.label) in _sans_accent(faible.detail)
        reserve = faible.detail if redondant else f"{faible.label.lower()}, {faible.detail}"
        base += f" — réserve : {reserve}"

    if blocker:
        # L'empêchement prime sur la réserve : il dit pourquoi la salle, même
        # bien notée, ne peut pas être réservée telle quelle.
        return f"{base}. Indisponible : {blocker}"
    return f"{base}."


# --------------------------------------------------------------------------- #
# Occupation observée
# --------------------------------------------------------------------------- #


def occupancy_rates(
    session: Session, room_ids: list[uuid.UUID], *, depuis: date | None = None
) -> dict[uuid.UUID, float]:
    """Taux d'occupation moyen par salle sur la fenêtre d'observation.

    Une salle absente de la vue n'a simplement jamais été réservée : elle est
    réputée libre, ce qui la fait remonter — c'est le comportement voulu pour
    une salle nouvellement mise en service.
    """
    if not room_ids:
        return {}

    depuis = depuis or date.today() - timedelta(days=FENETRE_OCCUPATION)

    # Requête textuelle : la vue n'est pas mappée, et le construire en ORM
    # n'apporterait qu'une indirection de plus sur trois colonnes.
    lignes = session.execute(
        text(
            "SELECT room_id, AVG(occupancy_rate) AS taux "
            "  FROM v_room_occupancy_daily "
            " WHERE room_id = ANY(CAST(:salles AS uuid[])) "
            "   AND occupancy_date >= CAST(:depuis AS date) "
            " GROUP BY room_id"
        ),
        {"salles": [str(item) for item in room_ids], "depuis": depuis},
    ).all()

    return {identifiant: float(taux or 0.0) for identifiant, taux in lignes}


# --------------------------------------------------------------------------- #
# Classement
# --------------------------------------------------------------------------- #


def _candidates(session: Session, besoin: Need) -> list[Room]:
    """Salles envisageables, chargées avec ce dont le score a besoin.

    Le filtrage est volontairement large : une salle trop petite ou dépourvue du
    vidéoprojecteur reste classée, marquée inéligible. L'écran U-03 affiche
    « à capacité juste » plutôt que de la faire disparaître sans explication.
    """
    requete = (
        select(Room)
        .options(
            selectinload(Room.floor).selectinload(Floor.building),
            selectinload(Room.room_equipments).selectinload(RoomEquipment.equipment),
            selectinload(Room.photos),
            selectinload(Room.placement),
        )
        .where(Room.deleted_at.is_(None), Room.status != RoomStatus.ARCHIVEE)
    )
    if not besoin.include_maintenance:
        requete = requete.where(Room.status == RoomStatus.DISPONIBLE)

    # Le bâtiment reste une préférence notée, jamais un filtre : sinon le score
    # de bâtiment vaudrait 15 pour tout le monde et ne départagerait rien.
    return list(session.scalars(requete).unique())


def _empechement(session: Session, salle: Room, besoin: Need) -> str | None:
    """Ce qui interdit la réservation sur le créneau, ou None.

    Réutilise le moteur de disponibilité plutôt que de redire ses règles : une
    recommandation qui proposerait une salle que la création refuse serait pire
    qu'une absence de recommandation.
    """
    if besoin.creneau is None:
        return None

    verdict = check_slot(
        session,
        room_id=salle.id,
        creneau=besoin.creneau,
        attendee_count=besoin.attendee_count or 1,
    )
    if verdict.available:
        return None

    bloquant = next((conflit for conflit in verdict.conflicts if conflit.blocking), None)
    if bloquant is not None:
        return bloquant.message
    return (
        verdict.closure_error
        or verdict.capacity_error
        or (verdict.rule_errors[0] if verdict.rule_errors else None)
        or (verdict.conflicts[0].message if verdict.conflicts else "Créneau indisponible.")
    )


def rank_rooms(session: Session, besoin: Need, *, limit: int = 5) -> list[Suggestion]:
    """Classe les salles pour un besoin : éligibles d'abord, score décroissant.

    Le créneau, s'il est fourni, n'écarte pas les salles prises : il les marque.
    L'utilisateur voit ainsi que la salle qu'il visait était bien la meilleure,
    et pourquoi elle n'est pas disponible.
    """
    salles = _candidates(session, besoin)
    if not salles:
        return []

    taux = occupancy_rates(session, [salle.id for salle in salles])
    suggestions: list[Suggestion] = []

    for salle in salles:
        presents = {lien.equipment_id for lien in salle.room_equipments}
        occupation = taux.get(salle.id, 0.0)

        eligible = (
            salle.capacity >= (besoin.attendee_count or 0)
            and salle.status is RoomStatus.DISPONIBLE
            and (
                not besoin.equipment_strict
                or all(item in presents for item in besoin.equipment_ids)
            )
            and (not besoin.accessible or salle.is_accessible)
        )

        # Le moteur de disponibilité ne tourne que sur les salles encore en
        # lice : l'interroger pour une salle déjà écartée coûterait plusieurs
        # requêtes pour un verdict sans effet.
        blocker = _empechement(session, salle, besoin) if eligible else None
        suggestions.append(
            Suggestion(
                room=salle,
                breakdown=noter(salle, besoin, occupation),
                eligible=eligible and blocker is None,
                occupancy_rate=occupation,
                blocker=blocker,
            )
        )

    suggestions.sort(key=lambda item: (not item.eligible, -item.score, item.room.capacity))
    return suggestions[:limit]


def best_room(session: Session, besoin: Need) -> Suggestion | None:
    """Meilleure salle réellement réservable, ou None.

    Utilisée par le tableau de bord, le chatbot et la résolution de conflit :
    tous trois veulent une réponse, pas un classement.
    """
    for suggestion in rank_rooms(session, besoin, limit=20):
        if suggestion.eligible:
            return suggestion
    return None


def suggest_alternatives(
    session: Session,
    *,
    room_id: uuid.UUID,
    creneau: Range[datetime],
    attendee_count: int | None = None,
    limit: int = 3,
    maintenant: datetime | None = None,
) -> list[Suggestion]:
    """Alternatives à une salle prise, à créneau constant.

    C'est le cas qui compte dans l'arbitrage : la salle demandée est occupée, et
    l'administrateur doit pouvoir proposer autre chose sans quitter l'écran. Le
    besoin est déduit de la salle visée — capacité, équipements, bâtiment —
    parce que c'est le meilleur portrait disponible de ce que l'utilisateur
    cherchait — à ceci près que le matériel y est une préférence et non une
    exigence : une alternative est un substitut raisonnable, pas un jumeau.
    """
    visee = session.scalars(
        select(Room)
        .options(
            selectinload(Room.floor),
            selectinload(Room.room_equipments),
        )
        .where(Room.id == room_id, Room.deleted_at.is_(None))
    ).one_or_none()
    if visee is None:
        raise NotFoundError("Salle introuvable.")

    besoin = Need(
        creneau=creneau,
        attendee_count=attendee_count or visee.capacity,
        equipment_ids=tuple(lien.equipment_id for lien in visee.room_equipments),
        building_id=visee.floor.building_id,
        accessible=visee.is_accessible,
        # Exiger l'équipement exact de la salle visée ne proposerait qu'un
        # clone : le parc n'en contient presque jamais. Le matériel reste noté
        # sur trente points, donc les salles les mieux dotées remontent, et la
        # justification annonce ce qui manque.
        equipment_strict=False,
    )

    # `limit + 1` puis exclusion : la salle visée obtiendrait forcément le
    # meilleur score, et se proposer elle-même n'aiderait personne.
    retenues = [
        suggestion
        for suggestion in rank_rooms(session, besoin, limit=limit + 1)
        if suggestion.room.id != room_id and suggestion.eligible
    ]
    return retenues[:limit]

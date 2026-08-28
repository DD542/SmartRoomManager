"""Outils de lecture du parc : chercher, situer, expliquer les règles.

Quatre outils, tous en lecture seule, tous adossés aux services existants :
`availability_service`, `recommendation_service`, `parc_service`,
`rules_service`. Aucun ne recalcule quoi que ce soit — un score reproduit ici
finirait par diverger de celui du calendrier, et personne ne saurait lequel
croire.
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.ai.tools.base import Carte, Domaine, Outil, ToolContext, ToolResult
from app.ai.tools.resolution import (
    Ambiguite,
    resoudre_batiment,
    resoudre_equipements,
    resoudre_salle,
    resume_salle,
)
from app.core.pagination import PageParams
from app.domain.types import SearchCriteria, TimeSlot
from app.models import ClosurePeriod, Floor, RoomPlacement
from app.services import availability_service, parc_service, recommendation_service, rules_service

CODES_EQUIPEMENT = ["visio", "screen4k", "projector", "mic", "whiteboard", "sockets", "aircon"]


class _Base(BaseModel):
    model_config = ConfigDict(extra="forbid")


# --------------------------------------------------------------------------- #
# 1. rechercher_salles
# --------------------------------------------------------------------------- #


class ArgsRechercherSalles(_Base):
    capacite_min: int | None = Field(default=None, ge=1, le=500)
    batiment: str | None = Field(default=None, max_length=60)
    equipements: list[Literal[*CODES_EQUIPEMENT]] = Field(default_factory=list, max_length=8)
    accessible_pmr: bool = False
    limite: int = Field(default=5, ge=1, le=10)


class RechercherSalles(Outil):
    DOMAINE = Domaine.PARC
    ARGUMENTS = ArgsRechercherSalles
    SCHEMA = {
        "name": "rechercher_salles",
        "description": (
            "Cherche des salles correspondant à un besoin, sans tenir compte d'un "
            "créneau précis. À utiliser quand l'utilisateur décrit ce qu'il lui faut "
            "(capacité, équipements, bâtiment) sans donner d'horaire. Pour savoir si "
            "une salle est libre à un moment donné, utiliser consulter_disponibilite."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "capacite_min": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 500,
                    "description": "Nombre de personnes à accueillir.",
                },
                "batiment": {
                    "type": "string",
                    "maxLength": 60,
                    "description": (
                        "Nom ou code du bâtiment, tel que l'utilisateur l'a dit : "
                        "« Eiffel 3 » ou « EIF3 ». La résolution en identifiant est "
                        "faite par le serveur."
                    ),
                },
                "equipements": {
                    "type": "array",
                    "maxItems": 8,
                    "items": {"type": "string", "enum": CODES_EQUIPEMENT},
                    "description": "Équipements souhaités. Ne pas inventer de code hors de cette liste.",
                },
                "accessible_pmr": {
                    "type": "boolean",
                    "description": "Vrai si la salle doit être accessible aux personnes à mobilité réduite.",
                },
                "limite": {"type": "integer", "minimum": 1, "maximum": 10, "default": 5},
            },
            "required": [],
        },
    }

    async def execute(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        params = self.valider(args)
        try:
            batiment_id = resoudre_batiment(ctx.session, params.batiment)
        except Ambiguite as souci:
            return ToolResult.vide(souci.message())

        criteres = SearchCriteria(
            slot=None,
            attendees=params.capacite_min,
            building_id=batiment_id,
            equipment_ids=resoudre_equipements(ctx.session, params.equipements),
            accessible_only=params.accessible_pmr,
            equipment_strict=False,
        )
        candidates = availability_service.search_rooms(ctx.session, criteres)
        if not candidates:
            return ToolResult.vide("Aucune salle du parc ne correspond à ces critères.")

        salles = []
        for profil, _ in candidates[: params.limite]:
            salle = resoudre_salle(ctx.session, salle_id=profil.id)
            portrait = resume_salle(ctx.session, salle)
            portrait["taux_occupation"] = round(profil.occupancy_rate, 2)
            salles.append(portrait)

        return ToolResult.ok(
            data={"salles": salles, "total_correspondant": len(candidates)},
            carte=Carte.SALLES,
        )


# --------------------------------------------------------------------------- #
# 2. consulter_disponibilite
# --------------------------------------------------------------------------- #


class ArgsDisponibilite(_Base):
    #: Même raison que pour la création : le nom suffit, le serveur résout.
    salle_id: uuid.UUID | None = None
    salle_nom: str | None = Field(default=None, max_length=60)
    debut: str
    fin: str
    effectif: int = Field(default=1, ge=1, le=500)

    @model_validator(mode="after")
    def _creneau_coherent(self):
        from app.ai.tools.temps import lire_instant

        if self.salle_id is None and not self.salle_nom:
            raise ValueError("Fournir `salle_id` ou `salle_nom`.")
        debut, fin = lire_instant(self.debut), lire_instant(self.fin)
        if fin <= debut:
            raise ValueError("`fin` doit être postérieur à `debut`.")
        return self


class ConsulterDisponibilite(Outil):
    DOMAINE = Domaine.RESERVATION
    ARGUMENTS = ArgsDisponibilite
    SCHEMA = {
        "name": "consulter_disponibilite",
        "description": (
            "Dit si une salle précise est libre sur un créneau, et pourquoi elle ne "
            "l'est pas le cas échéant : réservation existante, fermeture, hors "
            "horaires d'ouverture, règle de réservation. Rend aussi les créneaux "
            "libres du même jour."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "salle_id": {"type": "string", "format": "uuid"},
                "salle_nom": {
                    "type": "string",
                    "maxLength": 60,
                    "description": "Nom de la salle si l'identifiant n'est pas connu.",
                },
                "debut": {"type": "string", "format": "date-time", "description": "ISO 8601 UTC, suffixe Z."},
                "fin": {
                    "type": "string",
                    "format": "date-time",
                    "description": "ISO 8601 UTC, suffixe Z. Doit être postérieur à debut.",
                },
                "effectif": {"type": "integer", "minimum": 1, "maximum": 500, "default": 1},
            },
            "required": ["debut", "fin"],
        },
    }

    async def execute(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        from app.ai.tools.temps import lire_instant

        params = self.valider(args)
        try:
            salle = resoudre_salle(ctx.session, salle_id=params.salle_id, nom=params.salle_nom)
        except Ambiguite as souci:
            return ToolResult.vide(souci.message())

        creneau = TimeSlot(start=lire_instant(params.debut), end=lire_instant(params.fin))
        rapport = availability_service.check_slot(
            ctx.session,
            room_id=salle.id,
            slot=creneau,
            attendees=params.effectif,
            requester_id=ctx.utilisateur_id,
            now=ctx.maintenant,
        )

        # Les motifs viennent du domaine, jamais d'une reformulation : c'est la
        # même explication que celle affichée dans le calendrier.
        empechements = [
            {"type": "chevauchement", "detail": str(conflit.kind.value)}
            for conflit in rapport.blocking
        ] + [
            {"type": "regle", "detail": violation.message, "forcable": violation.forcible}
            for violation in rapport.violations
        ]

        jour = creneau.start.date()
        libres = availability_service.free_slots(ctx.session, salle.id, jour, jour)

        return ToolResult.ok(
            data={
                "salle": resume_salle(ctx.session, salle),
                "disponible": rapport.available,
                "empechements": empechements,
                "creneaux_libres_ce_jour": [
                    {"debut": item.start.isoformat(), "fin": item.end.isoformat()}
                    for item in libres[:6]
                ],
            },
            carte=Carte.CRENEAUX,
        )


# --------------------------------------------------------------------------- #
# 3. recommander_salle
# --------------------------------------------------------------------------- #


class ArgsRecommander(_Base):
    debut: str
    fin: str
    effectif: int = Field(ge=1, le=500)
    batiment: str | None = Field(default=None, max_length=60)
    equipements: list[Literal[*CODES_EQUIPEMENT]] = Field(default_factory=list, max_length=8)
    accessible_pmr: bool = False
    limite: int = Field(default=3, ge=1, le=5)

    @model_validator(mode="after")
    def _creneau_coherent(self):
        from app.ai.tools.temps import lire_instant

        if lire_instant(self.fin) <= lire_instant(self.debut):
            raise ValueError("`fin` doit être postérieur à `debut`.")
        return self


class RecommanderSalle(Outil):
    DOMAINE = Domaine.RESERVATION
    ARGUMENTS = ArgsRecommander
    SCHEMA = {
        "name": "recommander_salle",
        "description": (
            "Classe les salles éligibles pour un besoin complet, avec un score sur "
            "100 et sa justification. À préférer à rechercher_salles dès qu'un "
            "créneau est connu : le classement tient compte de l'occupation réelle "
            "et des règles."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "debut": {"type": "string", "format": "date-time"},
                "fin": {"type": "string", "format": "date-time"},
                "effectif": {"type": "integer", "minimum": 1, "maximum": 500},
                "batiment": {"type": "string", "maxLength": 60},
                "equipements": {
                    "type": "array",
                    "maxItems": 8,
                    "items": {"type": "string", "enum": CODES_EQUIPEMENT},
                },
                "accessible_pmr": {"type": "boolean"},
                "limite": {"type": "integer", "minimum": 1, "maximum": 5, "default": 3},
            },
            "required": ["debut", "fin", "effectif"],
        },
    }

    async def execute(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        from app.ai.tools.temps import lire_instant

        params = self.valider(args)
        try:
            batiment_id = resoudre_batiment(ctx.session, params.batiment)
        except Ambiguite as souci:
            return ToolResult.vide(souci.message())

        criteres = SearchCriteria(
            slot=TimeSlot(start=lire_instant(params.debut), end=lire_instant(params.fin)),
            attendees=params.effectif,
            building_id=batiment_id,
            equipment_ids=resoudre_equipements(ctx.session, params.equipements),
            accessible_only=params.accessible_pmr,
            equipment_strict=False,
        )
        classement = recommendation_service.rank_rooms(
            ctx.session,
            criteres,
            user_id=ctx.utilisateur_id,
            limit=params.limite,
            now=ctx.maintenant,
        )
        if not classement:
            return ToolResult.vide("Aucune salle ne correspond à ce besoin sur ce créneau.")

        propositions = []
        for proposition in classement:
            salle = resoudre_salle(ctx.session, salle_id=proposition.room.id)
            portrait = resume_salle(ctx.session, salle)
            # Le score et sa justification sont repris tels quels : le prompt
            # système interdit au modèle de les recalculer.
            # `Score` est un agrégat de composantes ; son total est la valeur
            # que l'écran affiche. Le détail part aussi : c'est lui qui permet
            # à l'assistant de dire *pourquoi* une salle passe devant une autre.
            portrait["score"] = proposition.score.total
            portrait["score_detail"] = [
                {"critere": composante.label, "points": composante.points,
                 "sur": composante.max_points, "detail": composante.detail}
                for composante in proposition.score.components
            ]
            portrait["justification"] = proposition.justification
            portrait["eligible"] = proposition.eligible
            portrait["empechements"] = [item.message for item in proposition.blockers]
            propositions.append(portrait)

        return ToolResult.ok(data={"propositions": propositions}, carte=Carte.SALLES)


# --------------------------------------------------------------------------- #
# 4. localiser_salle
# --------------------------------------------------------------------------- #


class ArgsLocaliser(_Base):
    salle_id: uuid.UUID | None = None
    salle_nom: str | None = Field(default=None, max_length=60)

    @model_validator(mode="after")
    def _au_moins_un(self):
        # Le schéma JSON ne sait pas exprimer « l'un ou l'autre » simplement ;
        # la contrainte vit donc ici, où elle sera dite au modèle en clair.
        if self.salle_id is None and not self.salle_nom:
            raise ValueError("Fournir `salle_id` ou `salle_nom`.")
        return self


class LocaliserSalle(Outil):
    DOMAINE = Domaine.PARC
    ARGUMENTS = ArgsLocaliser
    SCHEMA = {
        "name": "localiser_salle",
        "description": (
            "Dit où se trouve une salle — bâtiment, étage, adresse — et rend le plan "
            "de l'étage avec la salle repérée quand un plan est déposé."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "salle_id": {"type": "string", "format": "uuid"},
                "salle_nom": {
                    "type": "string",
                    "maxLength": 60,
                    "description": (
                        "À utiliser si l'identifiant n'est pas connu : le serveur "
                        "résout le nom, et signale l'ambiguïté s'il y en a une."
                    ),
                },
            },
            "required": [],
        },
    }

    async def execute(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        params = self.valider(args)
        try:
            salle = resoudre_salle(ctx.session, salle_id=params.salle_id, nom=params.salle_nom)
        except Ambiguite as souci:
            return ToolResult.vide(souci.message())

        placement = ctx.session.get(RoomPlacement, salle.id)
        etage = salle.floor

        return ToolResult.ok(
            data={
                "salle": resume_salle(ctx.session, salle),
                "plan_localisation_url": salle.location_plan_url,
                "etage_id": str(etage.id) if etage else None,
                "position_sur_le_plan": (
                    None
                    if placement is None
                    else {
                        "x": float(placement.pos_x),
                        "y": float(placement.pos_y),
                        "entree_marquee": placement.is_entrance_marked,
                    }
                ),
            },
            carte=Carte.PLAN,
        )


# --------------------------------------------------------------------------- #
# 5. consulter_regles
# --------------------------------------------------------------------------- #


class ArgsRegles(_Base):
    salle_id: uuid.UUID | None = None
    batiment: str | None = Field(default=None, max_length=60)


class ConsulterRegles(Outil):
    DOMAINE = Domaine.RESERVATION
    ARGUMENTS = ArgsRegles
    SCHEMA = {
        "name": "consulter_regles",
        "description": (
            "Rend les règles de réservation applicables : durée minimale et maximale, "
            "délai de préavis, horizon, quota par utilisateur, jours et horaires "
            "d'ouverture, fermetures à venir. Pour une salle précise, ou les règles "
            "générales de l'établissement."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "salle_id": {"type": "string", "format": "uuid"},
                "batiment": {"type": "string", "maxLength": 60},
            },
            "required": [],
        },
    }

    #: Convention PostgreSQL : `EXTRACT(DOW)` compte le dimanche comme 0.
    JOURS = ("dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi")

    async def execute(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        params = self.valider(args)

        salle = None
        if params.salle_id is not None:
            try:
                salle = resoudre_salle(ctx.session, salle_id=params.salle_id)
            except Ambiguite:
                return ToolResult.vide("Cette salle est introuvable.")

        if salle is None:
            # Sans salle désignée, une salle du bâtiment sert de porteuse : la
            # résolution des règles est hiérarchique et n'a pas d'autre entrée.
            batiment_id = None
            try:
                batiment_id = resoudre_batiment(ctx.session, params.batiment)
            except Ambiguite:
                batiment_id = None

            requete = select(parc_service.Room).options(
                selectinload(parc_service.Room.floor).selectinload(Floor.building)
            ).where(parc_service.Room.deleted_at.is_(None))
            if batiment_id is not None:
                requete = requete.join(Floor).where(Floor.building_id == batiment_id)
            salle = ctx.session.scalars(requete.limit(1)).one_or_none()
            if salle is None:
                return ToolResult.vide("Aucune salle dans ce périmètre.")

        regle = rules_service.resolve_rule_for_room(ctx.session, salle.id)
        horaires = rules_service.resolve_openings_for_room(ctx.session, salle.id)
        fermetures, _ = rules_service.list_closures(
            ctx.session,
            PageParams(page=1, size=5),
            first_day=ctx.maintenant.date(),
            last_day=ctx.maintenant.date() + timedelta(days=90),
        )

        return ToolResult.ok(
            data={
                "perimetre": salle.name if params.salle_id else "établissement",
                "regles": (
                    None
                    if regle is None
                    else {
                        "duree_min_minutes": regle.min_duration_min,
                        "duree_max_minutes": regle.max_duration_min,
                        "battement_minutes": regle.buffer_min,
                        "preavis_min_minutes": regle.min_advance_min,
                        "horizon_jours": regle.max_advance_days,
                        "delai_annulation_minutes": regle.cancel_deadline_min,
                        "fenetre_validation_presence_minutes": regle.checkin_window_min,
                        "quota_hebdomadaire_heures": regle.weekly_quota_hours,
                        "reservations_actives_max": regle.max_active_bookings,
                    }
                ),
                "ouvertures": [
                    {
                        "jour": self.JOURS[item.weekday],
                        "ouvert": item.is_open,
                        "de": item.opens_at.isoformat() if item.opens_at else None,
                        "a": item.closes_at.isoformat() if item.closes_at else None,
                    }
                    for item in horaires
                ],
                "fermetures_a_venir": [
                    {
                        "libelle": item.label,
                        "du": _borne(item, "lower"),
                        "au": _borne(item, "upper"),
                        "nature": item.kind.value if hasattr(item.kind, "value") else str(item.kind),
                    }
                    for item in fermetures
                ],
            },
            carte=Carte.REGLES,
        )


def _borne(fermeture: ClosurePeriod, cote: str) -> str | None:
    plage = fermeture.date_span
    valeur: date | None = getattr(plage, cote, None)
    return valeur.isoformat() if valeur else None

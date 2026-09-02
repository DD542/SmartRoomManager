"""Outils de réservation : lire les siennes, créer, modifier, annuler.

Trois des quatre écritures de tout le catalogue sont ici. Aucune ne s'exécute
dans le tour qui la propose : chacune rend un brouillon validé et une demande
de confirmation. Le tour suivant, déclenché par l'utilisateur, exécute le
brouillon — jamais une relecture de la sortie du modèle.

Le cloisonnement est vérifié avant toute chose : une réservation qui
n'appartient pas au demandeur est déclarée **introuvable**, et non « interdite ».
Répondre « interdit » confirmerait qu'elle existe, ce qui est déjà une fuite.
"""

from __future__ import annotations

import uuid
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.ai.tools.base import Carte, Domaine, Outil, ToolContext, ToolResult
from app.ai.tools.resolution import Ambiguite, resoudre_salle, resume_salle
from app.ai.tools.temps import lire_instant
from app.core.errors import DomainError
from app.domain.types import TimeSlot
from app.db.enums import BookingStatus
from app.models import Booking, BookingAccessCode, Floor, Room
from app.schemas.common import Email
from app.services import booking_service


class _Base(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _resume_reservation(reservation: Booking) -> dict[str, Any]:
    salle = reservation.room
    return {
        "reservation_id": str(reservation.id),
        "objet": reservation.title,
        "salle": salle.name if salle else None,
        "salle_id": str(reservation.room_id),
        "debut": reservation.time_range.lower.isoformat(),
        "fin": reservation.time_range.upper.isoformat(),
        "effectif": reservation.attendee_count,
        "statut": reservation.status.value
        if hasattr(reservation.status, "value")
        else str(reservation.status),
        "presence_validee": reservation.checked_in_at is not None,
    }


def _mienne(ctx: ToolContext, reservation_id: uuid.UUID) -> Booking | None:
    """Charge une réservation **du demandeur**, ou rien.

    Le filtre sur `owner_id` est posé dans la requête et non vérifié après
    coup : une comparaison oubliée dans une branche suffirait à ouvrir l'accès
    aux réservations d'autrui.
    """
    return ctx.session.scalars(
        select(Booking)
        .options(
            selectinload(Booking.room)
            .selectinload(Room.floor)
            .selectinload(Floor.building)
        )
        .where(
            Booking.id == reservation_id,
            Booking.owner_id == ctx.utilisateur_id,
            Booking.deleted_at.is_(None),
        )
    ).one_or_none()


# --------------------------------------------------------------------------- #
# 6. lister_mes_reservations
# --------------------------------------------------------------------------- #


class ArgsListerMiennes(_Base):
    etat: Literal["a_venir", "passees", "annulees", "toutes"] = "a_venir"
    depuis: str | None = None
    jusqu_a: str | None = None
    limite: int = Field(default=5, ge=1, le=20)


class ListerMesReservations(Outil):
    DOMAINE = Domaine.RESERVATION
    ARGUMENTS = ArgsListerMiennes
    SCHEMA = {
        "name": "lister_mes_reservations",
        "description": (
            "Liste les réservations de l'utilisateur connecté. Cet outil ne peut "
            "rendre que les réservations de la personne qui parle : il n'existe "
            "aucun moyen d'accéder à celles d'un tiers."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "etat": {
                    "type": "string",
                    "enum": ["a_venir", "passees", "annulees", "toutes"],
                    "default": "a_venir",
                },
                "depuis": {"type": "string", "format": "date"},
                "jusqu_a": {"type": "string", "format": "date"},
                "limite": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 20,
                    "default": 5,
                },
            },
            "required": [],
        },
    }

    async def execute(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        params = self.valider(args)

        requete = (
            select(Booking)
            .options(
                selectinload(Booking.room)
                .selectinload(Room.floor)
                .selectinload(Floor.building)
            )
            .where(Booking.owner_id == ctx.utilisateur_id, Booking.deleted_at.is_(None))
        )

        if params.etat == "a_venir":
            requete = requete.where(
                Booking.status != BookingStatus.ANNULEE,
                Booking.time_range.op(">>")(_instant_range(ctx.maintenant))
                | Booking.time_range.op("@>")(ctx.maintenant),
            ).order_by(Booking.time_range)
        elif params.etat == "passees":
            requete = requete.where(
                Booking.status != BookingStatus.ANNULEE,
                Booking.time_range.op("<<")(_instant_range(ctx.maintenant)),
            ).order_by(Booking.time_range.desc())
        elif params.etat == "annulees":
            requete = requete.where(Booking.status == BookingStatus.ANNULEE).order_by(
                Booking.time_range.desc()
            )
        else:
            requete = requete.order_by(Booking.time_range.desc())

        reservations = ctx.session.scalars(requete.limit(params.limite)).all()
        if not reservations:
            libelle = {
                "a_venir": "Vous n'avez aucune réservation à venir.",
                "passees": "Aucune réservation passée.",
                "annulees": "Aucune réservation annulée.",
                "toutes": "Vous n'avez aucune réservation.",
            }[params.etat]
            return ToolResult.vide(libelle)

        return ToolResult.ok(
            data={"reservations": [_resume_reservation(item) for item in reservations]},
            carte=Carte.RESERVATIONS,
        )


def _instant_range(moment):
    """Intervalle ponctuel, pour comparer un TSTZRANGE à un instant."""
    from psycopg.types.range import Range

    return Range(moment, moment, bounds="[]")


# --------------------------------------------------------------------------- #
# 7. creer_reservation
# --------------------------------------------------------------------------- #


class BrouillonReservation(_Base):
    #: L'un ou l'autre. Le modèle ne porte pas les UUID du parc de tête : lui
    #: imposer l'identifiant l'obligeait à enchaîner une recherche, à en
    #: extraire la valeur, puis à la recopier — trois occasions de se tromper,
    #: et il s'y perdait. Le nom est résolu côté serveur, qui signale
    #: l'ambiguïté au lieu de choisir.
    salle_id: uuid.UUID | None = None
    salle_nom: str | None = Field(default=None, max_length=60)
    debut: str
    fin: str
    objet: str = Field(default="Réunion", max_length=200)
    effectif: int = Field(default=1, ge=1, le=500)
    # `Email` du projet, et non `EmailStr` : cette dernière exige
    # `email-validator`, hors de la liste de dépendances arrêtée. Le motif est
    # celui que les autres schémas de l'API appliquent déjà, donc un participant
    # accepté par le robot l'est aussi par le formulaire.
    participants: list[Email] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def _creneau_coherent(self):
        if self.salle_id is None and not self.salle_nom:
            raise ValueError("Fournir `salle_id` ou `salle_nom`.")
        if lire_instant(self.fin) <= lire_instant(self.debut):
            raise ValueError("`fin` doit être postérieur à `debut`.")
        return self


class CreerReservation(Outil):
    DOMAINE = Domaine.RESERVATION
    ARGUMENTS = BrouillonReservation
    ECRITURE = True
    SCHEMA = {
        "name": "creer_reservation",
        "description": (
            "Crée une réservation après confirmation explicite de l'utilisateur. Ne "
            "jamais appeler cet outil sans que l'utilisateur ait validé la salle et "
            "le créneau au tour précédent. En cas de doute sur un paramètre, poser "
            "la question plutôt que de supposer."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "salle_id": {"type": "string", "format": "uuid"},
                "salle_nom": {
                    "type": "string",
                    "maxLength": 60,
                    "description": (
                        "Nom de la salle, si son identifiant n'est pas connu — "
                        "« Salle Hopper », « Hopper ». Le serveur le résout et "
                        "signale l'ambiguïté. Fournir salle_id ou salle_nom."
                    ),
                },
                "debut": {"type": "string", "format": "date-time"},
                "fin": {"type": "string", "format": "date-time"},
                "objet": {
                    "type": "string",
                    "maxLength": 200,
                    "description": "Intitulé de la réunion. À défaut : « Réunion ».",
                },
                "effectif": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 500,
                    "default": 1,
                },
                "participants": {
                    "type": "array",
                    "maxItems": 20,
                    "items": {"type": "string", "format": "email"},
                    "description": (
                        "Adresses des personnes à inviter. Ne jamais inventer une "
                        "adresse : si l'utilisateur donne un prénom sans adresse, ne "
                        "pas remplir ce champ."
                    ),
                },
            },
            "required": ["debut", "fin"],
        },
    }

    async def execute(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        params: BrouillonReservation = self.valider(args)

        try:
            salle = resoudre_salle(
                ctx.session, salle_id=params.salle_id, nom=params.salle_nom
            )
        except Ambiguite as souci:
            return ToolResult.vide(souci.message())

        creneau = TimeSlot(
            start=lire_instant(params.debut), end=lire_instant(params.fin)
        )

        if not ctx.confirmed:
            # Le créneau est éprouvé **avant** de demander confirmation : faire
            # valider une réservation que les règles refuseront serait une
            # question posée pour rien.
            rapport = availability_apercu(ctx, salle.id, creneau, params.effectif)
            if rapport is not None:
                return ToolResult.refus(rapport)

            return ToolResult.needs_confirmation(
                message=(
                    f"Confirmez-vous la réservation de {salle.name} "
                    f"du {creneau.start.isoformat()} au {creneau.end.isoformat()} "
                    f"pour {params.effectif} personne(s) ?"
                ),
                preview=params,
                data={
                    "salle": resume_salle(ctx.session, salle),
                    "debut": creneau.start.isoformat(),
                    "fin": creneau.end.isoformat(),
                    "objet": params.objet,
                    "effectif": params.effectif,
                    "participants": [str(item) for item in params.participants],
                },
            )

        try:
            reservation, code = booking_service.create_booking(
                ctx.session,
                room_id=salle.id,
                owner_id=ctx.utilisateur_id,
                slot=creneau,
                title=params.objet,
                attendees=params.effectif,
                participants=[(str(item), "") for item in params.participants],
                now=ctx.maintenant,
            )
            ctx.session.commit()
        except DomainError as souci:
            ctx.session.rollback()
            return ToolResult.refus(souci.message)

        charge = _resume_reservation(reservation)
        if code is not None:
            # Seul instant où le code existe en clair. Il part à l'utilisateur
            # et n'est jamais journalisé.
            charge["code_acces"] = code.clear
            charge["code_valide_jusqu_a"] = code.expires_at.isoformat()

        return ToolResult.ok(
            data=charge, carte=Carte.RESERVATION, message="Réservation confirmée."
        )


def availability_apercu(
    ctx: ToolContext, salle_id, creneau: TimeSlot, effectif: int
) -> str | None:
    """Rend le motif de refus si le créneau ne passe pas, `None` s'il passe."""
    from app.services import availability_service

    rapport = availability_service.check_slot(
        ctx.session,
        room_id=salle_id,
        slot=creneau,
        attendees=effectif,
        requester_id=ctx.utilisateur_id,
        now=ctx.maintenant,
    )
    if rapport.available:
        return None
    if rapport.blocking:
        return "Ce créneau est déjà pris dans cette salle."
    return " ".join(violation.message for violation in rapport.violations)


# --------------------------------------------------------------------------- #
# 8. modifier_reservation
# --------------------------------------------------------------------------- #


class BrouillonModification(_Base):
    reservation_id: uuid.UUID
    debut: str | None = None
    fin: str | None = None
    objet: str | None = Field(default=None, max_length=200)
    effectif: int | None = Field(default=None, ge=1, le=500)

    @model_validator(mode="after")
    def _quelque_chose_a_changer(self):
        if (
            self.debut is None
            and self.fin is None
            and self.objet is None
            and self.effectif is None
        ):
            raise ValueError("Indiquer au moins un champ à modifier.")
        if (self.debut is None) != (self.fin is None):
            raise ValueError("`debut` et `fin` se donnent ensemble.")
        if (
            self.debut
            and self.fin
            and lire_instant(self.fin) <= lire_instant(self.debut)
        ):
            raise ValueError("`fin` doit être postérieur à `debut`.")
        return self


class ModifierReservation(Outil):
    DOMAINE = Domaine.RESERVATION
    ARGUMENTS = BrouillonModification
    ECRITURE = True
    SCHEMA = {
        "name": "modifier_reservation",
        "description": (
            "Déplace une réservation existante ou en change l'intitulé et l'effectif, "
            "après confirmation explicite. Changer de salle n'est pas possible : il "
            "faut annuler puis recréer, et le dire à l'utilisateur."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "reservation_id": {"type": "string", "format": "uuid"},
                "debut": {"type": "string", "format": "date-time"},
                "fin": {"type": "string", "format": "date-time"},
                "objet": {"type": "string", "maxLength": 200},
                "effectif": {"type": "integer", "minimum": 1, "maximum": 500},
            },
            "required": ["reservation_id"],
        },
    }

    async def execute(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        params: BrouillonModification = self.valider(args)

        reservation = _mienne(ctx, params.reservation_id)
        if reservation is None:
            return ToolResult.vide("Cette réservation est introuvable.")

        creneau = (
            TimeSlot(start=lire_instant(params.debut), end=lire_instant(params.fin))
            if params.debut and params.fin
            else None
        )

        if not ctx.confirmed:
            changements = []
            if creneau is not None:
                changements.append(
                    f"créneau : {creneau.start.isoformat()} → {creneau.end.isoformat()}"
                )
            if params.objet is not None:
                changements.append(f"objet : « {params.objet} »")
            if params.effectif is not None:
                changements.append(f"effectif : {params.effectif}")

            return ToolResult.needs_confirmation(
                message=(
                    f"Confirmez-vous la modification de « {reservation.title} » "
                    f"({', '.join(changements)}) ?"
                ),
                preview=params,
                data={
                    "avant": _resume_reservation(reservation),
                    "changements": changements,
                },
            )

        try:
            modifiee = booking_service.update_booking(
                ctx.session,
                reservation.id,
                slot=creneau,
                title=params.objet,
                attendees=params.effectif,
                actor_id=ctx.utilisateur_id,
                now=ctx.maintenant,
            )
            ctx.session.commit()
        except DomainError as souci:
            ctx.session.rollback()
            return ToolResult.refus(souci.message)

        return ToolResult.ok(
            data=_resume_reservation(modifiee),
            carte=Carte.RESERVATION,
            message="Réservation modifiée.",
        )


# --------------------------------------------------------------------------- #
# 9. annuler_reservation
# --------------------------------------------------------------------------- #


class BrouillonAnnulation(_Base):
    reservation_id: uuid.UUID
    motif: str = Field(min_length=3, max_length=200)


class AnnulerReservation(Outil):
    DOMAINE = Domaine.RESERVATION
    ARGUMENTS = BrouillonAnnulation
    ECRITURE = True
    SCHEMA = {
        "name": "annuler_reservation",
        "description": (
            "Annule une réservation après confirmation explicite. Le motif est "
            "obligatoire côté application : le demander à l'utilisateur s'il ne l'a "
            "pas donné, ne jamais en inventer un."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "reservation_id": {"type": "string", "format": "uuid"},
                "motif": {
                    "type": "string",
                    "minLength": 3,
                    "maxLength": 200,
                    "description": "Raison donnée par l'utilisateur, reprise telle quelle.",
                },
            },
            "required": ["reservation_id", "motif"],
        },
    }

    async def execute(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        params: BrouillonAnnulation = self.valider(args)

        reservation = _mienne(ctx, params.reservation_id)
        if reservation is None:
            return ToolResult.vide("Cette réservation est introuvable.")

        if not ctx.confirmed:
            return ToolResult.needs_confirmation(
                message=(
                    f"Confirmez-vous l'annulation de « {reservation.title} » "
                    f"le {reservation.time_range.lower.isoformat()} ? "
                    f"Motif retenu : {params.motif}."
                ),
                preview=params,
                data=_resume_reservation(reservation),
            )

        try:
            annulee = booking_service.cancel_booking(
                ctx.session,
                reservation.id,
                reason=params.motif,
                actor_id=ctx.utilisateur_id,
                now=ctx.maintenant,
            )
            ctx.session.commit()
        except DomainError as souci:
            ctx.session.rollback()
            return ToolResult.refus(souci.message)

        return ToolResult.ok(
            data=_resume_reservation(annulee),
            carte=Carte.RESERVATION,
            message="Réservation annulée.",
        )


# --------------------------------------------------------------------------- #
# 10. obtenir_code_acces
# --------------------------------------------------------------------------- #


class ArgsCodeAcces(_Base):
    reservation_id: uuid.UUID


class ObtenirCodeAcces(Outil):
    DOMAINE = Domaine.RESERVATION
    ARGUMENTS = ArgsCodeAcces
    SCHEMA = {
        "name": "obtenir_code_acces",
        "description": (
            "Rend l'indice du code d'accès d'une réservation et sa fenêtre de "
            "validité. Le code complet n'est affiché qu'une seule fois, à la création "
            "de la réservation : il n'est pas conservé en clair et ne peut pas être "
            "relu. Dire cela à l'utilisateur plutôt que de laisser croire qu'il est "
            "perdu par erreur."
        ),
        "parameters": {
            "type": "object",
            "properties": {"reservation_id": {"type": "string", "format": "uuid"}},
            "required": ["reservation_id"],
        },
    }

    async def execute(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        params = self.valider(args)

        reservation = _mienne(ctx, params.reservation_id)
        if reservation is None:
            return ToolResult.vide("Cette réservation est introuvable.")

        code = ctx.session.scalars(
            select(BookingAccessCode)
            .where(BookingAccessCode.booking_id == reservation.id)
            .order_by(BookingAccessCode.issued_at.desc())
            .limit(1)
        ).one_or_none()

        if code is None:
            return ToolResult.vide(
                f"La salle {reservation.room.name} ne demande pas de code d'accès."
            )

        # La base ne garde qu'une empreinte : le clair n'existe plus. L'outil
        # ne peut pas faire mieux, et prétendre le contraire serait un mensonge
        # de conception.
        expire = code.expires_at <= ctx.maintenant or code.revoked_at is not None
        return ToolResult.ok(
            data={
                "reservation_id": str(reservation.id),
                "salle": reservation.room.name,
                "indice": None if expire else code.code_hint,
                "valide_jusqu_a": code.expires_at.isoformat(),
                "expire": expire,
                "code_complet_recuperable": False,
            },
            carte=Carte.CODE_ACCES,
            message=(
                "Ce code a expiré."
                if expire
                else "Le code complet n'est affiché qu'à la création de la réservation ; "
                "seul son indice est conservé."
            ),
        )

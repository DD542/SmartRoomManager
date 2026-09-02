"""Outils d'assistance : base de connaissances, ticket, transfert humain.

`rechercher_faq` s'appuie sur la recherche hybride du lot 3 : proximité de
sens et termes exacts, fusionnés par rangs réciproques. Le schéma exposé au
modèle n'a pas bougé d'un caractère en changeant d'implémentation — c'est ce
que la façade était censée permettre, et elle l'a permis.

Les articles rendus portent toujours leur source. Un assistant qui affirme une
procédure sans dire d'où elle vient est invérifiable, et donc inutilisable dans
un établissement.
"""

from __future__ import annotations

import uuid
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.ai.rag.recherche import rechercher
from app.ai.tools.base import Carte, Domaine, Outil, ToolContext, ToolResult
from app.core.errors import DomainError
from app.db.enums import TicketStatus
from app.models import FaqCategory
from app.services import support_service

CATEGORIES_TICKET = ["acces", "materiel", "reservation", "compte", "autre"]


class _Base(BaseModel):
    model_config = ConfigDict(extra="forbid")


# --------------------------------------------------------------------------- #
# 11. rechercher_faq
# --------------------------------------------------------------------------- #


class ArgsFaq(_Base):
    question: str = Field(min_length=3, max_length=300)
    categorie: str | None = Field(default=None, max_length=40)
    limite: int = Field(default=4, ge=1, le=5)


class RechercherFaq(Outil):
    DOMAINE = Domaine.ASSISTANCE
    ARGUMENTS = ArgsFaq
    SCHEMA = {
        "name": "rechercher_faq",
        "description": (
            "Cherche dans la base de connaissances de l'établissement. À utiliser "
            "pour toute question de procédure ou de fonctionnement — annulation, "
            "code d'accès, présence, notifications. Les extraits rendus sont la "
            "seule source autorisée pour répondre à ce type de question, et "
            "l'article doit être cité."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "question": {
                    "type": "string",
                    "minLength": 3,
                    "maxLength": 300,
                    "description": (
                        "La question de l'utilisateur, reformulée si elle dépend du "
                        "contexte de la conversation."
                    ),
                },
                "categorie": {
                    "type": "string",
                    "description": "Restreint la recherche. À omettre en cas de doute.",
                },
                "limite": {"type": "integer", "minimum": 1, "maximum": 5, "default": 4},
            },
            "required": ["question"],
        },
    }

    async def execute(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        params = self.valider(args)

        categorie_id = None
        if params.categorie:
            categorie_id = ctx.session.scalar(
                select(FaqCategory.id).where(FaqCategory.slug == params.categorie)
            )

        extraits = await rechercher(
            ctx.session,
            params.question,
            limite=params.limite,
            categorie_id=categorie_id,
        )

        if not extraits:
            return ToolResult.vide(
                "Aucun article de la base de connaissances ne traite cette question. "
                "Proposer l'ouverture d'un ticket."
            )

        # Les titres sont dédoublonnés dans l'ordre : deux fragments du même
        # article ne doivent pas produire deux citations identiques.
        sources: list[str] = []
        for extrait in extraits:
            if extrait.article_titre not in sources:
                sources.append(extrait.article_titre)

        return ToolResult.ok(
            data={
                "extraits": [
                    {
                        "titre": extrait.article_titre,
                        "slug": extrait.article_slug,
                        "contenu": extrait.contenu,
                        "voie": extrait.voie,
                    }
                    for extrait in extraits
                ]
            },
            carte=Carte.ARTICLE,
            sources=tuple(sources),
        )


# --------------------------------------------------------------------------- #
# 12. creer_ticket
# --------------------------------------------------------------------------- #


class BrouillonTicket(_Base):
    sujet: str = Field(min_length=5, max_length=120)
    categorie: Literal[*CATEGORIES_TICKET]
    message: str = Field(min_length=10, max_length=2000)
    salle_id: uuid.UUID | None = None
    reservation_id: uuid.UUID | None = None


class CreerTicket(Outil):
    DOMAINE = Domaine.ASSISTANCE
    ARGUMENTS = BrouillonTicket
    ECRITURE = True
    SCHEMA = {
        "name": "creer_ticket",
        "description": (
            "Ouvre une demande d'aide auprès du support, après confirmation "
            "explicite. À proposer quand la base de connaissances ne répond pas, "
            "quand un équipement est en panne, ou quand l'utilisateur demande une "
            "intervention humaine."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "sujet": {"type": "string", "minLength": 5, "maxLength": 120},
                "categorie": {"type": "string", "enum": CATEGORIES_TICKET},
                "message": {
                    "type": "string",
                    "minLength": 10,
                    "maxLength": 2000,
                    "description": (
                        "Description du problème, rédigée à partir de ce que "
                        "l'utilisateur a dit. Ne rien ajouter qu'il n'ait pas dit."
                    ),
                },
                "salle_id": {"type": "string", "format": "uuid"},
                "reservation_id": {"type": "string", "format": "uuid"},
            },
            "required": ["sujet", "categorie", "message"],
        },
    }

    async def execute(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        params: BrouillonTicket = self.valider(args)

        if not ctx.confirmed:
            return ToolResult.needs_confirmation(
                message=f"Confirmez-vous l'ouverture d'un ticket « {params.sujet} » ?",
                preview=params,
                data={
                    "sujet": params.sujet,
                    "categorie": params.categorie,
                    "message": params.message,
                },
            )

        try:
            ticket = support_service.create_ticket(
                ctx.session,
                requester_id=ctx.utilisateur_id,
                subject=params.sujet,
                category=params.categorie,
                body=params.message,
                room_id=params.salle_id,
                booking_id=params.reservation_id,
            )
            ctx.session.commit()
        except DomainError as souci:
            ctx.session.rollback()
            return ToolResult.refus(souci.message)

        return ToolResult.ok(
            data={
                "ticket_id": str(ticket.id),
                "reference": ticket.reference,
                "sujet": ticket.subject,
                "statut": ticket.status.value
                if hasattr(ticket.status, "value")
                else str(ticket.status),
            },
            carte=Carte.TICKET,
            message=f"Ticket {ticket.reference} ouvert.",
        )


# --------------------------------------------------------------------------- #
# 13. transferer_humain
# --------------------------------------------------------------------------- #


class ArgsTransfert(_Base):
    resume: str = Field(min_length=10, max_length=500)
    urgence: Literal["normale", "haute"] = "normale"


class TransfererHumain(Outil):
    DOMAINE = Domaine.ASSISTANCE
    ARGUMENTS = ArgsTransfert
    #: Non marqué `ECRITURE` : demander « confirmez-vous vouloir un humain ? » à
    #: quelqu'un qui vient de le demander serait une friction absurde. L'effet
    #: reste maîtrisé — un ticket dont l'utilisateur est l'auteur, rien d'autre.
    ECRITURE = False
    SCHEMA = {
        "name": "transferer_humain",
        "description": (
            "Passe la main au support humain. À appeler quand l'utilisateur le "
            "demande, quand il exprime de l'agacement, ou après deux échecs "
            "consécutifs à répondre. Ne pas insister avec d'autres outils une fois "
            "cet outil appelé."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "resume": {
                    "type": "string",
                    "minLength": 10,
                    "maxLength": 500,
                    "description": (
                        "Résumé factuel de la conversation pour la personne qui "
                        "prendra la suite."
                    ),
                },
                "urgence": {
                    "type": "string",
                    "enum": ["normale", "haute"],
                    "default": "normale",
                },
            },
            "required": ["resume"],
        },
    }

    async def execute(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        params: ArgsTransfert = self.valider(args)

        try:
            ticket = support_service.create_ticket(
                ctx.session,
                requester_id=ctx.utilisateur_id,
                subject=f"[Assistant] Demande de reprise humaine ({params.urgence})",
                category="autre",
                body=params.resume,
            )
            ctx.session.commit()
        except DomainError as souci:
            ctx.session.rollback()
            return ToolResult.refus(souci.message)

        return ToolResult.ok(
            data={
                "ticket_id": str(ticket.id),
                "reference": ticket.reference,
                "urgence": params.urgence,
                "statut": TicketStatus.OUVERT.value,
            },
            carte=Carte.TRANSFERT,
            message=(
                f"Un membre du support prend la suite. Référence {ticket.reference}."
            ),
        )

"""Assistant conversationnel : flux d'événements, conversations, observabilité.

**Pourquoi POST et non `EventSource`.** `EventSource` ne sait émettre qu'un
GET : le message partirait alors en paramètre d'URL, où il finirait dans les
journaux d'accès du serveur et du proxy. Le contenu d'une conversation n'a
rien à y faire. Le flux est donc servi en réponse à un POST, et le front le lit
avec `fetch` et un `ReadableStream` — aucune dépendance de plus d'un côté comme
de l'autre.

Le format reste du SSE : une ligne `data:` par événement, ce qui donne le
découpage gratuitement et rend le flux lisible dans un terminal.
"""

from __future__ import annotations

import json
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Query, Request, status
from pydantic import BaseModel, ConfigDict, Field
from sse_starlette.sse import EventSourceResponse

from app.ai.agent import Agent
from app.ai.agent.evenements import TypeEvenement
from app.ai.providers.selection import SelecteurModeles
from app.ai.rag import etat_index
from app.ai.reglages import get_reglages_ia
from app.ai.tools import resume_catalogue
from app.api.deps import (
    SUPPORT_HANDLE,
    CurrentPrincipal,
    SessionDep,
    require_permission,
)
from app.core.limiter import limiter
from app.db.session import SessionLocal
from app.models import ChatRole
from app.services import chat_service as service

from collections.abc import Callable, Iterator
from contextlib import contextmanager

from fastapi import Depends

router = APIRouter(tags=["Assistant"])

Support = Depends(require_permission(SUPPORT_HANDLE))


@contextmanager
def _session_de_flux() -> Iterator[Any]:
    """Session propre au flux.

    Celle de la requête est refermée par sa dépendance quand la réponse
    commence ; or un tour dure plusieurs secondes après ce moment. Une session
    à part vit exactement le temps du flux.
    """
    with SessionLocal() as session:
        yield session


def fabrique_session() -> Callable[[], Any]:
    """Dépendance : rend la fabrique de session du flux.

    Passer par une dépendance plutôt que d'appeler `SessionLocal` en dur rend
    le flux éprouvable : les tests y branchent la session transactionnelle du
    cas, et ce qu'écrit l'assistant est annulé avec le reste.
    """
    return _session_de_flux


def obtenir_selecteur() -> SelecteurModeles:
    """Dépendance : le sélecteur de modèles. Remplacé par les tests."""
    return SelecteurModeles()


FabriqueSessionDep = Annotated[Callable[[], Any], Depends(fabrique_session)]
SelecteurDep = Annotated[SelecteurModeles, Depends(obtenir_selecteur)]


class MessageIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: str = Field(min_length=1, max_length=2000)
    conversation_id: uuid.UUID | None = None


class ConfirmationIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    jeton: str = Field(min_length=8, max_length=64)
    conversation_id: uuid.UUID | None = None


def _trame(evenement) -> dict[str, str]:
    return {"data": json.dumps(evenement.pour_flux(), ensure_ascii=False, default=str)}


# --------------------------------------------------------------------------- #
# Flux
# --------------------------------------------------------------------------- #


@router.post(
    "/chat/messages",
    summary="Poser une question à l'assistant",
    description=(
        "Rend un flux d'événements Server-Sent Events : `debut`, `texte`, "
        "`outil`, `carte`, `confirmation`, `sources`, `reserve`, `fin`. "
        "La conversation est persistée au fil du tour ; interrompre la requête "
        "interrompt la génération, et ce qui a été produit reste enregistré."
    ),
)
@limiter.limit(get_reglages_ia().debit_messages)
async def poser_question(
    request: Request,
    payload: MessageIn,
    principal: CurrentPrincipal,
    fabrique: FabriqueSessionDep,
    selecteur: SelecteurDep,
) -> EventSourceResponse:
    async def flux():
        with fabrique() as session:
            conversation = (
                service.obtenir_conversation(
                    session, payload.conversation_id, user_id=principal.user.id
                )
                if payload.conversation_id
                else service.creer_conversation(session, user_id=principal.user.id)
            )
            service.ajouter_message(
                session,
                conversation,
                role=ChatRole.UTILISATEUR,
                contenu=payload.message,
            )
            session.commit()

            yield {
                "data": json.dumps(
                    {
                        "type": "conversation",
                        "conversation_id": str(conversation.id),
                        "titre": conversation.titre,
                    },
                    ensure_ascii=False,
                )
            }

            agent = Agent(session, principal, selecteur=selecteur)
            texte: list[str] = []
            cartes: list[tuple[str, Any]] = []
            sources: list[str] = []
            journal: dict[str, Any] = {}

            async for evenement in agent.repondre(
                payload.message,
                historique=service.historique(conversation),
                resume=conversation.resume,
                conversation_id=conversation.id,
            ):
                if evenement.type is TypeEvenement.TEXTE:
                    texte.append(evenement.donnees["texte"])
                elif evenement.type is TypeEvenement.CARTE:
                    cartes.append(
                        (evenement.donnees["carte"], evenement.donnees["donnees"])
                    )
                elif evenement.type is TypeEvenement.SOURCES:
                    sources = evenement.donnees["sources"]
                elif evenement.type is TypeEvenement.CONFIRMATION:
                    # La demande de confirmation est rangée avec sa carte : au
                    # rechargement, l'utilisateur doit retrouver ce qu'on lui a
                    # proposé, même si le jeton, lui, a expiré.
                    cartes.append(("confirmation", evenement.donnees))
                elif evenement.type is TypeEvenement.FIN:
                    journal = evenement.donnees

                yield _trame(evenement)

            carte, donnees = cartes[-1] if cartes else (None, None)
            service.ajouter_message(
                session,
                conversation,
                role=ChatRole.ASSISTANT,
                contenu="".join(texte),
                carte=carte,
                donnees=donnees,
                sources=sources,
            )
            service.enregistrer_tour(
                session,
                journal,
                conversation_id=conversation.id,
                user_id=principal.user.id,
            )
            session.commit()

    return EventSourceResponse(flux())


@router.post(
    "/chat/confirmations",
    summary="Confirmer une action proposée par l'assistant",
    description=(
        "Exécute le brouillon conservé côté serveur sous ce jeton. La sortie du "
        "modèle n'est jamais relue : c'est le brouillon validé qui part au "
        "service métier. Un jeton ne sert qu'une fois."
    ),
)
@limiter.limit(get_reglages_ia().debit_messages)
async def confirmer(
    request: Request,
    payload: ConfirmationIn,
    principal: CurrentPrincipal,
    fabrique: FabriqueSessionDep,
    selecteur: SelecteurDep,
) -> EventSourceResponse:
    async def flux():
        with fabrique() as session:
            conversation = (
                service.obtenir_conversation(
                    session, payload.conversation_id, user_id=principal.user.id
                )
                if payload.conversation_id
                else None
            )

            agent = Agent(session, principal, selecteur=selecteur)
            texte: list[str] = []
            cartes: list[tuple[str, Any]] = []
            journal: dict[str, Any] = {}

            async for evenement in agent.confirmer(payload.jeton):
                if evenement.type is TypeEvenement.TEXTE:
                    texte.append(evenement.donnees["texte"])
                elif evenement.type is TypeEvenement.CARTE:
                    cartes.append(
                        (evenement.donnees["carte"], evenement.donnees["donnees"])
                    )
                elif evenement.type is TypeEvenement.ERREUR:
                    texte.append(evenement.donnees["message"])
                elif evenement.type is TypeEvenement.FIN:
                    journal = evenement.donnees
                yield _trame(evenement)

            if conversation is not None:
                carte, donnees = cartes[-1] if cartes else (None, None)
                service.ajouter_message(
                    session,
                    conversation,
                    role=ChatRole.ASSISTANT,
                    contenu="".join(texte),
                    carte=carte,
                    donnees=donnees,
                )
                service.enregistrer_tour(
                    session,
                    journal,
                    conversation_id=conversation.id,
                    user_id=principal.user.id,
                )
                session.commit()

    return EventSourceResponse(flux())


# --------------------------------------------------------------------------- #
# Conversations
# --------------------------------------------------------------------------- #


@router.get("/chat/conversations", summary="Mes conversations")
def lister_conversations(
    session: SessionDep, principal: CurrentPrincipal
) -> list[dict[str, Any]]:
    return [
        {
            "id": str(conversation.id),
            "titre": conversation.titre,
            "messages": nombre,
            "derniere_activite": conversation.derniere_activite.isoformat(),
        }
        for conversation, nombre in service.lister_conversations(
            session, user_id=principal.user.id
        )
    ]


@router.get(
    "/chat/conversations/{conversation_id}", summary="Reprendre une conversation"
)
def relire_conversation(
    conversation_id: uuid.UUID, session: SessionDep, principal: CurrentPrincipal
) -> dict[str, Any]:
    conversation = service.obtenir_conversation(
        session, conversation_id, user_id=principal.user.id
    )
    return {
        "id": str(conversation.id),
        "titre": conversation.titre,
        "messages": [
            {
                "id": str(message.id),
                "role": message.role.value,
                "contenu": message.contenu,
                "carte": message.carte,
                "donnees": message.donnees,
                "sources": list(message.sources or []),
                "quand": message.created_at.isoformat(),
            }
            for message in conversation.messages
        ],
    }


@router.delete(
    "/chat/conversations/{conversation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Supprimer une conversation",
)
def supprimer_conversation(
    conversation_id: uuid.UUID, session: SessionDep, principal: CurrentPrincipal
) -> None:
    service.supprimer_conversation(session, conversation_id, user_id=principal.user.id)
    session.commit()


# --------------------------------------------------------------------------- #
# Observabilité — A-13
# --------------------------------------------------------------------------- #


@router.get(
    "/admin/chat/statistiques",
    summary="Tableau de bord de l'assistant",
    description=(
        "Taux de résolution sans transfert humain, taux de repli, latence "
        "médiane, outils les plus appelés, causes de bascule, conversations à "
        "revoir."
    ),
)
def statistiques(
    session: SessionDep,
    _admin=Support,
    jours: Annotated[int, Query(ge=1, le=90)] = 7,
) -> dict[str, Any]:
    return {
        **service.statistiques(session, jours=jours).pour_api(),
        "a_revoir": service.conversations_en_echec(session, jours=jours),
        "fenetre_jours": jours,
    }


@router.get(
    "/admin/chat/etat",
    summary="État de la couche d'assistance",
    description=(
        "Fournisseurs joignables, modèles configurés et réellement installés, "
        "état de l'index documentaire, catalogue d'outils et seuils en vigueur."
    ),
)
async def etat(session: SessionDep, _admin=Support) -> dict[str, Any]:
    reglages = get_reglages_ia()
    selecteur = SelecteurModeles(reglages)
    diagnostic = await selecteur.diagnostic()
    await selecteur.fermer()

    return {
        "fournisseurs": diagnostic,
        "index_documentaire": etat_index(session),
        "outils": resume_catalogue(),
        "seuils": {
            "max_iterations": reglages.max_iterations,
            "budget_tour_ms": reglages.budget_tour_ms,
            "timeout_premier_jeton_ms": reglages.timeout_premier_jeton_ms,
            "timeout_total_ms": reglages.timeout_total_ms,
            "rag_top_k": reglages.rag_top_k,
            "rag_seuil_similarite": reglages.rag_seuil_similarite,
            "debit_messages": reglages.debit_messages,
            "taille_message": reglages.taille_message,
            "confirmation_ttl_s": reglages.confirmation_ttl_s,
            "prompt_systeme_version": reglages.prompt_systeme_version,
            "forcer_repli": reglages.forcer_repli,
        },
    }


@router.get(
    "/admin/chat/prompt",
    summary="Prompt système en vigueur",
    description="Versionné sur disque. La version servie est celle des réglages.",
)
def prompt(
    _admin=Support, version: Annotated[int | None, Query(ge=1)] = None
) -> dict[str, Any]:
    from app.ai.prompts.chargeur import charger, versions_disponibles

    reglages = get_reglages_ia()
    charge = charger(version or reglages.prompt_systeme_version)
    return {
        "version": charge.version,
        "role": charge.role,
        "modele_cible": charge.modele_cible,
        "budget_jetons": charge.budget_jetons,
        "corps": charge.corps,
        "versions_disponibles": versions_disponibles(),
        "version_active": reglages.prompt_systeme_version,
    }

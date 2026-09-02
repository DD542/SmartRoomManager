"""Tickets, base de connaissances et chatbot."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import (
    SUPPORT_HANDLE,
    CurrentPrincipal,
    PageDep,
    SessionDep,
    require_permission,
)
from app.api.v1.schemas.support import (
    ChatAnswerOut,
    ChatIntentOut,
    ChatMessageIn,
    FaqArticleIn,
    FaqArticleOut,
    FaqArticlePatchIn,
    FaqArticleStatusIn,
    FaqCategoryOut,
    ResponseTemplateOut,
    TicketAssigneeIn,
    TicketIn,
    TicketMessageIn,
    TicketMessageOut,
    TicketOut,
    TicketStatusIn,
)
from app.core.errors import NotFoundError
from app.core.pagination import Page
from app.db.enums import TicketStatus
from app.models import Ticket
from app.ai.rag import indexation
from app.services import support_service as service

router = APIRouter(tags=["support"])

Support = Depends(require_permission(SUPPORT_HANDLE))


def _ticket_sortie(ticket: Ticket, *, avec_internes: bool) -> TicketOut:
    """Assemble un ticket. Les notes internes ne sortent que vers le support."""
    messages = [
        item
        for item in sorted(ticket.messages, key=lambda item: item.sent_at)
        if avec_internes or not item.is_internal
    ]
    return TicketOut(
        id=ticket.id,
        reference=ticket.reference,
        requester_id=ticket.requester_id,
        requester_name=f"{ticket.requester.first_name} {ticket.requester.last_name}",
        subject=ticket.subject,
        category=ticket.category,
        status=ticket.status,
        room_id=ticket.room_id,
        booking_id=ticket.booking_id,
        assigned_admin_id=ticket.assigned_admin_id,
        first_response_at=ticket.first_response_at,
        resolved_at=ticket.resolved_at,
        message_count=len(messages),
        created_at=ticket.created_at,
        messages=[TicketMessageOut.model_validate(item) for item in messages],
    )


# --------------------------------------------------------------------------- #
# Tickets de l'utilisateur
# --------------------------------------------------------------------------- #


@router.get("/tickets", response_model=Page[TicketOut], summary="Mes tickets")
def list_mine(
    session: SessionDep,
    principal: CurrentPrincipal,
    params: PageDep,
    ticket_status: Annotated[TicketStatus | None, Query(alias="status")] = None,
) -> Page[TicketOut]:
    tickets, total = service.list_mine(
        session, params, user_id=principal.user.id, status=ticket_status
    )
    return Page.build(
        [_ticket_sortie(item, avec_internes=False) for item in tickets], total, params
    )


@router.post(
    "/tickets",
    response_model=TicketOut,
    status_code=status.HTTP_201_CREATED,
    summary="Ouvrir un ticket",
    description=(
        "Le message initial fait partie du ticket : un ticket sans description "
        "obligerait le support à réclamer avant de pouvoir aider."
    ),
)
def create_ticket(
    payload: TicketIn, session: SessionDep, principal: CurrentPrincipal
) -> TicketOut:
    ticket = service.create_ticket(
        session,
        requester_id=principal.user.id,
        subject=payload.subject,
        category=payload.category,
        body=payload.body,
        room_id=payload.room_id,
        booking_id=payload.booking_id,
    )
    session.commit()
    return _ticket_sortie(service.get_ticket(session, ticket.id), avec_internes=False)


@router.get(
    "/tickets/{ticket_id}", response_model=TicketOut, summary="Détail d'un ticket"
)
def get_ticket(
    ticket_id: uuid.UUID, session: SessionDep, principal: CurrentPrincipal
) -> TicketOut:
    ticket = service.get_ticket(session, ticket_id)
    est_support = principal.can(SUPPORT_HANDLE)
    if ticket.requester_id != principal.user.id and not est_support:
        raise NotFoundError("Ticket introuvable.")
    return _ticket_sortie(ticket, avec_internes=est_support)


@router.post(
    "/tickets/{ticket_id}/messages",
    response_model=TicketMessageOut,
    status_code=status.HTTP_201_CREATED,
    summary="Répondre sur un ticket",
)
def add_message(
    ticket_id: uuid.UUID,
    payload: TicketMessageIn,
    session: SessionDep,
    principal: CurrentPrincipal,
) -> TicketMessageOut:
    ticket = service.get_ticket(session, ticket_id)
    est_support = principal.can(SUPPORT_HANDLE)
    if ticket.requester_id != principal.user.id and not est_support:
        raise NotFoundError("Ticket introuvable.")

    message = service.add_message(
        session,
        ticket_id,
        body=payload.body,
        author_user_id=principal.user.id,
        from_support=est_support,
        # Une note interne écrite par le demandeur n'aurait aucun sens.
        internal=payload.is_internal and est_support,
    )
    session.commit()
    return TicketMessageOut.model_validate(message)


# --------------------------------------------------------------------------- #
# File du support
# --------------------------------------------------------------------------- #


@router.get(
    "/admin/tickets",
    response_model=Page[TicketOut],
    summary="File des tickets",
    description="Les plus anciens d'abord : c'est l'ordre de traitement.",
)
def list_all(
    session: SessionDep,
    params: PageDep,
    _admin=Support,
    ticket_status: Annotated[TicketStatus | None, Query(alias="status")] = None,
    assigned_to: uuid.UUID | None = None,
    q: Annotated[str | None, Query(max_length=120)] = None,
) -> Page[TicketOut]:
    tickets, total = service.list_all(
        session, params, status=ticket_status, assigned_to=assigned_to, query=q
    )
    return Page.build(
        [_ticket_sortie(item, avec_internes=True) for item in tickets], total, params
    )


@router.patch(
    "/admin/tickets/{ticket_id}/status",
    response_model=TicketOut,
    summary="Changer le statut d'un ticket",
    description="Passer à « résolu » horodate la résolution, une seule fois.",
)
def set_status(
    ticket_id: uuid.UUID, payload: TicketStatusIn, session: SessionDep, _admin=Support
) -> TicketOut:
    ticket = service.set_ticket_status(session, ticket_id, status=payload.status)
    session.commit()
    return _ticket_sortie(ticket, avec_internes=True)


@router.patch(
    "/admin/tickets/{ticket_id}/assignee",
    response_model=TicketOut,
    summary="Attribuer un ticket",
)
def set_assignee(
    ticket_id: uuid.UUID, payload: TicketAssigneeIn, session: SessionDep, _admin=Support
) -> TicketOut:
    ticket = service.assign_ticket(
        session, ticket_id, admin_user_id=payload.admin_user_id
    )
    session.commit()
    return _ticket_sortie(ticket, avec_internes=True)


@router.get(
    "/admin/response-templates",
    response_model=list[ResponseTemplateOut],
    summary="Réponses types",
)
def response_templates(
    session: SessionDep, _admin=Support
) -> list[ResponseTemplateOut]:
    return [
        ResponseTemplateOut.model_validate(item)
        for item in service.response_templates(session)
    ]


# --------------------------------------------------------------------------- #
# Base de connaissances
# --------------------------------------------------------------------------- #


@router.get(
    "/faq/categories",
    response_model=list[FaqCategoryOut],
    summary="Catégories d'aide",
    description="Chaque catégorie porte son nombre d'articles publiés.",
)
def faq_categories(session: SessionDep, _: CurrentPrincipal) -> list[FaqCategoryOut]:
    return [
        FaqCategoryOut(
            id=categorie.id,
            code=categorie.code,
            label=categorie.label,
            icon=categorie.icon,
            sort_order=categorie.sort_order,
            article_count=nombre,
        )
        for categorie, nombre in service.list_categories(session)
    ]


@router.get(
    "/faq/articles",
    response_model=Page[FaqArticleOut],
    summary="Articles d'aide",
    description=(
        "Seuls les articles publiés remontent. La recherche porte sur le titre "
        "et l'extrait : le corps n'est pas indexé, et le balayer coûterait cher "
        "pour un gain marginal."
    ),
)
def faq_articles(
    session: SessionDep,
    _: CurrentPrincipal,
    params: PageDep,
    category_id: uuid.UUID | None = None,
    q: Annotated[str | None, Query(max_length=120)] = None,
) -> Page[FaqArticleOut]:
    articles, total = service.list_articles(
        session, params, category_id=category_id, query=q
    )
    return Page.build(
        [FaqArticleOut.model_validate(item) for item in articles], total, params
    )


@router.get(
    "/faq/articles/{slug}",
    response_model=FaqArticleOut,
    summary="Lire un article",
    description="La consultation incrémente un compteur d'usage, non nominatif.",
)
def faq_article(slug: str, session: SessionDep, _: CurrentPrincipal) -> FaqArticleOut:
    article = service.get_article(session, slug)
    session.commit()
    return FaqArticleOut.model_validate(article)


@router.get(
    "/admin/faq/articles",
    response_model=Page[FaqArticleOut],
    summary="Articles, brouillons compris",
)
def admin_articles(
    session: SessionDep,
    params: PageDep,
    _admin=Support,
    category_id: uuid.UUID | None = None,
    q: Annotated[str | None, Query(max_length=120)] = None,
) -> Page[FaqArticleOut]:
    articles, total = service.list_articles(
        session, params, category_id=category_id, query=q, include_drafts=True
    )
    return Page.build(
        [FaqArticleOut.model_validate(item) for item in articles], total, params
    )


@router.post(
    "/admin/faq/articles",
    response_model=FaqArticleOut,
    status_code=status.HTTP_201_CREATED,
    summary="Créer un article",
)
async def create_article(
    payload: FaqArticleIn, session: SessionDep, _admin=Support
) -> FaqArticleOut:
    article = service.upsert_article(session, payload)
    await indexation.indexer_article(session, article)
    session.commit()
    return FaqArticleOut.model_validate(article)


@router.patch(
    "/admin/faq/articles/{article_id}",
    response_model=FaqArticleOut,
    summary="Modifier un article",
)
async def update_article(
    article_id: uuid.UUID,
    payload: FaqArticlePatchIn,
    session: SessionDep,
    _admin=Support,
) -> FaqArticleOut:
    article = service.upsert_article(session, payload, article_id=article_id)
    await indexation.indexer_article(session, article)
    session.commit()
    return FaqArticleOut.model_validate(article)


@router.patch(
    "/admin/faq/articles/{article_id}/status",
    response_model=FaqArticleOut,
    summary="Publier ou dépublier un article",
    description="La première publication horodate `published_at`, définitivement.",
)
async def set_article_status(
    article_id: uuid.UUID,
    payload: FaqArticleStatusIn,
    session: SessionDep,
    _admin=Support,
) -> FaqArticleOut:
    article = service.set_article_status(session, article_id, status=payload.status)
    # Dépublier retire les fragments : sans cela, l'assistant continuerait de
    # citer un article que le centre d'aide n'affiche plus.
    await indexation.indexer_article(session, article)
    session.commit()
    return FaqArticleOut.model_validate(article)


@router.delete(
    "/admin/faq/articles/{article_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Supprimer un article",
)
async def delete_article(
    article_id: uuid.UUID, session: SessionDep, _admin=Support
) -> None:
    # La contrainte `ON DELETE CASCADE` emporterait les fragments de toute
    # façon ; l'appel explicite garde la trace dans le rapport d'indexation et
    # ne dépend pas d'un détail de schéma.
    await indexation.desindexer_article(session, article_id)
    service.delete_article(session, article_id)
    session.commit()


@router.get(
    "/admin/faq/index",
    summary="État de l'index de la base de connaissances",
    description=(
        "Nombre de fragments, part vectorisée, modèle employé. Un écart entre "
        "`fragments` et `vectorises` signale des articles écrits pendant une "
        "absence du modèle : ils sont trouvables en recherche lexicale, et la "
        "réindexation les complètera."
    ),
)
def etat_index_faq(session: SessionDep, _admin=Support) -> dict:
    return indexation.etat_index(session)


@router.post(
    "/admin/faq/reindex",
    summary="Reconstruire l'index de la base de connaissances",
    description=(
        "Commande d'administration, pas de routine : chaque écriture d'article "
        "met déjà l'index à jour. Sert après un changement de modèle de "
        "vecteurs, ou pour rattraper des fragments écrits sans vecteur."
    ),
)
async def reindexer_faq(session: SessionDep, _admin=Support) -> dict:
    rapport = await indexation.reindexer_tout(session)
    session.commit()
    return {
        "articles": rapport.articles,
        "fragments_ecrits": rapport.fragments_ecrits,
        "fragments_retires": rapport.fragments_retires,
        "fragments_vectorises": rapport.fragments_vectorises,
        "fragments_inchanges": rapport.fragments_inchanges,
        "sans_vecteurs": rapport.sans_vecteurs,
    }


# --------------------------------------------------------------------------- #
# Chatbot
# --------------------------------------------------------------------------- #


@router.post(
    "/chatbot/messages",
    response_model=ChatAnswerOut,
    summary="Interroger l'assistant",
    description=(
        "Rapproche le message d'une intention déclarée en base. En deçà du "
        "seuil de confiance, l'assistant dit qu'il ne sait pas et propose "
        "d'ouvrir un ticket : sur un système de réservation, une réponse "
        "inventée ferait plus de dégâts qu'un renvoi vers le support."
    ),
)
def chat(
    payload: ChatMessageIn, session: SessionDep, _: CurrentPrincipal
) -> ChatAnswerOut:
    return ChatAnswerOut(**service.answer(session, payload.message))


@router.get(
    "/admin/chatbot/intents",
    response_model=list[ChatIntentOut],
    summary="Intentions déclarées",
)
def list_intents(session: SessionDep, _admin=Support) -> list[ChatIntentOut]:
    return [
        ChatIntentOut(
            id=intention.id,
            code=intention.code,
            label=intention.label,
            answer=intention.answer,
            quick_replies=list(intention.quick_replies or []),
            escalates_to_ticket=intention.escalates_to_ticket,
            faq_article_id=intention.faq_article_id,
            is_active=intention.is_active,
            keywords=[item.keyword for item in intention.keywords],
        )
        for intention in service.list_intents(session)
    ]

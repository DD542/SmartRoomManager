"""Tickets, base de connaissances et chatbot.

Le chatbot n'apprend rien : il rapproche des mots-clés d'intentions déclarées
en base, et sait dire qu'il ne sait pas. Une réponse inventée sur un système de
réservation serait pire qu'un « je transmets au support ».
"""

from __future__ import annotations

import unicodedata
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.errors import NotFoundError, RuleViolationError
from app.core.pagination import PageParams, paginate
from app.db.enums import ArticleStatus, AuditAction, TicketStatus
from app.models import (
    ChatbotIntent,
    ChatbotIntentKeyword,
    FaqArticle,
    FaqCategory,
    Ticket,
    TicketMessage,
    TicketResponseTemplate,
)
from app.services import audit_service

#: `ck_tickets_reference_format` impose `^#?[0-9]{1,10}$` : la référence est
#: numérique, précédée d'un croisillon. Elle se dicte au téléphone, ce qu'un
#: UUID ne permet pas.
PREFIXE = "#"

#: En deçà, l'intention n'est pas assez sûre : le chatbot préfère l'avouer.
SEUIL_CONFIANCE = 0.34


def _sans_accent(valeur: str) -> str:
    plat = unicodedata.normalize("NFD", valeur.lower())
    return "".join(lettre for lettre in plat if not unicodedata.combining(lettre))


def _reference(session: Session) -> str:
    suivant = session.scalar(select(func.count()).select_from(Ticket)) or 0
    return f"{PREFIXE}{1000 + suivant + 1}"


# --------------------------------------------------------------------------- #
# Tickets
# --------------------------------------------------------------------------- #


def _requete_ticket() -> Any:
    return select(Ticket).options(
        selectinload(Ticket.requester),
        selectinload(Ticket.messages),
        selectinload(Ticket.room),
    )


def list_mine(
    session: Session,
    params: PageParams,
    *,
    user_id: uuid.UUID,
    status: TicketStatus | None = None,
) -> tuple[list[Ticket], int]:
    """Tickets du compte connecté. Le filtre est dans la requête, pas après."""
    requete = (
        _requete_ticket()
        .where(Ticket.requester_id == user_id)
        .order_by(Ticket.created_at.desc())
    )
    if status is not None:
        requete = requete.where(Ticket.status == status)
    return paginate(session, requete, params)


def list_all(
    session: Session,
    params: PageParams,
    *,
    status: TicketStatus | None = None,
    assigned_to: uuid.UUID | None = None,
    query: str | None = None,
) -> tuple[list[Ticket], int]:
    requete = _requete_ticket().order_by(Ticket.created_at)
    if status is not None:
        requete = requete.where(Ticket.status == status)
    if assigned_to is not None:
        requete = requete.where(Ticket.assigned_admin_id == assigned_to)
    if query:
        requete = requete.where(
            or_(Ticket.subject.ilike(f"%{query}%"), Ticket.reference.ilike(f"%{query}%"))
        )
    return paginate(session, requete, params)


def get_ticket(session: Session, ticket_id: uuid.UUID) -> Ticket:
    ticket = session.scalars(_requete_ticket().where(Ticket.id == ticket_id)).one_or_none()
    if ticket is None:
        raise NotFoundError("Ticket introuvable.")
    return ticket


def create_ticket(
    session: Session,
    *,
    requester_id: uuid.UUID,
    subject: str,
    category: str,
    body: str,
    room_id: uuid.UUID | None = None,
    booking_id: uuid.UUID | None = None,
) -> Ticket:
    """Ouvre un ticket avec son premier message.

    Le message initial fait partie du ticket : un ticket sans description
    obligerait le support à réclamer avant de pouvoir aider.
    """
    ticket = Ticket(
        reference=_reference(session),
        requester_id=requester_id,
        subject=subject,
        category=category,
        room_id=room_id,
        booking_id=booking_id,
        status=TicketStatus.OUVERT,
    )
    session.add(ticket)
    session.flush()

    session.add(
        TicketMessage(
            ticket_id=ticket.id,
            body=body,
            author_user_id=requester_id,
            is_from_support=False,
            sent_at=datetime.now(UTC),
        )
    )
    session.flush()
    return ticket


def add_message(
    session: Session,
    ticket_id: uuid.UUID,
    *,
    body: str,
    author_user_id: uuid.UUID | None,
    from_support: bool = False,
    internal: bool = False,
) -> TicketMessage:
    """Ajoute un message et met à jour le ticket.

    La première réponse du support horodate `first_response_at` : c'est
    l'indicateur que l'écran A-14 affiche, et il ne se recalcule pas après coup.
    """
    ticket = get_ticket(session, ticket_id)
    if ticket.status is TicketStatus.FERME:
        raise RuleViolationError("Ce ticket est fermé.", code="deja_ferme")

    maintenant = datetime.now(UTC)
    message = TicketMessage(
        ticket_id=ticket_id,
        body=body,
        author_user_id=author_user_id,
        is_from_support=from_support,
        is_internal=internal,
        sent_at=maintenant,
    )
    session.add(message)

    if from_support:
        if ticket.first_response_at is None and not internal:
            ticket.first_response_at = maintenant
        if ticket.status is TicketStatus.OUVERT:
            ticket.status = TicketStatus.EN_COURS

    session.flush()
    return message


def set_ticket_status(
    session: Session, ticket_id: uuid.UUID, *, status: TicketStatus
) -> Ticket:
    ticket = get_ticket(session, ticket_id)
    avant = ticket.status

    ticket.status = status
    if status is TicketStatus.RESOLU and ticket.resolved_at is None:
        ticket.resolved_at = datetime.now(UTC)

    audit_service.record(
        session,
        action=AuditAction.MODIFICATION,
        target_type="ticket",
        target_label=ticket.reference,
        target_id=ticket.id,
        before={"status": avant.value},
        after={"status": status.value},
    )
    session.flush()
    return ticket


def assign_ticket(
    session: Session, ticket_id: uuid.UUID, *, admin_user_id: uuid.UUID | None
) -> Ticket:
    ticket = get_ticket(session, ticket_id)
    avant = ticket.assigned_admin_id

    ticket.assigned_admin_id = admin_user_id
    if admin_user_id is not None and ticket.status is TicketStatus.OUVERT:
        ticket.status = TicketStatus.EN_COURS

    audit_service.record(
        session,
        action=AuditAction.MODIFICATION,
        target_type="ticket",
        target_label=ticket.reference,
        target_id=ticket.id,
        before={"assigned_admin_id": str(avant) if avant else None},
        after={"assigned_admin_id": str(admin_user_id) if admin_user_id else None},
    )
    session.flush()
    return ticket


def response_templates(session: Session) -> list[TicketResponseTemplate]:
    return list(
        session.scalars(
            select(TicketResponseTemplate)
            .where(TicketResponseTemplate.is_active.is_(True))
            .order_by(TicketResponseTemplate.category, TicketResponseTemplate.label)
        )
    )


# --------------------------------------------------------------------------- #
# Base de connaissances
# --------------------------------------------------------------------------- #


def list_categories(session: Session) -> list[tuple[FaqCategory, int]]:
    """Catégories avec le nombre d'articles publiés, agrégé en SQL."""
    articles = (
        select(func.count())
        .select_from(FaqArticle)
        .where(
            FaqArticle.category_id == FaqCategory.id,
            FaqArticle.status == ArticleStatus.PUBLIE,
        )
        .scalar_subquery()
    )
    return list(
        session.execute(
            select(FaqCategory, articles).order_by(FaqCategory.sort_order, FaqCategory.label)
        ).all()
    )


def list_articles(
    session: Session,
    params: PageParams,
    *,
    category_id: uuid.UUID | None = None,
    query: str | None = None,
    include_drafts: bool = False,
) -> tuple[list[FaqArticle], int]:
    """Articles publiés, ou tous pour l'administration.

    La recherche porte sur le titre et l'extrait, pas sur le corps : `pg_trgm`
    n'indexe pas le corps, et un `ILIKE` dessus imposerait un balayage complet.
    """
    requete = select(FaqArticle).order_by(FaqArticle.title)
    if not include_drafts:
        requete = requete.where(FaqArticle.status == ArticleStatus.PUBLIE)
    if category_id is not None:
        requete = requete.where(FaqArticle.category_id == category_id)
    if query:
        motif = f"%{query}%"
        requete = requete.where(
            or_(FaqArticle.title.ilike(motif), FaqArticle.excerpt.ilike(motif))
        )
    return paginate(session, requete, params)


def get_article(session: Session, slug: str, *, count_view: bool = True) -> FaqArticle:
    article = session.scalars(
        select(FaqArticle).where(FaqArticle.slug == slug)
    ).one_or_none()
    if article is None:
        raise NotFoundError("Article introuvable.")

    if count_view:
        # Compteur d'usage : il alimente le classement de la base de
        # connaissances, pas une statistique nominative.
        article.view_count += 1
        session.flush()
    return article


def upsert_article(
    session: Session, payload: Any, *, article_id: uuid.UUID | None = None
) -> FaqArticle:
    creation = article_id is None
    if creation:
        article = FaqArticle(**payload.model_dump(exclude_unset=True))
        session.add(article)
    else:
        article = session.get(FaqArticle, article_id)
        if article is None:
            raise NotFoundError("Article introuvable.")
        for champ, valeur in payload.model_dump(exclude_unset=True).items():
            setattr(article, champ, valeur)

    session.flush()
    audit_service.record(
        session,
        action=AuditAction.CREATION if creation else AuditAction.MODIFICATION,
        target_type="faq_article",
        target_label=article.title,
        target_id=article.id,
        after={"status": article.status.value, "slug": article.slug},
    )
    session.flush()
    return article


def set_article_status(
    session: Session, article_id: uuid.UUID, *, status: ArticleStatus
) -> FaqArticle:
    article = session.get(FaqArticle, article_id)
    if article is None:
        raise NotFoundError("Article introuvable.")

    # `ck_faq_articles_publishable` exige un corps réel pour publier. Sans ce
    # contrôle, la contrainte le refuse quand même — mais en erreur d'intégrité,
    # donc en 500, là où l'auteur attend qu'on lui dise ce qui manque.
    if status is ArticleStatus.PUBLIE and len((article.body or "").strip()) < 40:
        raise RuleViolationError(
            "Article trop court pour être publié : quarante caractères au moins.",
            code="contenu_insuffisant",
        )

    avant = article.status
    article.status = status
    # `ck_faq_articles_published` impose l'équivalence stricte entre le statut
    # et la date : un article dépublié n'a pas de date de publication, et
    # republier le redate. C'est la lecture juste — la date affichée est celle
    # de la mise en ligne courante, pas d'une version retirée depuis.
    article.published_at = datetime.now(UTC) if status is ArticleStatus.PUBLIE else None

    audit_service.record(
        session,
        action=AuditAction.MODIFICATION,
        target_type="faq_article",
        target_label=article.title,
        target_id=article.id,
        before={"status": avant.value},
        after={"status": status.value},
    )
    session.flush()
    return article


def delete_article(session: Session, article_id: uuid.UUID) -> None:
    article = session.get(FaqArticle, article_id)
    if article is None:
        raise NotFoundError("Article introuvable.")

    audit_service.record(
        session,
        action=AuditAction.SUPPRESSION,
        target_type="faq_article",
        target_label=article.title,
        target_id=article.id,
        before={"slug": article.slug, "status": article.status.value},
    )
    session.delete(article)
    session.flush()


# --------------------------------------------------------------------------- #
# Chatbot
# --------------------------------------------------------------------------- #


def list_intents(session: Session, *, active_only: bool = False) -> list[ChatbotIntent]:
    requete = select(ChatbotIntent).options(
        selectinload(ChatbotIntent.keywords)
    ).order_by(ChatbotIntent.label)
    if active_only:
        requete = requete.where(ChatbotIntent.is_active.is_(True))
    return list(session.scalars(requete))


def answer(session: Session, message: str) -> dict[str, Any]:
    """Rapproche un message d'une intention déclarée, ou avoue ne pas savoir.

    Le score est la proportion des mots-clés de l'intention retrouvés dans le
    message. En deçà du seuil, aucune réponse n'est donnée : sur un système de
    réservation, une réponse inventée ferait plus de dégâts qu'un renvoi vers
    le support.
    """
    mots = set(_sans_accent(message).split())
    if not mots:
        return _je_ne_sais_pas()

    meilleure: ChatbotIntent | None = None
    meilleur_score = 0.0

    for intention in list_intents(session, active_only=True):
        cles = [_sans_accent(item.keyword) for item in intention.keywords]
        if not cles:
            continue
        trouves = sum(1 for cle in cles if any(cle in mot or mot in cle for mot in mots))
        score = trouves / len(cles)
        if score > meilleur_score:
            meilleure, meilleur_score = intention, score

    if meilleure is None or meilleur_score < SEUIL_CONFIANCE:
        return _je_ne_sais_pas()

    return {
        "intent_code": meilleure.code,
        "intent_label": meilleure.label,
        "answer": meilleure.answer,
        "quick_replies": list(meilleure.quick_replies or []),
        "escalates_to_ticket": meilleure.escalates_to_ticket,
        "faq_article_id": meilleure.faq_article_id,
        "confidence": round(meilleur_score, 2),
    }


def _je_ne_sais_pas() -> dict[str, Any]:
    return {
        "intent_code": None,
        "intent_label": None,
        "answer": (
            "Je ne suis pas sûr de comprendre. Reformulez, ou ouvrez un ticket : "
            "le support vous répondra."
        ),
        "quick_replies": ["Ouvrir un ticket", "Voir l'aide"],
        "escalates_to_ticket": True,
        "faq_article_id": None,
        "confidence": 0.0,
    }

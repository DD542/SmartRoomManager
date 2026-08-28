"""Conversations de l'assistant : persistance, historique, journal, statistiques.

Le service ne connaît ni le modèle ni les outils. Il range ce qui s'est dit,
rend l'historique dans la forme que le budget de contexte attend, et agrège le
journal pour A-13. La boucle d'agent, elle, ne touche pas à la base.

Cette séparation a une conséquence pratique : le mode dégradé — repli
déterministe — persiste exactement comme le mode normal. Une conversation
tenue sans modèle se relit comme les autres.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session, selectinload

from app.ai.agent.contexte import Tour
from app.ai.providers.base import Message, RoleMessage
from app.ai.reglages import get_reglages_ia
from app.core.errors import NotFoundError
from app.models import ChatConversation, ChatMessage, ChatRole, ChatTour

#: Longueur du titre dérivé du premier message.
TAILLE_TITRE = 60


def creer_conversation(session: Session, *, user_id: uuid.UUID, titre: str = "") -> ChatConversation:
    conversation = ChatConversation(
        user_id=user_id, titre=(titre or "Nouvelle conversation")[:120]
    )
    session.add(conversation)
    session.flush()
    return conversation


def obtenir_conversation(
    session: Session, conversation_id: uuid.UUID, *, user_id: uuid.UUID
) -> ChatConversation:
    """Charge une conversation **de cet utilisateur**.

    Le filtre est dans la requête : une conversation d'autrui est introuvable,
    pas interdite. Dire « interdit » confirmerait qu'elle existe.
    """
    conversation = session.scalars(
        select(ChatConversation)
        .options(selectinload(ChatConversation.messages))
        .where(ChatConversation.id == conversation_id, ChatConversation.user_id == user_id)
    ).one_or_none()
    if conversation is None:
        raise NotFoundError("Conversation introuvable.")
    return conversation


def lister_conversations(
    session: Session, *, user_id: uuid.UUID, limite: int = 20
) -> list[tuple[ChatConversation, int]]:
    """Fils de l'utilisateur, du plus récent au plus ancien, avec leur volume."""
    lignes = session.execute(
        select(ChatConversation, func.count(ChatMessage.id))
        .join(ChatMessage, ChatMessage.conversation_id == ChatConversation.id, isouter=True)
        .where(ChatConversation.user_id == user_id)
        .group_by(ChatConversation.id)
        .order_by(ChatConversation.derniere_activite.desc())
        .limit(limite)
    ).all()
    return [(ligne[0], ligne[1] or 0) for ligne in lignes]


def supprimer_conversation(
    session: Session, conversation_id: uuid.UUID, *, user_id: uuid.UUID
) -> None:
    conversation = obtenir_conversation(session, conversation_id, user_id=user_id)
    session.delete(conversation)
    session.flush()


def ajouter_message(
    session: Session,
    conversation: ChatConversation,
    *,
    role: ChatRole,
    contenu: str = "",
    carte: str | None = None,
    donnees: Any = None,
    sources: list[str] | None = None,
) -> ChatMessage | None:
    """Range un message. Rend `None` si rien n'était à ranger.

    Un message sans texte ni carte n'est pas une erreur — un tour peut se
    terminer sur un refus déjà porté par un événement — mais la contrainte de
    la table le refuserait, et l'insérer quand même ferait échouer tout le tour
    pour rien.
    """
    if not contenu.strip() and carte is None:
        return None

    message = ChatMessage(
        conversation_id=conversation.id,
        role=role,
        contenu=contenu.strip(),
        carte=carte,
        donnees=_json_sur(donnees),
        sources=sources or [],
    )
    session.add(message)

    conversation.derniere_activite = datetime.now(UTC)
    if conversation.titre == "Nouvelle conversation" and role is ChatRole.UTILISATEUR:
        # Le titre vient de la première question, tronquée au mot. Un titre
        # produit par le modèle coûterait un appel de plus pour un libellé que
        # personne ne relit.
        conversation.titre = _titrer(contenu)

    session.flush()
    return message


def _json_sur(valeur: Any) -> Any:
    """Rend une valeur sérialisable en JSONB, quoi qu'elle contienne.

    Constaté par un test : une carte de salle portait la surface en `Decimal`,
    ce que psycopg refuse d'écrire. L'échec survenait **après** la réponse,
    déjà diffusée : l'utilisateur avait sa réponse, la conversation ne la
    gardait pas, et la session restait à annuler. La cause a été corrigée à la
    source ; cette conversion reste, parce qu'un outil ajouté demain n'a pas à
    connaître les types que JSONB accepte.
    """
    from decimal import Decimal

    if isinstance(valeur, Decimal):
        return float(valeur)
    if isinstance(valeur, dict):
        return {cle: _json_sur(item) for cle, item in valeur.items()}
    if isinstance(valeur, (list, tuple)):
        return [_json_sur(item) for item in valeur]
    if isinstance(valeur, (datetime, uuid.UUID)):
        return str(valeur)
    return valeur


def _titrer(message: str) -> str:
    texte = " ".join(message.split())
    if len(texte) <= TAILLE_TITRE:
        return texte or "Nouvelle conversation"
    coupe = texte[:TAILLE_TITRE].rsplit(" ", 1)[0]
    return f"{coupe}…"


def historique(conversation: ChatConversation, *, tours_max: int = 8) -> list[Tour]:
    """Rend l'historique dans la forme attendue par le budget de contexte.

    Les cartes ne repartent pas au modèle : elles pèsent lourd, elles sont déjà
    résumées par le texte du message, et une donnée d'il y a trois tours n'est
    plus vraie. C'est le même principe que la neutralisation des résultats
    d'outils anciens.
    """
    tours: list[Tour] = []
    courant: list[Message] = []

    for message in conversation.messages:
        if message.role is ChatRole.UTILISATEUR:
            if courant:
                tours.append(Tour(messages=courant))
            courant = [Message(role=RoleMessage.UTILISATEUR, contenu=message.contenu)]
        elif message.role is ChatRole.ASSISTANT and courant:
            courant.append(Message(role=RoleMessage.ASSISTANT, contenu=message.contenu))

    if courant:
        tours.append(Tour(messages=courant))

    return tours[-tours_max:]


def enregistrer_tour(
    session: Session,
    journal: dict[str, Any],
    *,
    conversation_id: uuid.UUID | None,
    user_id: uuid.UUID,
) -> ChatTour:
    """Range le journal d'un tour. Aucun contenu de message n'y entre."""
    contexte = journal.get("contexte") or {}
    tour = ChatTour(
        conversation_id=conversation_id,
        user_id=user_id,
        mode=journal.get("mode", "modele")[:16],
        modele=journal.get("modele"),
        repli=bool(journal.get("repli")),
        declencheur_repli=(journal.get("declencheur_repli") or None),
        iterations=int(journal.get("iterations", 0)),
        outils=list(journal.get("outils", [])),
        duree_ms=int(journal.get("duree_ms", 0)),
        premier_jeton_ms=journal.get("premier_jeton_ms"),
        jetons_invite=int(journal.get("jetons_invite", 0)),
        jetons_reponse=int(journal.get("jetons_reponse", 0)),
        jetons_contexte=int(contexte.get("jetons", 0)) if isinstance(contexte, dict) else 0,
        injection_suspectee=bool(journal.get("injection_suspectee")),
        etaye=bool(journal.get("etaye", True)),
        transfert_humain="transferer_humain" in (journal.get("outils") or []),
    )
    session.add(tour)
    session.flush()
    return tour


def purger(session: Session, *, maintenant: datetime | None = None) -> int:
    """Supprime les conversations au-delà de la rétention. Rend le nombre retiré."""
    limite = (maintenant or datetime.now(UTC)) - timedelta(
        days=get_reglages_ia().retention_jours
    )
    resultat = session.execute(
        delete(ChatConversation).where(ChatConversation.derniere_activite < limite)
    )
    return resultat.rowcount or 0


# --------------------------------------------------------------------------- #
# Observabilité — A-13
# --------------------------------------------------------------------------- #


@dataclass(frozen=True, slots=True)
class Statistiques:
    tours: int
    taux_resolution: float
    taux_repli: float
    taux_etaye: float
    latence_mediane_ms: int | None
    premier_jeton_median_ms: int | None
    outils: list[dict[str, Any]]
    replis: list[dict[str, Any]]
    injections: int
    jetons: dict[str, int]

    def pour_api(self) -> dict[str, Any]:
        return {
            "tours": self.tours,
            "taux_resolution": self.taux_resolution,
            "taux_repli": self.taux_repli,
            "taux_etaye": self.taux_etaye,
            "latence_mediane_ms": self.latence_mediane_ms,
            "premier_jeton_median_ms": self.premier_jeton_median_ms,
            "outils": self.outils,
            "replis": self.replis,
            "injections": self.injections,
            "jetons": self.jetons,
        }


def statistiques(session: Session, *, jours: int = 7) -> Statistiques:
    """Chiffres du tableau de bord, sur une fenêtre glissante.

    Le taux de résolution est celui des tours **sans transfert humain** : c'est
    la question que pose l'énoncé, et la seule mesure honnête dont on dispose —
    on ne sait pas si l'utilisateur est reparti satisfait, on sait s'il a dû
    demander un humain.
    """
    depuis = datetime.now(UTC) - timedelta(days=jours)
    base = select(ChatTour).where(ChatTour.created_at >= depuis)

    total = session.scalar(
        select(func.count()).select_from(ChatTour).where(ChatTour.created_at >= depuis)
    ) or 0

    if total == 0:
        return Statistiques(
            tours=0,
            taux_resolution=0.0,
            taux_repli=0.0,
            taux_etaye=0.0,
            latence_mediane_ms=None,
            premier_jeton_median_ms=None,
            outils=[],
            replis=[],
            injections=0,
            jetons={"invite": 0, "reponse": 0, "contexte": 0},
        )

    transferts = session.scalar(
        select(func.count()).select_from(ChatTour)
        .where(ChatTour.created_at >= depuis, ChatTour.transfert_humain.is_(True))
    ) or 0
    replis = session.scalar(
        select(func.count()).select_from(ChatTour)
        .where(ChatTour.created_at >= depuis, ChatTour.repli.is_(True))
    ) or 0
    etayes = session.scalar(
        select(func.count()).select_from(ChatTour)
        .where(ChatTour.created_at >= depuis, ChatTour.etaye.is_(True))
    ) or 0
    injections = session.scalar(
        select(func.count()).select_from(ChatTour)
        .where(ChatTour.created_at >= depuis, ChatTour.injection_suspectee.is_(True))
    ) or 0

    # Médiane et non moyenne : un tour à trente secondes tirerait la moyenne
    # au point de la rendre inutile, alors que la médiane dit ce que vit la
    # plupart des utilisateurs.
    mediane = session.scalar(
        select(func.percentile_cont(0.5).within_group(ChatTour.duree_ms))
        .where(ChatTour.created_at >= depuis)
    )
    mediane_premier = session.scalar(
        select(func.percentile_cont(0.5).within_group(ChatTour.premier_jeton_ms))
        .where(ChatTour.created_at >= depuis, ChatTour.premier_jeton_ms.is_not(None))
    )

    outils = session.execute(
        select(func.unnest(ChatTour.outils).label("outil"), func.count())
        .where(ChatTour.created_at >= depuis)
        .group_by("outil")
        .order_by(func.count().desc())
        .limit(10)
    ).all()

    causes = session.execute(
        select(ChatTour.declencheur_repli, func.count())
        .where(ChatTour.created_at >= depuis, ChatTour.repli.is_(True))
        .group_by(ChatTour.declencheur_repli)
        .order_by(func.count().desc())
    ).all()

    jetons = session.execute(
        select(
            func.coalesce(func.sum(ChatTour.jetons_invite), 0),
            func.coalesce(func.sum(ChatTour.jetons_reponse), 0),
            func.coalesce(func.sum(ChatTour.jetons_contexte), 0),
        ).where(ChatTour.created_at >= depuis)
    ).one()

    return Statistiques(
        tours=total,
        taux_resolution=round(1 - transferts / total, 3),
        taux_repli=round(replis / total, 3),
        taux_etaye=round(etayes / total, 3),
        latence_mediane_ms=int(mediane) if mediane is not None else None,
        premier_jeton_median_ms=int(mediane_premier) if mediane_premier is not None else None,
        outils=[{"outil": ligne[0], "appels": ligne[1]} for ligne in outils],
        replis=[{"cause": ligne[0] or "inconnue", "tours": ligne[1]} for ligne in causes],
        injections=injections,
        jetons={"invite": int(jetons[0]), "reponse": int(jetons[1]), "contexte": int(jetons[2])},
    )


def conversations_en_echec(session: Session, *, jours: int = 7, limite: int = 10):
    """Tours transférés à un humain ou non étayés : ceux qui méritent un œil."""
    depuis = datetime.now(UTC) - timedelta(days=jours)
    lignes = session.execute(
        select(ChatTour, ChatConversation.titre)
        .join(ChatConversation, ChatConversation.id == ChatTour.conversation_id, isouter=True)
        .where(
            ChatTour.created_at >= depuis,
            (ChatTour.transfert_humain.is_(True)) | (ChatTour.etaye.is_(False)),
        )
        .order_by(ChatTour.created_at.desc())
        .limit(limite)
    ).all()

    return [
        {
            "tour_id": str(ligne[0].id),
            "conversation_id": str(ligne[0].conversation_id) if ligne[0].conversation_id else None,
            "titre": ligne[1] or "—",
            "quand": ligne[0].created_at.isoformat(),
            "mode": ligne[0].mode,
            "transfert": ligne[0].transfert_humain,
            "etaye": ligne[0].etaye,
            "outils": list(ligne[0].outils or []),
        }
        for ligne in lignes
    ]

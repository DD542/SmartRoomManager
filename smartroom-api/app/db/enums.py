"""Énumérations Python, images exactes des types ENUM PostgreSQL.

Les valeurs sont en français et en minuscules, identiques à celles déclarées
dans `sql/00_extensions_enums.sql` : toute divergence produirait une erreur
d'insertion, jamais une conversion silencieuse.
"""

from __future__ import annotations

import enum


class BookingStatus(str, enum.Enum):
    EN_ATTENTE = "en_attente"
    CONFIRMEE = "confirmee"
    TERMINEE = "terminee"
    ANNULEE = "annulee"


class RoomStatus(str, enum.Enum):
    DISPONIBLE = "disponible"
    MAINTENANCE = "maintenance"
    ARCHIVEE = "archivee"


class TicketStatus(str, enum.Enum):
    OUVERT = "ouvert"
    EN_COURS = "en_cours"
    RESOLU = "resolu"
    FERME = "ferme"


class AccessType(str, enum.Enum):
    HORS_JOUR_OUVERTURE = "hors_jour_ouverture"
    HORS_HORAIRE = "hors_horaire"
    DEPASSEMENT_CAPACITE = "depassement_capacite"
    EQUIPEMENT_INDISPONIBLE = "equipement_indisponible"
    CONFLIT_RESERVATION = "conflit_reservation"


class NotificationChannel(str, enum.Enum):
    EMAIL = "email"
    IN_APP = "in_app"


class BookingSource(str, enum.Enum):
    UTILISATEUR = "utilisateur"
    ADMIN = "admin"
    RECURRENTE = "recurrente"
    BLOCAGE = "blocage"


class BookingEventType(str, enum.Enum):
    CREATION = "creation"
    CONFIRMATION = "confirmation"
    MODIFICATION = "modification"
    RAPPEL = "rappel"
    CHECKIN = "checkin"
    ANNULATION = "annulation"
    LIBERATION_AUTO = "liberation_auto"


class ParticipantResponse(str, enum.Enum):
    EN_ATTENTE = "en_attente"
    ACCEPTE = "accepte"
    DECLINE = "decline"


class UserStatus(str, enum.Enum):
    ACTIF = "actif"
    SUSPENDU = "suspendu"


class RequestStatus(str, enum.Enum):
    OUVERT = "ouvert"
    ACCORDE = "accorde"
    REFUSE = "refuse"
    REORIENTE = "reoriente"


class RuleScope(str, enum.Enum):
    GLOBAL = "global"
    BATIMENT = "batiment"
    SALLE = "salle"


class ClosureKind(str, enum.Enum):
    FERMETURE = "fermeture"
    EXCEPTION = "exception"


class RecurrenceFreq(str, enum.Enum):
    HEBDOMADAIRE = "hebdomadaire"
    BIHEBDOMADAIRE = "bihebdomadaire"
    MENSUELLE = "mensuelle"


class EquipmentCategory(str, enum.Enum):
    AUDIOVISUEL = "audiovisuel"
    MOBILIER = "mobilier"
    AMENAGEMENT = "amenagement"


class ArticleStatus(str, enum.Enum):
    BROUILLON = "brouillon"
    PUBLIE = "publie"


class AuditAction(str, enum.Enum):
    CREATION = "creation"
    MODIFICATION = "modification"
    SUPPRESSION = "suppression"
    PERMISSION = "permission"
    MAINTENANCE = "maintenance"
    CONNEXION = "connexion"


class PlanDocumentKind(str, enum.Enum):
    IMAGE = "image"
    PDF = "pdf"


#: Correspondance nom du type PostgreSQL -> énumération Python, utilisée par la
#: migration initiale pour créer les dix-sept types en une passe.
PG_ENUMS: dict[str, type[enum.Enum]] = {
    "booking_status": BookingStatus,
    "room_status": RoomStatus,
    "ticket_status": TicketStatus,
    "access_type": AccessType,
    "notification_channel": NotificationChannel,
    "booking_source": BookingSource,
    "booking_event_type": BookingEventType,
    "participant_response": ParticipantResponse,
    "user_status": UserStatus,
    "request_status": RequestStatus,
    "rule_scope": RuleScope,
    "closure_kind": ClosureKind,
    "recurrence_freq": RecurrenceFreq,
    "equipment_category": EquipmentCategory,
    "article_status": ArticleStatus,
    "audit_action": AuditAction,
    "plan_document_kind": PlanDocumentKind,
}

"""Point d'entrée unique des modèles.

Alembic et `Base.metadata` ont besoin que **toutes** les classes soient importées
avant la lecture des métadonnées : un modèle non importé serait absent de la
migration autogénérée, sans le moindre avertissement.
"""

from app.db.base import Base
from app.models.auth import PasswordResetToken, RefreshToken
from app.models.comptes import (
    AdminAccount,
    AdminInvitation,
    AdminInvitationPermission,
    AdminPermission,
    Permission,
    PermissionGroup,
    User,
    UserPreference,
)
from app.models.parc import (
    Building,
    Equipment,
    Floor,
    FloorPlan,
    Room,
    RoomEquipment,
    RoomPhoto,
    RoomPlacement,
)
from app.models.reservations import (
    AccessRequest,
    Booking,
    BookingAccessCode,
    BookingEvent,
    BookingParticipant,
    BookingRule,
    ClosureBuilding,
    ClosurePeriod,
    ClosureRoom,
    OpeningHour,
    RecurrenceRule,
)
from app.models.support import (
    AuditLog,
    ChatbotIntent,
    ChatbotIntentKeyword,
    EmailTemplate,
    EmailTemplateVariable,
    FaqArticle,
    FaqArticleLink,
    FaqCategory,
    Notification,
    Ticket,
    TicketMessage,
    TicketResponseTemplate,
)

__all__ = [
    "PasswordResetToken",
    "RefreshToken",
    "Base",
    # Parc
    "Building",
    "Floor",
    "FloorPlan",
    "Room",
    "RoomPlacement",
    "Equipment",
    "RoomEquipment",
    "RoomPhoto",
    # Comptes
    "User",
    "UserPreference",
    "AdminAccount",
    "PermissionGroup",
    "Permission",
    "AdminPermission",
    "AdminInvitation",
    "AdminInvitationPermission",
    # Réservation
    "RecurrenceRule",
    "Booking",
    "BookingParticipant",
    "BookingEvent",
    "BookingAccessCode",
    "BookingRule",
    "OpeningHour",
    "ClosurePeriod",
    "ClosureBuilding",
    "ClosureRoom",
    "AccessRequest",
    # Support
    "Ticket",
    "TicketMessage",
    "TicketResponseTemplate",
    "FaqCategory",
    "FaqArticle",
    "FaqArticleLink",
    "ChatbotIntent",
    "ChatbotIntentKeyword",
    "Notification",
    "EmailTemplateVariable",
    "EmailTemplate",
    "AuditLog",
]

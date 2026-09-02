"""Schémas de réservation, de récurrence et d'administration."""

from __future__ import annotations

import uuid
from datetime import date, datetime, time
from typing import Annotated

from pydantic import Field, model_validator

from app.api.v1.schemas.common import ApiModel, ReadModel, SlotIn, SlotOut
from app.db.enums import RecurrenceFreq
from app.domain.types import TimeSlot


class SlotCheckIn(ApiModel):
    slot: SlotIn
    attendees: Annotated[int, Field(ge=1, le=500)] = 1
    #: Renseigné lors d'un déplacement : la réservation ne se conflictue pas
    #: avec sa propre position actuelle.
    ignore_booking_id: uuid.UUID | None = None


class BookingIn(ApiModel):
    room_id: uuid.UUID
    slot: SlotIn
    title: Annotated[str, Field(min_length=1, max_length=160)] = "Réunion"
    attendees: Annotated[int, Field(ge=1, le=500)] = 1
    participants: list[tuple[str, str]] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def _invites_distincts(self) -> BookingIn:
        """Deux fois la même adresse, c'est une invitation, pas deux.

        `uq_booking_participants_email` le refuse déjà, mais en fin de course :
        l'écran recevait alors « Cette valeur est déjà utilisée », qui ne dit ni
        quelle valeur ni où la corriger, sur un écran qui a mis quatre étapes à
        se remplir.
        """
        vues: set[str] = set()
        for adresse, _ in self.participants:
            normalisee = adresse.strip().lower()
            if normalisee in vues:
                raise ValueError(f"{adresse} est invité deux fois.")
            vues.add(normalisee)
        return self


class BookingPatchIn(ApiModel):
    slot: SlotIn | None = None
    title: Annotated[str | None, Field(min_length=1, max_length=160)] = None
    attendees: Annotated[int | None, Field(ge=1, le=500)] = None


class CancelIn(ApiModel):
    reason: Annotated[str, Field(min_length=3, max_length=255)]


class CheckInIn(ApiModel):
    code: Annotated[str, Field(min_length=1, max_length=20)] = ""


class LateIn(ApiModel):
    """Durée annoncée d'un retard. Facultative, et sans effet sur les règles.

    « Je suis en retard » doit rester le geste le plus court de l'écran : le
    corps entier est optionnel. La borne haute est le créneau lui-même, posée
    par le service qui le connaît ; celle d'ici n'écarte que l'absurde.
    """

    delay_min: Annotated[int, Field(ge=1, le=480)] | None = None


class AccessCodeOut(ReadModel):
    code: str
    hint: str
    expires_at: datetime


class BookingOut(ReadModel):
    id: uuid.UUID
    room_id: uuid.UUID
    owner_id: uuid.UUID | None
    title: str
    slot: SlotOut
    attendees: int
    status: str
    source: str
    is_forced: bool
    checked_in_at: datetime | None
    cancelled_at: datetime | None
    cancel_reason: str | None
    #: Date d'écriture, distincte du créneau : une réservation posée
    #: aujourd'hui pour dans trois mois est récente, et une réservation créée
    #: l'an dernier pour demain ne l'est pas. L'écran d'administration trie
    #: dessus par défaut — c'est ce qu'on vient de faire qu'on cherche en
    #: ouvrant la liste.
    created_at: datetime

    #: Dénormalisés parce que toute liste de réservations les affiche : sans
    #: eux, l'écran ferait une requête par ligne pour nommer la salle.
    room_name: str | None = None
    building_name: str | None = None
    floor_label: str | None = None
    #: Première photo de la salle. La liste des réservations en affiche une
    #: vignette ; sans elle, l'écran rendait une image sans adresse — un carré
    #: vide, que rien ne signalait.
    #:
    #: Gratuite : `Room.photos` est déjà chargée en `selectin` avec la salle.
    room_photo_url: str | None = None
    #: Plan de localisation de la salle, et étage qui la porte.
    #:
    #: Le détail d'une réservation affiche « où est-ce ». Il cherchait l'étage
    #: dans un cache de module alimenté par la fiche de salle : sur un accès
    #: direct — un lien, un rechargement — ce cache est vide, et l'écran
    #: annonçait « aucun plan déposé » quelle que soit la réalité.
    room_location_plan_url: str | None = None
    floor_id: uuid.UUID | None = None
    owner_name: str | None = None
    #: Forme masquée « A-**** ». Le code en clair ne quitte le serveur qu'une
    #: fois, à la création, et n'est stocké que haché.
    access_code_hint: str | None = None
    #: La salle demande-t-elle un code à sa porte ? L'écran ne peut pas le
    #: déduire de l'indice ci-dessus : une réservation dont le code a été
    #: révoqué en est dépourvue tout en restant en salle à badge, et c'est
    #: précisément le cas où il faut proposer d'en émettre un.
    room_badge_required: bool = False
    #: L'étage porte-t-il un plan déposé ? L'écran ne peut pas le deviner, et
    #: le demander pour rien lui vaut un 404 — réponse juste, mais que la
    #: console affiche en rouge et qu'on lit comme une panne.
    floor_has_plan: bool = False

    @classmethod
    def of(cls, reservation) -> BookingOut:
        salle = reservation.room
        proprietaire = reservation.owner
        actif = next(
            (item for item in reservation.access_codes if item.revoked_at is None), None
        )
        return cls(
            id=reservation.id,
            room_id=reservation.room_id,
            owner_id=reservation.owner_id,
            title=reservation.title,
            room_name=salle.name if salle is not None else None,
            building_name=(
                salle.floor.building.name
                if salle is not None and salle.floor is not None
                else None
            ),
            floor_label=(
                salle.floor.label
                if salle is not None and salle.floor is not None
                else None
            ),
            room_photo_url=(
                salle.photos[0].file_url if salle is not None and salle.photos else None
            ),
            room_location_plan_url=(
                salle.location_plan_url if salle is not None else None
            ),
            floor_id=(salle.floor_id if salle is not None else None),
            owner_name=(
                f"{proprietaire.first_name} {proprietaire.last_name}"
                if proprietaire is not None
                else None
            ),
            access_code_hint=actif.code_hint if actif is not None else None,
            room_badge_required=salle.badge_required,
            floor_has_plan=salle.floor.plan is not None,
            slot=SlotOut.of(
                TimeSlot(
                    start=reservation.time_range.lower, end=reservation.time_range.upper
                )
            ),
            attendees=reservation.attendee_count,
            status=reservation.status.value,
            source=reservation.source.value,
            is_forced=reservation.is_forced,
            checked_in_at=reservation.checked_in_at,
            cancelled_at=reservation.cancelled_at,
            cancel_reason=reservation.cancel_reason,
            created_at=reservation.created_at,
        )


class BookingEventOut(ReadModel):
    """Un fait de la frise. Le libellé est figé au moment du fait : il reste
    lisible même si la règle qui l'a produit a changé depuis."""

    id: uuid.UUID
    event_type: str
    label: str
    occurred_at: datetime
    actor_label: str | None = None


class BookingDetailOut(BookingOut):
    """Détail d'une réservation : frise et participants compris.

    Ni l'une ni les autres n'accompagnent les listes : cent réservations
    affichées en tireraient cent historiques et cent listes d'invités dont
    aucun n'est lu.

    Les participants y figurent parce que deux écrans les lisaient ici sans
    qu'ils y soient — la fiche affichait « Participants (0) » quel que soit le
    nombre réel, et l'écran de modification plantait sur un `.filter()`
    d'`undefined`. Une route dédiée existe, qu'aucun des deux n'appelait ; leur
    demander un second aller-retour pour une donnée aussi courte l'aurait
    laissée oubliable une fois de plus.
    """

    events: list[BookingEventOut] = Field(default_factory=list)
    participants: list[ParticipantOut] = Field(default_factory=list)

    @classmethod
    def of(cls, reservation) -> BookingDetailOut:
        base = BookingOut.of(reservation).model_dump()
        return cls(
            **base,
            participants=[
                ParticipantOut(
                    id=item.id,
                    booking_id=item.booking_id,
                    user_id=item.user_id,
                    email=item.email,
                    display_name=item.display_name,
                    response=item.response.value,
                    is_organizer=item.is_organizer,
                    responded_at=item.responded_at,
                )
                for item in reservation.participants
            ],
            events=[
                BookingEventOut(
                    id=item.id,
                    event_type=item.event_type.value,
                    label=item.label,
                    occurred_at=item.occurred_at,
                    actor_label=(
                        f"{item.actor.first_name} {item.actor.last_name}"
                        if getattr(item, "actor", None) is not None
                        else None
                    ),
                )
                for item in reservation.events
            ],
        )


class BookingCreatedOut(ReadModel):
    booking: BookingOut
    access_code: AccessCodeOut | None = None


class AdminBookingIn(BookingIn):
    """Création par l'administration, pour le compte d'un utilisateur."""

    owner_id: uuid.UUID
    #: Lève les règles de durée, d'ouverture, de capacité et de quota. Jamais un
    #: conflit, que la contrainte EXCLUDE rend impossible quoi qu'il arrive.
    ignore_rules: bool = False


class BlockingIn(ApiModel):
    room_id: uuid.UUID
    slot: SlotIn
    reason: Annotated[str, Field(min_length=3, max_length=160)]


class MaintenanceOut(ReadModel):
    """Bilan d'un passage de la tâche de maintenance."""

    released: int
    closed: int
    ran_at: datetime


class RecurrenceIn(ApiModel):
    """Série récurrente. Les heures sont locales : une série à 14:00 reste à
    14:00 des deux côtés du changement d'heure."""

    room_id: uuid.UUID
    freq: RecurrenceFreq
    interval_count: Annotated[int, Field(ge=1, le=12)] = 1
    byweekday: Annotated[list[int], Field(min_length=1, max_length=7)]
    start_date: date
    until_date: date
    start_time: time
    end_time: time
    title: Annotated[str, Field(min_length=1, max_length=160)] = "Réunion récurrente"
    attendees: Annotated[int, Field(ge=1, le=500)] = 1

    @model_validator(mode="after")
    def _serie_coherente(self) -> RecurrenceIn:
        if self.until_date < self.start_date:
            raise ValueError("La date de fin précède la date de début.")
        if (self.until_date - self.start_date).days > 366:
            raise ValueError("Une série ne peut pas dépasser un an.")
        if self.end_time <= self.start_time:
            raise ValueError("L'heure de fin doit suivre l'heure de début.")
        if any(not 0 <= jour <= 6 for jour in self.byweekday):
            raise ValueError("Le jour de semaine va de 0 (dimanche) à 6 (samedi).")
        if len(set(self.byweekday)) != len(self.byweekday):
            raise ValueError("Un jour de la semaine ne peut être listé qu'une fois.")
        return self


class OccurrenceOut(ReadModel):
    slot: SlotOut
    accepted: bool
    reason: str | None = None


class SeriesPreviewOut(ReadModel):
    occurrences: list[OccurrenceOut] = Field(default_factory=list)
    accepted_count: int
    rejected_count: int


class SeriesCreatedOut(ReadModel):
    rule_id: uuid.UUID
    bookings: list[BookingOut] = Field(default_factory=list)
    #: Dates écartées : la série passe quand même, l'utilisateur voit ce qui manque.
    skipped: list[OccurrenceOut] = Field(default_factory=list)


class ParticipantIn(ApiModel):
    email: Annotated[str, Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=255)]
    display_name: Annotated[str, Field(min_length=1, max_length=120)]


class ParticipantOut(ReadModel):
    id: uuid.UUID
    booking_id: uuid.UUID
    user_id: uuid.UUID | None
    email: str
    display_name: str
    response: str
    is_organizer: bool
    responded_at: datetime | None


class ParticipantInvitedOut(ReadModel):
    """Le jeton d'invitation ne sort qu'ici : il part dans le courriel."""

    participant: ParticipantOut
    invitation_token: str


class InvitationRespondIn(ApiModel):
    token: Annotated[str, Field(min_length=16, max_length=2048)]
    response: Annotated[str, Field(pattern=r"^(accepte|decline)$")]

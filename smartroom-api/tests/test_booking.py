"""Tests du service de réservation."""

from __future__ import annotations

from datetime import datetime, time, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.orm import Session

from app.core.errors import ClosureError, RuleViolationError, SlotConflictError
from app.db.enums import BookingEventType, BookingSource, BookingStatus, RuleScope
from app.models import Booking, BookingAccessCode, BookingEvent, BookingParticipant, BookingRule
from app.services.booking import (
    cancel_booking,
    check_in,
    close_finished_bookings,
    create_blocking,
    create_booking,
    release_no_shows,
    update_booking,
)
from tests.conftest import PARIS, creneau


# --------------------------------------------------------------------------- #
# Création
# --------------------------------------------------------------------------- #


def test_creation_nominale(session: Session, salle, utilisateur, jour_ouvre):
    reservation, code = create_booking(
        session,
        room_id=salle.id,
        owner_id=utilisateur.id,
        creneau=creneau(jour_ouvre, 14, 0, 90),
        title="Revue de sprint",
        attendee_count=6,
    )

    assert reservation.status is BookingStatus.CONFIRMEE
    assert reservation.source is BookingSource.UTILISATEUR
    assert reservation.is_forced is False

    # L'organisateur est inscrit et a implicitement accepté.
    participants = session.scalars(
        select(BookingParticipant).where(BookingParticipant.booking_id == reservation.id)
    ).all()
    assert len(participants) == 1 and participants[0].is_organizer

    # La frise porte la création et la confirmation.
    types = {
        evenement.event_type
        for evenement in session.scalars(
            select(BookingEvent).where(BookingEvent.booking_id == reservation.id)
        )
    }
    assert types == {BookingEventType.CREATION, BookingEventType.CONFIRMATION}

    # Le code est renvoyé en clair une fois, et seule l'empreinte est stockée.
    assert code is not None
    assert code.hint.endswith("-****")
    stocke = session.scalars(
        select(BookingAccessCode).where(BookingAccessCode.booking_id == reservation.id)
    ).one()
    assert code.clear not in stocke.code_hash


def test_creation_refusee_sur_chevauchement(session: Session, salle, utilisateur, jour_ouvre, poser):
    poser(creneau(jour_ouvre, 14, 0, 120), "Revue de sprint")

    with pytest.raises(SlotConflictError) as refus:
        create_booking(
            session,
            room_id=salle.id,
            owner_id=utilisateur.id,
            creneau=creneau(jour_ouvre, 14, 30, 60),
            attendee_count=4,
        )
    assert "entièrement pris" in refus.value.message


def test_chevauchement_reste_refuse_meme_en_forcant(
    session: Session, salle, utilisateur, jour_ouvre, poser
):
    """« Ignorer les règles » ne lève jamais un conflit."""
    poser(creneau(jour_ouvre, 14, 0, 120))

    with pytest.raises(SlotConflictError):
        create_booking(
            session,
            room_id=salle.id,
            owner_id=utilisateur.id,
            creneau=creneau(jour_ouvre, 14, 30, 60),
            attendee_count=4,
            ignore_rules=True,
        )


def test_capacite_depassee_refusee_puis_forcee(session: Session, salle, utilisateur, jour_ouvre):
    plage = creneau(jour_ouvre, 14, 0, 60)

    with pytest.raises(RuleViolationError) as refus:
        create_booking(
            session, room_id=salle.id, owner_id=utilisateur.id, creneau=plage, attendee_count=30
        )
    assert refus.value.code == "capacite"

    reservation, _ = create_booking(
        session,
        room_id=salle.id,
        owner_id=utilisateur.id,
        creneau=plage,
        attendee_count=30,
        ignore_rules=True,
    )
    assert reservation.is_forced is True


def test_battement_insuffisant_refuse_puis_force(session: Session, salle, utilisateur, jour_ouvre, poser):
    poser(
        Range(
            datetime.combine(jour_ouvre, time(12, 30), tzinfo=PARIS),
            datetime.combine(jour_ouvre, time(13, 55), tzinfo=PARIS),
            bounds="[)",
        ),
        "Entretien RH",
    )
    plage = creneau(jour_ouvre, 14, 0, 60)

    with pytest.raises(RuleViolationError) as refus:
        create_booking(
            session, room_id=salle.id, owner_id=utilisateur.id, creneau=plage, attendee_count=4
        )
    assert refus.value.code == "battement"

    # Contrairement au chevauchement, le battement se force.
    reservation, _ = create_booking(
        session,
        room_id=salle.id,
        owner_id=utilisateur.id,
        creneau=plage,
        attendee_count=4,
        ignore_rules=True,
    )
    assert reservation.id is not None


def test_fermeture_exceptionnelle_refusee(session: Session, salle, utilisateur, jour_ouvre):
    from app.db.enums import ClosureKind
    from app.models import ClosurePeriod

    session.add(
        ClosurePeriod(
            label="Jour férié de test",
            date_span=Range(jour_ouvre, jour_ouvre + timedelta(days=1), bounds="[)"),
            kind=ClosureKind.FERMETURE,
            is_global=True,
        )
    )
    session.flush()

    with pytest.raises(ClosureError):
        create_booking(
            session,
            room_id=salle.id,
            owner_id=utilisateur.id,
            creneau=creneau(jour_ouvre, 14, 0, 60),
            attendee_count=4,
        )


# --------------------------------------------------------------------------- #
# Blocage administratif
# --------------------------------------------------------------------------- #


def test_blocage_echappe_aux_bornes_de_duree(session: Session, salle, jour_ouvre):
    """Dix heures : impossible pour une réunion, normal pour des travaux."""
    depart = datetime.combine(jour_ouvre, time(8, 0), tzinfo=PARIS)
    blocage = create_blocking(
        session,
        room_id=salle.id,
        creneau=Range(depart, depart + timedelta(hours=10), bounds="[)"),
        reason="Travaux électriques",
        created_by_admin_id=None,
    )

    assert blocage.source is BookingSource.BLOCAGE
    assert blocage.owner_id is None
    assert blocage.attendee_count == 0


def test_blocage_sans_motif_refuse(session: Session, salle, jour_ouvre):
    with pytest.raises(RuleViolationError) as refus:
        create_blocking(
            session,
            room_id=salle.id,
            creneau=creneau(jour_ouvre, 8, 0, 120),
            reason="   ",
            created_by_admin_id=None,
        )
    assert refus.value.code == "motif_requis"


def test_blocage_reste_soumis_au_chevauchement(session: Session, salle, jour_ouvre, poser):
    poser(creneau(jour_ouvre, 14, 0, 60))

    with pytest.raises(SlotConflictError):
        create_blocking(
            session,
            room_id=salle.id,
            creneau=creneau(jour_ouvre, 13, 0, 180),
            reason="Travaux",
            created_by_admin_id=None,
        )


# --------------------------------------------------------------------------- #
# Modification et annulation
# --------------------------------------------------------------------------- #


def test_deplacement_ne_se_heurte_pas_a_lui_meme(session: Session, salle, utilisateur, jour_ouvre):
    reservation, _ = create_booking(
        session,
        room_id=salle.id,
        owner_id=utilisateur.id,
        creneau=creneau(jour_ouvre, 14, 0, 90),
        attendee_count=4,
    )

    deplacee = update_booking(
        session, reservation.id, creneau=creneau(jour_ouvre, 14, 30, 90), actor_id=utilisateur.id
    )
    assert deplacee.time_range.lower.astimezone(PARIS).hour == 14
    assert deplacee.time_range.lower.astimezone(PARIS).minute == 30


def test_annulation_exige_un_motif(session: Session, salle, utilisateur, jour_ouvre):
    reservation, _ = create_booking(
        session,
        room_id=salle.id,
        owner_id=utilisateur.id,
        creneau=creneau(jour_ouvre, 14, 0, 60),
        attendee_count=4,
    )

    with pytest.raises(RuleViolationError) as refus:
        cancel_booking(session, reservation.id, reason="  ")
    assert refus.value.code == "motif_requis"


def test_annulation_revoque_le_code_et_libere_le_creneau(
    session: Session, salle, utilisateur, jour_ouvre
):
    plage = creneau(jour_ouvre, 14, 0, 60)
    reservation, _ = create_booking(
        session, room_id=salle.id, owner_id=utilisateur.id, creneau=plage, attendee_count=4
    )

    cancel_booking(session, reservation.id, reason="Réunion reportée", actor_id=utilisateur.id)

    assert reservation.status is BookingStatus.ANNULEE
    assert reservation.cancel_reason == "Réunion reportée"

    code = session.scalars(
        select(BookingAccessCode).where(BookingAccessCode.booking_id == reservation.id)
    ).one()
    assert code.revoked_at is not None

    # Le créneau est de nouveau réservable.
    suivante, _ = create_booking(
        session, room_id=salle.id, owner_id=utilisateur.id, creneau=plage, attendee_count=4
    )
    assert suivante.id != reservation.id


def test_annulation_tardive_est_signalee_dans_la_frise(
    session: Session, salle, utilisateur, jour_ouvre
):
    """Le créneau doit être libérable au dernier moment, mais la trace subsiste."""
    plage = creneau(jour_ouvre, 14, 0, 60)
    reservation, _ = create_booking(
        session, room_id=salle.id, owner_id=utilisateur.id, creneau=plage, attendee_count=4
    )

    # Dix minutes avant le début : bien après le délai d'annulation d'une heure.
    juste_avant = plage.lower - timedelta(minutes=10)
    cancel_booking(
        session, reservation.id, reason="Empêchement", maintenant=juste_avant
    )

    libelles = [
        evenement.label
        for evenement in session.scalars(
            select(BookingEvent).where(
                BookingEvent.booking_id == reservation.id,
                BookingEvent.event_type == BookingEventType.ANNULATION,
            )
        )
    ]
    assert any("hors délai" in libelle for libelle in libelles)


# --------------------------------------------------------------------------- #
# Présence et libération automatique
# --------------------------------------------------------------------------- #


def test_check_in_valide_la_presence(session: Session, salle, utilisateur, jour_ouvre):
    plage = creneau(jour_ouvre, 14, 0, 60)
    reservation, code = create_booking(
        session, room_id=salle.id, owner_id=utilisateur.id, creneau=plage, attendee_count=4
    )

    valide = check_in(
        session, reservation.id, code=code.clear, maintenant=plage.lower + timedelta(minutes=3)
    )
    assert valide.checked_in_at is not None


def test_check_in_refuse_un_code_errone(session: Session, salle, utilisateur, jour_ouvre):
    plage = creneau(jour_ouvre, 14, 0, 60)
    reservation, _ = create_booking(
        session, room_id=salle.id, owner_id=utilisateur.id, creneau=plage, attendee_count=4
    )

    with pytest.raises(RuleViolationError) as refus:
        check_in(
            session, reservation.id, code="A-0000", maintenant=plage.lower + timedelta(minutes=2)
        )
    assert refus.value.code == "code_invalide"


@pytest.mark.parametrize(
    ("decalage", "code_attendu"),
    [(timedelta(minutes=-5), "trop_tot"), (timedelta(minutes=30), "fenetre_fermee")],
)
def test_fenetre_de_validation_bornee(
    session: Session, salle, utilisateur, jour_ouvre, decalage, code_attendu
):
    plage = creneau(jour_ouvre, 14, 0, 60)
    reservation, code = create_booking(
        session, room_id=salle.id, owner_id=utilisateur.id, creneau=plage, attendee_count=4
    )

    with pytest.raises(RuleViolationError) as refus:
        check_in(session, reservation.id, code=code.clear, maintenant=plage.lower + decalage)
    assert refus.value.code == code_attendu


def test_liberation_automatique_apres_absence(session: Session, salle, utilisateur, jour_ouvre):
    plage = creneau(jour_ouvre, 14, 0, 120)
    reservation, _ = create_booking(
        session, room_id=salle.id, owner_id=utilisateur.id, creneau=plage, attendee_count=4
    )

    # Vingt minutes après le début : la fenêtre de dix minutes est dépassée,
    # mais la réunion n'est pas terminée.
    liberees = release_no_shows(session, maintenant=plage.lower + timedelta(minutes=20))

    assert reservation.id in {r.id for r in liberees}
    assert reservation.status is BookingStatus.ANNULEE
    assert "présence non validée" in reservation.cancel_reason


def test_liberation_epargne_les_reservations_validees(
    session: Session, salle, utilisateur, jour_ouvre
):
    plage = creneau(jour_ouvre, 14, 0, 120)
    reservation, code = create_booking(
        session, room_id=salle.id, owner_id=utilisateur.id, creneau=plage, attendee_count=4
    )
    check_in(session, reservation.id, code=code.clear, maintenant=plage.lower + timedelta(minutes=2))

    liberees = release_no_shows(session, maintenant=plage.lower + timedelta(minutes=20))
    assert reservation.id not in {r.id for r in liberees}
    assert reservation.status is BookingStatus.CONFIRMEE


def test_liberation_epargne_les_blocages(session: Session, salle, jour_ouvre):
    depart = datetime.combine(jour_ouvre, time(8, 0), tzinfo=PARIS)
    blocage = create_blocking(
        session,
        room_id=salle.id,
        creneau=Range(depart, depart + timedelta(hours=8), bounds="[)"),
        reason="Travaux",
        created_by_admin_id=None,
    )

    liberees = release_no_shows(session, maintenant=depart + timedelta(hours=2))
    assert blocage.id not in {r.id for r in liberees}


def test_cloture_des_reservations_ecoulees(session: Session, salle, utilisateur, jour_ouvre):
    plage = creneau(jour_ouvre, 14, 0, 60)
    reservation, _ = create_booking(
        session, room_id=salle.id, owner_id=utilisateur.id, creneau=plage, attendee_count=4
    )

    closes = close_finished_bookings(session, maintenant=plage.upper + timedelta(minutes=1))
    assert closes >= 1
    assert reservation.status is BookingStatus.TERMINEE


def test_course_perdue_est_traduite_en_conflit(
    session: Session, salle, utilisateur, jour_ouvre, poser, monkeypatch
):
    """Le verdict était propre, la base refuse : c'est la fenêtre de course.

    Une transaction concurrente peut prendre le créneau entre la vérification et
    l'insertion. Le verdict est ici neutralisé pour reproduire ce cas : seule la
    contrainte `ex_bookings_no_overlap` arrête l'écriture, et son refus doit
    ressortir en message métier, pas en trace SQL.
    """
    from app.services import booking as service
    from app.services.availability import SlotVerdict

    poser(creneau(jour_ouvre, 14, 0, 90), "Prise entre-temps")

    monkeypatch.setattr(service, "check_slot", lambda *args, **kwargs: SlotVerdict())

    with pytest.raises(SlotConflictError) as refus:
        create_booking(
            session,
            room_id=salle.id,
            owner_id=utilisateur.id,
            creneau=creneau(jour_ouvre, 14, 0, 90),
            attendee_count=4,
        )
    assert "vient d'être réservé" in refus.value.message

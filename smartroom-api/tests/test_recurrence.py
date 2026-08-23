"""Tests des séries récurrentes."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.orm import Session

from app.core.errors import RuleViolationError
from app.db.enums import BookingSource, RecurrenceFreq
from app.models import Booking
from app.services.recurrence import create_series, generate_dates, preview_series
from tests.conftest import PARIS


@pytest.fixture
def lundi_prochain() -> date:
    jour = date.today() + timedelta(days=1)
    while jour.weekday() != 0:
        jour += timedelta(days=1)
    return jour


# --------------------------------------------------------------------------- #
# Génération des dates
# --------------------------------------------------------------------------- #


def test_hebdomadaire_un_jour(lundi_prochain):
    # 4 = jeudi dans la numérotation EXTRACT(DOW).
    dates = generate_dates(
        freq=RecurrenceFreq.HEBDOMADAIRE,
        interval_count=1,
        byweekday=[4],
        start_date=lundi_prochain,
        until_date=lundi_prochain + timedelta(weeks=5),
    )
    # Cinq jeudis : celui de la sixième semaine tombe après la date de fin.
    assert len(dates) == 5
    assert all(jour.weekday() == 3 for jour in dates)  # jeudi, lundi = 0
    assert all((b - a).days == 7 for a, b in zip(dates, dates[1:]))


def test_hebdomadaire_plusieurs_jours(lundi_prochain):
    dates = generate_dates(
        freq=RecurrenceFreq.HEBDOMADAIRE,
        interval_count=1,
        byweekday=[2, 4],  # mardi et jeudi
        start_date=lundi_prochain,
        until_date=lundi_prochain + timedelta(weeks=2),
    )
    # Deux mardis et deux jeudis : ceux de la troisième semaine dépassent la fin.
    assert len(dates) == 4
    assert {jour.weekday() for jour in dates} == {1, 3}


def test_bihebdomadaire_saute_une_semaine(lundi_prochain):
    dates = generate_dates(
        freq=RecurrenceFreq.BIHEBDOMADAIRE,
        interval_count=1,
        byweekday=[4],
        start_date=lundi_prochain,
        until_date=lundi_prochain + timedelta(weeks=6),
    )
    assert all((b - a).days == 14 for a, b in zip(dates, dates[1:]))


def test_mensuelle_garde_le_rang_du_jour():
    """Le deuxième mardi reste le deuxième mardi, quel que soit le mois."""
    depart = date(2026, 9, 8)  # deuxième mardi de septembre 2026
    dates = generate_dates(
        freq=RecurrenceFreq.MENSUELLE,
        interval_count=1,
        byweekday=[2],
        start_date=depart,
        until_date=date(2026, 12, 31),
    )
    assert dates[0] == depart
    assert all(jour.weekday() == 1 for jour in dates)
    assert all((jour.day - 1) // 7 + 1 == 2 for jour in dates)
    assert [jour.month for jour in dates] == [9, 10, 11, 12]


def test_dates_inversees_refusees(lundi_prochain):
    with pytest.raises(RuleViolationError) as refus:
        generate_dates(
            freq=RecurrenceFreq.HEBDOMADAIRE,
            interval_count=1,
            byweekday=[4],
            start_date=lundi_prochain,
            until_date=lundi_prochain - timedelta(days=7),
        )
    assert refus.value.code == "ordre_dates"


# --------------------------------------------------------------------------- #
# Aperçu et création
# --------------------------------------------------------------------------- #


def test_apercu_signale_les_dates_en_conflit(
    session: Session, salle, utilisateur, lundi_prochain, poser
):
    jeudi = lundi_prochain + timedelta(days=3)
    poser(
        Range(
            datetime.combine(jeudi, time(14, 0), tzinfo=PARIS),
            datetime.combine(jeudi, time(15, 30), tzinfo=PARIS),
            bounds="[)",
        ),
        "Réunion existante",
    )

    apercu = preview_series(
        session,
        room_id=salle.id,
        owner_id=utilisateur.id,
        freq=RecurrenceFreq.HEBDOMADAIRE,
        interval_count=1,
        byweekday=[4],
        start_date=lundi_prochain,
        until_date=lundi_prochain + timedelta(weeks=3),
        start_time=time(14, 0),
        end_time=time(15, 0),
        attendee_count=4,
    )

    assert len(apercu.occurrences) == 3
    assert len(apercu.rejected) == 1
    assert "entièrement pris" in apercu.rejected[0].reason


def test_creation_ecarte_les_conflits_et_cree_le_reste(
    session: Session, salle, utilisateur, lundi_prochain, poser
):
    jeudi = lundi_prochain + timedelta(days=3)
    poser(
        Range(
            datetime.combine(jeudi, time(14, 0), tzinfo=PARIS),
            datetime.combine(jeudi, time(15, 30), tzinfo=PARIS),
            bounds="[)",
        )
    )

    regle, creees, ecartees = create_series(
        session,
        room_id=salle.id,
        owner_id=utilisateur.id,
        freq=RecurrenceFreq.HEBDOMADAIRE,
        interval_count=1,
        byweekday=[4],
        start_date=lundi_prochain,
        until_date=lundi_prochain + timedelta(weeks=3),
        start_time=time(14, 0),
        end_time=time(15, 0),
        title="Comité de suivi",
        attendee_count=4,
    )

    assert len(creees) == 2
    assert len(ecartees) == 1
    assert all(reservation.source is BookingSource.RECURRENTE for reservation in creees)
    assert all(reservation.recurrence_rule_id == regle.id for reservation in creees)

    # Les occurrences sont de vraies lignes : c'est ce qui les soumet à la
    # contrainte anti-chevauchement.
    total = session.scalar(
        select(func.count())
        .select_from(Booking)
        .where(Booking.recurrence_rule_id == regle.id)
    )
    assert total == 2


def test_serie_entierement_bloquee_est_refusee(
    session: Session, salle, utilisateur, lundi_prochain, poser
):
    for semaine in range(3):
        jeudi = lundi_prochain + timedelta(days=3, weeks=semaine)
        poser(
            Range(
                datetime.combine(jeudi, time(14, 0), tzinfo=PARIS),
                datetime.combine(jeudi, time(15, 30), tzinfo=PARIS),
                bounds="[)",
            )
        )

    with pytest.raises(RuleViolationError) as refus:
        create_series(
            session,
            room_id=salle.id,
            owner_id=utilisateur.id,
            freq=RecurrenceFreq.HEBDOMADAIRE,
            interval_count=1,
            byweekday=[4],
            start_date=lundi_prochain,
            until_date=lundi_prochain + timedelta(weeks=2),
            start_time=time(14, 0),
            end_time=time(15, 0),
            attendee_count=4,
        )
    assert refus.value.code == "serie_vide"


def test_mode_strict_refuse_toute_la_serie(
    session: Session, salle, utilisateur, lundi_prochain, poser
):
    jeudi = lundi_prochain + timedelta(days=3)
    poser(
        Range(
            datetime.combine(jeudi, time(14, 0), tzinfo=PARIS),
            datetime.combine(jeudi, time(15, 30), tzinfo=PARIS),
            bounds="[)",
        )
    )

    with pytest.raises(RuleViolationError) as refus:
        create_series(
            session,
            room_id=salle.id,
            owner_id=utilisateur.id,
            freq=RecurrenceFreq.HEBDOMADAIRE,
            interval_count=1,
            byweekday=[4],
            start_date=lundi_prochain,
            until_date=lundi_prochain + timedelta(weeks=3),
            start_time=time(14, 0),
            end_time=time(15, 0),
            attendee_count=4,
            skip_conflicts=False,
        )
    assert refus.value.code == "conflit"


def test_heures_inversees_refusees(session: Session, salle, utilisateur, lundi_prochain):
    with pytest.raises(RuleViolationError) as refus:
        preview_series(
            session,
            room_id=salle.id,
            owner_id=utilisateur.id,
            freq=RecurrenceFreq.HEBDOMADAIRE,
            interval_count=1,
            byweekday=[4],
            start_date=lundi_prochain,
            until_date=lundi_prochain + timedelta(weeks=2),
            start_time=time(15, 0),
            end_time=time(14, 0),
        )
    assert refus.value.code == "ordre_heures"

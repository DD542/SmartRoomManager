"""Tests du moteur de disponibilité.

Chaque test isole une règle. Les intitulés décrivent le comportement attendu,
pas la fonction appelée : ils se lisent comme le cahier des charges.
"""

from __future__ import annotations

from datetime import datetime, time, timedelta

import pytest
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.orm import Session

from app.db.enums import BookingStatus, ClosureKind, RoomStatus, RuleScope
from app.models import BookingRule, ClosurePeriod, OpeningHour
from app.services.availability import check_slot, find_available_rooms
from app.services.rules import resolve_opening, resolve_rules
from tests.conftest import PARIS, creneau


# --------------------------------------------------------------------------- #
# Conflits
# --------------------------------------------------------------------------- #


def test_creneau_libre_est_disponible(session: Session, salle, jour_ouvre):
    verdict = check_slot(
        session, room_id=salle.id, creneau=creneau(jour_ouvre, 14, 0, 90), attendee_count=6
    )
    assert verdict.available
    assert verdict.conflicts == []


def test_recouvrement_total_est_bloquant(session: Session, salle, jour_ouvre, poser):
    poser(creneau(jour_ouvre, 14, 0, 120), "Revue de sprint")

    verdict = check_slot(
        session, room_id=salle.id, creneau=creneau(jour_ouvre, 14, 30, 30), attendee_count=4
    )

    assert verdict.blocking
    assert not verdict.forcable
    (conflit,) = [c for c in verdict.conflicts if c.blocking]
    assert conflit.kind == "total"
    assert "entièrement pris" in conflit.message


def test_recouvrement_partiel_est_bloquant(session: Session, salle, jour_ouvre, poser):
    poser(creneau(jour_ouvre, 14, 0, 90), "Atelier data")

    verdict = check_slot(
        session, room_id=salle.id, creneau=creneau(jour_ouvre, 15, 0, 60), attendee_count=4
    )

    (conflit,) = [c for c in verdict.conflicts if c.blocking]
    assert conflit.kind == "partiel"
    assert conflit.overlap_minutes == 30
    assert not verdict.forcable


def test_creneau_jointif_ne_chevauche_pas(session: Session, salle, jour_ouvre, poser):
    """Bornes [) : une réunion qui finit à 15:30 n'occupe pas 15:30."""
    poser(creneau(jour_ouvre, 14, 0, 90))

    # 15:45 laisse les quinze minutes de battement réglementaires.
    verdict = check_slot(
        session, room_id=salle.id, creneau=creneau(jour_ouvre, 15, 45, 60), attendee_count=4
    )
    assert verdict.available


def test_battement_insuffisant_est_signale_sans_bloquer(
    session: Session, salle, jour_ouvre, poser
):
    """Le cas qui échappe à la contrainte EXCLUDE : les créneaux ne se touchent pas."""
    poser(
        Range(
            datetime.combine(jour_ouvre, time(12, 30), tzinfo=PARIS),
            datetime.combine(jour_ouvre, time(13, 55), tzinfo=PARIS),
            bounds="[)",
        ),
        "Entretien RH",
    )

    verdict = check_slot(
        session, room_id=salle.id, creneau=creneau(jour_ouvre, 14, 0, 60), attendee_count=4
    )

    (conflit,) = verdict.conflicts
    assert conflit.kind == "adjacent"
    assert conflit.gap_minutes == 5
    assert conflit.blocking is False
    # Signalé, donc indisponible ; mais forçable, contrairement à un recouvrement.
    assert not verdict.available
    assert verdict.forcable
    assert "5 min de battement au lieu des 15 min" in conflit.message


def test_reservation_annulee_libere_le_creneau(session: Session, salle, jour_ouvre, poser):
    reservation = poser(creneau(jour_ouvre, 14, 0, 90))
    reservation.status = BookingStatus.ANNULEE
    reservation.cancelled_at = datetime.now(PARIS)
    reservation.cancel_reason = "Réunion reportée"
    session.flush()

    verdict = check_slot(
        session, room_id=salle.id, creneau=creneau(jour_ouvre, 14, 0, 90), attendee_count=4
    )
    assert verdict.available


def test_deplacement_ignore_la_reservation_deplacee(
    session: Session, salle, jour_ouvre, poser
):
    reservation = poser(creneau(jour_ouvre, 14, 0, 90))

    verdict = check_slot(
        session,
        room_id=salle.id,
        creneau=creneau(jour_ouvre, 14, 30, 60),
        attendee_count=4,
        ignore_booking_id=reservation.id,
    )
    assert verdict.available


# --------------------------------------------------------------------------- #
# Règles de durée, d'horizon et d'état de la salle
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    ("duree", "extrait"),
    [(15, "durée minimale"), (300, "durée maximale")],
)
def test_bornes_de_duree(session: Session, salle, jour_ouvre, duree, extrait):
    verdict = check_slot(
        session, room_id=salle.id, creneau=creneau(jour_ouvre, 9, 0, duree), attendee_count=4
    )
    assert any(extrait in erreur for erreur in verdict.rule_errors)
    # Une règle se force : aucun chevauchement n'est en cause.
    assert verdict.forcable


def test_creneau_passe_est_refuse(session: Session, salle):
    hier = datetime.now(PARIS).date() - timedelta(days=1)
    verdict = check_slot(
        session, room_id=salle.id, creneau=creneau(hier, 14, 0, 60), attendee_count=4
    )
    assert any("déjà passé" in erreur for erreur in verdict.rule_errors)


def test_anticipation_maximale(session: Session, salle):
    lointain = datetime.now(PARIS).date() + timedelta(days=120)
    while lointain.weekday() >= 5:
        lointain += timedelta(days=1)

    verdict = check_slot(
        session, room_id=salle.id, creneau=creneau(lointain, 14, 0, 60), attendee_count=4
    )
    assert any("à l'avance" in erreur for erreur in verdict.rule_errors)


def test_salle_en_maintenance_est_refusee(session: Session, salle, jour_ouvre):
    salle.status = RoomStatus.MAINTENANCE
    session.flush()

    verdict = check_slot(
        session, room_id=salle.id, creneau=creneau(jour_ouvre, 14, 0, 60), attendee_count=4
    )
    assert any("maintenance" in erreur for erreur in verdict.rule_errors)


# --------------------------------------------------------------------------- #
# Horaires d'ouverture et fermetures
# --------------------------------------------------------------------------- #


def test_creneau_hors_horaires_est_refuse(session: Session, salle, jour_ouvre):
    verdict = check_slot(
        session, room_id=salle.id, creneau=creneau(jour_ouvre, 6, 0, 60), attendee_count=4
    )
    assert any("ouvre de" in erreur for erreur in verdict.rule_errors)


def test_jour_de_fermeture_hebdomadaire(session: Session, salle):
    dimanche = datetime.now(PARIS).date() + timedelta(days=1)
    while dimanche.weekday() != 6:
        dimanche += timedelta(days=1)

    verdict = check_slot(
        session, room_id=salle.id, creneau=creneau(dimanche, 14, 0, 60), attendee_count=4
    )
    assert any("fermée le dimanche" in erreur for erreur in verdict.rule_errors)


def test_surcharge_horaire_de_salle_prime_sur_le_global(
    session: Session, salle, jour_ouvre
):
    session.add(
        OpeningHour(
            scope=RuleScope.SALLE,
            room_id=salle.id,
            weekday=(jour_ouvre.weekday() + 1) % 7,
            is_open=True,
            opens_at=time(10, 0),
            closes_at=time(12, 0),
        )
    )
    session.flush()

    fenetre = resolve_opening(session, salle, jour_ouvre)
    assert fenetre is not None and fenetre.scope is RuleScope.SALLE

    # 14:00 est dans l'amplitude globale, hors de la surcharge de la salle.
    verdict = check_slot(
        session, room_id=salle.id, creneau=creneau(jour_ouvre, 14, 0, 60), attendee_count=4
    )
    assert any("ouvre de 10:00 à 12:00" in erreur for erreur in verdict.rule_errors)


def test_fermeture_exceptionnelle_globale(session: Session, salle, jour_ouvre):
    session.add(
        ClosurePeriod(
            label="Jour férié de test",
            date_span=Range(jour_ouvre, jour_ouvre + timedelta(days=1), bounds="[)"),
            kind=ClosureKind.FERMETURE,
            is_global=True,
        )
    )
    session.flush()

    verdict = check_slot(
        session, room_id=salle.id, creneau=creneau(jour_ouvre, 14, 0, 60), attendee_count=4
    )
    assert verdict.closure_error is not None
    assert "Jour férié de test" in verdict.closure_error


# --------------------------------------------------------------------------- #
# Capacité, validation et quotas
# --------------------------------------------------------------------------- #


def test_capacite_depassee(session: Session, salle, jour_ouvre):
    verdict = check_slot(
        session, room_id=salle.id, creneau=creneau(jour_ouvre, 14, 0, 60), attendee_count=30
    )
    assert verdict.capacity_error is not None
    assert "12 places pour 30 personnes" in verdict.capacity_error
    assert verdict.forcable


def test_seuil_de_validation_administrative(session: Session, salle, jour_ouvre):
    session.add(
        BookingRule(scope=RuleScope.SALLE, room_id=salle.id, validation_capacity_threshold=10)
    )
    session.flush()

    verdict = check_slot(
        session, room_id=salle.id, creneau=creneau(jour_ouvre, 14, 0, 60), attendee_count=11
    )
    assert verdict.requires_validation
    assert verdict.rules is not None and verdict.rules.scope is RuleScope.SALLE


def test_quota_hebdomadaire(session: Session, salle, jour_ouvre, utilisateur, poser):
    """Douze heures de quota : la treizième heure de la semaine est refusée."""
    jour = jour_ouvre - timedelta(days=jour_ouvre.weekday())  # lundi de la semaine
    heure = 8
    for _ in range(4):
        poser(creneau(jour, heure, 0, 180))
        heure += 4
        if heure > 16:
            jour += timedelta(days=1)
            heure = 8

    verdict = check_slot(
        session,
        room_id=salle.id,
        creneau=creneau(jour_ouvre, 9, 0, 60),
        attendee_count=4,
        requester_id=utilisateur.id,
    )
    assert any("Quota hebdomadaire dépassé" in erreur for erreur in verdict.rule_errors)


def test_surcharge_de_regle_par_salle(session: Session, salle, jour_ouvre):
    session.add(
        BookingRule(
            scope=RuleScope.SALLE,
            room_id=salle.id,
            min_duration_min=60,
            max_duration_min=120,
            weekly_quota_hours=12,
        )
    )
    session.flush()

    regles = resolve_rules(session, salle)
    assert regles.scope is RuleScope.SALLE
    assert regles.max_duration_min == 120

    verdict = check_slot(
        session, room_id=salle.id, creneau=creneau(jour_ouvre, 14, 0, 180), attendee_count=4
    )
    assert any("durée maximale est de 2 h" in erreur for erreur in verdict.rule_errors)


# --------------------------------------------------------------------------- #
# Recherche de salles disponibles
# --------------------------------------------------------------------------- #


def test_salle_occupee_sort_de_la_recherche(
    session: Session, salle, jour_ouvre, poser, batiment
):
    plage = creneau(jour_ouvre, 14, 0, 90)
    libres = find_available_rooms(
        session, creneau=plage, attendee_count=4, building_id=batiment.id
    )
    assert salle.id in {s.id for s in libres}

    poser(plage)
    libres = find_available_rooms(
        session, creneau=plage, attendee_count=4, building_id=batiment.id
    )
    assert salle.id not in {s.id for s in libres}


def test_recherche_filtre_la_capacite(session: Session, salle, jour_ouvre, batiment):
    libres = find_available_rooms(
        session,
        creneau=creneau(jour_ouvre, 14, 0, 90),
        attendee_count=30,
        building_id=batiment.id,
    )
    assert salle.id not in {s.id for s in libres}

"""Invariants des structures du domaine."""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta

import pytest

from app.domain.types import (
    Closure,
    Conflict,
    OpeningWindow,
    OverlapKind,
    RuleSet,
    Score,
    ScoreComponent,
    TimeSlot,
)
from tests.domain.conftest import booking, local, slot, utc


class TestConstructionTimeSlot:
    def test_creneau_valide(self):
        plage = TimeSlot(utc(10), utc(12))
        assert plage.duration == timedelta(hours=2)

    @pytest.mark.parametrize(
        ("debut", "fin", "attendu"),
        [
            pytest.param(utc(12), utc(10), "suivre son début", id="inverse"),
            pytest.param(utc(10), utc(10), "durée nulle", id="duree_nulle"),
        ],
    )
    def test_creneau_impossible(self, debut, fin, attendu):
        with pytest.raises(ValueError, match=attendu):
            TimeSlot(debut, fin)

    @pytest.mark.parametrize(
        ("debut", "fin", "borne"),
        [
            pytest.param(datetime(2026, 8, 25, 10), utc(12), "start", id="debut_naif"),
            pytest.param(utc(10), datetime(2026, 8, 25, 12), "end", id="fin_naive"),
        ],
    )
    def test_horodatage_naif_refuse(self, debut, fin, borne):
        with pytest.raises(ValueError, match=borne):
            TimeSlot(debut, fin)

    def test_normalisation_en_utc(self):
        """Une borne en heure de Paris est convertie, pas conservée telle quelle."""
        plage = TimeSlot(local(12), local(14))
        assert plage.start == utc(10)
        assert plage.start.tzinfo is UTC

    def test_construction_par_duree(self):
        assert TimeSlot.of(utc(10), timedelta(minutes=90)) == TimeSlot(
            utc(10), utc(11, 30)
        )


class TestRelations:
    @pytest.mark.parametrize(
        ("autre", "attendu"),
        [
            pytest.param(slot(10, 0, 12), True, id="identique"),
            pytest.param(slot(11, 0, 13), True, id="chevauche"),
            pytest.param(slot(12, 0, 14), False, id="adjacent_apres"),
            pytest.param(slot(8, 0, 10), False, id="adjacent_avant"),
            pytest.param(slot(13, 0, 14), False, id="disjoint"),
        ],
    )
    def test_overlaps(self, autre, attendu):
        assert slot(10, 0, 12).overlaps(autre) is attendu

    @pytest.mark.parametrize(
        ("autre", "attendu"),
        [
            pytest.param(slot(10, 30, 11, 30), True, id="strictement_dedans"),
            pytest.param(slot(10, 0, 12), True, id="bornes_egales"),
            pytest.param(slot(9, 0, 11), False, id="deborde_avant"),
            pytest.param(slot(11, 0, 13), False, id="deborde_apres"),
        ],
    )
    def test_contains(self, autre, attendu):
        assert slot(10, 0, 12).contains(autre) is attendu

    @pytest.mark.parametrize(
        ("autre", "attendu"),
        [
            pytest.param(slot(12, 0, 14), True, id="colle_apres"),
            pytest.param(slot(8, 0, 10), True, id="colle_avant"),
            pytest.param(slot(12, 5, 14), False, id="separe"),
        ],
    )
    def test_touches(self, autre, attendu):
        assert slot(10, 0, 12).touches(autre) is attendu

    @pytest.mark.parametrize(
        ("autre", "minutes"),
        [
            pytest.param(slot(13, 0, 14), 60, id="apres"),
            pytest.param(slot(8, 0, 9), 60, id="avant"),
            pytest.param(slot(12, 0, 13), 0, id="jointif"),
            pytest.param(slot(11, 0, 13), 0, id="chevauchant"),
        ],
    )
    def test_gap_to(self, autre, minutes):
        assert slot(10, 0, 12).gap_to(autre) == timedelta(minutes=minutes)

    @pytest.mark.parametrize(
        ("autre", "attendu"),
        [
            pytest.param(slot(11, 0, 13), slot(11, 0, 12), id="partielle"),
            pytest.param(slot(10, 30, 11), slot(10, 30, 11), id="incluse"),
            pytest.param(slot(12, 0, 13), None, id="adjacente"),
            pytest.param(slot(14, 0, 15), None, id="disjointe"),
        ],
    )
    def test_intersection(self, autre, attendu):
        assert slot(10, 0, 12).intersection(autre) == attendu

    def test_decalage_et_elargissement(self):
        base = slot(10, 0, 12)
        assert base.shifted(timedelta(hours=1)) == slot(11, 0, 13)
        assert base.expanded(timedelta(minutes=15)) == slot(9, 45, 12, 15)


class TestOpeningWindow:
    @pytest.mark.parametrize("jour", [0, 6], ids=["dimanche", "samedi"])
    def test_jour_valide(self, jour):
        assert (
            OpeningWindow(weekday=jour, opens_at=time(8), closes_at=time(20)).weekday
            == jour
        )

    @pytest.mark.parametrize("jour", [-1, 7], ids=["avant_dimanche", "apres_samedi"])
    def test_jour_hors_bornes(self, jour):
        with pytest.raises(ValueError, match="jour de semaine"):
            OpeningWindow(weekday=jour, opens_at=time(8), closes_at=time(20))


class TestClosure:
    def test_periode_inversee_refusee(self):
        with pytest.raises(ValueError, match="précède"):
            Closure(
                label="Travaux", first_day=date(2026, 8, 26), last_day=date(2026, 8, 25)
            )

    @pytest.mark.parametrize(
        ("jour", "attendu"),
        [
            pytest.param(date(2026, 8, 24), False, id="veille"),
            pytest.param(date(2026, 8, 25), True, id="premier_jour"),
            pytest.param(date(2026, 8, 26), True, id="jour_median"),
            pytest.param(date(2026, 8, 27), True, id="dernier_jour"),
            pytest.param(date(2026, 8, 28), False, id="lendemain"),
        ],
    )
    def test_bornes_incluses(self, jour, attendu):
        fermeture = Closure(
            label="Travaux", first_day=date(2026, 8, 25), last_day=date(2026, 8, 27)
        )
        assert fermeture.covers(jour) is attendu


class TestRuleSet:
    def test_valeurs_du_sujet(self):
        regles = RuleSet.defaults()
        assert regles.min_duration == timedelta(minutes=30)
        assert regles.max_duration == timedelta(hours=4)
        assert regles.max_advance == timedelta(days=60)
        assert regles.min_advance == timedelta(minutes=15)
        assert regles.max_active_bookings == 10
        assert regles.cancel_deadline == timedelta(hours=1)
        assert regles.checkin_window == timedelta(minutes=10)
        assert regles.validation_capacity_threshold == 20


class TestConflict:
    @pytest.mark.parametrize(
        ("kind", "bloquant"),
        [
            pytest.param(OverlapKind.IDENTIQUE, True, id="identique"),
            pytest.param(OverlapKind.ENGLOBANT, True, id="englobant"),
            pytest.param(OverlapKind.ENGLOBE, True, id="englobe"),
            pytest.param(OverlapKind.PARTIEL_DEBUT, True, id="partiel_debut"),
            pytest.param(OverlapKind.PARTIEL_FIN, True, id="partiel_fin"),
            pytest.param(OverlapKind.ADJACENT, False, id="adjacent"),
            pytest.param(OverlapKind.AUCUN, False, id="aucun"),
        ],
    )
    def test_caractere_bloquant(self, kind, bloquant):
        conflit = Conflict(
            existing=booking(slot(10, 0, 12)),
            kind=kind,
            overlap=timedelta(0),
            gap=timedelta(0),
        )
        assert conflit.is_blocking is bloquant

    def test_durees_en_minutes(self):
        conflit = Conflict(
            existing=booking(slot(10, 0, 12)),
            kind=OverlapKind.PARTIEL_FIN,
            overlap=timedelta(minutes=90),
            gap=timedelta(minutes=5),
        )
        assert conflit.overlap_minutes == 90
        assert conflit.gap_minutes == 5


class TestScore:
    def test_ratio(self):
        assert (
            ScoreComponent("k", "L", points=15, max_points=30, detail="d").ratio == 0.5
        )

    def test_ratio_sans_poids(self):
        """Un critère de poids nul ne vaut pas une division par zéro."""
        assert ScoreComponent("k", "L", points=0, max_points=0, detail="d").ratio == 0.0

    def test_total_et_acces(self):
        score = Score(
            components=(
                ScoreComponent("capacity", "Capacité", 30, 30, "juste"),
                ScoreComponent("equipment", "Équipements", 12, 25, "partiel"),
            )
        )
        assert score.total == 42
        assert score.get("capacity").points == 30
        assert score.get("absent") is None

    def test_score_vide(self):
        assert Score().total == 0

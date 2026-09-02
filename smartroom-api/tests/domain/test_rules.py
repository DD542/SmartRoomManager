"""Évaluation des règles de réservation, bornes comprises."""

from __future__ import annotations

from dataclasses import replace
from datetime import timedelta

import pytest

from app.domain.rules import (
    can_cancel,
    check_buffer,
    check_capacity,
    check_closure,
    check_duration,
    check_horizon,
    check_opening,
    check_quota,
    evaluate,
    format_duree,
    format_heure,
    is_releasable,
    local_days,
    requires_validation,
)
from app.domain.types import Closure, RuleCode, TimeSlot
from tests.domain.conftest import JOUR, PARIS, booking, local, slot, utc


def codes(violations) -> list[RuleCode]:
    return [item.code for item in violations]


class TestFormatage:
    @pytest.mark.parametrize(
        ("valeur", "attendu"),
        [
            pytest.param(timedelta(minutes=30), "30 min", id="minutes"),
            pytest.param(timedelta(hours=4), "4 h", id="heures_pleines"),
            pytest.param(
                timedelta(hours=1, minutes=30), "1 h 30", id="heures_et_minutes"
            ),
            pytest.param(timedelta(0), "0 min", id="nulle"),
        ],
    )
    def test_duree(self, valeur, attendu):
        assert format_duree(valeur) == attendu

    def test_heure_convertie_en_local(self):
        assert format_heure(utc(10), PARIS) == "12:00"


class TestDuree:
    @pytest.mark.parametrize(
        ("creneau", "attendu"),
        [
            pytest.param(slot(10, 0, 10, 20), [RuleCode.DUREE_MIN], id="trop_courte"),
            pytest.param(slot(10, 0, 10, 30), [], id="exactement_le_minimum"),
            pytest.param(slot(10, 0, 14), [], id="exactement_le_maximum"),
            pytest.param(slot(10, 0, 15), [RuleCode.DUREE_MAX], id="trop_longue"),
        ],
    )
    def test_bornes(self, creneau, attendu, regles):
        assert codes(check_duration(creneau, regles)) == attendu

    def test_message_cite_les_deux_durees(self, regles):
        (violation,) = check_duration(slot(10, 0, 10, 20), regles)
        assert "20 min" in violation.message
        assert "30 min" in violation.message


class TestHorizon:
    def test_creneau_ecoule(self, regles):
        (violation,) = check_horizon(slot(8, 0, 9), utc(10), regles)
        assert violation.code is RuleCode.PASSE
        assert violation.forcible is False

    def test_creneau_qui_vient_de_finir(self, regles):
        """La borne de fin est exclue : un créneau fini à 10:00 est écoulé à 10:00."""
        assert codes(check_horizon(slot(8, 0, 10), utc(10), regles)) == [RuleCode.PASSE]

    @pytest.mark.parametrize(
        ("jours", "attendu"),
        [
            pytest.param(59, [], id="dans_l_horizon"),
            pytest.param(60, [], id="exactement_soixante_jours"),
            pytest.param(61, [RuleCode.HORIZON_MAX], id="au_dela_de_l_horizon"),
        ],
    )
    def test_anticipation_maximale(self, jours, attendu, regles):
        maintenant = utc(9)
        depart = maintenant + timedelta(days=jours)
        creneau = TimeSlot(depart, depart + timedelta(hours=1))
        assert codes(check_horizon(creneau, maintenant, regles)) == attendu

    @pytest.mark.parametrize(
        ("minutes", "attendu"),
        [
            pytest.param(14, [RuleCode.HORIZON_MIN], id="trop_tardive"),
            pytest.param(15, [], id="exactement_quinze_minutes"),
            pytest.param(16, [], id="dans_les_temps"),
        ],
    )
    def test_anticipation_minimale(self, minutes, attendu, regles):
        maintenant = utc(9)
        depart = maintenant + timedelta(minutes=minutes)
        creneau = TimeSlot(depart, depart + timedelta(hours=1))
        assert codes(check_horizon(creneau, maintenant, regles)) == attendu


class TestQuota:
    @pytest.mark.parametrize(
        ("actives", "attendu"),
        [
            pytest.param(0, [], id="aucune"),
            pytest.param(9, [], id="juste_sous_le_quota"),
            pytest.param(10, [RuleCode.QUOTA], id="quota_atteint"),
            pytest.param(12, [RuleCode.QUOTA], id="quota_depasse"),
        ],
    )
    def test_bornes(self, actives, attendu, regles):
        assert codes(check_quota(actives, regles)) == attendu


class TestCapacite:
    @pytest.mark.parametrize(
        ("effectif", "capacite", "attendu"),
        [
            pytest.param(10, 12, [], id="de_la_marge"),
            pytest.param(12, 12, [], id="exactement_pleine"),
            pytest.param(13, 12, [RuleCode.CAPACITE], id="depassee"),
        ],
    )
    def test_bornes(self, effectif, capacite, attendu):
        assert codes(check_capacity(effectif, capacite)) == attendu


class TestOuverture:
    def test_creneau_dans_l_amplitude(self, ouverture_du_jour):
        assert (
            check_opening(TimeSlot(local(10), local(11)), ouverture_du_jour, PARIS)
            == ()
        )

    def test_creneau_hors_amplitude(self, ouverture_du_jour):
        (violation,) = check_opening(
            TimeSlot(local(21), local(22)), ouverture_du_jour, PARIS
        )
        assert violation.code is RuleCode.HORS_OUVERTURE
        assert "08:00–20:00" in violation.message

    def test_salle_fermee_ce_jour_la(self):
        (violation,) = check_opening(slot(10, 0, 11), [], PARIS)
        assert "pas ouverte ce jour-là" in violation.message


class TestFermeture:
    def test_jour_ferme(self, fermeture_du_jour):
        (violation,) = check_closure(
            TimeSlot(local(10), local(11)), [fermeture_du_jour], PARIS
        )
        assert violation.code is RuleCode.FERMETURE
        assert "Journée pédagogique" in violation.message

    def test_jour_ouvert(self):
        fermeture = Closure(
            label="Pont",
            first_day=JOUR + timedelta(days=5),
            last_day=JOUR + timedelta(days=6),
        )
        assert check_closure(TimeSlot(local(10), local(11)), [fermeture], PARIS) == ()

    def test_aucune_fermeture(self):
        assert check_closure(slot(10, 0, 11), [], PARIS) == ()

    def test_creneau_a_cheval_sur_un_jour_ferme(self):
        """Ouvert la veille au soir, fermé le lendemain : la fermeture s'applique."""
        demain = JOUR + timedelta(days=1)
        creneau = TimeSlot(local(23), local(1, day=demain))
        fermeture = Closure(label="Travaux", first_day=demain, last_day=demain)
        assert codes(check_closure(creneau, [fermeture], PARIS)) == [RuleCode.FERMETURE]


class TestJoursLocaux:
    @pytest.mark.parametrize(
        ("creneau", "nombre"),
        [
            pytest.param(TimeSlot(local(10), local(11)), 1, id="un_seul_jour"),
            pytest.param(
                TimeSlot(local(23), local(0, day=JOUR + timedelta(days=1))),
                1,
                id="finit_a_minuit_pile",
            ),
            pytest.param(
                TimeSlot(local(23), local(1, day=JOUR + timedelta(days=1))),
                2,
                id="a_cheval_sur_minuit",
            ),
        ],
    )
    def test_bornes_de_fin_exclue(self, creneau, nombre):
        assert len(local_days(creneau, PARIS)) == nombre


class TestBattement:
    def test_voisine_trop_proche(self, regles):
        voisine = booking(slot(9, 0, 9, 55), "Atelier")
        (violation,) = check_buffer(slot(10, 0, 11), [voisine], regles, PARIS)
        assert violation.code is RuleCode.BATTEMENT
        assert "Atelier" in violation.message
        assert violation.forcible is True

    def test_voisine_apres_le_creneau(self, regles):
        voisine = booking(slot(11, 5, 12), "Entretien")
        (violation,) = check_buffer(slot(10, 0, 11), [voisine], regles, PARIS)
        assert "commence à" in violation.message

    def test_battement_suffisant(self, regles):
        assert (
            check_buffer(slot(10, 0, 11), [booking(slot(9, 0, 9, 45))], regles, PARIS)
            == ()
        )

    def test_recouvrement_ignore_ici(self, regles):
        """Un vrai chevauchement relève de la détection de conflits, pas du battement."""
        assert (
            check_buffer(slot(10, 0, 12), [booking(slot(11, 0, 13))], regles, PARIS)
            == ()
        )

    def test_battement_desactive(self, regles):
        sans_battement = replace(regles, buffer=timedelta(0))
        voisine = booking(slot(9, 0, 9, 59))
        assert check_buffer(slot(10, 0, 11), [voisine], sans_battement, PARIS) == ()


class TestEvaluate:
    def test_creneau_conforme(self, regles, ouverture_du_jour, maintenant):
        assert (
            evaluate(
                TimeSlot(local(10), local(11)),
                rules=regles,
                now=maintenant,
                tz=PARIS,
                attendees=8,
                capacity=12,
                open_windows=ouverture_du_jour,
            )
            == ()
        )

    def test_creneau_ecoule_court_circuite_les_autres_regles(self, regles):
        """Sans amplitude fournie, la règle d'ouverture serait aussi enfreinte."""
        assert codes(evaluate(slot(8, 0, 9), rules=regles, now=utc(10), tz=PARIS)) == [
            RuleCode.PASSE
        ]

    def test_violations_cumulees_dans_un_ordre_stable(
        self, regles, ouverture_du_jour, maintenant
    ):
        obtenus = codes(
            evaluate(
                TimeSlot(local(21), local(21, 20)),
                rules=regles,
                now=maintenant,
                tz=PARIS,
                attendees=30,
                capacity=12,
                active_bookings=10,
                open_windows=ouverture_du_jour,
            )
        )
        assert obtenus == [
            RuleCode.DUREE_MIN,
            RuleCode.HORS_OUVERTURE,
            RuleCode.CAPACITE,
            RuleCode.QUOTA,
        ]

    def test_capacite_ignoree_si_non_fournie(
        self, regles, ouverture_du_jour, maintenant
    ):
        assert (
            codes(
                evaluate(
                    TimeSlot(local(10), local(11)),
                    rules=regles,
                    now=maintenant,
                    tz=PARIS,
                    attendees=500,
                    open_windows=ouverture_du_jour,
                )
            )
            == []
        )

    def test_quota_desactivable(self, regles, ouverture_du_jour, maintenant):
        """Une création administrative n'oppose pas le quota de l'utilisateur."""
        assert (
            codes(
                evaluate(
                    TimeSlot(local(10), local(11)),
                    rules=regles,
                    now=maintenant,
                    tz=PARIS,
                    active_bookings=50,
                    open_windows=ouverture_du_jour,
                    check_quotas=False,
                )
            )
            == []
        )

    def test_fermeture_et_ouverture_cumulees(
        self, regles, maintenant, fermeture_du_jour
    ):
        obtenus = codes(
            evaluate(
                TimeSlot(local(10), local(11)),
                rules=regles,
                now=maintenant,
                tz=PARIS,
                closures=[fermeture_du_jour],
            )
        )
        assert obtenus == [RuleCode.FERMETURE, RuleCode.HORS_OUVERTURE]


class TestValidationEtAnnulation:
    @pytest.mark.parametrize(
        ("effectif", "attendu"),
        [
            pytest.param(19, False, id="sous_le_seuil"),
            pytest.param(20, True, id="au_seuil"),
            pytest.param(25, True, id="au_dessus"),
        ],
    )
    def test_seuil_de_validation(self, effectif, attendu, regles):
        assert requires_validation(effectif, regles) is attendu

    def test_seuil_absent(self, regles):
        sans_seuil = replace(regles, validation_capacity_threshold=None)
        assert requires_validation(500, sans_seuil) is False

    @pytest.mark.parametrize(
        ("maintenant", "attendu"),
        [
            pytest.param(utc(8), True, id="deux_heures_avant"),
            pytest.param(utc(9), True, id="exactement_une_heure_avant"),
            pytest.param(utc(9, 30), False, id="trop_tard"),
        ],
    )
    def test_delai_d_annulation(self, maintenant, attendu, regles):
        assert can_cancel(slot(10, 0, 12), maintenant, regles) is attendu


class TestLiberation:
    @pytest.mark.parametrize(
        ("maintenant", "presence", "attendu"),
        [
            pytest.param(utc(10, 5), None, False, id="fenetre_encore_ouverte"),
            pytest.param(utc(10, 10), None, True, id="fenetre_expiree"),
            pytest.param(utc(11), None, True, id="creneau_en_cours"),
            pytest.param(utc(12), None, False, id="creneau_termine"),
            pytest.param(utc(11), utc(10, 2), False, id="presence_validee"),
        ],
    )
    def test_conditions(self, maintenant, presence, attendu, regles):
        assert is_releasable(slot(10, 0, 12), maintenant, presence, regles) is attendu

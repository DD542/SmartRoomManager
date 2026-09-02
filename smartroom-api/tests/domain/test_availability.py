"""Balayage d'intervalles, amplitudes d'ouverture et changements d'heure."""

from __future__ import annotations

from datetime import date, time, timedelta

import pytest

from app.domain.availability import (
    daily_windows,
    free_slots,
    is_free,
    is_within,
    merge,
    open_windows,
    subtract,
    subtract_all,
)
from app.domain.types import Closure, OpeningWindow, TimeSlot
from tests.domain.conftest import (
    AUTOMNE,
    JOUR,
    PARIS,
    PRINTEMPS,
    local,
    slot,
    toute_la_semaine,
)


class TestMerge:
    @pytest.mark.parametrize(
        ("entree", "attendu"),
        [
            pytest.param([], (), id="vide"),
            pytest.param([slot(10, 0, 12)], (slot(10, 0, 12),), id="unique"),
            pytest.param(
                [slot(10, 0, 12), slot(11, 0, 13)],
                (slot(10, 0, 13),),
                id="chevauchants",
            ),
            pytest.param(
                [slot(10, 0, 11), slot(11, 0, 12)],
                (slot(10, 0, 12),),
                id="jointifs",
            ),
            pytest.param(
                [slot(10, 0, 14), slot(11, 0, 12)],
                (slot(10, 0, 14),),
                id="inclus",
            ),
            pytest.param(
                [slot(14, 0, 15), slot(10, 0, 11)],
                (slot(10, 0, 11), slot(14, 0, 15)),
                id="desordonnes_disjoints",
            ),
            pytest.param(
                [slot(10, 0, 12), slot(10, 0, 11)],
                (slot(10, 0, 12),),
                id="meme_depart",
            ),
        ],
    )
    def test_fusion(self, entree, attendu):
        assert merge(entree) == attendu


class TestSubtract:
    @pytest.mark.parametrize(
        ("occupes", "attendu"),
        [
            pytest.param([], (slot(8, 0, 18),), id="rien_d_occupe"),
            pytest.param(
                [slot(6, 0, 7)], (slot(8, 0, 18),), id="occupe_avant_la_fenetre"
            ),
            pytest.param(
                [slot(19, 0, 20)], (slot(8, 0, 18),), id="occupe_apres_la_fenetre"
            ),
            pytest.param([slot(8, 0, 18)], (), id="occupe_toute_la_fenetre"),
            pytest.param([slot(7, 0, 19)], (), id="occupe_deborde_des_deux_cotes"),
            pytest.param(
                [slot(10, 0, 11)],
                (slot(8, 0, 10), slot(11, 0, 18)),
                id="trou_au_milieu",
            ),
            pytest.param(
                [slot(8, 0, 10)],
                (slot(10, 0, 18),),
                id="occupe_des_l_ouverture",
            ),
            pytest.param(
                [slot(16, 0, 18)],
                (slot(8, 0, 16),),
                id="occupe_jusqu_a_la_fermeture",
            ),
            pytest.param(
                [slot(7, 0, 9)],
                (slot(9, 0, 18),),
                id="occupe_a_cheval_sur_l_ouverture",
            ),
            pytest.param(
                [slot(17, 0, 19)],
                (slot(8, 0, 17),),
                id="occupe_a_cheval_sur_la_fermeture",
            ),
            pytest.param(
                [slot(10, 0, 11), slot(14, 0, 15)],
                (slot(8, 0, 10), slot(11, 0, 14), slot(15, 0, 18)),
                id="deux_trous",
            ),
            pytest.param(
                [slot(14, 0, 15), slot(10, 0, 11)],
                (slot(8, 0, 10), slot(11, 0, 14), slot(15, 0, 18)),
                id="occupation_desordonnee",
            ),
        ],
    )
    def test_soustraction(self, occupes, attendu):
        assert subtract(slot(8, 0, 18), occupes) == attendu

    def test_soustraction_sur_plusieurs_fenetres(self):
        fenetres = [slot(8, 0, 12), slot(14, 0, 18)]
        assert subtract_all(fenetres, [slot(9, 0, 10), slot(15, 0, 16)]) == (
            slot(8, 0, 9),
            slot(10, 0, 12),
            slot(14, 0, 15),
            slot(16, 0, 18),
        )


class TestFreeSlots:
    def test_sans_battement(self):
        assert free_slots(
            [slot(8, 0, 18)], [slot(10, 0, 11)], min_duration=timedelta(minutes=30)
        ) == (slot(8, 0, 10), slot(11, 0, 18))

    def test_le_battement_rogne_les_trous(self):
        """Occupée jusqu'à 11:00, la salle n'est libre qu'à 11:15 avec 15 min exigées."""
        assert free_slots(
            [slot(8, 0, 18)],
            [slot(10, 0, 11)],
            min_duration=timedelta(minutes=30),
            buffer=timedelta(minutes=15),
        ) == (slot(8, 0, 9, 45), slot(11, 15, 18))

    def test_trou_trop_court_ecarte(self):
        assert (
            free_slots(
                [slot(8, 0, 18)],
                [slot(8, 0, 17, 45)],
                min_duration=timedelta(minutes=30),
            )
            == ()
        )

    def test_trou_exactement_a_la_duree_minimale_conserve(self):
        assert free_slots(
            [slot(8, 0, 18)],
            [slot(8, 30, 18)],
            min_duration=timedelta(minutes=30),
        ) == (slot(8, 0, 8, 30),)

    def test_battement_negatif_refuse(self):
        with pytest.raises(ValueError, match="négatif"):
            free_slots(
                [slot(8, 0, 18)], [], min_duration=timedelta(0), buffer=timedelta(-1)
            )


class TestIsFree:
    @pytest.mark.parametrize(
        ("battement", "attendu"),
        [
            pytest.param(timedelta(0), True, id="sans_battement_adjacent_accepte"),
            pytest.param(timedelta(minutes=15), False, id="battement_exige_refuse"),
        ],
    )
    def test_adjacence(self, battement, attendu):
        assert is_free(slot(11, 0, 12), [slot(9, 0, 11)], buffer=battement) is attendu

    def test_battement_negatif_refuse(self):
        with pytest.raises(ValueError, match="négatif"):
            is_free(slot(10, 0, 12), [], buffer=timedelta(minutes=-1))


class TestIsWithin:
    @pytest.mark.parametrize(
        ("creneau", "attendu"),
        [
            pytest.param(slot(10, 0, 12), True, id="dedans"),
            pytest.param(slot(8, 0, 20), True, id="bornes_exactes"),
            pytest.param(slot(7, 0, 12), False, id="avant_l_ouverture"),
            pytest.param(slot(18, 0, 21), False, id="apres_la_fermeture"),
        ],
    )
    def test_appartenance(self, creneau, attendu):
        assert is_within(creneau, [slot(8, 0, 20)]) is attendu

    def test_aucune_amplitude(self):
        assert is_within(slot(10, 0, 12), []) is False

    def test_amplitudes_jointives_forment_une_union(self):
        """22:00–00:00 puis 00:00–02:00 : un créneau à cheval sur minuit tient dedans."""
        minuit = local(0, day=JOUR + timedelta(days=1))
        fenetres = [
            TimeSlot(local(22), minuit),
            TimeSlot(minuit, minuit + timedelta(hours=2)),
        ]
        a_cheval = TimeSlot(
            minuit - timedelta(minutes=30), minuit + timedelta(minutes=30)
        )
        assert is_within(a_cheval, fenetres) is True


class TestDailyWindows:
    def test_jour_sans_horaire(self):
        """Le jour de référence est un mardi, `weekday` 2 dans la numérotation SQL."""
        horaires = [OpeningWindow(weekday=0, opens_at=time(8), closes_at=time(20))]
        assert daily_windows(JOUR, horaires, PARIS) == ()

    def test_conversion_locale_vers_utc(self):
        fenetres = daily_windows(JOUR, toute_la_semaine(), PARIS)
        assert fenetres == (TimeSlot(local(8), local(20)),)

    def test_amplitude_de_nuit_se_referme_le_lendemain(self):
        horaires = toute_la_semaine(opens=time(22, 0), closes=time(2, 0))
        (fenetre,) = daily_windows(JOUR, horaires, PARIS)
        assert fenetre.duration == timedelta(hours=4)

    def test_amplitude_de_vingt_quatre_heures(self):
        """Ouverture et fermeture à la même heure : la salle ne ferme pas."""
        horaires = toute_la_semaine(opens=time(0, 0), closes=time(0, 0))
        (fenetre,) = daily_windows(JOUR, horaires, PARIS)
        assert fenetre.duration == timedelta(hours=24)


class TestChangementDHeure:
    def test_journee_de_printemps_dure_vingt_trois_heures(self):
        horaires = toute_la_semaine(opens=time(0, 0), closes=time(0, 0))
        (fenetre,) = daily_windows(PRINTEMPS, horaires, PARIS)
        assert fenetre.duration == timedelta(hours=23)

    def test_journee_d_automne_dure_vingt_cinq_heures(self):
        horaires = toute_la_semaine(opens=time(0, 0), closes=time(0, 0))
        (fenetre,) = daily_windows(AUTOMNE, horaires, PARIS)
        assert fenetre.duration == timedelta(hours=25)

    def test_creneau_a_cheval_sur_le_saut_ne_dure_qu_une_heure(self):
        """01:30–03:30 locale au printemps : 02:00 n'existe pas, il reste une heure."""
        creneau = TimeSlot(local(1, 30, day=PRINTEMPS), local(3, 30, day=PRINTEMPS))
        assert creneau.duration == timedelta(hours=1)

    def test_creneau_a_cheval_sur_l_heure_repetee_dure_trois_heures(self):
        """01:30–03:30 locale en automne : 02:00–03:00 est vécue deux fois."""
        creneau = TimeSlot(local(1, 30, day=AUTOMNE), local(3, 30, day=AUTOMNE))
        assert creneau.duration == timedelta(hours=3)

    def test_le_creneau_ne_disparait_ni_ne_se_duplique(self):
        """Une amplitude couvrant le saut reste une seule fenêtre continue."""
        horaires = toute_la_semaine(opens=time(0, 0), closes=time(6, 0))
        fenetres = daily_windows(PRINTEMPS, horaires, PARIS)
        assert len(fenetres) == 1
        assert fenetres[0].duration == timedelta(hours=5)


class TestOpenWindows:
    def test_periode_inversee_refusee(self):
        with pytest.raises(ValueError, match="précède"):
            open_windows(date(2026, 8, 26), JOUR, toute_la_semaine(), [], PARIS)

    def test_periode_d_un_jour(self):
        assert open_windows(JOUR, JOUR, toute_la_semaine(), [], PARIS) == (
            TimeSlot(local(8), local(20)),
        )

    def test_plusieurs_jours(self):
        fenetres = open_windows(
            JOUR, JOUR + timedelta(days=2), toute_la_semaine(), [], PARIS
        )
        assert len(fenetres) == 3

    def test_fermeture_supprime_la_journee(self, fermeture_du_jour):
        assert (
            open_windows(JOUR, JOUR, toute_la_semaine(), [fermeture_du_jour], PARIS)
            == ()
        )

    def test_fermeture_partielle_d_une_periode(self):
        fermeture = Closure(label="Pont", first_day=JOUR, last_day=JOUR)
        fenetres = open_windows(
            JOUR, JOUR + timedelta(days=1), toute_la_semaine(), [fermeture], PARIS
        )
        assert len(fenetres) == 1
        assert fenetres[0].start == local(8, day=JOUR + timedelta(days=1))

    def test_amplitude_de_la_veille_deborde_sur_la_periode(self):
        """Ouverte 22:00–02:00, la salle est encore ouverte au petit matin du jour demandé."""
        horaires = toute_la_semaine(opens=time(22, 0), closes=time(2, 0))
        fenetres = open_windows(JOUR, JOUR, horaires, [], PARIS)
        assert fenetres[0].start == local(0, 0)
        assert fenetres[0].end == local(2, 0)

    def test_la_fermeture_coupe_le_debordement_de_la_veille(self):
        horaires = toute_la_semaine(opens=time(22, 0), closes=time(2, 0))
        fenetres = open_windows(
            JOUR, JOUR, horaires, [Closure("Fermé", JOUR, JOUR)], PARIS
        )
        assert fenetres == ()

    def test_aucun_horaire_defini(self):
        assert open_windows(JOUR, JOUR, [], [], PARIS) == ()

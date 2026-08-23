"""Matrice exhaustive des chevauchements, alternatives et arbitrage."""

from __future__ import annotations

from datetime import timedelta
from uuid import uuid4

import pytest

from app.domain.conflicts import (
    DECALAGE_MAX,
    arbitration_brief,
    blocking,
    classify,
    describe,
    detect,
    has_blocking,
    propose_alternatives,
    qualify,
    report,
    seniority,
)
from app.domain.recommendation import score_room
from app.domain.types import (
    AlternativeKind,
    ClaimantFile,
    OverlapKind,
    SearchCriteria,
)
from tests.domain.conftest import PARIS, booking, room, slot, utc

#: Créneau demandé, référence de toute la matrice : 10:00–12:00 UTC.
CANDIDAT = slot(10, 0, 12)

#: Chaque ligne : nom du cas, créneau existant, type attendu, recouvrement et
#: écart en minutes. Les six types du sujet y figurent, plus « aucun ».
MATRICE = [
    pytest.param(slot(10, 0, 12), OverlapKind.IDENTIQUE, 120, 0, id="identique"),
    pytest.param(slot(9, 0, 13), OverlapKind.ENGLOBANT, 120, 0, id="englobant_strict"),
    pytest.param(slot(10, 0, 13), OverlapKind.ENGLOBANT, 120, 0, id="englobant_bord_debut"),
    pytest.param(slot(9, 0, 12), OverlapKind.ENGLOBANT, 120, 0, id="englobant_bord_fin"),
    pytest.param(slot(10, 30, 11, 30), OverlapKind.ENGLOBE, 60, 0, id="englobe_strict"),
    pytest.param(slot(10, 0, 11), OverlapKind.ENGLOBE, 60, 0, id="englobe_bord_debut"),
    pytest.param(slot(11, 0, 12), OverlapKind.ENGLOBE, 60, 0, id="englobe_bord_fin"),
    pytest.param(slot(9, 0, 11), OverlapKind.PARTIEL_DEBUT, 60, 0, id="partiel_debut"),
    pytest.param(slot(11, 0, 13), OverlapKind.PARTIEL_FIN, 60, 0, id="partiel_fin"),
    pytest.param(slot(8, 0, 10), OverlapKind.ADJACENT, 0, 0, id="adjacent_avant"),
    pytest.param(slot(12, 0, 14), OverlapKind.ADJACENT, 0, 0, id="adjacent_apres"),
    pytest.param(slot(8, 0, 9), OverlapKind.AUCUN, 0, 60, id="disjoint_avant"),
    pytest.param(slot(13, 0, 14), OverlapKind.AUCUN, 0, 60, id="disjoint_apres"),
    pytest.param(slot(12, 5, 13), OverlapKind.AUCUN, 0, 5, id="battement_court"),
]

BLOQUANTS = {
    OverlapKind.IDENTIQUE,
    OverlapKind.ENGLOBANT,
    OverlapKind.ENGLOBE,
    OverlapKind.PARTIEL_DEBUT,
    OverlapKind.PARTIEL_FIN,
}


class TestMatrice:
    @pytest.mark.parametrize(("existante", "attendu", "recouvre", "ecart"), MATRICE)
    def test_qualification(self, existante, attendu, recouvre, ecart):
        assert classify(CANDIDAT, existante) is attendu

    @pytest.mark.parametrize(("existante", "attendu", "recouvre", "ecart"), MATRICE)
    def test_mesures(self, existante, attendu, recouvre, ecart):
        conflit = qualify(CANDIDAT, booking(existante))
        assert conflit.overlap_minutes == recouvre
        assert conflit.gap_minutes == ecart

    @pytest.mark.parametrize(("existante", "attendu", "recouvre", "ecart"), MATRICE)
    def test_caractere_bloquant(self, existante, attendu, recouvre, ecart):
        conflit = qualify(CANDIDAT, booking(existante))
        assert conflit.is_blocking is (attendu in BLOQUANTS)

    def test_l_adjacence_n_est_pas_un_conflit(self):
        """Convention [début, fin[ : 14:00–15:00 et 15:00–16:00 sont compatibles."""
        assert not qualify(CANDIDAT, booking(slot(12, 0, 14))).is_blocking


class TestDetect:
    def test_tri_par_gravite_puis_par_heure(self):
        existantes = [
            booking(slot(11, 0, 13), "Partielle"),
            booking(slot(10, 0, 12), "Identique"),
            booking(slot(10, 30, 11), "Englobee"),
        ]
        titres = [item.existing.title for item in detect(CANDIDAT, existantes)]
        assert titres == ["Identique", "Englobee", "Partielle"]

    def test_les_reservations_lointaines_sont_ignorees(self):
        assert detect(CANDIDAT, [booking(slot(15, 0, 16))]) == ()

    def test_le_battement_elargit_la_fenetre(self):
        tardive = booking(slot(12, 5, 13), "Tardive")
        assert detect(CANDIDAT, [tardive]) == ()
        assert len(detect(CANDIDAT, [tardive], buffer=timedelta(minutes=15))) == 1

    def test_l_adjacence_remonte_sans_battement(self):
        """Jointive, elle doit être visible même si elle ne bloque pas."""
        conflits = detect(CANDIDAT, [booking(slot(8, 0, 10), "Jointive")])
        assert len(conflits) == 1
        assert conflits[0].kind is OverlapKind.ADJACENT

    def test_battement_negatif_refuse(self):
        with pytest.raises(ValueError, match="négatif"):
            detect(CANDIDAT, [], buffer=timedelta(minutes=-1))

    def test_aucune_reservation(self):
        assert detect(CANDIDAT, []) == ()


class TestBloquants:
    def test_filtre_et_predicat(self):
        conflits = detect(
            CANDIDAT,
            [booking(slot(10, 0, 12), "Prise"), booking(slot(12, 0, 13), "Jointive")],
        )
        assert has_blocking(conflits) is True
        assert [item.existing.title for item in blocking(conflits)] == ["Prise"]

    def test_aucun_bloquant(self):
        conflits = detect(CANDIDAT, [booking(slot(12, 0, 13), "Jointive")])
        assert has_blocking(conflits) is False
        assert blocking(conflits) == ()


class TestDescribe:
    @pytest.mark.parametrize(
        ("existante", "extrait"),
        [
            pytest.param(slot(10, 0, 12), "entièrement pris", id="identique"),
            pytest.param(slot(9, 0, 13), "couvre tout le créneau", id="englobant"),
            pytest.param(slot(10, 30, 11, 30), "occupe 1 h", id="englobe"),
            pytest.param(slot(9, 0, 11), "sur le début", id="partiel_debut"),
            pytest.param(slot(11, 0, 13), "sur la fin", id="partiel_fin"),
            pytest.param(slot(8, 0, 10), "jointive", id="adjacent"),
            pytest.param(slot(12, 5, 13), "5 min de battement", id="aucun"),
        ],
    )
    def test_phrase_par_type(self, existante, extrait):
        conflit = qualify(CANDIDAT, booking(existante, "Atelier"))
        phrase = describe(conflit, PARIS)
        assert extrait in phrase
        assert "Atelier" in phrase

    def test_les_heures_sont_affichees_en_local(self):
        """Stocké en UTC, affiché en heure de Paris : 10:00 UTC devient 12:00."""
        conflit = qualify(CANDIDAT, booking(slot(10, 0, 12), "Atelier"))
        assert "12:00–14:00" in describe(conflit, PARIS)

    def test_rapport_complet(self):
        conflits = detect(CANDIDAT, [booking(slot(10, 0, 12)), booking(slot(12, 0, 13))])
        assert len(report(conflits, PARIS)) == 2


class TestSeniority:
    def test_la_plus_ancienne_demande_l_emporte(self):
        vieille = booking(slot(10, 0, 12), "Lundi", created_at=utc(8))
        recente = booking(slot(11, 0, 13), "Mardi", created_at=utc(9))
        conflits = detect(CANDIDAT, [recente, vieille])
        assert seniority(conflits).title == "Lundi"

    def test_aucun_conflit_bloquant(self):
        assert seniority(detect(CANDIDAT, [booking(slot(12, 0, 13))])) is None

    def test_conflit_sans_date_de_creation(self):
        assert seniority(detect(CANDIDAT, [booking(slot(10, 0, 12))])) is None


class TestAlternatives:
    def test_meme_salle_a_un_autre_creneau(self):
        salle = room("Vinci")
        (proposition,) = propose_alternatives(
            CANDIDAT, salle, same_room_free=[slot(13, 0, 18)], tz=PARIS
        )
        assert proposition.kind is AlternativeKind.MEME_SALLE_AUTRE_CRENEAU
        assert proposition.slot == slot(13, 0, 15)
        assert proposition.room_id == salle.id
        assert "Vinci" in proposition.justification

    def test_le_report_colle_a_l_heure_visee(self):
        """Un trou qui englobe l'heure demandée n'entraîne aucun décalage utile."""
        salle = room("Vinci")
        assert propose_alternatives(
            CANDIDAT, salle, same_room_free=[slot(8, 0, 18)], tz=PARIS
        ) == ()

    def test_trou_trop_court_ecarte(self):
        assert propose_alternatives(
            CANDIDAT, room(), same_room_free=[slot(13, 0, 13, 30)], tz=PARIS
        ) == ()

    def test_autre_salle_au_meme_creneau(self):
        visee, autre = room("Vinci"), room("Curie")
        critere = SearchCriteria(attendees=10)
        (proposition,) = propose_alternatives(
            CANDIDAT, visee, other_rooms=[(autre, score_room(autre, critere))], tz=PARIS
        )
        assert proposition.kind is AlternativeKind.AUTRE_SALLE_MEME_CRENEAU
        assert proposition.slot == CANDIDAT
        assert "Curie" in proposition.justification

    def test_la_salle_visee_ne_se_propose_pas_elle_meme(self):
        visee = room("Vinci")
        critere = SearchCriteria(attendees=10)
        assert propose_alternatives(
            CANDIDAT, visee, other_rooms=[(visee, score_room(visee, critere))], tz=PARIS
        ) == ()

    def test_salle_et_creneau_proches(self):
        visee, autre = room("Vinci"), room("Curie")
        critere = SearchCriteria(attendees=10)
        (proposition,) = propose_alternatives(
            CANDIDAT,
            visee,
            nearby=[(autre, slot(14, 0, 16), score_room(autre, critere))],
            tz=PARIS,
        )
        assert proposition.kind is AlternativeKind.PROCHE
        assert "de décalage" in proposition.justification

    def test_une_proposition_identique_est_ecartee(self):
        visee = room("Vinci")
        critere = SearchCriteria(attendees=10)
        assert propose_alternatives(
            CANDIDAT, visee, nearby=[(visee, CANDIDAT, score_room(visee, critere))], tz=PARIS
        ) == ()

    def test_le_decalage_au_dela_de_l_horizon_ne_vaut_rien(self):
        salle = room("Vinci")
        (proposition,) = propose_alternatives(
            CANDIDAT, salle, same_room_free=[CANDIDAT.shifted(DECALAGE_MAX)], tz=PARIS
        )
        assert proposition.score == 0

    def test_les_trois_familles_sur_une_meme_echelle(self):
        visee, autre = room("Vinci"), room("Curie")
        critere = SearchCriteria(attendees=10)
        propositions = propose_alternatives(
            CANDIDAT,
            visee,
            same_room_free=[slot(13, 0, 18)],
            other_rooms=[(autre, score_room(autre, critere))],
            nearby=[(autre, slot(16, 0, 18), score_room(autre, critere))],
            tz=PARIS,
        )
        assert {item.kind for item in propositions} == set(AlternativeKind)
        assert list(propositions) == sorted(propositions, key=lambda item: -item.score)

    def test_limite(self):
        visee = room("Vinci")
        critere = SearchCriteria(attendees=10)
        autres = [(room(f"Salle {i}"), score_room(room(f"Salle {i}"), critere)) for i in range(6)]
        assert len(propose_alternatives(CANDIDAT, visee, other_rooms=autres, tz=PARIS, limit=3)) == 3

    def test_aucune_source(self):
        assert propose_alternatives(CANDIDAT, room(), tz=PARIS) == ()


class TestArbitrage:
    def test_tri_par_anteriorite(self):
        premier = ClaimantFile(user_id=uuid4(), requested_at=utc(8), display_name="Premier")
        second = ClaimantFile(user_id=uuid4(), requested_at=utc(9), display_name="Second")
        brief = arbitration_brief(CANDIDAT, uuid4(), [second, premier], tz=PARIS)
        assert [item.display_name for item in brief.claimants] == ["Premier", "Second"]

    def test_les_trois_criteres_sont_exposes_separement(self):
        dossiers = [
            ClaimantFile(
                user_id=uuid4(), requested_at=utc(8), active_bookings=2,
                max_active_bookings=10, no_show_rate=0.05, display_name="Premier",
            ),
            ClaimantFile(
                user_id=uuid4(), requested_at=utc(9), active_bookings=8,
                max_active_bookings=10, no_show_rate=0.30, display_name="Second",
            ),
        ]
        brief = arbitration_brief(CANDIDAT, uuid4(), dossiers, tz=PARIS)

        assert [item.key for item in brief.claimants[0].factors] == [
            "anteriorite",
            "quota",
            "absence",
        ]
        assert all(item.favours is True for item in brief.claimants[0].factors)
        assert all(item.favours is False for item in brief.claimants[1].factors)

    def test_aucun_score_global_n_est_calcule(self):
        """La décision reste humaine : le domaine informe, il ne tranche pas."""
        brief = arbitration_brief(
            CANDIDAT,
            uuid4(),
            [ClaimantFile(user_id=uuid4(), requested_at=utc(8))],
            tz=PARIS,
        )
        assert not hasattr(brief, "winner")
        assert not hasattr(brief.claimants[0], "score")

    def test_critere_qui_ne_departage_pas(self):
        dossiers = [
            ClaimantFile(user_id=uuid4(), requested_at=utc(8), active_bookings=2, no_show_rate=0.1),
            ClaimantFile(user_id=uuid4(), requested_at=utc(8), active_bookings=2, no_show_rate=0.1),
        ]
        brief = arbitration_brief(CANDIDAT, uuid4(), dossiers, tz=PARIS)
        assert all(
            item.favours is None for dossier in brief.claimants for item in dossier.factors
        )

    def test_quota_illimite(self):
        """Un quota nul ne provoque pas de division par zéro."""
        dossiers = [
            ClaimantFile(user_id=uuid4(), requested_at=utc(8), max_active_bookings=0),
            ClaimantFile(user_id=uuid4(), requested_at=utc(9), max_active_bookings=0),
        ]
        brief = arbitration_brief(CANDIDAT, uuid4(), dossiers, tz=PARIS)
        quota = brief.claimants[0].factors[1]
        assert quota.value == 0.0
        assert quota.favours is None

    def test_detail_en_francais(self):
        dossier = ClaimantFile(
            user_id=uuid4(), requested_at=utc(8), active_bookings=7,
            max_active_bookings=10, no_show_rate=0.12,
        )
        brief = arbitration_brief(CANDIDAT, uuid4(), [dossier], tz=PARIS)
        details = [item.detail for item in brief.claimants[0].factors]
        assert "25/08/2026 à 10:00" in details[0]
        assert "7 réservations actives sur 10" in details[1]
        assert "12 % d'absences" in details[2]

    def test_aucun_pretendant(self):
        brief = arbitration_brief(CANDIDAT, uuid4(), [], tz=PARIS)
        assert brief.claimants == ()

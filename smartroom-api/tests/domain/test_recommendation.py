"""Scoring pondéré, éligibilité et justification explicable."""

from __future__ import annotations

from dataclasses import replace
from uuid import uuid4

import pytest

from app.domain.recommendation import (
    DEFAULT_WEIGHTS,
    HISTORIQUE_PLEIN,
    NEUTRE,
    Weights,
    building_fit,
    capacity_fit,
    eligibility_issues,
    equipment_fit,
    evaluate_room,
    floor_fit,
    history_fit,
    is_eligible,
    justify,
    occupancy_fit,
    rank,
    score_room,
)
from app.domain.types import Score, SearchCriteria
from tests.domain.conftest import room, user

VIDEO, TABLEAU, ECRAN = uuid4(), uuid4(), uuid4()
BATIMENT, ANNEXE = uuid4(), uuid4()


class TestPonderations:
    def test_les_poids_totalisent_cent(self):
        cles = ("capacity", "equipment", "building", "floor", "occupancy", "history")
        assert sum(DEFAULT_WEIGHTS.of(cle) for cle in cles) == 100

    @pytest.mark.parametrize(
        "modification",
        [
            pytest.param({"capacity": 99}, id="trop"),
            pytest.param({"history": 0}, id="pas_assez"),
        ],
    )
    def test_une_somme_differente_est_refusee(self, modification):
        with pytest.raises(ValueError, match="totaliser 100"):
            Weights(**modification)

    def test_les_poids_se_modifient_sans_toucher_a_l_algorithme(self):
        """Doubler la capacité au détriment du matériel change le classement."""
        autres = Weights(
            capacity=55, equipment=0, building=15, floor=10, occupancy=12, history=8
        )
        petite = room("Petite", capacity=10, equipment_ids=frozenset())
        critere = SearchCriteria(attendees=10, equipment_ids=frozenset({VIDEO}))
        assert (
            score_room(petite, critere, weights=autres).total
            > score_room(petite, critere).total
        )


class TestCapacite:
    @pytest.mark.parametrize(
        ("effectif", "capacite", "attendu"),
        [
            pytest.param(10, 10, 1.0, id="exactement_pleine"),
            pytest.param(
                10,
                12,
                pytest.approx(0.958, abs=0.01),
                id="leger_surdimensionnement_tolere",
            ),
            pytest.param(10, 60, pytest.approx(0.19, abs=0.01), id="surdimensionnee"),
            pytest.param(20, 12, 0.0, id="sous_capacite_eliminatoire"),
            pytest.param(None, 12, 0.8, id="effectif_inconnu"),
            pytest.param(0, 0, 0.0, id="salle_sans_place"),
        ],
    )
    def test_ajustement(self, effectif, capacite, attendu):
        assert capacity_fit(effectif, capacite) == attendu

    def test_la_grande_salle_est_penalisee(self):
        critere = SearchCriteria(attendees=10)
        assert (
            score_room(room(capacity=12), critere).total
            > score_room(room(capacity=60), critere).total
        )


class TestEquipements:
    @pytest.mark.parametrize(
        ("exiges", "presents", "attendu"),
        [
            pytest.param(frozenset(), frozenset(), 1.0, id="aucune_exigence"),
            pytest.param(
                frozenset({VIDEO}), frozenset({VIDEO}), 1.0, id="tout_present"
            ),
            pytest.param(
                frozenset({VIDEO, TABLEAU}),
                frozenset({VIDEO}),
                0.5,
                id="moitie_presente",
            ),
            pytest.param(frozenset({VIDEO}), frozenset(), 0.0, id="rien_present"),
        ],
    )
    def test_proportion(self, exiges, presents, attendu):
        assert equipment_fit(exiges, presents) == attendu


class TestBatimentEtEtage:
    def test_batiment_demande_prime_sur_l_habituel(self):
        salle = room(building_id=BATIMENT)
        profil = user(preferred_building_id=ANNEXE)
        assert building_fit(salle, SearchCriteria(building_id=BATIMENT), profil) == 1.0

    def test_batiment_habituel_a_defaut(self):
        salle = room(building_id=ANNEXE)
        assert (
            building_fit(salle, SearchCriteria(), user(preferred_building_id=ANNEXE))
            == 1.0
        )

    def test_autre_batiment(self):
        salle = room(building_id=ANNEXE)
        assert building_fit(salle, SearchCriteria(building_id=BATIMENT), None) == 0.0

    def test_aucune_reference_reste_neutre(self):
        assert building_fit(room(), SearchCriteria(), None) == NEUTRE

    @pytest.mark.parametrize(
        ("etage", "attendu"),
        [
            pytest.param(2, 1.0, id="meme_etage"),
            pytest.param(3, 0.5, id="un_etage"),
            pytest.param(4, pytest.approx(0.33, abs=0.01), id="deux_etages"),
            pytest.param(0, pytest.approx(0.33, abs=0.01), id="deux_etages_en_dessous"),
        ],
    )
    def test_proximite_d_etage(self, etage, attendu):
        assert (
            floor_fit(room(floor_level=etage), user(preferred_floor_level=2)) == attendu
        )

    @pytest.mark.parametrize(
        "profil", [None, user()], ids=["sans_profil", "sans_preference"]
    )
    def test_etage_sans_reference_reste_neutre(self, profil):
        assert floor_fit(room(), profil) == NEUTRE


class TestOccupationEtHistorique:
    @pytest.mark.parametrize(
        ("taux", "attendu"),
        [
            pytest.param(0.0, 1.0, id="jamais_reservee"),
            pytest.param(0.25, 0.75, id="peu_sollicitee"),
            pytest.param(1.0, 0.0, id="saturee"),
            pytest.param(1.5, 0.0, id="taux_aberrant_ecrete"),
            pytest.param(-0.5, 1.0, id="taux_negatif_ecrete"),
        ],
    )
    def test_occupation(self, taux, attendu):
        assert occupancy_fit(room(occupancy_rate=taux)) == attendu

    def test_favoriser_les_salles_sous_utilisees(self):
        """L'objectif métier du sujet : mieux répartir l'usage des espaces."""
        critere = SearchCriteria(attendees=10)
        libre = room("Libre", capacity=12, occupancy_rate=0.05)
        saturee = room("Saturee", capacity=12, occupancy_rate=0.95)
        assert score_room(libre, critere).total > score_room(saturee, critere).total

    def test_historique(self):
        salle = room()
        assert (
            history_fit(salle, user(booked_room_counts={salle.id: HISTORIQUE_PLEIN}))
            == 1.0
        )
        assert history_fit(
            salle, user(booked_room_counts={salle.id: 1})
        ) == pytest.approx(1 / 3)
        assert history_fit(salle, user(booked_room_counts={uuid4(): 5})) == 0.0

    @pytest.mark.parametrize(
        "profil", [None, user()], ids=["sans_profil", "sans_historique"]
    )
    def test_historique_sans_reference_reste_neutre(self, profil):
        assert history_fit(room(), profil) == NEUTRE


class TestScore:
    def test_six_composantes(self):
        score = score_room(room(), SearchCriteria(attendees=10))
        assert [item.key for item in score.components] == [
            "capacity",
            "equipment",
            "building",
            "floor",
            "occupancy",
            "history",
        ]

    def test_le_total_ne_depasse_jamais_cent(self):
        parfaite = room(
            capacity=10,
            building_id=BATIMENT,
            floor_level=2,
            equipment_ids=frozenset({VIDEO}),
            occupancy_rate=0.0,
        )
        critere = SearchCriteria(
            attendees=10, equipment_ids=frozenset({VIDEO}), building_id=BATIMENT
        )
        profil = user(preferred_floor_level=2, booked_room_counts={parfaite.id: 5})
        assert score_room(parfaite, critere, profil).total == 100

    def test_details_construits_depuis_les_donnees(self):
        salle = room(capacity=12, occupancy_rate=0.37)
        critere = SearchCriteria(attendees=10)
        details = {
            item.key: item.detail for item in score_room(salle, critere).components
        }
        assert details["capacity"] == "12 places pour 10 personnes"
        assert details["occupancy"] == "occupée à 37 %"
        assert details["equipment"] == "aucun équipement imposé"

    def test_details_sans_reference(self):
        details = {
            item.key: item.detail
            for item in score_room(room(), SearchCriteria()).components
        }
        assert details["capacity"].endswith("effectif non précisé")
        assert details["building"] == "aucun bâtiment de préférence"
        assert details["floor"] == "aucun étage de préférence"
        assert details["history"] == "aucun historique"

    @pytest.mark.parametrize(
        ("fois", "attendu"),
        [
            pytest.param(0, "jamais réservée", id="jamais"),
            pytest.param(1, "déjà réservée une fois", id="une_fois"),
            pytest.param(4, "déjà réservée 4 fois", id="plusieurs_fois"),
        ],
    )
    def test_detail_de_l_historique(self, fois, attendu):
        salle = room()
        profil = user(booked_room_counts={salle.id: fois} if fois else {uuid4(): 1})
        detail = score_room(salle, SearchCriteria(), profil).get("history").detail
        assert detail == attendu

    @pytest.mark.parametrize(
        ("ecart", "attendu"),
        [
            pytest.param(0, "même étage", id="meme_etage"),
            pytest.param(1, "1 étage d'écart", id="singulier"),
            pytest.param(3, "3 étages d'écart", id="pluriel"),
        ],
    )
    def test_detail_de_l_etage(self, ecart, attendu):
        salle = room(floor_level=2 + ecart)
        detail = score_room(salle, SearchCriteria(), user(preferred_floor_level=2)).get(
            "floor"
        )
        assert detail.detail == attendu


class TestEligibilite:
    def test_salle_conforme(self):
        salle = room(capacity=12, equipment_ids=frozenset({VIDEO}), is_accessible=True)
        critere = SearchCriteria(
            attendees=10, equipment_ids=frozenset({VIDEO}), accessible_only=True
        )
        assert eligibility_issues(salle, critere) == ()
        assert is_eligible(salle, critere) is True

    @pytest.mark.parametrize(
        ("salle", "critere", "extrait"),
        [
            pytest.param(
                room(capacity=4),
                SearchCriteria(attendees=10),
                "capacité insuffisante",
                id="sous_capacite",
            ),
            pytest.param(
                room(is_available=False),
                SearchCriteria(),
                "salle indisponible",
                id="maintenance",
            ),
            pytest.param(
                room(),
                SearchCriteria(equipment_ids=frozenset({VIDEO})),
                "1 équipement manquant",
                id="un_equipement",
            ),
            pytest.param(
                room(),
                SearchCriteria(equipment_ids=frozenset({VIDEO, TABLEAU})),
                "2 équipements manquants",
                id="plusieurs_equipements",
            ),
            pytest.param(
                room(is_accessible=False),
                SearchCriteria(accessible_only=True),
                "accès PMR absent",
                id="pmr",
            ),
        ],
    )
    def test_motifs(self, salle, critere, extrait):
        assert extrait in " ".join(eligibility_issues(salle, critere))
        assert is_eligible(salle, critere) is False

    def test_materiel_en_preference_n_elimine_pas(self):
        critere = SearchCriteria(
            equipment_ids=frozenset({VIDEO}), equipment_strict=False
        )
        assert eligibility_issues(room(), critere) == ()


class TestJustification:
    def test_les_deux_criteres_forts_forment_la_phrase(self):
        salle = room(
            capacity=12, building_id=BATIMENT, equipment_ids=frozenset({VIDEO})
        )
        critere = SearchCriteria(
            attendees=10, equipment_ids=frozenset({VIDEO}), building_id=BATIMENT
        )
        phrase = justify(score_room(salle, critere))
        assert phrase.endswith(".")
        assert phrase[0].isupper()

    def test_la_reserve_ne_repete_pas_le_critere(self):
        salle = room(capacity=12, building_id=ANNEXE, equipment_ids=frozenset({VIDEO}))
        critere = SearchCriteria(
            attendees=10, equipment_ids=frozenset({VIDEO}), building_id=BATIMENT
        )
        phrase = justify(score_room(salle, critere))
        assert "réserve : autre bâtiment" in phrase
        assert "bâtiment, autre bâtiment" not in phrase

    def test_la_reserve_nomme_le_critere_quand_le_detail_ne_le_fait_pas(self):
        salle = room(
            capacity=60, building_id=BATIMENT, equipment_ids=frozenset({VIDEO})
        )
        critere = SearchCriteria(
            attendees=10, equipment_ids=frozenset({VIDEO}), building_id=BATIMENT
        )
        assert "réserve : capacité, 60 places" in justify(score_room(salle, critere))

    def test_aucune_reserve_quand_tout_est_correct(self):
        salle = room(
            capacity=12,
            building_id=BATIMENT,
            equipment_ids=frozenset({VIDEO}),
            occupancy_rate=0.05,
        )
        critere = SearchCriteria(
            attendees=10, equipment_ids=frozenset({VIDEO}), building_id=BATIMENT
        )
        assert "réserve" not in justify(score_room(salle, critere))

    @pytest.mark.parametrize(
        ("critere", "extrait"),
        [
            pytest.param(
                SearchCriteria(attendees=10),
                "Sans contrainte matérielle",
                id="sans_materiel",
            ),
            pytest.param(
                SearchCriteria(attendees=10, equipment_ids=frozenset({VIDEO})),
                "Tous les équipements demandés",
                id="materiel_complet",
            ),
            pytest.param(
                SearchCriteria(
                    attendees=10, equipment_ids=frozenset({VIDEO, TABLEAU, ECRAN})
                ),
                "La plupart des équipements (2/3 demandés présents)",
                id="materiel_partiel",
            ),
        ],
    )
    def test_phrase_du_materiel(self, critere, extrait):
        """Salle vaste et saturée : le matériel est le seul critère qui ressort."""
        salle = room(
            capacity=60, occupancy_rate=0.95, equipment_ids=frozenset({VIDEO, TABLEAU})
        )
        assert extrait in justify(score_room(salle, critere))

    def test_phrase_de_l_etage(self):
        salle = room(capacity=12, floor_level=2, equipment_ids=frozenset({VIDEO}))
        critere = SearchCriteria(attendees=10, equipment_ids=frozenset({VIDEO}))
        phrase = justify(score_room(salle, critere, user(preferred_floor_level=2)))
        assert "au même étage" in phrase or "tous les équipements" in phrase

        eloignee = room(capacity=12, floor_level=3, equipment_ids=frozenset({VIDEO}))
        profil = user(preferred_floor_level=2, booked_room_counts={eloignee.id: 9})
        assert "proche (1 étage d'écart)" in justify(
            score_room(eloignee, critere, profil)
        ) or "salle habituelle" in justify(score_room(eloignee, critere, profil))

    def test_phrase_de_l_habitude(self):
        salle = room(capacity=60)
        profil = user(booked_room_counts={salle.id: 9})
        assert "salle habituelle" in justify(
            score_room(salle, SearchCriteria(attendees=1), profil)
        )

    def test_compromis_quand_aucun_critere_ne_ressort(self):
        salle = room(capacity=60, building_id=ANNEXE, occupancy_rate=0.9)
        critere = SearchCriteria(
            attendees=2, equipment_ids=frozenset({VIDEO}), building_id=BATIMENT
        )
        profil = user(preferred_floor_level=99, booked_room_counts={uuid4(): 1})
        assert justify(score_room(salle, critere, profil)).startswith("Compromis :")

    def test_empechement_annonce_en_dernier(self):
        salle = room(capacity=12, equipment_ids=frozenset({VIDEO}))
        critere = SearchCriteria(attendees=10, equipment_ids=frozenset({VIDEO}))
        phrase = justify(score_room(salle, critere), "créneau déjà pris")
        assert phrase.endswith("Indisponible : créneau déjà pris")

    @pytest.mark.parametrize(
        ("empechement", "attendu"),
        [
            pytest.param(None, "Aucun critère renseigné.", id="sans_empechement"),
            pytest.param(
                "salle fermée", "Indisponible : salle fermée", id="avec_empechement"
            ),
        ],
    )
    def test_score_vide(self, empechement, attendu):
        assert justify(Score(), empechement) == attendu

    def test_deux_jeux_de_donnees_deux_phrases(self):
        """Rien n'est figé : la justification suit les données du moment."""
        salle = room(
            capacity=12, building_id=BATIMENT, equipment_ids=frozenset({VIDEO})
        )
        critere = SearchCriteria(equipment_ids=frozenset({VIDEO}), building_id=BATIMENT)
        libre = justify(score_room(replace(salle, occupancy_rate=0.05), critere))
        saturee = justify(score_room(replace(salle, occupancy_rate=0.95), critere))
        assert libre != saturee
        assert "occupée à 95 %" in saturee


class TestEvaluateEtRank:
    def test_salle_eligible(self):
        salle = room(capacity=12, equipment_ids=frozenset({VIDEO}))
        critere = SearchCriteria(attendees=10, equipment_ids=frozenset({VIDEO}))
        evaluee = evaluate_room(salle, critere)
        assert evaluee.eligible is True
        assert evaluee.blockers == ()

    def test_empechement_externe_rend_ineligible(self):
        """Un conflit de créneau n'est pas visible du scoring : l'appelant le fournit."""
        salle = room(capacity=12)
        evaluee = evaluate_room(
            salle, SearchCriteria(attendees=10), blocker="créneau pris"
        )
        assert evaluee.eligible is False
        assert "créneau pris" in evaluee.justification

    def test_les_eligibles_passent_devant_quel_que_soit_le_score(self):
        occupee = room(
            "Occupee",
            capacity=12,
            building_id=BATIMENT,
            equipment_ids=frozenset({VIDEO}),
            occupancy_rate=0.0,
        )
        libre = room(
            "Libre",
            capacity=40,
            building_id=ANNEXE,
            equipment_ids=frozenset({VIDEO}),
            occupancy_rate=0.5,
        )
        critere = SearchCriteria(
            attendees=10, equipment_ids=frozenset({VIDEO}), building_id=BATIMENT
        )

        classement = rank(
            [occupee, libre], critere, blockers={occupee.id: "déjà prise"}
        )
        assert [item.room.name for item in classement] == ["Libre", "Occupee"]
        assert classement[1].score.total > classement[0].score.total

    def test_egalite_departagee_par_la_capacite_puis_le_nom(self):
        critere = SearchCriteria()
        petite = room("Zeta", capacity=10)
        grande = room("Alpha", capacity=10)
        classement = rank([petite, grande], critere)
        assert [item.room.name for item in classement] == ["Alpha", "Zeta"]

    def test_limite(self):
        salles = [room(f"Salle {i}", capacity=10 + i) for i in range(5)]
        assert len(rank(salles, SearchCriteria(), limit=2)) == 2

    def test_sans_limite(self):
        salles = [room(f"Salle {i}") for i in range(4)]
        assert len(rank(salles, SearchCriteria())) == 4

    def test_parc_vide(self):
        assert rank([], SearchCriteria()) == ()

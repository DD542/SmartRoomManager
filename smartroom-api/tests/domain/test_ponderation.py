"""Non-régression du moteur de recommandation.

Le but n'est pas de figer un classement — il changera, et c'est sain — mais de
rendre **visible** tout changement de pondération. Sans le verrou de
`TestTablePonderation`, modifier un poids ne casse rien : le moteur continue de
classer, la suite reste verte, et le comportement du produit dérive sans que
personne ne l'ait décidé.

Chaque critère a ensuite son scénario, construit sur deux salles qui ne
diffèrent que par lui. Un scénario qui varierait deux axes à la fois
n'apprendrait rien : on ne saurait pas lequel a tranché.
"""

from __future__ import annotations

from dataclasses import fields
from uuid import uuid4

import pytest

from app.domain.recommendation import DEFAULT_WEIGHTS, Weights, rank, score_room
from app.domain.types import SearchCriteria
from tests.domain.conftest import room, user

#: La table de référence. Toute modification d'un poids fait échouer ce test,
#: et le diff montre exactement ce qui a bougé. C'est le seul endroit du dépôt
#: où ces six nombres sont écrits deux fois, et c'est délibéré.
POIDS_ATTENDUS = {
    "capacity": 30,
    "equipment": 25,
    "building": 15,
    "floor": 10,
    "occupancy": 12,
    "history": 8,
}


class TestTablePonderation:
    def test_les_six_poids_sont_ceux_attendus(self):
        poids = DEFAULT_WEIGHTS
        releve = {champ.name: getattr(poids, champ.name) for champ in fields(poids)}
        assert releve == POIDS_ATTENDUS

    def test_la_somme_vaut_exactement_cent(self):
        """Un score qui ne totalise pas 100 n'est plus un pourcentage."""
        assert sum(POIDS_ATTENDUS.values()) == 100

    def test_aucun_critere_n_a_ete_ajoute_ni_retire(self):
        """Un septième critère passerait inaperçu du test précédent si les
        poids restaient à somme constante."""
        assert {champ.name for champ in fields(Weights)} == set(POIDS_ATTENDUS)

    def test_une_ponderation_qui_ne_totalise_pas_cent_est_refusee(self):
        with pytest.raises(ValueError, match="100"):
            Weights(capacity=31)


class TestClassementParCritere:
    """Deux salles, un seul axe de différence, un ordre attendu."""

    def test_la_capacite_ajustee_devance_le_surdimensionnement(self):
        ajustee = room("Ajustée", capacity=6)
        vaste = room("Vaste", capacity=60)
        criteres = SearchCriteria(attendees=5)

        classement = rank([vaste, ajustee], criteres)
        assert [item.room.name for item in classement] == ["Ajustée", "Vaste"]

    def test_la_salle_equipee_devance_la_salle_nue(self):
        video = uuid4()
        equipee = room("Équipée", equipment_ids=frozenset({video}))
        nue = room("Nue")
        criteres = SearchCriteria(
            equipment_ids=frozenset({video}), equipment_strict=False
        )

        classement = rank([nue, equipee], criteres)
        assert [item.room.name for item in classement] == ["Équipée", "Nue"]

    def test_le_batiment_prefere_devance_les_autres(self):
        prefere = uuid4()
        proche = room("Proche", building_id=prefere)
        lointaine = room("Lointaine", building_id=uuid4())
        criteres = SearchCriteria()

        classement = rank(
            [lointaine, proche], criteres, user(preferred_building_id=prefere)
        )
        assert [item.room.name for item in classement] == ["Proche", "Lointaine"]

    def test_l_etage_prefere_devance_les_autres(self):
        batiment = uuid4()
        au_bon_etage = room("Bon étage", building_id=batiment, floor_level=3)
        ailleurs = room("Autre étage", building_id=batiment, floor_level=7)
        criteres = SearchCriteria()

        classement = rank(
            [ailleurs, au_bon_etage],
            criteres,
            user(preferred_building_id=batiment, preferred_floor_level=3),
        )
        assert [item.room.name for item in classement] == ["Bon étage", "Autre étage"]

    def test_la_salle_peu_occupee_devance_la_salle_saturee(self):
        libre = room("Peu occupée", occupancy_rate=0.05)
        saturee = room("Saturée", occupancy_rate=0.95)
        criteres = SearchCriteria()

        classement = rank([saturee, libre], criteres)
        assert [item.room.name for item in classement] == ["Peu occupée", "Saturée"]

    def test_la_salle_deja_reservee_devance_l_inconnue(self):
        habituelle = room("Habituelle")
        inconnue = room("Inconnue")
        criteres = SearchCriteria()

        classement = rank(
            [inconnue, habituelle],
            criteres,
            user(booked_room_counts={habituelle.id: 6}),
        )
        assert [item.room.name for item in classement] == ["Habituelle", "Inconnue"]


class TestHierarchieDesCriteres:
    """Le classement relatif des poids, vérifié par le comportement.

    Ces cas tomberaient aussi si l'on permutait deux poids sans changer leur
    somme — ce que le verrou de la table détecte, mais avec un message moins
    parlant qu'un ordre de classement inversé.
    """

    def test_la_capacite_pese_plus_que_les_equipements(self):
        video = uuid4()
        criteres = SearchCriteria(
            attendees=5, equipment_ids=frozenset({video}), equipment_strict=False
        )
        ajustee_sans_video = room("Ajustée", capacity=6)
        vaste_avec_video = room("Vaste", capacity=60, equipment_ids=frozenset({video}))

        classement = rank([vaste_avec_video, ajustee_sans_video], criteres)
        assert classement[0].room.name == "Ajustée"

    def test_les_equipements_pesent_plus_que_le_batiment(self):
        video = uuid4()
        prefere = uuid4()
        criteres = SearchCriteria(
            equipment_ids=frozenset({video}), equipment_strict=False
        )
        equipee_ailleurs = room("Équipée", equipment_ids=frozenset({video}))
        nue_au_bon_endroit = room("Nue", building_id=prefere)

        classement = rank(
            [nue_au_bon_endroit, equipee_ailleurs],
            criteres,
            user(preferred_building_id=prefere),
        )
        assert classement[0].room.name == "Équipée"

    def test_le_batiment_pese_plus_que_l_etage(self):
        prefere = uuid4()
        criteres = SearchCriteria()
        bon_batiment = room("Bon bâtiment", building_id=prefere, floor_level=9)
        bon_etage = room("Bon étage", building_id=uuid4(), floor_level=3)

        classement = rank(
            [bon_etage, bon_batiment],
            criteres,
            user(preferred_building_id=prefere, preferred_floor_level=3),
        )
        assert classement[0].room.name == "Bon bâtiment"


class TestScoreBorne:
    def test_le_score_ne_depasse_jamais_cent(self):
        """Salle parfaite sur les six axes : le plafond tient."""
        video = uuid4()
        batiment = uuid4()
        parfaite = room(
            "Parfaite",
            capacity=5,
            building_id=batiment,
            floor_level=2,
            equipment_ids=frozenset({video}),
            occupancy_rate=0.0,
        )
        score = score_room(
            parfaite,
            SearchCriteria(attendees=5, equipment_ids=frozenset({video})),
            user(
                preferred_building_id=batiment,
                preferred_floor_level=2,
                booked_room_counts={parfaite.id: 10},
            ),
        )
        assert 0 <= score.total <= 100

    def test_le_score_ne_descend_jamais_sous_zero(self):
        """Salle mauvaise partout : le plancher tient."""
        mediocre = room("Médiocre", capacity=200, occupancy_rate=1.0)
        score = score_room(
            mediocre,
            SearchCriteria(attendees=2, equipment_ids=frozenset({uuid4()})),
            user(preferred_building_id=uuid4(), preferred_floor_level=0),
        )
        assert 0 <= score.total <= 100

    def test_la_somme_des_composantes_egale_le_total(self):
        """Un total qui ne se recompose pas rendrait la justification fausse."""
        score = score_room(room("Quelconque"), SearchCriteria(attendees=8))
        assert sum(part.points for part in score.components) == score.total

    def test_chaque_composante_reste_dans_son_plafond(self):
        score = score_room(room("Quelconque"), SearchCriteria(attendees=8))
        for part in score.components:
            assert 0 <= part.points <= part.max_points

    def test_les_plafonds_des_composantes_sont_les_poids(self):
        """Le lien entre la table et ce qu'affiche l'écran de justification."""
        score = score_room(room("Quelconque"), SearchCriteria(attendees=8))
        assert sum(part.max_points for part in score.components) == 100

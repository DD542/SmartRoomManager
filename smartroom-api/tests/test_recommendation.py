"""Tests du moteur de recommandation.

Ce qui est vérifié ici n'est pas « le score est correct » — un score est une
convention — mais que le classement se comporte comme le sujet l'exige : la
salle la plus ajustée passe devant, une salle prise ne se recommande pas, et la
justification dit la vérité sur les données du moment.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
from sqlalchemy.orm import Session

from app.db.enums import EquipmentCategory, RoomStatus
from app.models import Building, Equipment, Floor, Room, RoomEquipment
from app.services.recommendation import (
    WEIGHTS,
    Need,
    best_room,
    capacity_fit,
    construire_justification,
    equipment_fit,
    noter,
    rank_rooms,
    suggest_alternatives,
)
from tests.conftest import creneau


# --------------------------------------------------------------------------- #
# Un petit parc dédié, isolé des seeds
# --------------------------------------------------------------------------- #


@pytest.fixture
def parc(session: Session):
    """Deux bâtiments, quatre salles de tailles et d'équipements différents."""
    marque = uuid.uuid4().hex[:6]
    # Le code bâtiment est contraint à ^[A-Z0-9]{1,4}$ : on prend les chiffres.
    court = "".join(c for c in marque if c.isdigit())[:3] or "1"

    principal = Building(code=f"R{court}", name=f"Campus recommandation {marque}")
    annexe = Building(code=f"S{court}", name=f"Annexe recommandation {marque}")
    session.add_all([principal, annexe])
    session.flush()

    etage_p = Floor(building_id=principal.id, code="R", label="Étage reco", level=7)
    etage_a = Floor(building_id=annexe.id, code="S", label="Étage annexe", level=7)
    session.add_all([etage_p, etage_a])
    session.flush()

    videoprojecteur = Equipment(
        code=f"video-{marque}",
        label="Vidéoprojecteur",
        category=EquipmentCategory.AUDIOVISUEL,
        icon="projector",
    )
    tableau = Equipment(
        code=f"tableau-{marque}",
        label="Tableau blanc",
        category=EquipmentCategory.MOBILIER,
        icon="square-pen",
    )
    session.add_all([videoprojecteur, tableau])
    session.flush()

    def salle(nom: str, capacite: int, etage: Floor, accessible: bool = True) -> Room:
        piece = Room(
            floor_id=etage.id,
            name=f"{nom} {marque}",
            slug=f"{nom.lower()}-{marque}",
            capacity=capacite,
            area_m2=Decimal("24.00"),
            status=RoomStatus.DISPONIBLE,
            is_accessible=accessible,
        )
        session.add(piece)
        session.flush()
        return piece

    petite = salle("Petite", 8, etage_p)
    moyenne = salle("Moyenne", 12, etage_p)
    grande = salle("Grande", 40, etage_p)
    lointaine = salle("Lointaine", 10, etage_a, accessible=False)
    #: Presque identique à la moyenne : c'est l'alternative naturelle.
    jumelle = salle("Jumelle", 12, etage_p)

    # La moyenne, la lointaine et la jumelle ont le vidéoprojecteur.
    for piece in (moyenne, lointaine, jumelle):
        session.add(
            RoomEquipment(room_id=piece.id, equipment_id=videoprojecteur.id, quantity=1)
        )
    session.add(RoomEquipment(room_id=moyenne.id, equipment_id=tableau.id, quantity=1))
    session.flush()

    return {
        "batiment": principal,
        "annexe": annexe,
        "petite": petite,
        "moyenne": moyenne,
        "grande": grande,
        "lointaine": lointaine,
        "jumelle": jumelle,
        "video": videoprojecteur,
        "tableau": tableau,
    }


def ids(suggestions) -> list[uuid.UUID]:
    return [item.room.id for item in suggestions]


def classer(session: Session, besoin: Need, parc: dict):
    """Classement restreint aux salles de la fixture.

    La base peut contenir le jeu de démonstration : sans ce filtre, les
    assertions d'ordre dépendraient de données que le test ne maîtrise pas.
    """
    connues = {
        parc[cle].id
        for cle in ("petite", "moyenne", "grande", "lointaine", "jumelle")
    }
    return [
        item
        for item in rank_rooms(session, besoin, limit=200)
        if item.room.id in connues
    ]


# --------------------------------------------------------------------------- #
# Les critères, isolément
# --------------------------------------------------------------------------- #


def test_capacite_penalise_le_surdimensionnement():
    assert capacity_fit(8, 8) == 1.0
    assert capacity_fit(8, 12) > capacity_fit(8, 40)
    # Une salle trop petite ne vaut rien, elle n'est pas « presque bonne ».
    assert capacity_fit(20, 12) == 0.0


def test_leger_surdimensionnement_tolere():
    """Dix personnes dans douze places reste un bon ajustement, pas un gâchis."""
    assert capacity_fit(10, 12) == pytest.approx(0.958, abs=0.01)


def test_sans_effectif_la_capacite_ne_discrimine_pas():
    assert capacity_fit(None, 8) == capacity_fit(None, 40)


def test_equipements_notes_en_proportion():
    a, b = uuid.uuid4(), uuid.uuid4()
    assert equipment_fit((), set()) == 1.0
    assert equipment_fit((a, b), {a, b}) == 1.0
    assert equipment_fit((a, b), {a}) == 0.5
    assert equipment_fit((a, b), set()) == 0.0


def test_le_score_ne_depasse_jamais_cent(session: Session, parc):
    besoin = Need(
        attendee_count=12,
        equipment_ids=(parc["video"].id,),
        building_id=parc["batiment"].id,
    )
    for suggestion in classer(session, besoin, parc):
        assert 0 <= suggestion.score <= 100
        assert sum(WEIGHTS.values()) == 100


# --------------------------------------------------------------------------- #
# Classement
# --------------------------------------------------------------------------- #


def test_la_salle_ajustee_passe_devant_la_grande(session: Session, parc):
    """Quarante places pour huit personnes : correct, mais du gâchis."""
    classement = classer(session, Need(attendee_count=8), parc)
    ordre = ids(classement)
    assert ordre.index(parc["petite"].id) < ordre.index(parc["grande"].id)


def test_la_salle_trop_petite_est_marquee_pas_supprimee(session: Session, parc):
    classement = classer(session, Need(attendee_count=20), parc)
    petite = next(item for item in classement if item.room.id == parc["petite"].id)
    assert petite.eligible is False
    # Elle reste dans la réponse : l'écran explique plutôt que de faire disparaître.
    assert parc["petite"].id in ids(classement)


def test_equipement_manquant_rend_ineligible(session: Session, parc):
    besoin = Need(attendee_count=8, equipment_ids=(parc["video"].id,))
    classement = classer(session, besoin, parc)

    petite = next(item for item in classement if item.room.id == parc["petite"].id)
    moyenne = next(item for item in classement if item.room.id == parc["moyenne"].id)
    assert petite.eligible is False
    assert moyenne.eligible is True
    # Et les éligibles passent devant, quel que soit leur score.
    assert ids(classement).index(parc["moyenne"].id) < ids(classement).index(parc["petite"].id)


def test_le_batiment_de_preference_departage(session: Session, parc):
    """À besoin égal, le bâtiment demandé vaut quinze points d'écart."""
    sans = classer(session, Need(attendee_count=10), parc)
    avec = classer(
        session, Need(attendee_count=10, building_id=parc["batiment"].id), parc
    )

    moyenne_sans = next(i for i in sans if i.room.id == parc["moyenne"].id).score
    moyenne_avec = next(i for i in avec if i.room.id == parc["moyenne"].id).score
    assert moyenne_avec - moyenne_sans == WEIGHTS["building"]


def test_accessibilite_exigee_ecarte_la_salle_non_accessible(session: Session, parc):
    classement = classer(session, Need(attendee_count=8, accessible=True), parc)
    lointaine = next(item for item in classement if item.room.id == parc["lointaine"].id)
    assert lointaine.eligible is False


def test_salle_en_maintenance_absente_par_defaut(session: Session, parc):
    parc["moyenne"].status = RoomStatus.MAINTENANCE
    session.flush()

    defaut = classer(session, Need(attendee_count=10), parc)
    assert parc["moyenne"].id not in ids(defaut)

    incluses = classer(
        session, Need(attendee_count=10, include_maintenance=True), parc
    )
    en_panne = next(item for item in incluses if item.room.id == parc["moyenne"].id)
    assert en_panne.eligible is False


# --------------------------------------------------------------------------- #
# Le créneau : classer n'est pas réserver
# --------------------------------------------------------------------------- #


def test_salle_prise_reste_classee_mais_ineligible(
    session: Session, parc, jour_ouvre, utilisateur
):
    from app.db.enums import BookingStatus
    from app.models import Booking

    plage = creneau(jour_ouvre, 10, 0, 60)
    session.add(
        Booking(
            room_id=parc["moyenne"].id,
            owner_id=utilisateur.id,
            title="Séminaire",
            time_range=plage,
            attendee_count=6,
            status=BookingStatus.CONFIRMEE,
        )
    )
    session.flush()

    classement = classer(session, Need(creneau=plage, attendee_count=10), parc)
    moyenne = next(item for item in classement if item.room.id == parc["moyenne"].id)

    assert moyenne.eligible is False
    # Le score reste élevé : la salle était bien la bonne, elle est juste prise.
    assert moyenne.score >= 50
    assert "Séminaire" in moyenne.justification


def test_meilleure_salle_ignore_les_ineligibles(session: Session, parc, jour_ouvre):
    besoin = Need(attendee_count=8, equipment_ids=(parc["video"].id,))
    meilleure = best_room(session, besoin)
    assert meilleure is not None
    assert meilleure.eligible is True
    assert meilleure.room.id in {parc["moyenne"].id, parc["lointaine"].id, parc["jumelle"].id}


def test_aucune_salle_ne_convient(session: Session, parc):
    """Mille personnes : la réponse est « aucune », pas une liste vide muette."""
    assert best_room(session, Need(attendee_count=1000)) is None


# --------------------------------------------------------------------------- #
# Alternatives à créneau constant
# --------------------------------------------------------------------------- #


def test_alternatives_excluent_la_salle_visee(session: Session, parc, jour_ouvre):
    plage = creneau(jour_ouvre, 14, 0, 60)
    propositions = suggest_alternatives(
        session, room_id=parc["moyenne"].id, creneau=plage, attendee_count=8
    )
    assert parc["moyenne"].id not in ids(propositions)
    assert all(item.eligible for item in propositions)


def test_alternative_prefere_le_materiel_sans_l_exiger(session: Session, parc, jour_ouvre):
    """Une alternative est un substitut raisonnable, pas un jumeau de la salle visée.

    Exiger l'équipement exact ne proposerait qu'un clone — le parc n'en contient
    presque jamais, et l'écran d'arbitrage resterait vide. Le matériel reste
    noté, donc la salle qui l'a remonte en tête.
    """
    plage = creneau(jour_ouvre, 14, 0, 60)
    connues = {parc[cle].id for cle in ("petite", "grande", "jumelle")}
    propositions = [
        item
        for item in suggest_alternatives(
            session, room_id=parc["moyenne"].id, creneau=plage, attendee_count=8, limit=200
        )
        if item.room.id in connues
    ]

    assert propositions, "une alternative doit être proposée, même imparfaite"
    # La jumelle a le vidéoprojecteur : elle passe devant les salles nues.
    equipee = next(item for item in propositions if item.room.id == parc["jumelle"].id)
    for item in propositions:
        if item.room.id != parc["jumelle"].id:
            assert item.score <= equipee.score


def test_alternative_introuvable_ne_leve_pas(session: Session, parc, jour_ouvre):
    """Aucune alternative n'est une réponse acceptable, pas une erreur."""
    plage = creneau(jour_ouvre, 14, 0, 60)
    propositions = suggest_alternatives(
        session, room_id=parc["grande"].id, creneau=plage, attendee_count=40
    )
    assert propositions == []


# --------------------------------------------------------------------------- #
# Justification
# --------------------------------------------------------------------------- #


def test_justification_cite_les_criteres_forts(session: Session, parc):
    besoin = Need(
        attendee_count=12,
        equipment_ids=(parc["video"].id,),
        building_id=parc["batiment"].id,
    )
    detail = noter(parc["moyenne"], besoin, 0.1)
    phrase = construire_justification(detail)

    assert phrase.startswith("Capacité ajustée") or "équipements demandés" in phrase
    assert phrase.endswith(".")


def test_justification_signale_la_reserve(session: Session, parc):
    """Bonne salle, mauvais bâtiment : la réserve doit apparaître."""
    besoin = Need(attendee_count=10, building_id=parc["annexe"].id)
    detail = noter(parc["moyenne"], besoin, 0.05)
    phrase = construire_justification(detail)

    assert "réserve : autre bâtiment" in phrase
    # Pas de « réserve : bâtiment, autre bâtiment » : le détail reprend le critère.
    assert "bâtiment, autre bâtiment" not in phrase


def test_justification_suit_les_donnees(session: Session, parc):
    """Deux taux d'occupation, deux phrases différentes : rien n'est figé."""
    besoin = Need(building_id=parc["batiment"].id)
    libre = construire_justification(noter(parc["moyenne"], besoin, 0.05))
    saturee = construire_justification(noter(parc["moyenne"], besoin, 0.95))

    assert libre != saturee
    # Une salle saturée devient la réserve de sa propre recommandation.
    assert "occupée à 95 %" in saturee
    assert "réserve" not in libre


def test_le_detail_du_score_porte_le_taux_reel(session: Session, parc):
    """Le détail affiché vient des données, même quand la phrase ne le cite pas."""
    besoin = Need(attendee_count=10)
    detail = {item.key: item.detail for item in noter(parc["moyenne"], besoin, 0.37)}
    assert detail["occupancy"] == "occupée à 37 %"
    assert detail["capacity"] == "12 places pour 10 personnes"

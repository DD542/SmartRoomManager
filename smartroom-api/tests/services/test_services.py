"""Tests d'intégration des services : chargement, orchestration, écriture."""

from __future__ import annotations

from datetime import timedelta

import pytest
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.orm import Session

from app.core.errors import ClosureError, RuleViolationError, SlotConflictError
from app.db.enums import BookingStatus, ClosureKind, RoomStatus, RuleScope
from app.domain.types import RuleCode, SearchCriteria, TimeSlot
from app.models import Booking, BookingRule, ClosurePeriod, ClosureRoom
from app.services import availability_service as service
from app.services import booking_service as booking
from app.services import recommendation_service as reco
from tests.services.conftest import creneau


def poser(session: Session, salle, compte, slot: TimeSlot, titre="Réunion existante") -> Booking:
    reservation = Booking(
        room_id=salle.id,
        owner_id=compte.id,
        title=titre,
        time_range=Range(slot.start, slot.end, bounds="[)"),
        attendee_count=4,
        status=BookingStatus.CONFIRMEE,
    )
    session.add(reservation)
    session.flush()
    return reservation


class TestChargement:
    def test_regles_par_defaut_sans_ligne_en_base(self, session, salle):
        """Aucune règle en base : les valeurs du sujet s'appliquent."""
        regles = service.load_rules(session, service.charger_salle(session, salle.id))
        assert regles.min_duration == timedelta(minutes=30)
        assert regles.max_active_bookings == 10

    def test_la_regle_de_salle_prime_sur_le_global(self, session, salle):
        """La migration pose déjà une règle globale : celle de la salle la coiffe."""
        session.add(
            BookingRule(scope=RuleScope.SALLE, room_id=salle.id, min_duration_min=60,
                        buffer_min=5)
        )
        session.flush()

        regles = service.load_rules(session, service.charger_salle(session, salle.id))
        assert regles.min_duration == timedelta(minutes=60)
        assert regles.buffer == timedelta(minutes=5)

    def test_horaires_de_la_salle(self, session, salle):
        horaires = service.load_openings(session, service.charger_salle(session, salle.id))
        assert len(horaires) == 7
        assert {item.weekday for item in horaires} == set(range(7))

    def test_fermeture_ciblant_la_salle(self, session, salle, jour_ouvre):
        fermeture = ClosurePeriod(
            label="Travaux de peinture",
            date_span=Range(jour_ouvre, jour_ouvre + timedelta(days=1), bounds="[)"),
            kind=ClosureKind.FERMETURE,
            is_global=False,
        )
        session.add(fermeture)
        session.flush()
        session.add(ClosureRoom(closure_id=fermeture.id, room_id=salle.id))
        session.flush()

        chargees = service.load_closures(
            session, service.charger_salle(session, salle.id), jour_ouvre, jour_ouvre
        )
        assert [item.label for item in chargees] == ["Travaux de peinture"]
        # DATERANGE est stocké en [début, fin[ : le dernier jour fermé est bien le jour visé.
        assert chargees[0].last_day == jour_ouvre


class TestCreneauxLibres:
    def test_journee_entierement_libre(self, session, salle, jour_ouvre):
        trous = service.free_slots(session, salle.id, jour_ouvre, jour_ouvre)
        assert len(trous) == 1
        assert trous[0].duration == timedelta(hours=12)

    def test_une_reservation_coupe_la_journee_en_deux(
        self, session, salle, compte, jour_ouvre
    ):
        poser(session, salle, compte, creneau(jour_ouvre, 12, 0, 60))
        trous = service.free_slots(session, salle.id, jour_ouvre, jour_ouvre)
        assert len(trous) == 2
        # Battement de 15 min par défaut : le trou de l'après-midi ouvre à 13:15.
        assert trous[1].start == creneau(jour_ouvre, 13, 15, 60).start

    def test_salle_sans_horaires_herite_du_global(self, creer_salle, session, jour_ouvre):
        """La résolution se fait par portée entière : salle, puis bâtiment, puis global."""
        muette = creer_salle("Muette", horaires=None)
        heritees = service.load_openings(session, service.charger_salle(session, muette.id))
        assert heritees, "la salle doit hériter des horaires globaux"
        assert service.free_slots(session, muette.id, jour_ouvre, jour_ouvre) != ()

    def test_fermeture_supprime_la_journee(self, session, salle, jour_ouvre):
        fermeture = ClosurePeriod(
            label="Jour férié",
            date_span=Range(jour_ouvre, jour_ouvre + timedelta(days=1), bounds="[)"),
            kind=ClosureKind.FERMETURE,
            is_global=True,
        )
        session.add(fermeture)
        session.flush()
        assert service.free_slots(session, salle.id, jour_ouvre, jour_ouvre) == ()


class TestVerification:
    def test_creneau_libre(self, session, salle, compte, jour_ouvre):
        rapport = service.check_slot(
            session,
            room_id=salle.id,
            slot=creneau(jour_ouvre, 10),
            attendees=4,
            requester_id=compte.id,
        )
        assert rapport.available is True
        assert rapport.conflicts == ()

    def test_chevauchement_bloquant(self, session, salle, compte, jour_ouvre):
        poser(session, salle, compte, creneau(jour_ouvre, 10, 0, 120), "Atelier")
        rapport = service.check_slot(
            session, room_id=salle.id, slot=creneau(jour_ouvre, 10, 30), attendees=4
        )
        assert rapport.available is False
        assert rapport.forcible is False
        assert rapport.blocking[0].existing.title == "Atelier"

    def test_battement_insuffisant_est_forcable(self, session, salle, compte, jour_ouvre):
        poser(session, salle, compte, creneau(jour_ouvre, 9, 0, 55), "Atelier")
        rapport = service.check_slot(
            session, room_id=salle.id, slot=creneau(jour_ouvre, 10), attendees=4
        )
        assert rapport.available is False
        assert rapport.forcible is True
        assert [item.code for item in rapport.violations] == [RuleCode.BATTEMENT]

    def test_capacite_depassee(self, session, salle, jour_ouvre):
        rapport = service.check_slot(
            session, room_id=salle.id, slot=creneau(jour_ouvre, 10), attendees=100
        )
        assert RuleCode.CAPACITE in [item.code for item in rapport.violations]

    def test_hors_horaires(self, session, salle, jour_ouvre):
        rapport = service.check_slot(
            session, room_id=salle.id, slot=creneau(jour_ouvre, 22), attendees=4
        )
        assert RuleCode.HORS_OUVERTURE in [item.code for item in rapport.violations]

    def test_le_deplacement_ignore_la_reservation_elle_meme(
        self, session, salle, compte, jour_ouvre
    ):
        existante = poser(session, salle, compte, creneau(jour_ouvre, 10, 0, 120))
        rapport = service.check_slot(
            session,
            room_id=salle.id,
            slot=creneau(jour_ouvre, 10, 30),
            attendees=4,
            ignore_booking_id=existante.id,
        )
        assert rapport.available is True


class TestRecherche:
    def test_une_seule_requete_filtrante(self, session, salle, creer_salle, jour_ouvre, video):
        equipee = creer_salle("Equipee", equipements=[video])
        criteres = SearchCriteria(
            slot=creneau(jour_ouvre, 10),
            attendees=8,
            equipment_ids=frozenset({video.id}),
        )
        resultats = service.search_rooms(session, criteres)
        identifiants = {profil.id for profil, _ in resultats}
        assert equipee.id in identifiants
        assert salle.id not in identifiants

    def test_le_drapeau_libre_accompagne_la_salle(
        self, session, salle, compte, jour_ouvre
    ):
        poser(session, salle, compte, creneau(jour_ouvre, 10))
        criteres = SearchCriteria(slot=creneau(jour_ouvre, 10), attendees=4)
        occupation = {profil.id: libre for profil, libre in service.search_rooms(session, criteres)}
        assert occupation[salle.id] is False

    def test_filtre_pmr(self, session, creer_salle, jour_ouvre):
        creer_salle("Etroite", accessible=False)
        accessible = creer_salle("Large", accessible=True)
        criteres = SearchCriteria(slot=creneau(jour_ouvre, 10), accessible_only=True)
        identifiants = {profil.id for profil, _ in service.search_rooms(session, criteres)}
        assert accessible.id in identifiants

    def test_salle_archivee_absente(self, session, creer_salle, jour_ouvre):
        archivee = creer_salle("Archivee", statut=RoomStatus.ARCHIVEE)
        criteres = SearchCriteria(slot=creneau(jour_ouvre, 10))
        assert archivee.id not in {p.id for p, _ in service.search_rooms(session, criteres)}


class TestEcriture:
    def test_creation_puis_relecture(self, session, salle, compte, jour_ouvre):
        reservation, code = booking.create_booking(
            session,
            room_id=salle.id,
            owner_id=compte.id,
            slot=creneau(jour_ouvre, 10),
            title="Revue de projet",
            attendees=4,
        )
        assert reservation.status is BookingStatus.CONFIRMEE
        assert session.get(Booking, reservation.id) is not None
        # La salle exige un badge : le clair sort une fois, la base ne garde
        # que l'empreinte et un indice masqué.
        assert code is not None
        assert code.hint.endswith("****")
        assert code.clear not in code.hint

    def test_creation_sur_un_creneau_pris(self, session, salle, compte, jour_ouvre):
        poser(session, salle, compte, creneau(jour_ouvre, 10))
        with pytest.raises(SlotConflictError):
            booking.create_booking(
                session, room_id=salle.id, owner_id=compte.id,
                slot=creneau(jour_ouvre, 10), attendees=4,
            )

    def test_fermeture_leve_une_erreur_dediee(self, session, salle, compte, jour_ouvre):
        fermeture = ClosurePeriod(
            label="Jour férié",
            date_span=Range(jour_ouvre, jour_ouvre + timedelta(days=1), bounds="[)"),
            kind=ClosureKind.FERMETURE,
            is_global=True,
        )
        session.add(fermeture)
        session.flush()
        with pytest.raises(ClosureError):
            booking.create_booking(
                session, room_id=salle.id, owner_id=compte.id,
                slot=creneau(jour_ouvre, 10), attendees=4,
            )

    def test_l_administration_force_une_regle_mais_pas_un_conflit(
        self, session, salle, compte, jour_ouvre
    ):
        forcee, _ = booking.create_booking(
            session, room_id=salle.id, owner_id=compte.id,
            slot=creneau(jour_ouvre, 22), attendees=4, ignore_rules=True,
        )
        assert forcee.is_forced is True

        with pytest.raises(SlotConflictError):
            booking.create_booking(
                session, room_id=salle.id, owner_id=compte.id,
                slot=creneau(jour_ouvre, 22), attendees=4, ignore_rules=True,
            )

    def test_creneau_ecoule_n_est_pas_forcable(self, session, salle, compte, jour_ouvre):
        passe = creneau(jour_ouvre - timedelta(days=14), 10)
        with pytest.raises(RuleViolationError) as refus:
            booking.create_booking(
                session, room_id=salle.id, owner_id=compte.id,
                slot=passe, attendees=4, ignore_rules=True,
            )
        assert refus.value.code == RuleCode.PASSE.value

    def test_annulation_exige_un_motif(self, session, salle, compte, jour_ouvre):
        reservation = poser(session, salle, compte, creneau(jour_ouvre, 10))
        with pytest.raises(RuleViolationError):
            booking.cancel_booking(session, reservation.id, reason="  ")

        annulee = booking.cancel_booking(session, reservation.id, reason="Reportée")
        assert annulee.status is BookingStatus.ANNULEE
        assert annulee.cancel_reason == "Reportée"

    def test_le_deplacement_ne_se_conflictue_pas_avec_lui_meme(
        self, session, salle, compte, jour_ouvre
    ):
        reservation = poser(session, salle, compte, creneau(jour_ouvre, 10, 0, 120))
        deplacee = booking.update_booking(
            session, reservation.id, slot=creneau(jour_ouvre, 10, 30, 60)
        )
        assert deplacee.time_range.lower == creneau(jour_ouvre, 10, 30).start

    def test_liberation_automatique(self, session, salle, compte, maintenant):
        debut = maintenant - timedelta(minutes=30)
        session.add(
            Booking(
                room_id=salle.id,
                owner_id=compte.id,
                title="Réunion fantôme",
                time_range=Range(debut, debut + timedelta(hours=2), bounds="[)"),
                attendee_count=3,
                status=BookingStatus.CONFIRMEE,
            )
        )
        session.flush()

        liberees = booking.release_no_shows(session, maintenant)
        assert len(liberees) == 1
        assert liberees[0].status is BookingStatus.ANNULEE
        assert "présence non validée" in liberees[0].cancel_reason


class TestRecommandation:
    def test_le_classement_place_les_eligibles_devant(
        self, session, compte, creer_salle, jour_ouvre, video
    ):
        equipee = creer_salle("Equipee", capacity=12, equipements=[video])
        nue = creer_salle("Nue", capacity=12)
        poser(session, equipee, compte, creneau(jour_ouvre, 10))

        classement = reco.rank_rooms(
            session,
            SearchCriteria(slot=creneau(jour_ouvre, 10), attendees=8),
            user_id=compte.id,
        )
        par_salle = {item.room.id: item for item in classement}
        assert par_salle[equipee.id].eligible is False
        assert par_salle[nue.id].eligible is True
        assert classement.index(par_salle[nue.id]) < classement.index(par_salle[equipee.id])

    def test_la_justification_cite_l_empechement(
        self, session, compte, salle, jour_ouvre
    ):
        poser(session, salle, compte, creneau(jour_ouvre, 10))
        classement = reco.rank_rooms(
            session, SearchCriteria(slot=creneau(jour_ouvre, 10), attendees=4)
        )
        propose = next(item for item in classement if item.room.id == salle.id)
        assert "créneau déjà pris" in propose.justification

    def test_meilleure_salle_ou_rien(self, session, compte, salle, jour_ouvre):
        assert reco.best_room(
            session, SearchCriteria(slot=creneau(jour_ouvre, 10), attendees=4)
        ) is not None
        assert reco.best_room(session, SearchCriteria(attendees=5000)) is None

    def test_profil_utilisateur_agrege(self, session, compte, salle, jour_ouvre):
        """Les réservations à venir comptent au quota, les passées à l'habitude."""
        poser(session, salle, compte, creneau(jour_ouvre, 10))
        # Quatorze jours et non sept : `jour_ouvre` est le prochain mardi, donc
        # jusqu'à sept jours devant. Retrancher sept jours ne donne une date
        # passée que si l'on est lundi ou mardi — le test réussissait cinq jours
        # sur sept, ce qui est la pire forme d'échec.
        poser(session, salle, compte, creneau(jour_ouvre - timedelta(days=14), 10))

        profil = reco.load_user_profile(session, compte.id)
        assert profil.active_bookings == 1
        assert profil.booked_room_counts[salle.id] == 1

    def test_alternatives_dans_les_trois_familles(
        self, session, compte, salle, creer_salle, jour_ouvre, video
    ):
        creer_salle("Curie", capacity=12)
        creer_salle("Pascal", capacity=14)
        poser(session, salle, compte, creneau(jour_ouvre, 10))

        propositions = reco.suggest_alternatives(
            session,
            room_id=salle.id,
            slot=creneau(jour_ouvre, 10),
            attendees=6,
            user_id=compte.id,
        )
        assert propositions
        assert all(item.score >= 0 for item in propositions)
        assert all(item.justification for item in propositions)

"""Cas limites temporels, éprouvés **à travers PostgreSQL**.

Le domaine sait déjà raisonner sur minuit et sur les changements d'heure : ses
tests sont purs, rapides, et couvrent la logique. Ils ne prouvent rien sur la
traversée. Or c'est là que se logent les défauts de fuseau — dans le passage
Python → `TSTZRANGE` → Python, et dans l'accord entre le fuseau du domaine et
`smartroom_timezone()`.

D'où ce module : les mêmes situations, mais écrites en base et relues.

Convention rappelée : `[début, fin[`. Un créneau qui commence à l'instant où un
autre finit ne le chevauche pas — c'est le battement, et non la géométrie, qui
peut le refuser.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import Range

from app.core.errors import RuleViolationError, SlotConflictError
from app.db.enums import ClosureKind, RuleScope
from app.domain.types import TimeSlot
from app.models import Booking, BookingRule, ClosurePeriod, ClosureRoom, OpeningHour
from app.services import availability_service as dispo
from app.services import booking_service as booking
from tests.horloge import PARIS, PASSAGE_ETE, PASSAGE_HIVER, local, prochain
from tests.services.conftest import creneau

pytestmark = pytest.mark.integration


def _poser(
    session,
    salle,
    compte,
    slot: TimeSlot,
    titre: str = "Occupée",
    *,
    maintenant: datetime | None = None,
) -> Booking:
    """Pose une réservation, règles levées.

    `maintenant` déplace l'horloge et non la date du créneau : « ce créneau est
    écoulé » n'est pas une règle forçable, et les journées de changement d'heure
    ne se choisissent pas — il faut donc se placer avant elles.
    """
    reservation, _ = booking.create_booking(
        session,
        room_id=salle.id,
        owner_id=compte.id,
        slot=slot,
        title=titre,
        attendees=4,
        ignore_rules=True,
        now=maintenant,
    )
    session.flush()
    return reservation


def _veille_de(slot: TimeSlot) -> datetime:
    """Instant situé la veille du créneau, pour une horloge injectée."""
    return slot.start - timedelta(days=1)


def _ouvrir_en_continu(session, salle) -> None:
    """Amplitude 00:00–23:59 : les cas de cette section portent sur le temps,
    pas sur les horaires. Une amplitude 08:00–20:00 refuserait un créneau de
    minuit pour une raison qui n'est pas celle qu'on veut éprouver."""
    session.execute(
        OpeningHour.__table__.delete().where(OpeningHour.room_id == salle.id)
    )
    for jour in range(7):
        session.add(
            OpeningHour(
                scope=RuleScope.SALLE,
                room_id=salle.id,
                weekday=jour,
                is_open=True,
                opens_at=time(0, 0),
                closes_at=time(23, 59),
            )
        )
    session.flush()


class TestAllerRetourEnBase:
    def test_le_creneau_relu_est_celui_qui_a_ete_ecrit(
        self, session, salle, compte, jour_ouvre
    ):
        """Un décalage d'une heure au stockage ne se verrait qu'ici."""
        _ouvrir_en_continu(session, salle)
        depart = local(14, 30, jour=jour_ouvre)
        slot = TimeSlot(start=depart, end=depart + timedelta(hours=1))

        reservation = _poser(session, salle, compte, slot)
        session.expire(reservation)

        relu = session.get(Booking, reservation.id)
        assert relu.time_range.lower == slot.start
        assert relu.time_range.upper == slot.end

    def test_l_heure_locale_est_preservee_a_la_relecture(
        self, session, salle, compte, jour_ouvre
    ):
        _ouvrir_en_continu(session, salle)
        slot = creneau(jour_ouvre, 14, 30, 60)

        reservation = _poser(session, salle, compte, slot)
        session.expire(reservation)

        relu = session.get(Booking, reservation.id)
        assert relu.time_range.lower.astimezone(PARIS).hour == 14
        assert relu.time_range.lower.astimezone(PARIS).minute == 30


class TestMinuit:
    def test_un_creneau_a_cheval_sur_minuit_est_accepte(self, session, salle, compte):
        """Deux jours civils, un seul intervalle : `TSTZRANGE` ne connaît que
        des instants, la frontière de minuit ne le concerne pas."""
        _ouvrir_en_continu(session, salle)
        veille = prochain(1) - timedelta(days=1)
        slot = TimeSlot(
            start=local(23, 0, jour=veille), end=local(1, 0, jour=veille + timedelta(days=1))
        )

        reservation = _poser(session, salle, compte, slot)
        session.expire(reservation)

        relu = session.get(Booking, reservation.id)
        assert _ecart_reel(relu.time_range.lower, relu.time_range.upper) == timedelta(hours=2)
        assert relu.time_range.lower.astimezone(PARIS).date() == veille
        assert relu.time_range.upper.astimezone(PARIS).date() == veille + timedelta(days=1)

    def test_un_chevauchement_de_part_et_d_autre_de_minuit_est_refuse(
        self, session, salle, compte
    ):
        """Le conflit se calcule sur des instants : la coupure de minuit ne
        crée pas deux créneaux indépendants."""
        _ouvrir_en_continu(session, salle)
        veille = prochain(1) - timedelta(days=1)
        lendemain = veille + timedelta(days=1)
        _poser(
            session,
            salle,
            compte,
            TimeSlot(start=local(23, 0, jour=veille), end=local(1, 0, jour=lendemain)),
        )

        with pytest.raises(SlotConflictError):
            booking.create_booking(
                session,
                room_id=salle.id,
                owner_id=compte.id,
                slot=TimeSlot(
                    start=local(23, 30, jour=veille), end=local(0, 30, jour=lendemain)
                ),
                title="Chevauche minuit",
                attendees=2,
                ignore_rules=True,
            )

    def test_un_creneau_adjacent_a_minuit_est_accepte(self, session, salle, compte):
        """23:00–00:00 puis 00:00–01:00 : la borne haute est exclue."""
        _ouvrir_en_continu(session, salle)
        session.add(
            BookingRule(scope=RuleScope.SALLE, room_id=salle.id, buffer_min=0)
        )
        session.flush()

        veille = prochain(1) - timedelta(days=1)
        lendemain = veille + timedelta(days=1)
        _poser(
            session,
            salle,
            compte,
            TimeSlot(start=local(23, 0, jour=veille), end=local(0, 0, jour=lendemain)),
        )

        suivante = _poser(
            session,
            salle,
            compte,
            TimeSlot(start=local(0, 0, jour=lendemain), end=local(1, 0, jour=lendemain)),
            titre="Juste après minuit",
        )
        assert suivante.id is not None


def _ecart_reel(premier: datetime, second: datetime) -> timedelta:
    """Écart entre deux instants, décalage compris.

    La conversion en UTC n'est pas une précaution de style. Python spécifie que
    deux datetimes portant **le même objet** `tzinfo` se soustraient naïvement,
    décalage ignoré. Le piège vaut pour les valeurs construites comme pour
    celles relues de PostgreSQL, que psycopg rend en heure locale.
    """
    return second.astimezone(UTC) - premier.astimezone(UTC)


class TestChangementDHeure:
    """Deux journées de l'année ne durent pas 24 heures.

    Le 29 mars 2026, 02:00 locale n'existe pas : la journée dure 23 h.
    Le 25 octobre 2026, 02:30 locale existe deux fois : elle dure 25 h.

    Un créneau décrit par deux heures **locales** a donc une durée réelle qui
    n'est pas la différence naïve des deux cadrans. C'est exactement ce qu'un
    utilisateur constate, et ce qu'une facturation à l'heure devrait retenir.
    """

    def test_le_jour_du_passage_a_l_heure_d_ete_dure_vingt_trois_heures(self):
        veille = local(0, jour=PASSAGE_ETE)
        lendemain = local(0, jour=PASSAGE_ETE + timedelta(days=1))
        assert _ecart_reel(veille, lendemain) == timedelta(hours=23)

    def test_le_jour_du_retour_a_l_heure_d_hiver_dure_vingt_cinq_heures(self):
        veille = local(0, jour=PASSAGE_HIVER)
        lendemain = local(0, jour=PASSAGE_HIVER + timedelta(days=1))
        assert _ecart_reel(veille, lendemain) == timedelta(hours=25)

    def test_la_soustraction_naive_ment_sur_ces_journees(self):
        """Le piège, rendu explicite : si ce test cessait d'échouer à sa
        première ligne, c'est que Python aurait changé de sémantique."""
        veille = local(0, jour=PASSAGE_ETE)
        lendemain = local(0, jour=PASSAGE_ETE + timedelta(days=1))
        assert lendemain - veille == timedelta(hours=24)
        assert _ecart_reel(veille, lendemain) == timedelta(hours=23)

    def test_au_printemps_trois_heures_au_cadran_n_en_durent_que_deux(
        self, session, salle, compte
    ):
        """01:00 → 04:00 le 29 mars : l'heure de 02:00 n'existe pas."""
        _ouvrir_en_continu(session, salle)
        slot = TimeSlot(
            start=local(1, 0, jour=PASSAGE_ETE), end=local(4, 0, jour=PASSAGE_ETE)
        )
        assert slot.end - slot.start == timedelta(hours=2)

        reservation = _poser(
            session, salle, compte, slot, "Nuit de printemps", maintenant=_veille_de(slot)
        )
        session.expire(reservation)

        relu = session.get(Booking, reservation.id)
        assert _ecart_reel(relu.time_range.lower, relu.time_range.upper) == timedelta(hours=2)
        assert relu.time_range.lower.astimezone(PARIS).hour == 1
        assert relu.time_range.upper.astimezone(PARIS).hour == 4

    def test_a_l_automne_trois_heures_au_cadran_en_durent_quatre(
        self, session, salle, compte
    ):
        """01:00 → 04:00 le 25 octobre : l'heure de 02:00 est vécue deux fois."""
        _ouvrir_en_continu(session, salle)
        slot = TimeSlot(
            start=local(1, 0, jour=PASSAGE_HIVER), end=local(4, 0, jour=PASSAGE_HIVER)
        )
        assert slot.end - slot.start == timedelta(hours=4)

        reservation = _poser(
            session, salle, compte, slot, "Nuit d'automne", maintenant=_veille_de(slot)
        )
        session.expire(reservation)

        relu = session.get(Booking, reservation.id)
        assert _ecart_reel(relu.time_range.lower, relu.time_range.upper) == timedelta(hours=4)
        assert relu.time_range.lower.astimezone(PARIS).hour == 1
        assert relu.time_range.upper.astimezone(PARIS).hour == 4

    def test_le_conflit_tient_a_travers_le_changement_d_heure(
        self, session, salle, compte
    ):
        """Une réservation posée avant le basculement bloque bien celle qui le
        franchit : la comparaison se fait sur des instants, pas sur des cadrans."""
        _ouvrir_en_continu(session, salle)
        _poser(
            session,
            salle,
            compte,
            TimeSlot(
                start=local(1, 0, jour=PASSAGE_HIVER), end=local(4, 0, jour=PASSAGE_HIVER)
            ),
        )

        with pytest.raises(SlotConflictError):
            booking.create_booking(
                session,
                room_id=salle.id,
                owner_id=compte.id,
                slot=TimeSlot(
                    start=local(3, 0, jour=PASSAGE_HIVER),
                    end=local(5, 0, jour=PASSAGE_HIVER),
                ),
                title="Franchit le basculement",
                attendees=2,
                ignore_rules=True,
            )


class TestBornesDOuverture:
    def test_un_creneau_qui_finit_a_la_fermeture_est_accepte(
        self, session, salle, compte, jour_ouvre
    ):
        """La borne haute est exclue : finir à 20:00 n'est pas dépasser 20:00."""
        rapport = dispo.check_slot(
            session,
            room_id=salle.id,
            slot=creneau(jour_ouvre, 19, 0, 60),
            attendees=2,
            requester_id=compte.id,
        )
        assert [item.code for item in rapport.violations] == []

    def test_un_creneau_qui_deborde_d_une_minute_est_refuse(
        self, session, salle, compte, jour_ouvre
    ):
        rapport = dispo.check_slot(
            session,
            room_id=salle.id,
            slot=creneau(jour_ouvre, 19, 0, 61),
            attendees=2,
            requester_id=compte.id,
        )
        assert "hors_ouverture" in {item.code.value for item in rapport.violations}

    def test_un_creneau_qui_commence_a_l_ouverture_est_accepte(
        self, session, salle, compte, jour_ouvre
    ):
        rapport = dispo.check_slot(
            session,
            room_id=salle.id,
            slot=creneau(jour_ouvre, 8, 0, 60),
            attendees=2,
            requester_id=compte.id,
        )
        assert [item.code for item in rapport.violations] == []

    def test_un_creneau_qui_commence_une_minute_trop_tot_est_refuse(
        self, session, salle, compte, jour_ouvre
    ):
        rapport = dispo.check_slot(
            session,
            room_id=salle.id,
            slot=creneau(jour_ouvre, 7, 59, 60),
            attendees=2,
            requester_id=compte.id,
        )
        assert "hors_ouverture" in {item.code.value for item in rapport.violations}


class TestFermetureExceptionnelle:
    @pytest.fixture
    def fermer(self, session, salle):
        def _fermer(jour: date, *, ciblee: bool = True) -> ClosurePeriod:
            fermeture = ClosurePeriod(
                label="Journée pédagogique",
                # DATERANGE en [début, fin[ : le dernier jour fermé est la
                # veille de la borne haute.
                date_span=Range(jour, jour + timedelta(days=1), bounds="[)"),
                kind=ClosureKind.FERMETURE,
                is_global=not ciblee,
            )
            session.add(fermeture)
            session.flush()
            if ciblee:
                session.add(
                    ClosureRoom(closure_id=fermeture.id, room_id=salle.id)
                )
                session.flush()
            return fermeture

        return _fermer

    def test_un_jour_ferme_ne_laisse_aucun_creneau_libre(
        self, session, salle, jour_ouvre, fermer
    ):
        fermer(jour_ouvre)
        assert dispo.free_slots(session, salle.id, jour_ouvre, jour_ouvre) == ()

    def test_un_jour_ferme_refuse_la_reservation(
        self, session, salle, compte, jour_ouvre, fermer
    ):
        fermer(jour_ouvre)
        rapport = dispo.check_slot(
            session,
            room_id=salle.id,
            slot=creneau(jour_ouvre, 10, 0, 60),
            attendees=2,
            requester_id=compte.id,
        )
        assert "fermeture" in {item.code.value for item in rapport.violations}

    def test_le_lendemain_d_une_fermeture_reste_ouvert(
        self, session, salle, jour_ouvre, fermer
    ):
        """Une fermeture d'un jour qui déborderait sur le suivant se verrait ici."""
        fermer(jour_ouvre)
        assert dispo.free_slots(
            session, salle.id, jour_ouvre + timedelta(days=1), jour_ouvre + timedelta(days=1)
        ) != ()

    def test_une_fermeture_ciblant_une_autre_salle_ne_touche_pas_celle_ci(
        self, session, salle, creer_salle, jour_ouvre
    ):
        voisine = creer_salle("Voisine")
        fermeture = ClosurePeriod(
            label="Travaux",
            date_span=Range(jour_ouvre, jour_ouvre + timedelta(days=1), bounds="[)"),
            kind=ClosureKind.FERMETURE,
            is_global=False,
        )
        session.add(fermeture)
        session.flush()
        session.add(ClosureRoom(closure_id=fermeture.id, room_id=voisine.id))
        session.flush()

        assert dispo.free_slots(session, salle.id, jour_ouvre, jour_ouvre) != ()
        assert dispo.free_slots(session, voisine.id, jour_ouvre, jour_ouvre) == ()


class TestBattementContreAdjacence:
    """La distinction que le sujet demande de ne pas confondre.

    Géométriquement, 15:00–16:00 après 14:00–15:00 ne chevauche rien. C'est la
    règle de battement — configurable, donc lue en base — qui décide s'il faut
    la refuser. Un moteur qui mélangerait les deux ne saurait plus expliquer
    pourquoi il refuse.
    """

    @pytest.fixture
    def avec_battement(self, session, salle):
        def _poser_battement(minutes: int) -> None:
            session.add(
                BookingRule(
                    scope=RuleScope.SALLE, room_id=salle.id, buffer_min=minutes
                )
            )
            session.flush()

        return _poser_battement

    def test_sans_battement_l_adjacence_est_acceptee(
        self, session, salle, compte, jour_ouvre, avec_battement
    ):
        avec_battement(0)
        _poser(session, salle, compte, creneau(jour_ouvre, 14, 0, 60))

        rapport = dispo.check_slot(
            session,
            room_id=salle.id,
            slot=creneau(jour_ouvre, 15, 0, 60),
            attendees=2,
            requester_id=compte.id,
        )
        assert rapport.available is True

    @pytest.mark.parametrize(
        ("battement", "ecart_min", "attendu"),
        [
            pytest.param(15, 0, False, id="colle_au_creneau_precedent"),
            pytest.param(15, 14, False, id="une_minute_sous_le_battement"),
            pytest.param(15, 15, True, id="exactement_le_battement"),
            pytest.param(15, 30, True, id="largement_au_dela"),
            pytest.param(30, 15, False, id="battement_double_non_respecte"),
            pytest.param(30, 30, True, id="battement_double_respecte"),
        ],
    )
    def test_le_battement_configure_decide(
        self,
        session,
        salle,
        compte,
        jour_ouvre,
        avec_battement,
        battement,
        ecart_min,
        attendu,
    ):
        """La valeur vient de la base, jamais d'une constante du test."""
        avec_battement(battement)
        _poser(session, salle, compte, creneau(jour_ouvre, 14, 0, 60))

        rapport = dispo.check_slot(
            session,
            room_id=salle.id,
            slot=creneau(jour_ouvre, 15, ecart_min, 30),
            attendees=2,
            requester_id=compte.id,
        )
        assert rapport.available is attendu

    def test_le_conflit_d_adjacence_n_est_pas_qualifie_de_chevauchement(
        self, session, salle, compte, jour_ouvre, avec_battement
    ):
        """Le message doit parler de battement, pas de créneau pris : c'est ce
        qui permet à l'utilisateur de comprendre qu'un décalage suffit."""
        avec_battement(15)
        _poser(session, salle, compte, creneau(jour_ouvre, 14, 0, 60))

        rapport = dispo.check_slot(
            session,
            room_id=salle.id,
            slot=creneau(jour_ouvre, 15, 5, 30),
            attendees=2,
            requester_id=compte.id,
        )
        assert rapport.available is False
        # Aucun des cinq types de chevauchement : le refus vient du battement,
        # pas d'un recouvrement. C'est ce qui permet à l'écran de proposer un
        # simple décalage plutôt qu'un changement de salle.
        recouvrements = {"identique", "englobant", "englobe", "partiel_debut", "partiel_fin"}
        assert rapport.conflicts, "le battement doit produire un conflit signalé"
        assert not any(item.kind.value in recouvrements for item in rapport.conflicts)

"""Concurrence réelle sur un même créneau : une seule écriture survit.

Ces tests n'utilisent pas la session transactionnelle des autres. Plusieurs
transactions doivent être **réellement** ouvertes en parallèle, sur des
connexions distinctes, pour que la contrainte `EXCLUDE` entre en jeu : une
simulation séquentielle ne prouverait rien, puisque la seconde écriture
verrait simplement la première déjà validée.

Ils nettoient donc leurs propres écritures, et portent un groupe xdist qui les
maintient sur un même worker — les répartir ferait s'affronter des tests conçus
pour s'affronter entre eux.

La garantie éprouvée ici n'est pas applicative. `ex_bookings_no_overlap` est
une contrainte de base : elle tient quel que soit le code qui l'attaque, y
compris un `INSERT` écrit à la main, y compris un administrateur qui force les
règles. C'est le dernier rempart contre la double réservation, et le sujet en
fait sa promesse centrale.
"""

from __future__ import annotations

import threading
import uuid
from datetime import date, datetime, time, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import delete, text
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import SlotConflictError
from app.db.enums import RoomStatus, RuleScope
from app.domain.types import TimeSlot
from app.models import (
    Booking,
    BookingEvent,
    BookingParticipant,
    Building,
    Floor,
    OpeningHour,
    Room,
    User,
)
from app.services import booking_service as booking
from tests.horloge import PARIS

pytestmark = [pytest.mark.concurrence, pytest.mark.xdist_group("concurrence")]

#: La perdante attend que la gagnante commite : PostgreSQL sérialise les deux
#: écritures sur la contrainte EXCLUDE. Le plafond évite qu'un blocage réel fige
#: le test au lieu de le faire échouer.
VERROU_MAX = "10s"

#: Nombre de prétendants du scénario le plus dense. Dix connexions suffisent à
#: exercer la sérialisation sans transformer la suite en test de charge.
PRETENDANTS = 10


@pytest.fixture
def parc_isole(engine):
    """Bâtiment, salle et dix comptes, écrits pour de bon puis supprimés.

    Écrits pour de bon : sans `commit`, les autres connexions ne les verraient
    pas, et chaque fil échouerait sur une salle introuvable au lieu d'entrer en
    concurrence.
    """
    marque = uuid.uuid4().hex[:6]
    chiffres = "".join(c for c in marque if c.isdigit())[:3] or "1"

    with Session(engine, expire_on_commit=False) as session:
        batiment = Building(code=f"C{chiffres}", name=f"Campus concurrence {marque}")
        session.add(batiment)
        session.flush()

        etage = Floor(building_id=batiment.id, code="C", label="Étage", level=1)
        session.add(etage)
        session.flush()

        salle = Room(
            floor_id=etage.id,
            name=f"Salle concurrence {marque}",
            slug=f"concurrence-{marque}",
            capacity=20,
            area_m2=Decimal("30.00"),
            status=RoomStatus.DISPONIBLE,
            badge_required=False,
        )
        session.add(salle)
        session.flush()

        for jour in range(7):
            session.add(
                OpeningHour(
                    scope=RuleScope.SALLE,
                    room_id=salle.id,
                    weekday=jour,
                    opens_at=time(7, 0),
                    closes_at=time(22, 0),
                )
            )

        comptes = []
        for index in range(PRETENDANTS):
            compte = User(
                email=f"pretendant{index}-{marque}@ece.fr",
                password_hash="x" * 60,
                first_name=f"Prétendant{index}",
                last_name="Concurrent",
            )
            session.add(compte)
            comptes.append(compte)
        session.commit()

        contexte = {"salle": salle, "comptes": comptes}

    yield contexte

    with Session(engine) as session:
        reservations = list(
            session.scalars(
                text("SELECT id FROM bookings WHERE room_id = :salle").bindparams(
                    salle=salle.id
                )
            )
        )
        if reservations:
            session.execute(
                delete(BookingEvent).where(BookingEvent.booking_id.in_(reservations))
            )
            session.execute(
                delete(BookingParticipant).where(
                    BookingParticipant.booking_id.in_(reservations)
                )
            )
        session.execute(delete(Booking).where(Booking.room_id == salle.id))
        session.execute(delete(OpeningHour).where(OpeningHour.room_id == salle.id))
        session.execute(delete(Room).where(Room.id == salle.id))
        session.execute(delete(Floor).where(Floor.id == etage.id))
        session.execute(delete(Building).where(Building.id == batiment.id))
        for compte in comptes:
            session.execute(delete(User).where(User.id == compte.id))
        session.commit()


def _creneau_futur(decalage_jours: int = 3) -> TimeSlot:
    jour = date.today() + timedelta(days=decalage_jours)
    depart = datetime.combine(jour, time(14, 0), tzinfo=PARIS)
    return TimeSlot(start=depart, end=depart + timedelta(hours=1))


class Tentative:
    """Issue d'un prétendant, avec de quoi juger la qualité du refus."""

    __slots__ = ("index", "etat", "message", "conflit", "alternatives")

    def __init__(self, index: int) -> None:
        self.index = index
        self.etat = "non_lance"
        self.message: str | None = None
        self.conflit: dict | None = None
        self.alternatives: list = []


def _reserver(engine, salle_id, owner_id, slot, depart, tentative: Tentative) -> None:
    """Réserve dans sa propre transaction, sur sa propre connexion.

    Tous les fils partent au même instant. La sérialisation est celle de
    PostgreSQL : les écritures suivantes attendent le verdict de la première.
    """
    depart.wait(timeout=15)
    with Session(engine) as session:
        try:
            session.execute(text(f"SET LOCAL lock_timeout = '{VERROU_MAX}'"))
            booking.create_booking(
                session,
                room_id=salle_id,
                owner_id=owner_id,
                slot=slot,
                title=f"Réservation {tentative.index}",
                attendees=4,
            )
            session.commit()
            tentative.etat = "reussi"
        except SlotConflictError as conflit:
            session.rollback()
            tentative.etat = "conflit"
            tentative.message = str(conflit)
            tentative.conflit = conflit.conflict
            tentative.alternatives = conflit.alternatives
        except Exception as erreur:  # noqa: BLE001
            session.rollback()
            tentative.etat = type(erreur).__name__
            tentative.message = str(erreur)


def _affronter(engine, salle, comptes, slot, nombre: int) -> list[Tentative]:
    """Lance `nombre` réservations simultanées et rend leurs issues."""
    depart = threading.Event()
    tentatives = [Tentative(index) for index in range(nombre)]
    fils = [
        threading.Thread(
            target=_reserver,
            args=(engine, salle.id, comptes[index].id, slot, depart, tentatives[index]),
        )
        for index in range(nombre)
    ]
    for fil in fils:
        fil.start()
    depart.set()
    for fil in fils:
        fil.join(timeout=30)

    assert all(not fil.is_alive() for fil in fils), "un fil ne s'est pas terminé"
    return tentatives


def _compter(session, salle_id, slot: TimeSlot) -> int:
    return session.scalar(
        text(
            "SELECT count(*) FROM bookings "
            "WHERE room_id = :salle AND time_range && tstzrange(:debut, :fin, '[)')"
        ).bindparams(salle=salle_id, debut=slot.start, fin=slot.end)
    )


class TestConcurrence:
    @pytest.mark.parametrize(
        "nombre",
        [pytest.param(2, id="deux_pretendants"), pytest.param(PRETENDANTS, id="dix_pretendants")],
    )
    def test_une_seule_reservation_survit(self, engine, parc_isole, nombre):
        """Le cœur du sujet : la double réservation est impossible.

        Aucune sérialisation applicative n'est en jeu. Les fils passent tous
        la vérification de disponibilité — le créneau est libre pour chacun au
        moment où il regarde — puis se heurtent à la contrainte au moment
        d'écrire.
        """
        slot = _creneau_futur()
        tentatives = _affronter(
            engine, parc_isole["salle"], parc_isole["comptes"], slot, nombre
        )

        issues = [item.etat for item in tentatives]
        assert issues.count("reussi") == 1, issues
        assert issues.count("conflit") == nombre - 1, issues

        with Session(engine) as session:
            assert _compter(session, parc_isole["salle"].id, slot) == 1

    def test_chaque_perdant_recoit_un_message_exploitable(self, engine, parc_isole):
        """Un refus opaque obligerait l'utilisateur à deviner. Le message nomme
        la réunion en place et son créneau, en français."""
        slot = _creneau_futur(4)
        tentatives = _affronter(
            engine, parc_isole["salle"], parc_isole["comptes"], slot, PRETENDANTS
        )

        perdants = [item for item in tentatives if item.etat == "conflit"]
        assert len(perdants) == PRETENDANTS - 1

        for perdant in perdants:
            assert perdant.message
            assert "Réservation" in perdant.message or "créneau" in perdant.message.lower()

    def test_chaque_perdant_est_refuse_de_maniere_exploitable(self, engine, parc_isole):
        """Deux chemins de refus, deux niveaux de détail. C'est délibéré.

        Quand le conflit est vu **avant** l'écriture, le service interroge le
        moteur et rend un 409 porteur du conflit qualifié et des alternatives :
        c'est le cas courant, celui de l'écran de conflit.

        Quand il est vu **par la base**, la transaction est déjà avortée. La
        qualifier demanderait d'en ouvrir une seconde depuis un gestionnaire
        d'exception, dans un service dont le contrat dit que le `commit`
        appartient à l'appelant. Le refus reste donc un message actionnable
        sans enrichissement, et c'est ce que ce test verrouille — pour que la
        différence soit constatée, et non découverte en production.
        """
        slot = _creneau_futur(5)
        tentatives = _affronter(
            engine, parc_isole["salle"], parc_isole["comptes"], slot, PRETENDANTS
        )

        perdants = [item for item in tentatives if item.etat == "conflit"]
        assert len(perdants) == PRETENDANTS - 1

        # Le chemin emprunté dépend du moment : un fil qui vérifie après que la
        # gagnante a validé est refusé par le pré-contrôle et reçoit le conflit
        # qualifié ; celui qui vérifie avant passe le contrôle et se heurte à la
        # contrainte. Affirmer un seul des deux rendrait ce test intermittent.
        #
        # L'invariant, lui, tient dans les deux cas : le refus est un message
        # français exploitable, et jamais une erreur technique.
        par_la_base = 0
        par_le_pre_controle = 0
        for perdant in perdants:
            assert perdant.message
            if perdant.conflit is None:
                assert "Rafraîchissez" in perdant.message
                assert perdant.alternatives == []
                par_la_base += 1
            else:
                assert perdant.conflit["blocking"] is True
                par_le_pre_controle += 1

        assert par_la_base + par_le_pre_controle == PRETENDANTS - 1

    def test_le_conflit_vu_avant_l_ecriture_est_lui_qualifie(self, engine, parc_isole):
        """Le pendant du cas précédent : hors course, le 409 porte tout.

        Sans lui, on ne saurait pas si l'absence d'enrichissement tient au
        chemin de la course ou à une régression générale.
        """
        slot = _creneau_futur(12)
        salle = parc_isole["salle"]

        with Session(engine) as session:
            booking.create_booking(
                session,
                room_id=salle.id,
                owner_id=parc_isole["comptes"][0].id,
                slot=slot,
                title="Déjà posée",
                attendees=4,
            )
            session.commit()

        with Session(engine) as session, pytest.raises(SlotConflictError) as refus:
            booking.create_booking(
                session,
                room_id=salle.id,
                owner_id=parc_isole["comptes"][1].id,
                slot=slot,
                title="Trop tard",
                attendees=4,
            )

        assert refus.value.conflict is not None
        assert refus.value.conflict["kind"] == "identique"
        assert refus.value.conflict["overlap_minutes"] == 60
        assert refus.value.conflict["blocking"] is True

    def test_aucun_perdant_ne_recoit_une_erreur_technique(self, engine, parc_isole):
        """Une violation d'intégrité remontée telle quelle donnerait un 500.
        Le service doit la traduire en refus métier."""
        slot = _creneau_futur(6)
        tentatives = _affronter(
            engine, parc_isole["salle"], parc_isole["comptes"], slot, PRETENDANTS
        )

        inattendues = [
            (item.etat, item.message)
            for item in tentatives
            if item.etat not in {"reussi", "conflit"}
        ]
        assert inattendues == []

    def test_des_creneaux_disjoints_aboutissent_tous(self, engine, parc_isole):
        """Contre-épreuve : sans chevauchement, la contrainte ne gêne personne.

        Sans ce cas, un service qui refuserait *toute* écriture concurrente
        passerait les tests précédents avec les honneurs.
        """
        depart = threading.Event()
        base = date.today() + timedelta(days=7)
        tentatives = [Tentative(index) for index in range(PRETENDANTS)]
        fils = []
        for index in range(PRETENDANTS):
            heure = datetime.combine(base, time(8 + index, 0), tzinfo=PARIS)
            fils.append(
                threading.Thread(
                    target=_reserver,
                    args=(
                        engine,
                        parc_isole["salle"].id,
                        parc_isole["comptes"][index].id,
                        TimeSlot(start=heure, end=heure + timedelta(minutes=45)),
                        depart,
                        tentatives[index],
                    ),
                )
            )
        for fil in fils:
            fil.start()
        depart.set()
        for fil in fils:
            fil.join(timeout=30)

        issues = [item.etat for item in tentatives]
        assert issues.count("reussi") == PRETENDANTS, issues


class TestContrainteDeBase:
    """La garantie ne dépend pas du code applicatif.

    Ces cas contournent entièrement les services : ils écrivent en SQL. Si la
    contrainte disparaissait d'une migration, tous les tests passant par le
    service continueraient de réussir — c'est ce trou que cette classe ferme.
    """

    def test_la_base_refuse_un_chevauchement_insere_a_la_main(self, engine, parc_isole):
        slot = _creneau_futur(8)
        salle = parc_isole["salle"]
        proprietaire = parc_isole["comptes"][0]

        with Session(engine) as session:
            session.add(
                Booking(
                    room_id=salle.id,
                    owner_id=proprietaire.id,
                    title="Première",
                    time_range=Range(slot.start, slot.end, bounds="[)"),
                    attendee_count=2,
                )
            )
            session.commit()

        with Session(engine) as session, pytest.raises(IntegrityError) as refus:
            session.add(
                Booking(
                    room_id=salle.id,
                    owner_id=parc_isole["comptes"][1].id,
                    title="Seconde",
                    time_range=Range(
                        slot.start + timedelta(minutes=30),
                        slot.end + timedelta(minutes=30),
                        bounds="[)",
                    ),
                    attendee_count=2,
                )
            )
            session.commit()

        assert "ex_bookings_no_overlap" in str(refus.value)

    def test_la_base_accepte_deux_creneaux_adjacents(self, engine, parc_isole):
        """Convention `[début, fin[` au niveau base : 14:00–15:00 puis
        15:00–16:00 ne se chevauchent pas. Le battement est une règle
        applicative, pas une contrainte d'intégrité — les confondre
        empêcherait de le configurer à zéro."""
        slot = _creneau_futur(9)
        salle = parc_isole["salle"]

        with Session(engine) as session:
            session.add(
                Booking(
                    room_id=salle.id,
                    owner_id=parc_isole["comptes"][0].id,
                    title="Première",
                    time_range=Range(slot.start, slot.end, bounds="[)"),
                    attendee_count=2,
                )
            )
            session.add(
                Booking(
                    room_id=salle.id,
                    owner_id=parc_isole["comptes"][1].id,
                    title="Collée",
                    time_range=Range(
                        slot.end, slot.end + timedelta(hours=1), bounds="[)"
                    ),
                    attendee_count=2,
                )
            )
            session.commit()

        with Session(engine) as session:
            total = session.scalar(
                text("SELECT count(*) FROM bookings WHERE room_id = :salle").bindparams(
                    salle=salle.id
                )
            )
            assert total == 2

    def test_une_reservation_annulee_ne_bloque_plus_le_creneau(self, engine, parc_isole):
        """L'index d'exclusion est partiel : il ignore les annulées. Sans cela,
        annuler ne libérerait rien, et la salle resterait prise pour toujours."""
        slot = _creneau_futur(10)
        salle = parc_isole["salle"]

        with Session(engine) as session:
            premiere = Booking(
                room_id=salle.id,
                owner_id=parc_isole["comptes"][0].id,
                title="Annulée",
                time_range=Range(slot.start, slot.end, bounds="[)"),
                attendee_count=2,
            )
            session.add(premiere)
            session.commit()
            identifiant = premiere.id

        with Session(engine) as session:
            session.execute(
                text(
                    "UPDATE bookings SET status = 'annulee', "
                    "cancelled_at = now(), cancel_reason = 'Test' WHERE id = :id"
                ).bindparams(id=identifiant)
            )
            session.commit()

        with Session(engine) as session:
            session.add(
                Booking(
                    room_id=salle.id,
                    owner_id=parc_isole["comptes"][1].id,
                    title="Remplaçante",
                    time_range=Range(slot.start, slot.end, bounds="[)"),
                    attendee_count=2,
                )
            )
            session.commit()

        with Session(engine) as session:
            actives = session.scalar(
                text(
                    "SELECT count(*) FROM bookings "
                    "WHERE room_id = :salle AND status <> 'annulee'"
                ).bindparams(salle=salle.id)
            )
            assert actives == 1

    def test_deux_salles_differentes_ne_se_genent_pas(self, engine, parc_isole):
        """La contrainte porte sur le couple salle-créneau. Une contrainte
        posée sur le seul créneau interdirait toute réunion simultanée sur le
        campus, et passerait pourtant tous les tests d'une seule salle."""
        slot = _creneau_futur(11)
        salle = parc_isole["salle"]
        marque = uuid.uuid4().hex[:6]

        with Session(engine, expire_on_commit=False) as session:
            voisine = Room(
                floor_id=salle.floor_id,
                name=f"Salle voisine {marque}",
                slug=f"voisine-{marque}",
                capacity=10,
                area_m2=Decimal("20.00"),
                status=RoomStatus.DISPONIBLE,
                badge_required=False,
            )
            session.add(voisine)
            session.flush()
            for room_id, titre, index in (
                (salle.id, "Ici", 0),
                (voisine.id, "À côté", 1),
            ):
                session.add(
                    Booking(
                        room_id=room_id,
                        owner_id=parc_isole["comptes"][index].id,
                        title=titre,
                        time_range=Range(slot.start, slot.end, bounds="[)"),
                        attendee_count=2,
                    )
                )
            session.commit()
            identifiant_voisine = voisine.id

        with Session(engine) as session:
            session.execute(delete(Booking).where(Booking.room_id == identifiant_voisine))
            session.execute(delete(Room).where(Room.id == identifiant_voisine))
            session.commit()

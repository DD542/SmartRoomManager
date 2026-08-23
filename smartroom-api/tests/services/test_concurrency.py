"""Deux réservations simultanées sur le même créneau : une seule doit aboutir.

Ces tests n'utilisent pas la session transactionnelle des autres : deux
transactions concurrentes doivent être réellement ouvertes en parallèle, sur
deux connexions distinctes, pour que la contrainte `EXCLUDE` entre en jeu. Ils
nettoient donc leurs propres écritures.
"""

from __future__ import annotations

import threading
import uuid
from datetime import date, datetime, time, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import delete, text
from sqlalchemy.dialects.postgresql import Range
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
from tests.services.conftest import PARIS

#: La perdante attend que la gagnante commite : PostgreSQL sérialise les deux
#: écritures sur la contrainte EXCLUDE. Le plafond évite qu'un blocage réel fige
#: le test au lieu de le faire échouer.
VERROU_MAX = "10s"


@pytest.fixture
def parc_isole(engine):
    """Bâtiment, salle et deux comptes, écrits pour de bon puis supprimés."""
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
        for prenom in ("Alice", "Bob"):
            compte = User(
                email=f"{prenom.lower()}-{marque}@ece.fr",
                password_hash="x" * 60,
                first_name=prenom,
                last_name="Concurrent",
            )
            session.add(compte)
            comptes.append(compte)
        session.commit()

        contexte = {"salle": salle, "comptes": comptes}

    yield contexte

    with Session(engine) as session:
        reservations = [
            item for item in session.scalars(
                text("SELECT id FROM bookings WHERE room_id = :salle").bindparams(
                    salle=salle.id
                )
            )
        ]
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


def _creneau_futur() -> TimeSlot:
    jour = date.today() + timedelta(days=3)
    depart = datetime.combine(jour, time(14, 0), tzinfo=PARIS)
    return TimeSlot(start=depart, end=depart + timedelta(hours=1))


def _reserver(engine, salle_id, owner_id, slot, depart, resultats, index) -> None:
    """Réserve dans sa propre transaction, sur sa propre connexion.

    Les deux fils partent au même instant. La sérialisation est celle de
    PostgreSQL : la seconde écriture attend le verdict de la première.
    """
    depart.wait(timeout=10)
    with Session(engine) as session:
        try:
            session.execute(text(f"SET LOCAL lock_timeout = '{VERROU_MAX}'"))
            booking.create_booking(
                session,
                room_id=salle_id,
                owner_id=owner_id,
                slot=slot,
                title=f"Réservation {index}",
                attendees=4,
            )
            session.commit()
            resultats[index] = "reussi"
        except SlotConflictError:
            session.rollback()
            resultats[index] = "conflit"
        except Exception as erreur:  # noqa: BLE001
            session.rollback()
            resultats[index] = f"{type(erreur).__name__}"


class TestConcurrence:
    def test_une_seule_reservation_survit(self, engine, parc_isole):
        """Deux transactions, un créneau : la contrainte EXCLUDE tranche.

        Le moteur détecte le conflit avant l'insertion, mais aucune des deux
        transactions ne voit l'écriture de l'autre avant son COMMIT. C'est
        précisément la fenêtre que la contrainte referme.
        """
        salle = parc_isole["salle"]
        alice, bob = parc_isole["comptes"]
        slot = _creneau_futur()

        depart = threading.Event()
        resultats: dict[int, str] = {}

        fils = [
            threading.Thread(
                target=_reserver,
                args=(engine, salle.id, compte.id, slot, depart, resultats, index),
            )
            for index, compte in enumerate((alice, bob))
        ]
        for fil in fils:
            fil.start()
        depart.set()
        for fil in fils:
            fil.join(timeout=30)

        issues = sorted(resultats.values())
        assert len(resultats) == 2, resultats
        assert issues == ["conflit", "reussi"], resultats

        with Session(engine) as session:
            survivantes = session.scalars(
                text(
                    "SELECT id FROM bookings "
                    " WHERE room_id = :salle AND status <> 'annulee' AND deleted_at IS NULL"
                ).bindparams(salle=salle.id)
            ).all()
        assert len(survivantes) == 1

    def test_le_perdant_recoit_un_message_exploitable(self, engine, parc_isole):
        """La violation `23P01` devient un conflit métier, jamais une erreur 500."""
        salle = parc_isole["salle"]
        alice, bob = parc_isole["comptes"]
        slot = _creneau_futur()

        with Session(engine) as gagnante:
            booking.create_booking(
                session=gagnante,
                room_id=salle.id,
                owner_id=alice.id,
                slot=slot,
                title="Première arrivée",
                attendees=4,
            )
            gagnante.commit()

        with Session(engine) as perdante:
            with pytest.raises(SlotConflictError) as refus:
                booking.create_booking(
                    session=perdante,
                    room_id=salle.id,
                    owner_id=bob.id,
                    slot=slot,
                    title="Seconde arrivée",
                    attendees=4,
                )
            perdante.rollback()

        assert refus.value.http_status == 409
        assert refus.value.message

    def test_la_base_refuse_meme_sans_passer_par_le_service(self, engine, parc_isole):
        """Le dernier rempart tient, quel que soit le chemin d'écriture.

        Deux INSERT bruts, sans moteur ni vérification : seule la contrainte
        `ex_bookings_no_overlap` s'y oppose, et elle suffit.
        """
        salle = parc_isole["salle"]
        alice, bob = parc_isole["comptes"]
        slot = _creneau_futur()
        plage = Range(slot.start, slot.end, bounds="[)")

        with Session(engine) as session:
            session.add(
                Booking(
                    room_id=salle.id, owner_id=alice.id, title="Brute 1",
                    time_range=plage, attendee_count=2,
                )
            )
            session.commit()

        from sqlalchemy.exc import IntegrityError

        with Session(engine) as session:
            session.add(
                Booking(
                    room_id=salle.id, owner_id=bob.id, title="Brute 2",
                    time_range=plage, attendee_count=2,
                )
            )
            with pytest.raises(IntegrityError) as erreur:
                session.commit()
            session.rollback()

        assert getattr(erreur.value.orig, "sqlstate", None) == booking.EXCLUSION_VIOLATION

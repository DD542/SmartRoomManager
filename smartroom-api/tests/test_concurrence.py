"""La double réservation est impossible, y compris sous concurrence.

C'est la garantie centrale du sujet, et la seule que le moteur de disponibilité
ne peut pas offrir : entre sa vérification et l'écriture, une autre transaction
a le temps de s'intercaler. Seule la contrainte `ex_bookings_no_overlap` ferme
cette fenêtre.

Ce test sort volontairement de la fixture transactionnelle : il lui faut deux
connexions réellement distinctes, donc deux transactions concurrentes.
"""

from __future__ import annotations

import threading
import uuid
from datetime import datetime, time, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import delete, select, text
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.orm import Session

from app.db.enums import BookingStatus
from app.models import Booking, Building, Floor, Room, User
from tests.conftest import PARIS

#: Codes SQLSTATE acceptables : violation d'exclusion, ou expiration du verrou
#: pris par la transaction concurrente — les deux prouvent la sérialisation.
CODES_ATTENDUS = {"23P01", "55P03", "40001"}


@pytest.fixture
def decor(engine):
    """Bâtiment, étage, salle et utilisateur dédiés, nettoyés à la fin.

    Les identifiants sont aléatoires : deux exécutions simultanées de la suite
    ne se marcheraient pas dessus.
    """
    marqueur = uuid.uuid4().hex[:8]
    with Session(engine) as session:
        batiment = Building(code=f"X{marqueur[:2].upper()}", name=f"Concurrence {marqueur}")
        session.add(batiment)
        session.flush()
        etage = Floor(building_id=batiment.id, code="C", label="Étage", level=8)
        session.add(etage)
        session.flush()
        salle = Room(
            floor_id=etage.id,
            name=f"Salle concurrence {marqueur}",
            slug=f"salle-concurrence-{marqueur}",
            capacity=10,
            area_m2=Decimal("20.00"),
        )
        compte = User(
            email=f"concurrence-{marqueur}@ece.fr",
            password_hash="x" * 60,
            first_name="Concurrence",
            last_name="Test",
        )
        session.add_all([salle, compte])
        session.commit()
        identifiants = (salle.id, compte.id, batiment.id)

    yield identifiants

    salle_id, user_id, batiment_id = identifiants
    with Session(engine) as session:
        session.execute(delete(Booking).where(Booking.room_id == salle_id))
        session.execute(delete(Room).where(Room.id == salle_id))
        session.execute(delete(User).where(User.id == user_id))
        session.execute(delete(Floor).where(Floor.building_id == batiment_id))
        session.execute(delete(Building).where(Building.id == batiment_id))
        session.commit()


def _reservation(salle_id, user_id, plage, titre):
    return Booking(
        room_id=salle_id,
        owner_id=user_id,
        title=titre,
        time_range=plage,
        attendee_count=4,
        status=BookingStatus.CONFIRMEE,
    )


def test_deux_transactions_simultanees_une_seule_passe(engine, decor):
    salle_id, user_id, _ = decor

    demain = datetime.now(PARIS).date() + timedelta(days=2)
    while demain.weekday() >= 5:
        demain += timedelta(days=1)
    depart = datetime.combine(demain, time(14, 0), tzinfo=PARIS)
    plage = Range(depart, depart + timedelta(minutes=90), bounds="[)")

    premiere_a_insere = threading.Event()
    resultats: dict[str, BaseException | None] = {}

    def transaction_lente() -> None:
        """Insère, laisse l'autre transaction se heurter à elle, puis valide."""
        with Session(engine) as session:
            try:
                session.add(_reservation(salle_id, user_id, plage, "Première"))
                session.flush()
                premiere_a_insere.set()
                # Laisse le temps à la seconde transaction de tenter son écriture.
                threading.Event().wait(0.5)
                session.commit()
                resultats["lente"] = None
            except BaseException as erreur:  # pragma: no cover - ne doit pas arriver
                session.rollback()
                resultats["lente"] = erreur

    def transaction_concurrente() -> None:
        """Tente le même créneau pendant que la première est encore ouverte."""
        premiere_a_insere.wait(timeout=5)
        with Session(engine) as session:
            try:
                # Sans délai maximal, l'insertion attendrait indéfiniment la
                # décision de la transaction concurrente.
                session.execute(text("SET LOCAL lock_timeout = '3s'"))
                session.add(_reservation(salle_id, user_id, plage, "Seconde"))
                session.flush()
                session.commit()
                resultats["concurrente"] = None
            except BaseException as erreur:
                session.rollback()
                resultats["concurrente"] = erreur

    fils = [
        threading.Thread(target=transaction_lente),
        threading.Thread(target=transaction_concurrente),
    ]
    for fil in fils:
        fil.start()
    for fil in fils:
        fil.join(timeout=20)

    assert resultats.get("lente") is None, "la première transaction devait aboutir"

    erreur = resultats.get("concurrente")
    assert isinstance(erreur, (IntegrityError, DBAPIError)), (
        "la seconde transaction devait être refusée par la base"
    )
    sqlstate = getattr(getattr(erreur, "orig", None), "sqlstate", None)
    assert sqlstate in CODES_ATTENDUS, f"code inattendu : {sqlstate}"

    with Session(engine) as session:
        posees = session.scalars(select(Booking).where(Booking.room_id == salle_id)).all()
    assert len(posees) == 1, "une seule réservation doit subsister"
    assert posees[0].title == "Première"


def test_meme_creneau_apres_annulation_est_accepte(engine, decor):
    """Le prédicat de la contrainte exclut les annulées : le créneau se libère."""
    salle_id, user_id, _ = decor

    demain = datetime.now(PARIS).date() + timedelta(days=3)
    while demain.weekday() >= 5:
        demain += timedelta(days=1)
    depart = datetime.combine(demain, time(10, 0), tzinfo=PARIS)
    plage = Range(depart, depart + timedelta(minutes=60), bounds="[)")

    with Session(engine) as session:
        premiere = _reservation(salle_id, user_id, plage, "À annuler")
        session.add(premiere)
        session.commit()

        premiere.status = BookingStatus.ANNULEE
        premiere.cancelled_at = datetime.now(PARIS)
        premiere.cancel_reason = "Réunion reportée"
        session.commit()

        session.add(_reservation(salle_id, user_id, plage, "Nouvelle"))
        session.commit()  # ne doit pas lever

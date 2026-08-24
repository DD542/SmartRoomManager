"""Tâches planifiées.

Quatre traitements périodiques, chacun avec sa cadence propre :

  - le **rappel** avant le créneau, toutes les cinq minutes ;
  - la **libération** des créneaux non validés, à la même cadence, parce qu'un
    créneau abandonné doit être rendu vite ;
  - le **rafraîchissement** de la vue matérialisée d'occupation, plus lent ;
  - la **purge** des jetons expirés, une fois par jour.

APScheduler tourne dans le processus de l'API. Ce n'est pas une architecture de
production — un ordonnanceur externe serait plus robuste — mais elle a la
propriété qui compte ici : le déploiement reste un seul conteneur.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime, timedelta

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.orm import Session, selectinload

from app.core.config import get_settings
from app.db.enums import BookingStatus
from app.db.session import SessionLocal
from app.models import Booking, Notification, Room
from app.services import auth_service, booking_service, mail_service, stats_service

logger = logging.getLogger(__name__)
settings = get_settings()

#: Code du gabarit de rappel, tel qu'inséré par les données de référence.
GABARIT_RAPPEL = "reservation_rappel"


def _session() -> Session:
    """Session dédiée : les tâches ne partagent rien avec les requêtes en vol."""
    return SessionLocal()


def send_reminders(session: Session, now: datetime | None = None) -> int:
    """Prévient les organisateurs dont le créneau approche.

    La fenêtre est bornée des deux côtés et la notification déjà envoyée sert
    de garde : sans elle, chaque passage renverrait le même rappel toutes les
    cinq minutes jusqu'au début de la réunion.
    """
    now = now or datetime.now(UTC)
    horizon = now + timedelta(minutes=settings.reminder_lead_minutes)

    imminentes = session.scalars(
        select(Booking)
        .options(selectinload(Booking.owner), selectinload(Booking.room))
        .where(
            Booking.status == BookingStatus.CONFIRMEE,
            Booking.deleted_at.is_(None),
            Booking.owner_id.is_not(None),
            Booking.time_range.op("&&")(Range(now, horizon, bounds="[)")),
            Booking.time_range.op(">>")(Range(None, now, bounds="[)")),
        )
    ).all()

    envoyes = 0
    for reservation in imminentes:
        # La garde porte sur la fenêtre, pas sur le libellé : celui-ci vient
        # d'un gabarit qu'un administrateur peut réécrire, et s'y fier ferait
        # repartir le rappel toutes les cinq minutes le jour où il change.
        depuis = reservation.time_range.lower - timedelta(
            minutes=settings.reminder_lead_minutes
        )
        deja = session.scalars(
            select(Notification).where(
                Notification.booking_id == reservation.id,
                Notification.sent_at >= depuis,
            )
        ).first()
        if deja is not None:
            continue

        salle = session.get(Room, reservation.room_id)
        mail_service.notify(
            session,
            user=reservation.owner,
            code=GABARIT_RAPPEL,
            booking_id=reservation.id,
            variables={
                "titre": reservation.title,
                "salle": salle.name if salle else "",
                "debut": reservation.time_range.lower.isoformat(),
                "minutes": settings.reminder_lead_minutes,
            },
        )
        envoyes += 1

    session.commit()
    return envoyes


def release_and_close(session: Session, now: datetime | None = None) -> tuple[int, int]:
    """Libère les créneaux non validés, puis clôture les créneaux écoulés.

    L'ordre compte : clôturer d'abord ferait passer en « terminée » une
    réservation dont la fenêtre de validation vient d'expirer, et elle
    échapperait à la libération.
    """
    now = now or datetime.now(UTC)
    liberees = booking_service.release_no_shows(session, now)
    closes = booking_service.close_finished_bookings(session, now)
    session.commit()
    return len(liberees), closes


async def _expedier() -> None:
    """Vide la file de courriels accumulée par les traitements.

    Les envois ont lieu **après** le COMMIT : expédier avant annoncerait une
    réservation qu'un `ROLLBACK` ferait disparaître.
    """
    for message in mail_service.flush():
        await mail_service.send(message)


async def _tache_reservations() -> None:
    with _session() as session:
        liberees, closes = await asyncio.to_thread(release_and_close, session)
        rappels = await asyncio.to_thread(send_reminders, session)

    await _expedier()

    if liberees or closes or rappels:
        logger.info(
            "Maintenance : %s libérée(s), %s clôturée(s), %s rappel(s).",
            liberees,
            closes,
            rappels,
        )


async def _tache_statistiques() -> None:
    with _session() as session:
        await asyncio.to_thread(stats_service.refresh_occupancy, session)
    logger.info("Vue d'occupation rafraîchie.")


async def _tache_purge() -> None:
    with _session() as session:
        supprimes = await asyncio.to_thread(auth_service.purge_expired, session)
        session.commit()
    if supprimes:
        logger.info("Purge : %s jeton(s) expiré(s) supprimé(s).", supprimes)


def build_scheduler() -> AsyncIOScheduler:
    """Assemble l'ordonnanceur sans le démarrer.

    `coalesce` et `max_instances=1` évitent l'empilement : si un passage
    déborde sur le suivant, mieux vaut en sauter un que les faire se marcher
    dessus sur les mêmes lignes.
    """
    scheduler = AsyncIOScheduler(
        timezone="UTC",
        job_defaults={"coalesce": True, "max_instances": 1, "misfire_grace_time": 60},
    )

    scheduler.add_job(
        _tache_reservations,
        "interval",
        seconds=settings.maintenance_interval_seconds,
        id="reservations",
        name="Libération, clôture et rappels",
    )
    scheduler.add_job(
        _tache_statistiques,
        "interval",
        # Trois fois la durée du cache : rafraîchir plus vite ne servirait
        # qu'à relire une vue dont personne n'a encore vu la version précédente.
        seconds=settings.stats_cache_seconds * 3,
        id="statistiques",
        name="Rafraîchissement des agrégats",
    )
    scheduler.add_job(
        _tache_purge,
        "cron",
        hour=3,
        minute=17,
        id="purge",
        name="Purge des jetons expirés",
    )
    return scheduler

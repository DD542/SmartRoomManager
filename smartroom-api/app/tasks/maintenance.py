"""Tâche périodique : rendre les créneaux que personne n'occupe.

Sans elle, une réservation abandonnée bloquerait la salle jusqu'à son terme.
La contrainte anti-chevauchement garantit qu'on ne réserve pas deux fois ; c'est
cette tâche qui garantit qu'on ne réserve pas *pour rien*.

Elle tourne dans le processus de l'API. Ce n'est pas une architecture de
production — un ordonnanceur externe serait plus robuste — mais elle a la
propriété qui compte ici : le déploiement reste un seul conteneur.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.schemas.reservations import MaintenanceReport
from app.services.booking import close_finished_bookings, release_no_shows

logger = logging.getLogger(__name__)
settings = get_settings()
FUSEAU = ZoneInfo(settings.timezone)


def passer(session: Session, maintenant: datetime | None = None) -> MaintenanceReport:
    """Un passage complet, dans une seule transaction.

    L'ordre compte : on libère avant de clôturer, sinon une réservation dont la
    fenêtre de validation vient d'expirer serait déjà passée en « terminée » et
    échapperait à la libération.
    """
    maintenant = maintenant or datetime.now(FUSEAU)

    liberees = release_no_shows(session, maintenant)
    closes = close_finished_bookings(session, maintenant)
    session.commit()

    return MaintenanceReport(released=len(liberees), closed=closes, ran_at=maintenant)


async def boucle(intervalle: int | None = None) -> None:
    """Boucle de fond, annulée proprement à l'extinction de l'application."""
    periode = intervalle or settings.maintenance_interval_seconds

    while True:
        try:
            await asyncio.sleep(periode)
        except asyncio.CancelledError:
            logger.info("Tâche de maintenance arrêtée.")
            raise

        try:
            # `to_thread` : les services sont synchrones, les exécuter dans la
            # boucle d'événements gèlerait toutes les requêtes en cours.
            bilan = await asyncio.to_thread(_passer_isole)
        except Exception:
            # Une erreur ne doit pas tuer la boucle : la prochaine itération
            # retentera, et l'incident reste tracé.
            logger.exception("Échec d'un passage de maintenance")
            continue

        if bilan.released or bilan.closed:
            logger.info(
                "Maintenance : %s créneau(x) libéré(s), %s réservation(s) clôturée(s).",
                bilan.released,
                bilan.closed,
            )


def _passer_isole() -> MaintenanceReport:
    """Session dédiée : la tâche ne partage rien avec les requêtes en vol."""
    with SessionLocal() as session:
        return passer(session)

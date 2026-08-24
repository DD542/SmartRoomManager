"""Agrégats des tableaux de bord.

Tout est calculé en SQL. Charger les réservations pour les compter en Python
ferait grossir la réponse avec l'historique, alors que ces écrans doivent
répondre en temps constant quel que soit le volume.

Les agrégats coûteux s'appuient sur `mv_room_occupancy_hourly`, rafraîchie par
la tâche planifiée. Leur durée de validité est portée par l'en-tête
`Cache-Control` des routes : cinq minutes par défaut — au-delà, un
administrateur verrait des chiffres périmés ; en deçà, la vue serait relue pour
rien.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import get_settings

settings = get_settings()

#: Fenêtre par défaut des tableaux de bord.
FENETRE_JOURS = 30


def _periode(first_day: date | None, last_day: date | None, jours: int) -> tuple[date, date]:
    fin = last_day or date.today()
    debut = first_day or (fin - timedelta(days=jours))
    return debut, fin


def me(session: Session, user_id: uuid.UUID, *, days: int = FENETRE_JOURS) -> dict[str, Any]:
    """Chiffres personnels : heures réservées, assiduité, quota restant.

    Une seule requête, sept agrégats. Le taux d'absence ne compte que les
    réservations écoulées : une réunion de demain n'est ni honorée ni manquée.
    """
    ligne = session.execute(
        text(
            """
            SELECT
                count(*) FILTER (WHERE status <> 'annulee')                 AS actives,
                count(*) FILTER (WHERE status = 'annulee')                  AS annulees,
                count(*) FILTER (
                    WHERE upper(time_range) <= now() AND status <> 'annulee'
                )                                                            AS ecoulees,
                count(*) FILTER (
                    WHERE upper(time_range) <= now()
                      AND status <> 'annulee'
                      AND checked_in_at IS NOT NULL
                )                                                            AS honorees,
                COALESCE(SUM(
                    EXTRACT(EPOCH FROM (upper(time_range) - lower(time_range))) / 3600
                ) FILTER (WHERE status <> 'annulee'), 0)::numeric(10, 2)     AS heures,
                count(DISTINCT room_id) FILTER (WHERE status <> 'annulee')   AS salles,
                count(*) FILTER (
                    WHERE lower(time_range) > now() AND status <> 'annulee'
                )                                                            AS a_venir
              FROM bookings
             WHERE owner_id = CAST(:utilisateur AS uuid)
               AND deleted_at IS NULL
               AND upper(time_range) >= now() - make_interval(days => CAST(:jours AS integer))
            """
        ),
        {"utilisateur": str(user_id), "jours": days},
    ).one()

    ecoulees = ligne.ecoulees or 0
    return {
        "window_days": days,
        "total_bookings": (ligne.actives or 0) + (ligne.annulees or 0),
        "active_bookings": ligne.actives or 0,
        "cancelled_bookings": ligne.annulees or 0,
        "upcoming_bookings": ligne.a_venir or 0,
        "booked_hours": float(ligne.heures or 0),
        "distinct_rooms": ligne.salles or 0,
        "attendance_rate": round((ligne.honorees or 0) / ecoulees, 4) if ecoulees else None,
        "no_show_rate": (
            round(1 - (ligne.honorees or 0) / ecoulees, 4) if ecoulees else None
        ),
    }


def my_bookings_csv(session: Session, user_id: uuid.UUID) -> str:
    """Export CSV des réservations d'un compte.

    Le formatage se fait en SQL : construire les lignes en Python imposerait de
    charger l'historique entier pour le recracher aussitôt.
    """
    lignes = session.execute(
        text(
            """
            SELECT to_char(lower(b.time_range) AT TIME ZONE smartroom_timezone(),
                           'DD/MM/YYYY')                                  AS jour,
                   to_char(lower(b.time_range) AT TIME ZONE smartroom_timezone(),
                           'HH24:MI')                                     AS debut,
                   to_char(upper(b.time_range) AT TIME ZONE smartroom_timezone(),
                           'HH24:MI')                                     AS fin,
                   r.name                                                 AS salle,
                   b.title                                                AS titre,
                   b.attendee_count                                       AS effectif,
                   b.status::text                                         AS statut
              FROM bookings b
              JOIN rooms r ON r.id = b.room_id
             WHERE b.owner_id = CAST(:utilisateur AS uuid)
               AND b.deleted_at IS NULL
             ORDER BY lower(b.time_range) DESC
            """
        ),
        {"utilisateur": str(user_id)},
    ).all()

    entete = "Date;Début;Fin;Salle;Titre;Effectif;Statut"
    corps = "\n".join(
        ";".join(str(valeur).replace(";", ",") for valeur in ligne) for ligne in lignes
    )
    return f"{entete}\n{corps}\n" if corps else f"{entete}\n"


def public(session: Session) -> dict[str, Any]:
    """Chiffres de la page d'accueil publique, sans donnée personnelle."""
    ligne = session.execute(
        text(
            """
            SELECT
                (SELECT count(*) FROM rooms
                  WHERE deleted_at IS NULL AND status = 'disponible')      AS salles,
                (SELECT count(*) FROM buildings)                           AS batiments,
                (SELECT COALESCE(SUM(capacity), 0) FROM rooms
                  WHERE deleted_at IS NULL AND status = 'disponible')      AS places,
                (SELECT count(*) FROM bookings
                  WHERE deleted_at IS NULL
                    AND status <> 'annulee'
                    AND lower(time_range) >= now() - INTERVAL '30 days')   AS reservations
            """
        )
    ).one()

    return {
        "rooms": ligne.salles or 0,
        "buildings": ligne.batiments or 0,
        "seats": ligne.places or 0,
        "bookings_last_30_days": ligne.reservations or 0,
    }


def overview(session: Session, *, days: int = 7) -> dict[str, Any]:
    """Vue d'ensemble du tableau de bord d'administration."""
    ligne = session.execute(
        text(
            """
            WITH periode AS (
                SELECT now() - make_interval(days => CAST(:jours AS integer)) AS depuis
            )
            SELECT
                (SELECT count(*) FROM bookings, periode
                  WHERE deleted_at IS NULL
                    AND status <> 'annulee'
                    AND lower(time_range) >= periode.depuis)                AS reservations,
                (SELECT count(*) FROM bookings, periode
                  WHERE deleted_at IS NULL
                    AND status = 'annulee'
                    AND cancelled_at >= periode.depuis)                     AS annulations,
                (SELECT count(*) FROM bookings, periode
                  WHERE deleted_at IS NULL
                    AND status <> 'annulee'
                    AND checked_in_at IS NULL
                    AND upper(time_range) <= now()
                    AND upper(time_range) >= periode.depuis)                AS absences,
                (SELECT count(*) FROM access_requests
                  WHERE status = 'ouvert')                                  AS demandes,
                (SELECT count(*) FROM tickets
                  WHERE status IN ('ouvert', 'en_cours'))                   AS tickets,
                (SELECT count(*) FROM rooms
                  WHERE deleted_at IS NULL AND status = 'maintenance')      AS maintenance,
                (SELECT COALESCE(ROUND(AVG(occupancy_rate) * 100), 0)
                   FROM v_room_occupancy_daily, periode
                  WHERE occupancy_date >= periode.depuis::date)             AS occupation
            """
        ),
        {"jours": days},
    ).one()

    return {
        "window_days": days,
        "bookings": ligne.reservations or 0,
        "cancellations": ligne.annulations or 0,
        "no_shows": ligne.absences or 0,
        "pending_access_requests": ligne.demandes or 0,
        "open_tickets": ligne.tickets or 0,
        "rooms_in_maintenance": ligne.maintenance or 0,
        "occupancy_percent": int(ligne.occupation or 0),
    }


def occupancy(
    session: Session,
    *,
    first_day: date | None = None,
    last_day: date | None = None,
    building_ids: list[uuid.UUID] | None = None,
    granularity: str = "day",
) -> list[dict[str, Any]]:
    """Série d'occupation, agrégée au jour, à la semaine ou au mois.

    `date_trunc` fait le regroupement en base : produire une série journalière
    puis la replier en Python transporterait trente fois plus de lignes.
    """
    if granularity not in {"day", "week", "month"}:
        from app.core.errors import ValidationError

        raise ValidationError(
            "Granularité inconnue : `day`, `week` ou `month`.",
            fields=[{"field": "granularity", "message": "Valeur non reconnue."}],
        )

    debut, fin = _periode(first_day, last_day, FENETRE_JOURS)
    lignes = session.execute(
        text(
            f"""
            SELECT date_trunc('{granularity}', occupancy_date)::date  AS periode,
                   ROUND(AVG(occupancy_rate) * 100)::int              AS taux,
                   SUM(booking_count)::int                            AS reservations,
                   ROUND(SUM(booked_minutes) / 60.0, 1)::float        AS heures
              FROM v_room_occupancy_daily
             WHERE occupancy_date BETWEEN CAST(:debut AS date) AND CAST(:fin AS date)
               AND (
                    CAST(:batiments AS uuid[]) IS NULL
                    OR cardinality(CAST(:batiments AS uuid[])) = 0
                    OR building_id = ANY(CAST(:batiments AS uuid[]))
               )
             GROUP BY 1
             ORDER BY 1
            """
        ),
        {
            "debut": debut,
            "fin": fin,
            "batiments": [str(item) for item in (building_ids or [])],
        },
    ).all()

    return [
        {
            "period": ligne.periode.isoformat(),
            "occupancy_percent": ligne.taux or 0,
            "bookings": ligne.reservations or 0,
            "hours": ligne.heures or 0.0,
        }
        for ligne in lignes
    ]


def rooms(
    session: Session,
    *,
    first_day: date | None = None,
    last_day: date | None = None,
    limit: int = 20,
) -> list[dict[str, Any]]:
    """Classement des salles par occupation.

    Le décompte de réservations et l'occupation viennent de deux sources : les
    joindre directement multiplierait les lignes. Deux CTE les gardent séparés.
    """
    debut, fin = _periode(first_day, last_day, FENETRE_JOURS)
    lignes = session.execute(
        text(
            """
            WITH occupation AS (
                SELECT room_id,
                       ROUND(AVG(occupancy_rate) * 100)::int AS taux,
                       ROUND(SUM(booked_minutes) / 60.0, 1)::float AS heures
                  FROM v_room_occupancy_daily
                 WHERE occupancy_date BETWEEN CAST(:debut AS date) AND CAST(:fin AS date)
                 GROUP BY room_id
            ),
            activite AS (
                SELECT room_id,
                       count(*)::int AS reservations,
                       count(*) FILTER (WHERE checked_in_at IS NULL
                                          AND upper(time_range) <= now())::int AS absences
                  FROM bookings
                 WHERE deleted_at IS NULL
                   AND status <> 'annulee'
                   AND lower(time_range) >= CAST(:debut AS date)
                 GROUP BY room_id
            )
            SELECT r.id, r.name, r.capacity, b.name AS batiment,
                   COALESCE(o.taux, 0)          AS taux,
                   COALESCE(o.heures, 0)        AS heures,
                   COALESCE(a.reservations, 0)  AS reservations,
                   COALESCE(a.absences, 0)      AS absences
              FROM rooms r
              JOIN floors f ON f.id = r.floor_id
              JOIN buildings b ON b.id = f.building_id
              LEFT JOIN occupation o ON o.room_id = r.id
              LEFT JOIN activite a ON a.room_id = r.id
             WHERE r.deleted_at IS NULL AND r.status <> 'archivee'
             ORDER BY COALESCE(o.taux, 0) DESC, r.name
             LIMIT CAST(:limite AS integer)
            """
        ),
        {"debut": debut, "fin": fin, "limite": limit},
    ).all()

    return [
        {
            "room_id": str(ligne.id),
            "room_name": ligne.name,
            "building_name": ligne.batiment,
            "capacity": ligne.capacity,
            "occupancy_percent": ligne.taux,
            "hours": ligne.heures,
            "bookings": ligne.reservations,
            "no_shows": ligne.absences,
        }
        for ligne in lignes
    ]


def peak_hours(
    session: Session, *, first_day: date | None = None, last_day: date | None = None
) -> list[dict[str, Any]]:
    """Répartition horaire de l'occupation, jour de semaine par jour de semaine."""
    debut, fin = _periode(first_day, last_day, FENETRE_JOURS)
    lignes = session.execute(
        text(
            """
            SELECT EXTRACT(DOW FROM occupancy_date)::int AS jour,
                   hour_of_day                           AS heure,
                   SUM(booking_count)::int               AS reservations,
                   ROUND(SUM(booked_minutes) / 60.0, 1)::float AS heures
              FROM mv_room_occupancy_hourly
             WHERE occupancy_date BETWEEN CAST(:debut AS date) AND CAST(:fin AS date)
             GROUP BY 1, 2
             ORDER BY 1, 2
            """
        ),
        {"debut": debut, "fin": fin},
    ).all()

    return [
        {
            "weekday": ligne.jour,
            "hour": ligne.heure,
            "bookings": ligne.reservations,
            "hours": ligne.heures,
        }
        for ligne in lignes
    ]


def occupancy_csv(
    session: Session, *, first_day: date | None = None, last_day: date | None = None
) -> str:
    debut, fin = _periode(first_day, last_day, FENETRE_JOURS)
    lignes = rooms(session, first_day=debut, last_day=fin, limit=500)

    entete = "Salle;Bâtiment;Capacité;Occupation %;Heures;Réservations;Absences"
    corps = "\n".join(
        ";".join(
            str(
                ligne[cle]
            ).replace(";", ",")
            for cle in (
                "room_name",
                "building_name",
                "capacity",
                "occupancy_percent",
                "hours",
                "bookings",
                "no_shows",
            )
        )
        for ligne in lignes
    )
    return f"{entete}\n{corps}\n" if corps else f"{entete}\n"


def refresh_occupancy(session: Session) -> None:
    """Rafraîchit la vue matérialisée. Appelée par la tâche planifiée.

    `CONCURRENTLY` évite de verrouiller la vue pendant le rafraîchissement :
    les tableaux de bord restent consultables. Le repli sans l'option couvre le
    premier rafraîchissement, où l'option est refusée.
    """
    try:
        session.execute(text("REFRESH MATERIALIZED VIEW CONCURRENTLY mv_room_occupancy_hourly"))
    except Exception:  # noqa: BLE001
        session.rollback()
        session.execute(text("REFRESH MATERIALIZED VIEW mv_room_occupancy_hourly"))
    session.commit()

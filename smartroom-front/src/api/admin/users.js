// src/api/admin/users.js
// Endpoints réels :
//   GET   /api/v1/admin/users                   annuaire filtré et paginé
//   GET   /api/v1/admin/users/{id}              fiche, métriques agrégées en SQL
//   PATCH /api/v1/admin/users/{id}/status       suspendre ou réactiver
//   PATCH /api/v1/admin/users/{id}/quota        ajuster le quota hebdomadaire
//   GET   /api/v1/admin/bookings?owner_id=      dernières réservations du compte

import * as adapt from '../adapters';
import { ApiError, abortable, get, items, patch } from '../client';

const metriques = (data) =>
  data
    ? {
        activeBookings: data.active_bookings,
        cancellations: data.cancellations,
        noShows: data.no_shows,
        attendanceRate: data.attendance_rate,
        bookedHours: data.booked_hours_this_week,
        weeklyQuotaHours: data.weekly_quota_hours,
        remainingCredits: data.remaining_credits_h,
      }
    : null;

const compte = (data) => ({
  ...adapt.user(data),
  role: data.is_admin ? 'admin' : 'utilisateur',
  metrics: metriques(data.metrics),
});

export async function listManagedUsers(filters = {}) {
  const page = await get('/admin/users', {
    params: {
      promotion: filters.promotion || undefined,
      department: filters.department || undefined,
      status: filters.status || undefined,
      role: filters.role || undefined,
      q: filters.query || undefined,
      size: 100,
    },
    signal: abortable('admin:users'),
  });
  return items(page).map(compte);
}

/**
 * Fiche d'un compte.
 *
 * Les métriques — quota consommé, absences, taux de présence — sont agrégées
 * en SQL et jamais stockées : elles bougent à chaque écriture, et un compteur
 * matérialisé se désynchroniserait à la première annulation.
 */
export async function getManagedUser(id, { signal } = {}) {
  const [fiche, reservations] = await Promise.all([
    get(`/admin/users/${id}`, { signal }),
    get('/admin/bookings', {
      params: { owner_id: id, limit: 5 },
      signal,
    }).catch(() => []),
  ]);

  return {
    ...compte(fiche),
    recentBookings: reservations.map(adapt.booking).map((item) => ({
      id: item.id,
      roomName: item.roomName ?? item.roomId,
      start: item.start,
      status: item.status,
      checkedIn: item.checkedIn,
    })),
  };
}

/**
 * Suspension d'un compte.
 *
 * Le motif est exigé par l'API : une suspension sans raison consignée est
 * inexploitable en relecture. Les sessions ouvertes tombent côté serveur —
 * laisser courir un jeton de quinze minutes viderait la décision de son sens.
 *
 * Les réservations à venir ne sont pas annulées d'office : l'administrateur
 * décide ensuite, depuis la liste des réservations.
 */
export async function setUserStatus(id, status, { reason } = {}) {
  if (!['actif', 'suspendu'].includes(status)) {
    throw new ApiError('Statut inconnu.', 422, 'statut_invalide');
  }

  const data = await patch(`/admin/users/${id}/status`, {
    status,
    reason:
      reason?.trim()
      || (status === 'suspendu' ? 'Suspension administrative' : 'Réactivation du compte'),
  });

  const aVenir = await get('/admin/bookings', {
    params: { owner_id: id, status: 'confirmee', from_date: new Date().toISOString(), limit: 100 },
  }).catch(() => []);

  return { ...compte(data), upcomingBookings: aVenir.length };
}

export async function adjustCredits(id, hours) {
  const heures = Number(hours);
  if (!Number.isFinite(heures) || heures < 1) {
    throw new ApiError('Nombre d’heures invalide.', 422, 'heures_invalides');
  }

  const data = await patch(`/admin/users/${id}/quota`, { weekly_quota_hours: heures });
  return { id, metrics: metriques(data) };
}

/**
 * Valeurs proposées par les filtres.
 *
 * Mesurées sur l'annuaire réel : une liste écrite en dur proposerait des
 * promotions que plus personne ne suit, et en tairait de nouvelles.
 */
export async function listUserFilters({ signal } = {}) {
  const page = await get('/admin/users', { params: { size: 100 }, signal });
  const lignes = items(page);

  return {
    promotions: [...new Set(lignes.map((item) => item.promotion))].filter(Boolean).sort(),
    departments: [...new Set(lignes.map((item) => item.department))].filter(Boolean).sort(),
    roles: ['utilisateur', 'admin'],
  };
}

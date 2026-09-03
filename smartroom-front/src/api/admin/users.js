// src/api/admin/users.js
// Endpoints réels :
//   GET   /api/v1/admin/users                   annuaire filtré et paginé
//   GET   /api/v1/admin/users/{id}              fiche, métriques agrégées en SQL
//   PATCH /api/v1/admin/users/{id}/status       suspendre ou réactiver
//   PATCH /api/v1/admin/users/{id}/quota        ajuster le quota hebdomadaire
//   GET   /api/v1/admin/bookings?owner_id=      dernières réservations du compte

import * as adapt from '../adapters';
import { ApiError, abortable, del, get, items, patch } from '../client';

/**
 * Métriques d'un compte, sous les noms que lit `UsersTable`.
 *
 * La table affiche un taux de no-show et un score de fiabilité ; l'API rend un
 * taux de présence. Les deux se déduisent de lui, et le déduire ici plutôt que
 * dans le composant garde une seule définition de « fiable ».
 *
 * Sans historique, le taux est nul côté API et les deux mesures restent nulles
 * ici : la table affiche « — », ce qui est plus honnête qu'un 100/100 accordé
 * à un compte qui n'a jamais rien réservé.
 */
const metriques = (data) => {
  if (!data) return null;
  const presence = data.attendance_rate;
  return {
    bookings: data.active_bookings,
    noShowRate: presence === null || presence === undefined ? null : 1 - presence,
    reliabilityScore:
      presence === null || presence === undefined ? null : Math.round(presence * 100),
    remainingCreditsH: data.remaining_credits_h,
    // Conservées telles quelles pour la fiche détaillée, qui les affiche
    // séparément du tableau.
    cancellations: data.cancellations,
    noShows: data.no_shows,
    attendanceRate: presence,
    bookedHours: data.booked_hours_this_week,
    weeklyQuotaHours: data.weekly_quota_hours,
  };
};

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
      params: { owner_id: id, size: 5 },
      signal,
    })
      .then(items)
      .catch(() => []),
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
/**
 * Retrait d'un compte, par anonymisation.
 *
 * La ligne n'est pas effacee : le journal d'audit, les frises de reservation
 * et les agregats d'occupation la referencent tous. Ce que le reglement
 * demande n'est pas la disparition de l'historique, c'est celle de l'identite.
 *
 * Le motif suit la meme exigence qu'une suspension, et pour la meme raison :
 * c'est ce que l'audit conservera de la decision.
 */
export async function anonymiseUser(id, { reason } = {}) {
  const motif = reason?.trim() ?? '';
  if (motif.length < 3) {
    throw new ApiError('Indiquez le motif du retrait.', 422, 'motif_requis');
  }

  await del(`/admin/users/${id}`, { body: { reason: motif } });
  return { id, reason: motif };
}


export async function setUserStatus(id, status, { reason } = {}) {
  if (!['actif', 'suspendu'].includes(status)) {
    throw new ApiError('Statut inconnu.', 422, 'statut_invalide');
  }

  // Le motif n'est pas complété par défaut : l'API l'exige, et lui substituer
  // un « Suspension administrative » générique remplirait le journal d'audit
  // d'entrées qui ne disent rien de la décision. L'écran le fait saisir.
  const motif = reason?.trim() ?? '';
  if (motif.length < 3) {
    throw new ApiError('Indiquez le motif de la décision.', 422, 'motif_requis');
  }

  const data = await patch(`/admin/users/${id}/status`, { status, reason: motif });

  // Le total de l'enveloppe, et non la longueur de la page : compter les
  // lignes rendues plafonnerait le décompte à la taille de page.
  const aVenir = await get('/admin/bookings', {
    params: {
      owner_id: id,
      status: 'confirmee',
      from_date: new Date().toISOString(),
      size: 1,
    },
  }).catch(() => ({ total: 0 }));

  return { ...compte(data), upcomingBookings: aVenir.total ?? 0 };
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

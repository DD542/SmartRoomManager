// src/api/admin/users.js
// Endpoints FastAPI cibles :
//   GET   /api/admin/users?promotion=&department=&status=&role=&q=
//   GET   /api/admin/users/{id}            fiche complète et métriques
//   PATCH /api/admin/users/{id}/status     suspension, réactivation
//   PATCH /api/admin/users/{id}/credits    ajustement du quota

import { users as seedUsers } from '../../mocks/users';
import { roomById } from '../../mocks/rooms';
import { NOW, durationMin, toDate } from '../../utils/dates';
import { normalize } from '../../utils/format';
import { ApiError, clone, createStore, delay } from '../client';
import { bookingStore } from '../bookings';

const store = createStore(
  seedUsers.map((user) => ({ ...user, status: user.id === 'u-04' ? 'suspendu' : 'actif' })),
);

/**
 * Métriques calculées depuis le magasin de réservations, comme les statistiques
 * personnelles : annuler ou créer une réservation les déplace immédiatement.
 */
const quotaDe = (user) => user?.preferences?.weeklyQuotaHours ?? 12;

function metriques(userId, quotaHebdo = 12) {
  const siennes = bookingStore.filter((booking) => booking.ownerId === userId);
  const actives = siennes.filter((booking) => booking.status !== 'annulee');
  const passees = actives.filter((booking) => toDate(booking.end) < NOW);
  const presentes = passees.filter((booking) => booking.checkedIn);

  const heures = actives.reduce((total, b) => total + durationMin(b.start, b.end), 0) / 60;
  const noShow = passees.length === 0 ? 0 : 1 - presentes.length / passees.length;
  const annulations = siennes.filter((booking) => booking.status === 'annulee').length;

  // Score de fiabilité : la présence pèse le plus, les annulations pénalisent.
  const fiabilite = Math.max(
    0,
    Math.round(100 - noShow * 60 - (annulations / Math.max(1, siennes.length)) * 25),
  );

  return {
    // Sans historique, aucun score : « — » vaut mieux qu'un 100/100 trompeur.
    reliabilityScore: siennes.length === 0 ? null : fiabilite,
    remainingCreditsH: Math.max(0, Math.round(quotaHebdo - heures / 4)),
    bookedHours: Math.round(heures),
    attendanceRate: passees.length === 0 ? 1 : presentes.length / passees.length,
    noShowRate: noShow,
    bookings: actives.length,
    cancellations: annulations,
  };
}

export async function listManagedUsers(filters = {}) {
  await delay();
  const { promotion, department, status, role, query } = filters;

  return store
    .all()
    .filter((user) => (promotion ? user.promotion === promotion : true))
    .filter((user) => (department ? user.department === department : true))
    .filter((user) => (status ? user.status === status : true))
    .filter((user) => (role ? user.role === role : true))
    .filter((user) =>
      query
        ? normalize(`${user.firstName} ${user.lastName} ${user.email}`).includes(normalize(query))
        : true,
    )
    // Le quota est propre à chaque compte : le laisser à sa valeur par défaut
    // afficherait des crédits restants faux dès qu'il a été ajusté.
    .map((user) => ({ ...user, metrics: metriques(user.id, quotaDe(user)) }));
}

export async function getManagedUser(id) {
  await delay();
  const user = store.find((item) => item.id === id);
  if (!user) throw new ApiError('Utilisateur introuvable.', 404, 'introuvable');

  const dernieres = bookingStore
    .filter((booking) => booking.ownerId === id)
    .sort((a, b) => toDate(b.start) - toDate(a.start))
    .slice(0, 5)
    .map((booking) => ({
      id: booking.id,
      roomName: roomById[booking.roomId]?.name ?? booking.roomId,
      start: booking.start,
      status: booking.status,
      checkedIn: booking.checkedIn,
    }));

  return { ...user, metrics: metriques(id, quotaDe(user)), recentBookings: dernieres };
}

/**
 * Suspension d'un compte. Les réservations à venir ne sont pas annulées
 * d'office : l'administrateur décide ensuite, depuis la liste des réservations.
 */
export async function setUserStatus(id, status) {
  await delay();
  if (!['actif', 'suspendu'].includes(status)) {
    throw new ApiError('Statut inconnu.', 422, 'statut_invalide');
  }
  const updated = store.update(id, { status });
  if (!updated) throw new ApiError('Utilisateur introuvable.', 404, 'introuvable');

  const aVenir = bookingStore.filter(
    (booking) =>
      booking.ownerId === id && booking.status === 'confirmee' && toDate(booking.start) >= NOW,
  );
  return { ...updated, metrics: metriques(id, quotaDe(updated)), upcomingBookings: aVenir.length };
}

export async function adjustCredits(id, hours) {
  await delay();
  if (Number.isNaN(Number(hours))) {
    throw new ApiError('Nombre d’heures invalide.', 422, 'heures_invalides');
  }
  const updated = store.update(id, (user) => ({
    preferences: { ...user.preferences, weeklyQuotaHours: Number(hours) },
  }));
  if (!updated) throw new ApiError('Utilisateur introuvable.', 404, 'introuvable');
  return { ...updated, metrics: metriques(id, Number(hours)) };
}

export async function listUserFilters() {
  await delay(120);
  const all = store.all();
  return {
    promotions: [...new Set(all.map((user) => user.promotion))].filter((p) => p !== '—'),
    departments: [...new Set(all.map((user) => user.department))],
    roles: [...new Set(all.map((user) => user.role))],
  };
}

// src/api/bookings.js
// Endpoints réels :
//   GET    /api/v1/bookings                        mes réservations
//   POST   /api/v1/bookings                        créer — 409 porteur d'alternatives
//   GET    /api/v1/bookings/{id}                   détail
//   PATCH  /api/v1/bookings/{id}                   déplacer ou modifier
//   POST   /api/v1/bookings/{id}/cancel            annuler
//   GET    /api/v1/bookings/{id}/alternatives      propositions de remplacement
//   POST   /api/v1/bookings/recurring[/preview]    séries
//   POST   /api/v1/bookings/participants/respond   réponse à une invitation
//   POST   /api/v1/availability/rooms/{id}/check   vérification d'un créneau

import * as adapt from './adapters';
import { ApiError, abortable, del, get, items, patch, post } from './client';

const iso = (valeur) => (valeur instanceof Date ? valeur.toISOString() : valeur);

/** Motifs proposés à l'annulation. Fixes : ils alimentent une liste déroulante. */
const MOTIFS = [
  { id: 'reporte', label: 'Réunion reportée' },
  { id: 'annulee', label: 'Réunion annulée' },
  { id: 'salle', label: 'Changement de salle' },
  { id: 'effectif', label: "Effectif finalement différent" },
  { id: 'autre', label: 'Autre motif' },
];

export async function listBookings(filters = {}) {
  const page = await get('/bookings', {
    params: {
      status: filters.status,
      from_date: iso(filters.from),
      to_date: iso(filters.to),
      size: 100,
    },
    signal: abortable('bookings:list'),
  });
  return items(page).map(adapt.booking);
}

/**
 * Réservations d'une salle.
 *
 * Passe par le calendrier plutôt que par la liste personnelle : les
 * réservations d'une salle appartiennent à tout le monde, et `GET /bookings`
 * ne rend que les siennes.
 */
export async function listRoomBookings(roomId, { from, to } = {}) {
  const debut = from ?? new Date();
  const fin = to ?? new Date(debut.getTime() + 7 * 86_400_000);

  const data = await get('/availability/calendar', {
    params: { from_date: iso(debut), to_date: iso(fin), room_ids: [roomId] },
    signal: abortable(`bookings:room:${roomId}`),
  });
  return data.events.map((item) => ({
    id: item.id,
    roomId: item.room_id,
    title: item.title,
    start: new Date(item.start),
    end: new Date(item.end),
    status: item.status,
    isMine: item.is_mine,
    isBlocking: item.is_blocking,
  }));
}

export async function getBooking(id, { signal } = {}) {
  return adapt.booking(await get(`/bookings/${id}`, { signal }));
}

/** Prochaine réservation à venir : le tableau de bord n'en affiche qu'une. */
export async function getNextBooking() {
  const page = await get('/bookings', {
    params: { status: 'confirmee', from_date: new Date().toISOString(), size: 1 },
  });
  const [premiere] = items(page);
  return premiere ? adapt.booking(premiere) : null;
}

/**
 * Verdict du moteur sur un créneau.
 *
 * La forme rendue est celle qu'attendaient les écrans : `ok`, `rules`,
 * `conflicts`, `alternatives`. Les alternatives ne sont plus devinées — elles
 * viennent du moteur de recommandation, qui connaît le parc entier.
 */
export async function checkSlot({ roomId, start, end, attendees = 1, ignoreBookingId }) {
  const data = await post(
    `/availability/rooms/${roomId}/check`,
    {
      slot: adapt.slotIn(start, end),
      attendees,
      ignore_booking_id: ignoreBookingId ?? null,
    },
    { signal: abortable(`bookings:check:${roomId}`) },
  );

  const verdict = adapt.slotCheck(data);
  let alternatives = [];
  if (verdict.conflicts.some((item) => item.blocking)) {
    alternatives = await suggestAlternatives({ roomId, start, end, attendees });
  }

  return {
    ok: verdict.available,
    forcible: verdict.forcible,
    requiresValidation: verdict.requiresValidation,
    rules: {
      ok: verdict.violations.length === 0,
      errors: verdict.violations,
    },
    conflicts: verdict.conflicts,
    alternatives,
  };
}

async function suggestAlternatives({ roomId, start, end, attendees }) {
  try {
    const data = await post(`/recommendations/rooms/${roomId}/alternatives`, {
      slot: adapt.slotIn(start, end),
      attendees,
    });
    return data.map(adapt.alternative);
  } catch {
    // Une alternative manquante ne doit pas masquer le conflit lui-même :
    // l'écran affiche le refus, sans consolation.
    return [];
  }
}

/**
 * Crée une réservation.
 *
 * Un 409 remonte tel quel : il porte déjà le conflit qualifié et les
 * alternatives, que l'écran de conflit affiche sans second aller-retour.
 */
export async function createBooking(payload) {
  const data = await post('/bookings', {
    room_id: payload.roomId,
    slot: adapt.slotIn(payload.start, payload.end),
    title: payload.title?.trim() || 'Réunion',
    attendees: payload.attendees ?? 1,
    participants: (payload.participants ?? []).map((item) => [item.email, item.name ?? item.email]),
  });

  return {
    ...adapt.booking(data.booking),
    accessCode: data.access_code?.code ?? null,
    accessCodeHint: data.access_code?.hint ?? null,
  };
}

export async function previewSeries({ roomId, date, startTime, endTime, rule }) {
  const data = await post('/bookings/recurring/preview', serieIn({ roomId, date, startTime, endTime, rule }));
  return {
    occurrences: data.occurrences.map((item) => ({
      ...adapt.slotOut(item.slot),
      accepted: item.accepted,
      reason: item.reason,
    })),
    acceptedCount: data.accepted_count,
    rejectedCount: data.rejected_count,
  };
}

export async function createSeries({ roomId, date, startTime, endTime, rule, ...rest }) {
  const data = await post('/bookings/recurring', {
    ...serieIn({ roomId, date, startTime, endTime, rule }),
    title: rest.title?.trim() || 'Réunion récurrente',
    attendees: rest.attendees ?? 1,
  });

  return {
    ruleId: data.rule_id,
    bookings: data.bookings.map(adapt.booking),
    skipped: data.skipped.map((item) => ({
      ...adapt.slotOut(item.slot),
      reason: item.reason,
    })),
  };
}

/** La récurrence du front — `{ freq, interval, weekdays, until }` — vers l'API. */
function serieIn({ roomId, date, startTime, endTime, rule }) {
  return {
    room_id: roomId,
    freq: rule?.freq ?? 'hebdomadaire',
    interval_count: rule?.interval ?? 1,
    // Le front compte les jours comme `Date.getDay()` : dimanche = 0, comme
    // `EXTRACT(DOW)`. Aucune conversion n'est donc nécessaire.
    byweekday: rule?.weekdays?.length ? rule.weekdays : [new Date(date).getDay()],
    start_date: date,
    until_date: rule?.until ?? date,
    start_time: startTime,
    end_time: endTime,
  };
}

export async function updateBooking(id, patchBody) {
  const corps = {};
  if (patchBody.start && patchBody.end) corps.slot = adapt.slotIn(patchBody.start, patchBody.end);
  if (patchBody.title !== undefined) corps.title = patchBody.title;
  if (patchBody.attendees !== undefined) corps.attendees = patchBody.attendees;

  return adapt.booking(await patch(`/bookings/${id}`, corps));
}

/**
 * Émet un nouveau code d'accès et révoque le précédent.
 *
 * Le code en clair n'existe qu'au moment de son émission : il n'est ni
 * conservé, ni relisible. Le réémettre est donc le seul moyen d'en redonner un
 * à qui l'a perdu.
 */
export async function reissueAccessCode(id) {
  const data = await post(`/bookings/${id}/access-code`, {});
  return {
    code: data.code,
    hint: data.hint,
    expiresAt: data.expires_at ? new Date(data.expires_at) : null,
  };
}

export async function cancelBooking(id, { reason, comment }) {
  const motif = [MOTIFS.find((item) => item.id === reason)?.label ?? reason, comment]
    .filter(Boolean)
    .join(' — ');

  if (!motif || motif.trim().length < 3) {
    throw new ApiError('Le motif d’annulation est obligatoire.', 422, 'motif_requis');
  }
  return adapt.booking(await post(`/bookings/${id}/cancel`, { reason: motif }));
}

export async function getAlternatives(bookingId, { limit = 5 } = {}) {
  const data = await get(`/bookings/${bookingId}/alternatives`, { params: { limit } });
  return data.map(adapt.alternative);
}

/* -------------------------------------------------------------------------- */
/* Participants                                                               */
/* -------------------------------------------------------------------------- */

export async function listParticipants(bookingId, { signal } = {}) {
  const data = await get(`/bookings/${bookingId}/participants`, { signal });
  return data.map(adapt.participant);
}

export async function inviteParticipant(bookingId, { email, name }) {
  const data = await post(`/bookings/${bookingId}/participants`, {
    email,
    display_name: name ?? email,
  });
  return {
    ...adapt.participant(data.participant),
    invitationToken: data.invitation_token,
  };
}

export async function removeParticipant(bookingId, participantId) {
  await del(`/bookings/${bookingId}/participants/${participantId}`);
  return { removed: true };
}

/**
 * Réponse à une invitation.
 *
 * Ouverte sans session : le jeton porte l'identité. Un invité extérieur n'a pas
 * de compte, et lui en imposer un pour cliquer « je viens » ferait tomber le
 * taux de réponse.
 */
export async function respondToInvitation(_bookingId, { token, response }) {
  const data = await post('/bookings/participants/respond', { token, response });
  return adapt.participant(data);
}

export async function listCancelReasons() {
  return MOTIFS.map((item) => ({ ...item }));
}

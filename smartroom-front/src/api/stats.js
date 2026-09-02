// src/api/stats.js
// Endpoints réels :
//   GET /api/v1/stats/me            agrégats personnels, une requête
//   GET /api/v1/stats/me/export     export CSV de mes réservations
//   GET /api/v1/stats/public        chiffres de la page d'accueil
//   GET /api/v1/bookings            base des répartitions par mois, salle, tranche

import { getMonth, getYear } from 'date-fns';
import { durationMin, heureCampus, toDate } from '../utils/dates';
import * as adapt from './adapters';
import { abortable, collect, get, getText } from './client';

const MOIS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];

const TRANCHES = [
  { id: '08-10', label: '08:00 - 10:00', from: 8, to: 10 },
  { id: '10-12', label: '10:00 - 12:00', from: 10, to: 12 },
  { id: '14-16', label: '14:00 - 16:00', from: 14, to: 16 },
  { id: '16-18', label: '16:00 - 18:00', from: 16, to: 18 },
];

const FENETRE_JOURS = { mois: 31, trimestre: 92, annee: 365 };

/**
 * Chiffres personnels.
 *
 * Les indicateurs viennent du serveur, qui les agrège en une requête. Les
 * répartitions — par mois, par salle, par tranche — sont calculées ici depuis
 * mes propres réservations : elles portent sur quelques dizaines de lignes déjà
 * chargées, et trois endpoints d'agrégation de plus ne serviraient qu'un écran.
 */
export async function getMyStats(period = 'trimestre', _ownerId, { signal } = {}) {
  const jours = FENETRE_JOURS[period] ?? 92;
  const depuis = new Date(Date.now() - jours * 86_400_000);

  const [chiffres, lignes] = await Promise.all([
    get('/stats/me', { params: { days: jours }, signal: signal ?? abortable('stats:me') }),
    collect('/bookings', { params: { from_date: depuis.toISOString() }, signal }),
  ]);

  const reservations = lignes.map(adapt.booking).filter((item) => item.status !== 'annulee');
  const anneeCourante = getYear(new Date());

  const byMonth = MOIS.map((label, index) => ({
    label,
    hours: Math.round(
      reservations
        .filter(
          (item) => getYear(item.start) === anneeCourante && getMonth(item.start) === index,
        )
        .reduce((somme, item) => somme + durationMin(item.start, item.end), 0) / 60,
    ),
  })).filter((_, index) => index <= getMonth(new Date()));

  const parSalle = new Map();
  reservations.forEach((item) => {
    const cle = item.roomId;
    const courant = parSalle.get(cle) ?? { roomId: cle, name: item.roomName ?? cle, count: 0 };
    courant.count += 1;
    parSalle.set(cle, courant);
  });
  const byRoom = [...parSalle.values()]
    .map((item) => ({ ...item, share: item.count / (reservations.length || 1) }))
    .sort((a, b) => b.count - a.count);

  const bySlot = TRANCHES.map((tranche) => {
    const count = reservations.filter((item) => {
      // Heure du campus, et non celle du poste : les tranches sont les
      // creneaux d'ouverture de l'etablissement.
      const heure = heureCampus(item.start);
      return heure >= tranche.from && heure < tranche.to;
    }).length;
    return { ...tranche, count, share: count / (reservations.length || 1) };
  });

  return {
    period,
    kpis: {
      bookings: chiffres.active_bookings,
      hours: Math.round(chiffres.booked_hours),
      cancelled: chiffres.cancelled_bookings,
      attendance: chiffres.attendance_rate,
    },
    byMonth,
    byRoom,
    bySlot,
    observation: observation(byRoom, bySlot),
  };
}

/**
 * Phrase d'observation.
 *
 * Construite depuis les répartitions plutôt que figée : une remarque écrite en
 * dur cesserait d'être vraie dès la première réservation ajoutée.
 */
function observation(byRoom, bySlot) {
  const salle = byRoom[0];
  const tranche = [...bySlot].sort((a, b) => b.count - a.count)[0];
  if (!salle || !tranche?.count) return 'Pas encore assez de réservations pour dégager une tendance.';

  return `Vous réservez surtout ${salle.name} (${Math.round(salle.share * 100)} % de vos créneaux), principalement entre ${tranche.label}.`;
}

/** Chiffres de la page d'accueil : aucun n'est personnel. */
export async function getPublicStats({ signal } = {}) {
  const data = await get('/stats/public', { signal });
  return {
    rooms: data.rooms,
    buildings: data.buildings,
    seats: data.seats,
    bookings: data.bookings_last_30_days,
    // La contrainte d'exclusion rend le chevauchement impossible en base : le
    // chiffre est zéro par construction, pas par mesure.
    doubleBookings: 0,
  };
}

/**
 * Export de mes réservations.
 *
 * CSV et non PDF : le serveur formate le fichier en SQL, et fabriquer un PDF
 * demanderait une dépendance de rendu pour un contenu qui reste tabulaire.
 */
export async function exportStats(period) {
  const csv = await getText('/stats/me/export');
  const nom = `mes-reservations-${period}.csv`;
  telecharger(csv, nom);
  return { period, ready: true, filename: nom };
}

function telecharger(contenu, nom) {
  const url = URL.createObjectURL(new Blob([contenu], { type: 'text/csv;charset=utf-8' }));
  const lien = document.createElement('a');
  lien.href = url;
  lien.download = nom;
  lien.click();
  URL.revokeObjectURL(url);
}

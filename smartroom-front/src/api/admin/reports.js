// src/api/admin/reports.js
// Endpoints FastAPI cibles :
//   GET  /api/admin/reports/overview?days=          tableau de bord d'occupation
//   GET  /api/admin/reports?from=&to=&buildings=&granularity=
//   POST /api/admin/reports/export                  génération de l'export

import { getDay, getMonth } from 'date-fns';
import { buildings } from '../../mocks/buildings';
import { roomById, rooms } from '../../mocks/rooms';
import {
  NOW,
  addDays,
  durationMin,
  fmtDayMonth,
  isSameDay,
  startOfDay,
  toDate,
  toDateInput,
} from '../../utils/dates';
import { ApiError, clone, delay } from '../client';
import { bookingStore } from '../bookings';
import { queueStore } from './conflicts';

const actives = () => bookingStore.filter((booking) => booking.status !== 'annulee');

const heuresDe = (liste) => liste.reduce((total, b) => total + durationMin(b.start, b.end), 0) / 60;

/** Amplitude d'ouverture retenue pour ramener les heures réservées en taux. */
const AMPLITUDE_H = 12;

/**
 * Tableau de bord A-01 : quatre indicateurs comparés à la période précédente,
 * courbe d'occupation, alertes et densité horaire.
 */
export async function getOverview(days = 7) {
  await delay();
  const debut = addDays(NOW, -days);
  const debutPrecedent = addDays(NOW, -days * 2);

  const dans = (from, to) =>
    actives().filter((booking) => toDate(booking.start) >= from && toDate(booking.start) < to);

  // La fenêtre s'arrête à la fin de la journée en cours : « sur 7 jours » ne
  // doit pas embarquer les réservations de demain matin.
  const periode = dans(debut, addDays(startOfDay(NOW), 1));
  const precedente = dans(debutPrecedent, debut);

  const ouvrables = rooms.filter((room) => room.status !== 'maintenance');
  const occupationMoyenne =
    ouvrables.reduce((total, room) => total + room.occupancyRate, 0) / (ouvrables.length || 1);

  const noShow = tauxNoShow(periode);
  const ouverts = queueStore.filter((item) => item.status === 'ouvert');

  return {
    days,
    kpis: {
      occupancyRate: occupationMoyenne,
      periodBookings: periode.length,
      pendingConflicts: ouverts.length,
      resolvedConflicts: queueStore.filter((item) => item.status !== 'ouvert').length,
      noShowRate: noShow,
    },
    // Variations calculées face à la même durée juste avant : sans cela, la
    // flèche de tendance des tuiles serait décorative.
    deltas: {
      periodBookings: periode.length - precedente.length,
      noShowRate: noShow - tauxNoShow(precedente),
    },
    trend: tendance(days, ouvrables.length),
    alerts: alertes(ouverts.length),
    heatmap: heatmap(),
  };
}

/** Part des réservations passées dont la présence n'a jamais été validée. */
function tauxNoShow(liste) {
  const passees = liste.filter((booking) => toDate(booking.end) < NOW);
  if (passees.length === 0) return 0;
  return 1 - passees.filter((booking) => booking.checkedIn).length / passees.length;
}

/** Courbe jour par jour : taux d'occupation, volume et heures réservées. */
function tendance(days, sallesOuvrables) {
  return Array.from({ length: days }, (_, index) => {
    const jour = addDays(NOW, -(days - 1 - index));
    const duJour = actives().filter((booking) => isSameDay(toDate(booking.start), jour));
    const heures = heuresDe(duJour);
    const capacite = Math.max(1, sallesOuvrables * AMPLITUDE_H);
    return {
      label: index === days - 1 ? "Auj." : fmtDayMonth(jour),
      date: jour.toISOString(),
      occupation: Math.round(Math.min(100, (heures / capacite) * 100)),
      bookings: duJour.length,
      hours: Math.round(heures * 10) / 10,
    };
  });
}

/** Alertes dérivées de l'état réel du parc, jamais écrites en dur. */
function alertes(conflitsOuverts = 0) {
  const liste = [];

  if (conflitsOuverts > 0) {
    liste.push({
      id: 'file-arbitrage',
      tone: conflitsOuverts > 3 ? 'warning' : 'info',
      message: `${conflitsOuverts} demande(s) en attente d'arbitrage`,
      action: { label: 'Traiter', to: '/admin/conflits', permission: 'conflicts.arbitrate' },
    });
  }

  for (const room of rooms) {
    if (room.status === 'maintenance') {
      liste.push({
        id: `maint-${room.id}`,
        tone: 'warning',
        message: `${room.name} en maintenance`,
        action: { label: 'Détails', to: `/admin/salles/${room.id}`, permission: 'rooms.manage' },
      });
    }
    if (room.occupancyRate < 0.3 && room.status === 'disponible') {
      liste.push({
        id: `sous-${room.id}`,
        tone: 'info',
        message: `${room.name} sous-utilisée : ${Math.round(room.occupancyRate * 100)} % en moyenne`,
        action: { label: 'Voir', to: `/admin/salles/${room.id}`, permission: 'rooms.manage' },
      });
    }
  }
  return liste.slice(0, 5);
}

/** Densité d'occupation par jour ouvré et par heure. */
function heatmap() {
  const heures = Array.from({ length: 12 }, (_, index) => 8 + index);
  const jours = [1, 2, 3, 4, 5];
  const cellules = [];

  for (const jour of jours) {
    for (const heure of heures) {
      const compte = actives().filter((booking) => {
        const debut = toDate(booking.start);
        return getDay(debut) === jour && debut.getHours() === heure;
      }).length;
      cellules.push({ day: jour, hour: heure, value: compte });
    }
  }
  const max = Math.max(1, ...cellules.map((cell) => cell.value));
  return { hours: heures, days: jours, cells: cellules.map((c) => ({ ...c, ratio: c.value / max })) };
}

/** Rapports A-02 : agrégats par salle, par bâtiment et par période. */
export async function getReport({ from, to, buildingIds = [], granularity = 'mois' } = {}) {
  await delay();
  const debut = from ? startOfDay(toDate(from)) : addDays(NOW, -30);
  // La borne haute couvre le jour entier : sinon une date de fin fixée à
  // aujourd'hui exclurait toutes les réservations… d'aujourd'hui.
  const fin = to ? addDays(startOfDay(toDate(to)), 1) : NOW;

  const periode = actives().filter(
    (booking) => toDate(booking.start) >= debut && toDate(booking.start) < fin,
  );
  const retenues = periode.filter((booking) =>
    buildingIds.length === 0
      ? true
      : buildingIds.includes(roomById[booking.roomId]?.buildingId),
  );

  const parSalle = rooms
    .filter((room) => (buildingIds.length === 0 ? true : buildingIds.includes(room.buildingId)))
    .map((room) => {
      const siennes = retenues.filter((booking) => booking.roomId === room.id);
      const passees = siennes.filter((booking) => toDate(booking.end) < NOW);
      const absences = passees.filter((booking) => !booking.checkedIn).length;
      return {
        roomId: room.id,
        room: room.name,
        building: buildings.find((b) => b.id === room.buildingId)?.name ?? '',
        bookings: siennes.length,
        hours: Math.round(heuresDe(siennes)),
        occupancy: room.occupancyRate,
        noShow: passees.length === 0 ? 0 : absences / passees.length,
      };
    })
    .sort((a, b) => b.bookings - a.bookings);

  const parPeriode =
    granularity === 'jour'
      ? grouper(retenues, (booking) => isoJour(booking.start), (cle) => fmtDayMonth(toDate(cle)))
      : grouper(retenues, (booking) => isoJour(booking.start).slice(0, 7), (cle) =>
          MOIS[getMonth(toDate(`${cle}-01`))],
        );

  // Les heures des bâtiments et du total sont sommées à partir des heures déjà
  // arrondies par salle : sans cela, trois arrondis indépendants affichent un
  // total inférieur à la somme de ses parts, et le rapport se contredit.
  const parBatiment = buildings
    .filter((batiment) => (buildingIds.length === 0 ? true : buildingIds.includes(batiment.id)))
    .map((batiment) => {
      const siennes = parSalle.filter((salle) => roomById[salle.roomId]?.buildingId === batiment.id);
      return {
        id: batiment.id,
        label: batiment.name,
        bookings: siennes.reduce((total, salle) => total + salle.bookings, 0),
        hours: siennes.reduce((total, salle) => total + salle.hours, 0),
      };
    })
    .filter((entree) => entree.bookings > 0);

  return {
    from: debut,
    to: fin,
    granularity,
    byRoom: parSalle,
    byPeriod: parPeriode,
    byBuilding: parBatiment,
    totals: {
      bookings: retenues.length,
      hours: parSalle.reduce((total, salle) => total + salle.hours, 0),
      rooms: parSalle.length,
      usedRooms: parSalle.filter((salle) => salle.bookings > 0).length,
      noShow: tauxNoShow(retenues),
    },
  };
}

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/**
 * Regroupe des réservations par tranche de temps.
 *
 * La clé est toujours une date ISO tronquée, jamais le libellé affiché : trier
 * « 01/04 » et « 26/03 » comme du texte remettrait avril avant mars.
 */
function grouper(liste, cle, libelle) {
  const carte = liste.reduce((acc, booking) => {
    const k = cle(booking);
    acc[k] = (acc[k] ?? 0) + durationMin(booking.start, booking.end) / 60;
    return acc;
  }, {});

  return Object.entries(carte)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, hours]) => ({ label: libelle(k), hours: Math.round(hours) }));
}

/** Jour local au format ISO, sans passer par UTC qui décalerait la date. */
const isoJour = (value) => toDateInput(toDate(value));

export const COLONNES_EXPORT = [
  { id: 'room', label: 'Salle / Espace', default: true },
  { id: 'building', label: 'Localisation (bâtiment)', default: true },
  { id: 'bookings', label: 'Volume de réservations', default: true },
  { id: 'hours', label: 'Heures totales', default: true },
  { id: 'occupancy', label: 'Taux d’occupation', default: true },
  { id: 'noShow', label: 'Taux de no-show', default: true },
  { id: 'organisers', label: 'Détails organisateurs', default: false },
];

export async function exportReport({ format = 'csv', columns = [], ...filters } = {}) {
  if (!['csv', 'pdf', 'excel'].includes(format)) {
    throw new ApiError('Format d’export inconnu.', 422, 'format_invalide');
  }
  // Un export sans colonne produirait un fichier vide : autant le refuser ici.
  if (columns.length === 0) {
    throw new ApiError('Sélectionnez au moins une colonne à exporter.', 422, 'colonnes_requises');
  }

  await delay(700);
  const rapport = await getReport(filters);
  const extension = { csv: 'csv', pdf: 'pdf', excel: 'xlsx' }[format];
  const lignes = rapport.byRoom.filter((salle) => salle.bookings > 0);

  return {
    filename: `rapport-occupation-${toDateInput(NOW)}.${extension}`,
    format,
    columns: columns.filter((id) => COLONNES_EXPORT.some((colonne) => colonne.id === id)),
    rows: lignes.length,
    generatedAt: NOW.toISOString(),
  };
}

export const colonnesExport = () => clone(COLONNES_EXPORT);

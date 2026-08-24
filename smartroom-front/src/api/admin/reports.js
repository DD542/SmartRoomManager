// src/api/admin/reports.js
// Endpoints réels :
//   GET /api/v1/admin/stats/overview     sept indicateurs, une requête
//   GET /api/v1/admin/stats/occupancy    série temporelle, granularité au choix
//   GET /api/v1/admin/stats/rooms        classement des salles
//   GET /api/v1/admin/stats/peak-hours   densité par jour ouvré et par heure
//   GET /api/v1/admin/stats/export       export CSV de l'occupation
//   GET /api/v1/admin/access-requests    file d'arbitrage, pour les alertes
//
// Aucun agrégat n'est recalculé ici : ils viennent de vues et de requêtes SQL,
// et les refaire en JavaScript sur un échantillon rapatrié donnerait des
// chiffres différents de ceux qu'affiche le reste de l'application.

import { addDays, toDateInput } from '../../utils/dates';
import * as adapt from '../adapters';
import { ApiError, abortable, get, getText } from '../client';

const jour = (valeur) => toDateInput(valeur);

/** Tableau de bord de l'administration. */
export async function getOverview(days = 7) {
  const signal = abortable('admin:overview');
  const aujourdhui = new Date();
  const debut = addDays(aujourdhui, -(days - 1));

  const [courant, precedent, tendance, salles, file] = await Promise.all([
    get('/admin/stats/overview', { params: { days }, signal }),
    get('/admin/stats/overview', { params: { days: days * 2 }, signal }),
    get('/admin/stats/occupancy', {
      params: { first_day: jour(debut), last_day: jour(aujourdhui), granularity: 'jour' },
      signal,
    }),
    get('/admin/stats/rooms', { params: { limit: 50 }, signal }),
    get('/admin/access-requests', { params: { request_status: 'ouvert', size: 1 }, signal })
      .then((page) => page.total ?? 0)
      .catch(() => 0),
  ]);

  // La fenêtre double couvre la période courante *et* la précédente : leur
  // différence donne la précédente seule, sans second appel décalé.
  const precedentSeul = {
    bookings: precedent.bookings - courant.bookings,
    noShows: precedent.no_shows - courant.no_shows,
  };
  const tauxNoShow = (reservations, absences) =>
    reservations > 0 ? absences / reservations : 0;

  return {
    days,
    kpis: {
      occupancyRate: courant.occupancy_percent / 100,
      periodBookings: courant.bookings,
      pendingConflicts: file,
      resolvedConflicts: courant.cancellations,
      noShowRate: tauxNoShow(courant.bookings, courant.no_shows),
    },
    deltas: {
      periodBookings: courant.bookings - precedentSeul.bookings,
      noShowRate:
        tauxNoShow(courant.bookings, courant.no_shows)
        - tauxNoShow(precedentSeul.bookings, precedentSeul.noShows),
    },
    trend: tendance.map((point, index) => ({
      label: index === tendance.length - 1 ? 'Auj.' : point.period,
      date: point.period,
      occupation: point.occupancy_percent,
      bookings: point.bookings,
      hours: point.hours,
    })),
    alerts: alertes(file, salles, courant),
    heatmap: await heatmap(signal),
  };
}

/** Alertes dérivées de l'état réel du parc, jamais écrites en dur. */
function alertes(conflitsOuverts, salles, apercu) {
  const liste = [];

  if (conflitsOuverts > 0) {
    liste.push({
      id: 'file-arbitrage',
      tone: conflitsOuverts > 3 ? 'warning' : 'info',
      message: `${conflitsOuverts} demande(s) en attente d'arbitrage`,
      action: { label: 'Traiter', to: '/admin/conflits', permission: 'conflicts.arbitrate' },
    });
  }
  if (apercu.rooms_in_maintenance > 0) {
    liste.push({
      id: 'maintenance',
      tone: 'warning',
      message: `${apercu.rooms_in_maintenance} salle(s) en maintenance`,
      action: { label: 'Voir', to: '/admin/salles', permission: 'rooms.manage' },
    });
  }
  if (apercu.open_tickets > 0) {
    liste.push({
      id: 'tickets',
      tone: 'info',
      message: `${apercu.open_tickets} ticket(s) ouvert(s)`,
      action: { label: 'Traiter', to: '/admin/tickets', permission: 'support.handle' },
    });
  }

  salles
    .filter((salle) => salle.occupancy_percent < 30)
    .slice(0, 2)
    .forEach((salle) =>
      liste.push({
        id: `sous-${salle.room_id}`,
        tone: 'info',
        message: `${salle.room_name} sous-utilisée : ${salle.occupancy_percent} % en moyenne`,
        action: {
          label: 'Voir',
          to: `/admin/salles/${salle.room_id}`,
          permission: 'rooms.manage',
        },
      }),
    );

  return liste.slice(0, 5);
}

/** Densité d'occupation par jour ouvré et par heure. */
async function heatmap(signal) {
  const points = await get('/admin/stats/peak-hours', { signal });
  const heures = Array.from({ length: 12 }, (_, index) => 8 + index);
  const jours = [1, 2, 3, 4, 5];

  const parCle = new Map(points.map((item) => [`${item.weekday}-${item.hour}`, item.bookings]));
  const cellules = jours.flatMap((j) =>
    heures.map((h) => ({ day: j, hour: h, value: parCle.get(`${j}-${h}`) ?? 0 })),
  );
  const max = Math.max(1, ...cellules.map((cell) => cell.value));

  return {
    hours: heures,
    days: jours,
    cells: cellules.map((cell) => ({ ...cell, ratio: cell.value / max })),
  };
}

/** Rapport d'occupation détaillé, filtrable par période et par bâtiment. */
export async function getReport({ from, to, buildingIds = [], granularity = 'mois' } = {}) {
  const signal = abortable('admin:report');
  const debut = from ? new Date(from) : addDays(new Date(), -30);
  const fin = to ? new Date(to) : new Date();
  const bornes = { first_day: jour(debut), last_day: jour(fin) };

  const [salles, periodes, batiments] = await Promise.all([
    get('/admin/stats/rooms', { params: { ...bornes, limit: 200 }, signal }),
    get('/admin/stats/occupancy', { params: { ...bornes, granularity }, signal }),
    get('/buildings', { signal }).then((data) => data.map(adapt.building)),
  ]);

  const nomsRetenus = new Set(
    batiments.filter((item) => buildingIds.includes(item.id)).map((item) => item.name),
  );
  const retenus = buildingIds.length
    ? salles.filter((salle) => nomsRetenus.has(salle.building_name))
    : salles;

  const byRoom = retenus
    .map((salle) => ({
      roomId: salle.room_id,
      room: salle.room_name,
      building: salle.building_name,
      bookings: salle.bookings,
      hours: Math.round(salle.hours),
      occupancy: salle.occupancy_percent / 100,
      noShow: salle.bookings > 0 ? salle.no_shows / salle.bookings : 0,
    }))
    .sort((a, b) => b.bookings - a.bookings);

  // Les heures des bâtiments sont sommées depuis les heures déjà arrondies par
  // salle : sans cela, deux arrondis indépendants donnent un total qui
  // contredit la somme de ses parts, et le rapport se contredit lui-même.
  const byBuilding = batiments
    .filter((batiment) => (buildingIds.length === 0 ? true : buildingIds.includes(batiment.id)))
    .map((batiment) => {
      const siennes = byRoom.filter((salle) => salle.building === batiment.name);
      return {
        id: batiment.id,
        label: batiment.name,
        bookings: siennes.reduce((total, salle) => total + salle.bookings, 0),
        hours: siennes.reduce((total, salle) => total + salle.hours, 0),
      };
    })
    .filter((entree) => entree.bookings > 0);

  const absences = retenus.reduce((total, salle) => total + salle.no_shows, 0);
  const total = byRoom.reduce((somme, salle) => somme + salle.bookings, 0);

  return {
    from: debut,
    to: fin,
    granularity,
    byRoom,
    byPeriod: periodes.map((point) => ({ label: point.period, hours: Math.round(point.hours) })),
    byBuilding,
    totals: {
      bookings: total,
      hours: byRoom.reduce((somme, salle) => somme + salle.hours, 0),
      rooms: byRoom.length,
      usedRooms: byRoom.filter((salle) => salle.bookings > 0).length,
      noShow: total > 0 ? absences / total : 0,
    },
  };
}

export const COLONNES_EXPORT = [
  { id: 'room', label: 'Salle / Espace', default: true },
  { id: 'building', label: 'Localisation (bâtiment)', default: true },
  { id: 'bookings', label: 'Volume de réservations', default: true },
  { id: 'hours', label: 'Heures totales', default: true },
  { id: 'occupancy', label: 'Taux d’occupation', default: true },
  { id: 'noShow', label: 'Taux de no-show', default: true },
  { id: 'organisers', label: 'Détails organisateurs', default: false },
];

/**
 * Export du rapport.
 *
 * Le CSV est produit par le serveur, en SQL : le régénérer côté écran depuis
 * des agrégats déjà arrondis donnerait un fichier différent du tableau affiché.
 * Les autres formats ne sont pas servis — un PDF demanderait un moteur de rendu
 * hors de la liste de dépendances arrêtée.
 */
export async function exportReport({ format = 'csv', columns = [], ...filters } = {}) {
  if (format !== 'csv') {
    throw new ApiError(
      'Seul l’export CSV est disponible : il s’ouvre dans un tableur.',
      422,
      'format_indisponible',
    );
  }
  if (columns.length === 0) {
    throw new ApiError('Sélectionnez au moins une colonne à exporter.', 422, 'colonnes_requises');
  }

  const debut = filters.from ? new Date(filters.from) : addDays(new Date(), -30);
  const fin = filters.to ? new Date(filters.to) : new Date();

  const csv = await getText('/admin/stats/export', {
    params: { first_day: jour(debut), last_day: jour(fin) },
  });
  const nom = `rapport-occupation-${jour(new Date())}.csv`;
  telecharger(csv, nom);

  return {
    filename: nom,
    format,
    columns: columns.filter((id) => COLONNES_EXPORT.some((colonne) => colonne.id === id)),
    rows: Math.max(0, csv.trim().split('\n').length - 1),
    generatedAt: new Date().toISOString(),
  };
}

/** Remise du fichier au navigateur, sans dépendance de téléchargement. */
export function telecharger(contenu, nom) {
  const url = URL.createObjectURL(new Blob([contenu], { type: 'text/csv;charset=utf-8' }));
  const lien = document.createElement('a');
  lien.href = url;
  lien.download = nom;
  lien.click();
  URL.revokeObjectURL(url);
}

export const colonnesExport = () => COLONNES_EXPORT.map((item) => ({ ...item }));

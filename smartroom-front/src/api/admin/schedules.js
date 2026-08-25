// src/api/admin/schedules.js
// Endpoints réels :
//   GET    /api/v1/opening-hours              horaires, par portée
//   PUT    /api/v1/opening-hours/{scope}      remplacement en bloc d'une portée
//   GET    /api/v1/closures                   fermetures, filtrables par période
//   GET    /api/v1/closures/{id}/impact       réservations qu'elle empêcherait
//   POST   /api/v1/closures                   déclarer une fermeture
//   DELETE /api/v1/closures/{id}              lever une fermeture

import { toDateInput } from '../../utils/dates';
import * as adapt from '../adapters';
import { ApiError, collect, del, get, items, post, put } from '../client';

/**
 * Jours de la grille, dans l'ordre où ils se lisent.
 *
 * `day` est la valeur du réseau, où 0 vaut dimanche — c'est la convention de
 * `EXTRACT(DOW)`, que la base impose et qui reste inchangée. Seul l'ordre de
 * cette liste gouverne l'affichage : une semaine d'établissement commence le
 * lundi, et présenter dimanche en tête faisait lire le week-end en premier.
 */
const JOURS = [
  { day: 1, label: 'Lundi' },
  { day: 2, label: 'Mardi' },
  { day: 3, label: 'Mercredi' },
  { day: 4, label: 'Jeudi' },
  { day: 5, label: 'Vendredi' },
  { day: 6, label: 'Samedi' },
  { day: 0, label: 'Dimanche' },
];

const hhmm = (heure) => String(heure ?? '').slice(0, 5);

/** Grille hebdomadaire globale. */
export async function getSchedule({ signal } = {}) {
  const lignes = await get('/opening-hours', { params: { scope: 'global' }, signal });
  const parJour = new Map(lignes.map((item) => [item.weekday, item]));

  return {
    scope: 'global',
    days: JOURS.map(({ day, label }) => {
      const ligne = parJour.get(day);
      return {
        day,
        label,
        open: Boolean(ligne?.is_open),
        openTime: hhmm(ligne?.opens_at) || '08:00',
        closeTime: hhmm(ligne?.closes_at) || '20:00',
      };
    }),
  };
}

/**
 * Modification d'un jour.
 *
 * Le remplacement est total côté serveur : la semaine entière est renvoyée,
 * jour modifié compris. Un jour manquant hériterait du bâtiment et créerait une
 * amplitude incohérente avec le reste de la semaine — d'où le bloc complet.
 *
 * Une fermeture se traduit par `is_open: false` plutôt que par des horaires
 * vides, pour que la règle reste lisible.
 */
export async function updateScheduleDay(day, patchBody) {
  const grille = await getSchedule();
  const jour = grille.days.find((item) => item.day === day);
  if (!jour) throw new ApiError('Jour inconnu.', 404, 'introuvable');

  const futur = { ...jour, ...patchBody };
  if (futur.open && futur.openTime >= futur.closeTime) {
    throw new ApiError('L’heure de fermeture doit suivre l’heure d’ouverture.', 422, 'ordre');
  }

  const semaine = grille.days.map((item) => (item.day === day ? futur : item));
  await put(
    '/opening-hours/global',
    semaine.map((item) => ({
      weekday: item.day,
      is_open: item.open,
      opens_at: `${item.openTime}:00`,
      closes_at: `${item.closeTime}:00`,
    })),
  );
  return getSchedule();
}

export async function listClosures({ signal } = {}) {
  const [fermetures, batiments, salles] = await Promise.all([
    collect('/closures', { signal }),
    get('/buildings', { signal }).then((data) => data.map(adapt.building)),
    get('/rooms', { params: { size: 100 }, signal }).then((page) => items(page).map(adapt.room)),
  ]);

  const nomDe = (liste, id) => liste.find((item) => item.id === id)?.name ?? id;

  return fermetures.map((item) => {
    const fermeture = adapt.closure(item);
    const portee = item.is_global
      ? 'global'
      : item.building_ids?.length
        ? 'batiment'
        : 'salle';
    const cibles = item.is_global ? [] : [...(item.building_ids ?? []), ...(item.room_ids ?? [])];

    return {
      ...fermeture,
      scopeType: portee,
      scopeIds: cibles,
      scopeLabel:
        portee === 'global'
          ? 'Global'
          : cibles
              .map((id) => nomDe(portee === 'batiment' ? batiments : salles, id))
              .join(', '),
    };
  });
}

/** Réservations qu'une fermeture empêcherait, à consulter avant de la lever. */
export async function closureImpact(id, { signal } = {}) {
  return get(`/closures/${id}/impact`, { signal });
}

export async function addClosure(payload) {
  const { label, from, to, scopeType = 'global', scopeIds = [], kind = 'fermeture' } = payload;

  if (!label?.trim()) throw new ApiError('Le motif est obligatoire.', 422, 'motif_requis');
  if (!from || !to) throw new ApiError('Sélectionnez la période.', 422, 'periode_requise');
  if (new Date(to) < new Date(from)) {
    throw new ApiError('La date de fin précède la date de début.', 422, 'ordre');
  }
  if (scopeType !== 'global' && scopeIds.length === 0) {
    throw new ApiError('Précisez la portée de la fermeture.', 422, 'portee_requise');
  }

  const data = await post('/closures', {
    label: label.trim(),
    first_day: toDateInput(from),
    last_day: toDateInput(to),
    kind,
    // Globale, ou ciblée — jamais les deux : cocher « tout le campus » puis
    // désigner deux salles décrirait deux intentions contradictoires.
    is_global: scopeType === 'global',
    building_ids: scopeType === 'batiment' ? scopeIds : [],
    room_ids: scopeType === 'salle' ? scopeIds : [],
  });
  return adapt.closure(data);
}

export async function removeClosure(id) {
  await del(`/closures/${id}`);
  return { id, removed: true };
}

/** Jours marqués dans l'aperçu annuel : fermeture ou exception. */
export async function getYearOverview(year) {
  const fermetures = await collect('/closures', {
    params: { first_day: `${year}-01-01`, last_day: `${year}-12-31` },
  });

  const jours = {};
  for (const fermeture of fermetures) {
    let curseur = new Date(`${fermeture.first_day}T12:00:00`);
    const fin = new Date(`${fermeture.last_day}T12:00:00`);
    while (curseur <= fin) {
      if (curseur.getFullYear() === Number(year)) {
        // Clé au format local : `toISOString` bascule en UTC et décalerait
        // chaque jour marqué d'une case vers la veille en heure d'été.
        jours[toDateInput(curseur)] = fermeture.kind;
      }
      curseur = new Date(curseur.getTime() + 86_400_000);
    }
  }
  return { year: Number(year), days: jours };
}

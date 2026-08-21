// src/api/admin/schedules.js
// Endpoints FastAPI cibles :
//   GET    /api/admin/schedules?scope=       grille hebdomadaire
//   PATCH  /api/admin/schedules/{scope}      modification d'un jour
//   GET    /api/admin/closures               fermetures exceptionnelles
//   POST   /api/admin/closures               ajout
//   DELETE /api/admin/closures/{id}          retrait

import { closures as seedClosures, openingSchedule } from '../../mocks/admin/closures';
import { buildings } from '../../mocks/buildings';
import { toDate, toDateInput } from '../../utils/dates';
import { ApiError, clone, createStore, delay, nextId } from '../client';
import { roomStore } from './rooms';

const closureStore = createStore(seedClosures);
let schedule = clone(openingSchedule);

export async function getSchedule() {
  await delay();
  return clone(schedule);
}

/**
 * Modification d'un jour de la grille. Une fermeture se traduit par `open:false`
 * plutôt que par des horaires vides, pour que la règle reste lisible.
 */
export async function updateScheduleDay(day, patch) {
  await delay(200);
  const jour = schedule.days.find((item) => item.day === day);
  if (!jour) throw new ApiError('Jour inconnu.', 404, 'introuvable');

  const futur = { ...jour, ...patch };
  if (futur.open && futur.openTime >= futur.closeTime) {
    throw new ApiError('L’heure de fermeture doit suivre l’heure d’ouverture.', 422, 'ordre');
  }

  schedule = {
    ...schedule,
    days: schedule.days.map((item) => (item.day === day ? futur : item)),
  };
  return clone(schedule);
}

export async function listClosures() {
  await delay();
  return closureStore.all().map((closure) => ({
    ...closure,
    scopeLabel: libelleDePortee(closure),
  }));
}

function libelleDePortee(closure) {
  if (closure.scopeType === 'global') return 'Global';
  if (closure.scopeType === 'batiment') {
    return closure.scopeIds
      .map((id) => buildings.find((b) => b.id === id)?.name ?? id)
      .join(', ');
  }
  return closure.scopeIds
    .map((id) => roomStore.find((room) => room.id === id)?.name ?? id)
    .join(', ');
}

export async function addClosure(payload) {
  await delay();
  const { label, from, to, scopeType = 'global', scopeIds = [], kind = 'ferme' } = payload;

  if (!label?.trim()) throw new ApiError('Le motif est obligatoire.', 422, 'motif_requis');
  if (!from || !to) throw new ApiError('Sélectionnez la période.', 422, 'periode_requise');
  if (toDate(to) < toDate(from)) {
    throw new ApiError('La date de fin précède la date de début.', 422, 'ordre');
  }
  if (scopeType !== 'global' && scopeIds.length === 0) {
    throw new ApiError('Précisez la portée de la fermeture.', 422, 'portee_requise');
  }

  return closureStore.insert({
    id: nextId('clo'),
    label: label.trim(),
    from,
    to,
    scopeType,
    scopeIds,
    kind,
  });
}

export async function removeClosure(id) {
  await delay(200);
  closureStore.remove(id);
  return { id, removed: true };
}

/** Jours marqués dans l'aperçu annuel : fermeture ou exception. */
export async function getYearOverview(year) {
  await delay();
  const jours = {};
  for (const closure of closureStore.all()) {
    let curseur = toDate(closure.from);
    const fin = toDate(closure.to);
    while (curseur <= fin) {
      if (curseur.getFullYear() === Number(year)) {
        // Clé au format local : `toISOString` bascule en UTC et décalerait
        // chaque jour marqué d'une case vers la veille en heure d'été.
        jours[toDateInput(curseur)] = closure.kind;
      }
      curseur = new Date(curseur.getTime() + 86400000);
    }
  }
  return { year: Number(year), days: jours };
}

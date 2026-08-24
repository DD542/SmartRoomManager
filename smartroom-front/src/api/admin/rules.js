// src/api/admin/rules.js
// Endpoints réels :
//   GET  /api/v1/booking-rules              règles, par portée
//   GET  /api/v1/rooms/{id}/booking-rules   règle effectivement appliquée
//   PUT  /api/v1/booking-rules/{scope}      remplacement d'une portée
//   POST /api/v1/booking-rules/preview      effet mesuré avant application
//
// `PUT` et non `PATCH` : il n'existe qu'une règle par portée, garantie par une
// contrainte d'unicité. Créer ou modifier n'a donc pas à exiger deux appels
// différents du front.

import { fmtDuration } from '../../utils/dates';
import * as adapt from '../adapters';
import { get, items, post, put } from '../client';

/**
 * Règles d'une portée.
 *
 * `scope` vaut « global » ou un identifiant de salle, comme dans la maquette.
 * Pour une salle, c'est la règle *résolue* qui est rendue — salle, puis
 * bâtiment, puis global : afficher la ligne brute laisserait croire qu'une
 * salle sans surcharge n'a aucune règle.
 */
export async function getRules(scope = 'global', { signal } = {}) {
  if (scope === 'global') {
    const page = await get('/booking-rules', { params: { scope: 'global' }, signal });
    const [globale] = items(page);
    return { ...adapt.rules(globale), scope: 'global' };
  }

  const data = await get(`/rooms/${scope}/booking-rules`, { signal });
  return { ...adapt.rules(data), scope };
}

/**
 * Remplacement d'une portée.
 *
 * Les bornes sont revalidées côté serveur — durées cohérentes, fenêtre de
 * validation minimale, quota supérieur à une réservation. Le corps envoyé est
 * complet : la règle actuelle sert de base au formulaire partiel.
 */
export async function updateRules(scope, patchBody) {
  const actuelles = await getRules(scope);
  const futur = { ...actuelles, ...patchBody };

  const cible = scope === 'global' ? 'global' : 'salle';
  const data = await put(`/booking-rules/${cible}`, adapt.rulesIn(futur), {
    params: scope === 'global' ? undefined : { room_id: scope },
  });
  return { ...adapt.rules(data), scope };
}

/**
 * Effet d'une règle avant application.
 *
 * Deux volets : les phrases lisibles, construites depuis les valeurs saisies,
 * et le décompte réel des réservations qui deviendraient non conformes —
 * mesuré en SQL sur l'historique, jamais estimé.
 */
export async function previewImpact(regles) {
  const mesure = await post('/booking-rules/preview', adapt.rulesIn(regles), {
    params: { days: 30 },
  }).catch(() => null);

  return {
    resume: `Un utilisateur ne peut pas réserver plus de ${fmtDuration(
      regles.maxDurationMin,
    )} d’affilée, ni tenir plus de ${regles.maxActiveBookings} réservations actives.`,
    quota: `Quota hebdomadaire : ${regles.weeklyQuotaHours} h, soit environ ${Math.floor(
      (regles.weeklyQuotaHours * 60) / Math.max(1, regles.maxDurationMin),
    )} réservations à la durée maximale.`,
    avertissement: `Les réservations seront automatiquement libérées si l’utilisateur ne valide pas sa présence dans les ${regles.checkinWindowMin} minutes suivant le début.`,
    battement: `Un battement de ${regles.bufferMin} min reste exigé entre deux réunions d’une même salle.`,
    mesure: mesure
      ? {
          examinees: mesure.examined,
          tropCourtes: mesure.too_short,
          tropLongues: mesure.too_long,
          aValider: mesure.would_need_validation,
          fenetreJours: mesure.window_days,
        }
      : null,
  };
}

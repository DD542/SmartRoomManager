// src/api/admin/templates.js
// Endpoints réels :
//   GET   /api/v1/admin/email-templates              gabarits, modifiables en base
//   GET   /api/v1/admin/email-templates/variables    variables autorisées
//   GET   /api/v1/admin/email-templates/{id}         détail
//   PATCH /api/v1/admin/email-templates/{id}         modification
//   PATCH /api/v1/admin/email-templates/{id}/state   activation
//   POST  /api/v1/admin/email-templates/{id}/preview rendu, sans rien envoyer
//
// Les gabarits vivent en base : les modifier ne demande pas de redéploiement.
// Le rendu est fait côté serveur, dans un environnement Jinja en bac à sable —
// interpréter un gabarit dans le navigateur donnerait un aperçu qui ne
// correspond pas au courriel réellement envoyé.

import * as adapt from '../adapters';
import { ApiError, get, patch, post } from '../client';

/** Référentiel des variables, chargé une fois puis conservé. */
let referentiel = null;

async function variables() {
  if (!referentiel) {
    referentiel = (await get('/admin/email-templates/variables')).map((item) => ({
      code: item.code,
      label: item.label,
      sample: item.sample_value,
    }));
  }
  return referentiel;
}

export async function listTemplates({ signal } = {}) {
  const data = await get('/admin/email-templates', { signal });
  return data.map(adapt.emailTemplate);
}

export async function getTemplate(id, { signal } = {}) {
  return adapt.emailTemplate(await get(`/admin/email-templates/${id}`, { signal }));
}

export async function listVariables() {
  return (await variables()).map((item) => item.code);
}

/**
 * Aperçu.
 *
 * Synchrone parce que l'écran l'appelle à chaque frappe. Le rendu de référence
 * reste celui du serveur — `previewTemplate` — mais l'attendre à chaque
 * caractère saisi rendrait la zone de texte inutilisable.
 */
export function render(texte = '') {
  const exemples = Object.fromEntries((referentiel ?? []).map((item) => [item.code, item.sample]));
  return String(texte).replace(
    /\{\{\s*(\w+)\s*\}\}/g,
    (correspondance, cle) => exemples[cle] ?? correspondance,
  );
}

/** Variables employées dans un gabarit mais absentes du référentiel. */
export function unknownVariables(texte = '') {
  const connues = new Set((referentiel ?? []).map((item) => item.code));
  const employees = [...String(texte).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]);
  // Sans référentiel chargé, aucune variable n'est déclarée inconnue : signaler
  // une erreur sur une liste vide accuserait le gabarit d'une lenteur réseau.
  return connues.size === 0
    ? []
    : [...new Set(employees.filter((nom) => !connues.has(nom)))];
}

/** Rendu de référence, produit par le serveur avec les valeurs d'exemple. */
export async function previewTemplate(id) {
  const data = await post(`/admin/email-templates/${id}/preview`, { variables: {} });
  return { to: data.to, subject: data.subject, body: data.body };
}

export async function saveTemplate(id, { subject, body, format }) {
  if (!subject?.trim()) throw new ApiError('L’objet est obligatoire.', 422, 'objet_requis');
  if (!body?.trim()) throw new ApiError('Le corps du message est vide.', 422, 'corps_requis');

  await variables();
  const inconnues = [...unknownVariables(subject), ...unknownVariables(body)];
  if (inconnues.length > 0) {
    throw new ApiError(
      `Variable inconnue : {{${inconnues[0]}}}. Elle ne sera pas remplacée à l’envoi.`,
      422,
      'variable_inconnue',
    );
  }

  // `format` reste un choix d'écran : les gabarits sont stockés en texte et
  // rendus tels quels, et prétendre gérer du HTML sans l'échapper ouvrirait
  // une injection dans les courriels sortants.
  const data = await patch(`/admin/email-templates/${id}`, {
    subject: subject.trim(),
    body,
  });
  return { ...adapt.emailTemplate(data), format: format ?? 'texte' };
}

export async function toggleTemplate(id, enabled) {
  const data = await patch(`/admin/email-templates/${id}/state`, { enabled: Boolean(enabled) });
  return adapt.emailTemplate(data);
}

/**
 * Envoi de test.
 *
 * L'API ne propose pas d'envoi à une adresse arbitraire : elle deviendrait un
 * relais capable d'expédier un message rédigé sur mesure à n'importe qui. Le
 * rendu serveur est donc restitué à l'écran, sans qu'aucun courriel ne parte.
 */
export async function sendTest(id, email) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
    throw new ApiError('Adresse de test invalide.', 422, 'email_invalide');
  }

  const rendu = await previewTemplate(id);
  return { id, sentTo: null, preview: rendu, subject: rendu.subject };
}

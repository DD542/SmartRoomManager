// src/api/admin/templates.js
// Endpoints FastAPI cibles :
//   GET   /api/admin/email-templates          liste des modèles
//   PATCH /api/admin/email-templates/{id}     enregistrement
//   POST  /api/admin/email-templates/{id}/test envoi d'un test
//   PATCH /api/admin/email-templates/{id}/state activation

import { emailTemplates, templateVariables } from '../../mocks/admin/emailTemplates';
import { NOW, fmtDateLong, fmtTime } from '../../utils/dates';
import { ApiError, clone, createStore, delay } from '../client';

const store = createStore(emailTemplates);

/** Jeu d'exemple servant à l'aperçu en direct. */
const EXEMPLE = {
  prenom: 'Dylan',
  salle: 'Salle Vinci',
  batiment: 'Bâtiment A — 2e étage',
  date: fmtDateLong('2026-03-26T14:00:00'),
  creneau: `${fmtTime('2026-03-26T14:00:00')} - ${fmtTime('2026-03-26T15:30:00')}`,
  code_acces: 'A-4821',
  lien_reservation: 'https://smartroom.ece.fr/app/reservations/bk-1001',
};

export async function listTemplates() {
  await delay();
  return store.all();
}

export async function getTemplate(id) {
  await delay(200);
  const template = store.find((item) => item.id === id);
  if (!template) throw new ApiError('Modèle introuvable.', 404, 'introuvable');
  return template;
}

export async function listVariables() {
  await delay(100);
  return clone(templateVariables);
}

/** Remplace les {{variables}} par le jeu d'exemple, pour l'aperçu. */
export function render(texte = '') {
  return texte.replace(/\{\{\s*(\w+)\s*\}\}/g, (correspondance, cle) => EXEMPLE[cle] ?? correspondance);
}

/** Variables employées dans un modèle mais absentes du référentiel. */
export function unknownVariables(texte = '') {
  const employees = [...texte.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]);
  return [...new Set(employees.filter((nom) => !templateVariables.includes(nom)))];
}

export async function saveTemplate(id, { subject, body, format }) {
  await delay();
  if (!subject?.trim()) throw new ApiError('L’objet est obligatoire.', 422, 'objet_requis');
  if (!body?.trim()) throw new ApiError('Le corps du message est vide.', 422, 'corps_requis');

  const inconnues = [...unknownVariables(subject), ...unknownVariables(body)];
  if (inconnues.length > 0) {
    throw new ApiError(
      `Variable inconnue : {{${inconnues[0]}}}. Elle ne sera pas remplacée à l’envoi.`,
      422,
      'variable_inconnue',
    );
  }

  const updated = store.update(id, {
    subject: subject.trim(),
    body,
    format: format ?? 'texte',
    updatedAt: NOW.toISOString(),
  });
  if (!updated) throw new ApiError('Modèle introuvable.', 404, 'introuvable');
  return updated;
}

export async function toggleTemplate(id, enabled) {
  await delay(200);
  const updated = store.update(id, { enabled });
  if (!updated) throw new ApiError('Modèle introuvable.', 404, 'introuvable');
  return updated;
}

export async function sendTest(id, email) {
  await delay(600);
  const template = store.find((item) => item.id === id);
  if (!template) throw new ApiError('Modèle introuvable.', 404, 'introuvable');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
    throw new ApiError('Adresse de test invalide.', 422, 'email_invalide');
  }
  return { id, sentTo: email, subject: render(template.subject) };
}

// src/api/admin/audit.js
// Endpoints FastAPI cibles :
//   GET  /api/admin/audit?period=&author=&action=&q=   journal paginé
//   GET  /api/admin/audit/{id}                          détail et diff
//   POST /api/admin/audit/export                        export du journal
//   POST /api/admin/audit/{id}/flag                     signalement d'une action

import { auditEntries, auditHistory } from '../../mocks/admin/auditLog';
import { admins } from '../../mocks/admin/admins';
import { NOW, addDays, toDate, toDateInput } from '../../utils/dates';
import { normalize } from '../../utils/format';
import { ApiError, clone, createStore, delay } from '../client';

const store = createStore([...auditEntries, ...auditHistory]);

const PERIODES = {
  '24h': 1,
  '7j': 7,
  '30j': 30,
  tout: null,
};

export const actionLabels = {
  modification: 'Modification',
  maintenance: 'Maintenance',
  permission: 'Permission',
  suppression: 'Suppression',
  connexion: 'Connexion',
};

/**
 * Les actions automatiques sont attribuées au système. Le nom est normalisé ici
 * pour que la pastille d'initiales n'affiche pas une parenthèse.
 */
const decorer = (entry) => ({
  ...entry,
  authorName: entry.authorId ? entry.authorName : 'Système',
});

export async function listAuditEntries(filters = {}) {
  await delay();
  const { period = '7j', authorId, action, query } = filters;
  const jours = PERIODES[period] ?? null;
  const depuis = jours ? addDays(NOW, -jours) : null;

  return store
    .all()
    .filter((entry) => (depuis ? toDate(entry.at) >= depuis : true))
    .filter((entry) => (authorId ? entry.authorId === authorId : true))
    .filter((entry) => (action ? entry.action === action : true))
    .filter((entry) =>
      query ? normalize(`${entry.target} ${entry.authorName}`).includes(normalize(query)) : true,
    )
    .map(decorer)
    .sort((a, b) => toDate(b.at) - toDate(a.at));
}

export async function getAuditEntry(id) {
  await delay(200);
  const entry = store.find((item) => item.id === String(id));
  if (!entry) throw new ApiError('Action introuvable.', 404, 'introuvable');
  return decorer(entry);
}

export async function listAuditAuthors() {
  await delay(120);
  return [
    ...admins.map((admin) => ({ id: admin.id, label: `${admin.firstName} ${admin.lastName}` })),
    { id: null, label: 'Système' },
  ];
}

export async function listAuditActions() {
  await delay(100);
  return Object.entries(actionLabels).map(([id, label]) => ({ id, label }));
}

/**
 * Un signalement n'efface rien : il ajoute une marque au journal, lui-même
 * immuable. C'est la propriété qui rend l'audit utile.
 */
export async function flagAuditEntry(id, reason) {
  await delay();
  const updated = store.update(id, { flagged: true, flagReason: reason ?? '' });
  if (!updated) throw new ApiError('Action introuvable.', 404, 'introuvable');
  return updated;
}

export async function exportAuditLog(filters = {}) {
  await delay(600);
  const lignes = await listAuditEntries(filters);
  return {
    filename: `journal-audit-${toDateInput(NOW)}.csv`,
    rows: lignes.length,
    columns: ['Horodatage', 'Auteur', 'Action', 'Cible', 'Adresse IP'],
  };
}

export const clonerLibelles = () => clone(actionLabels);

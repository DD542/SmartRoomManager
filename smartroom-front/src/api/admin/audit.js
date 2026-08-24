// src/api/admin/audit.js
// Endpoints réels :
//   GET  /api/v1/admin/audit-logs             journal, du plus récent au plus ancien
//   GET  /api/v1/admin/audit-logs/{id}        détail, valeurs avant et après
//   POST /api/v1/admin/audit-logs/{id}/flag   signalement pour relecture
//   GET  /api/v1/admin/audit-logs/export/csv  export borné
//
// Le tri n'est pas exposé : un journal d'audit ne se lit pas à l'envers, et
// offrir l'ordre inverse laisserait croire qu'on peut en réorganiser le récit.

import { addDays, toDateInput } from '../../utils/dates';
import * as adapt from '../adapters';
import { abortable, get, getText, items, post } from '../client';
import { telecharger } from './reports';

const PERIODES = { '24h': 1, '7j': 7, '30j': 30, tout: null };

export const actionLabels = {
  creation: 'Création',
  modification: 'Modification',
  suppression: 'Suppression',
  permission: 'Permission',
  maintenance: 'Maintenance',
  connexion: 'Connexion',
};

/**
 * Les actions automatiques sont attribuées au système. Le serveur écrit déjà
 * « Système » dans `actor_label` ; la normalisation reste ici pour que la
 * pastille d'initiales n'affiche jamais une chaîne vide.
 */
const decorer = (entree) => ({
  ...entree,
  authorId: entree.actorId,
  authorName: entree.actor || 'Système',
});

const bornes = (period) => {
  const jours = PERIODES[period] ?? null;
  return jours ? { since: addDays(new Date(), -jours).toISOString() } : {};
};

export async function listAuditEntries(filters = {}) {
  const { period = '7j', authorId, action, query } = filters;

  const page = await get('/admin/audit-logs', {
    params: {
      ...bornes(period),
      actor_id: authorId || undefined,
      action: action || undefined,
      q: query || undefined,
      size: 100,
    },
    signal: abortable('admin:audit'),
  });
  return items(page).map((item) => decorer(adapt.auditEntry(item)));
}

export async function getAuditEntry(id, { signal } = {}) {
  return decorer(adapt.auditEntry(await get(`/admin/audit-logs/${id}`, { signal })));
}

/** Auteurs proposés au filtre : les administrateurs, plus le système. */
export async function listAuditAuthors({ signal } = {}) {
  const page = await get('/admin/users', {
    params: { role: 'admin', size: 100 },
    signal,
  }).catch(() => ({ items: [] }));

  return [
    ...items(page).map((item) => ({
      id: item.id,
      label: `${item.first_name} ${item.last_name}`,
    })),
    { id: null, label: 'Système' },
  ];
}

export async function listAuditActions() {
  return Object.entries(actionLabels).map(([id, label]) => ({ id, label }));
}

/**
 * Un signalement n'efface rien : il ajoute une marque au journal, lui-même en
 * ajout seul. C'est la propriété qui rend l'audit utile — et le déclencheur en
 * base n'autorise que cette colonne.
 */
export async function flagAuditEntry(id, reason) {
  const data = await post(`/admin/audit-logs/${id}/flag`, {
    flagged: true,
    reason: reason ?? '',
  });
  return decorer(adapt.auditEntry(data));
}

/**
 * Export du journal.
 *
 * Borné côté serveur à cent entrées : exporter un journal entier offrirait une
 * extraction de masse déguisée en consultation.
 */
export async function exportAuditLog(filters = {}) {
  const { period = '7j', action } = filters;
  const csv = await getText('/admin/audit-logs/export/csv', {
    params: { ...bornes(period), action: action || undefined },
  });

  const nom = `journal-audit-${toDateInput(new Date())}.csv`;
  telecharger(csv, nom);

  return {
    filename: nom,
    rows: Math.max(0, csv.trim().split('\n').length - 1),
    columns: ['Horodatage', 'Auteur', 'Action', 'Cible', 'Adresse IP'],
  };
}

export const clonerLibelles = () => ({ ...actionLabels });

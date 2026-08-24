// src/api/admin/session.js
// Endpoints réels :
//   POST /api/v1/auth/admin/login   mêmes identifiants, jeton `scope=admin`
//   POST /api/v1/auth/refresh       reprise de session
//   GET  /api/v1/auth/me            session courante et permissions
//   GET  /api/v1/admin/permissions  référentiel groupé des permissions
//
// Le jeton d'accès et le cookie de rafraîchissement sont uniques par
// navigateur : ouvrir une session d'administration remplace la session
// utilisateur dans le même onglet. Faire coexister les deux demanderait deux
// cookies et deux emplacements de jeton, pour un cas — être connecté aux deux
// espaces en même temps — qui n'a pas d'usage réel.

import * as adapt from '../adapters';
import { get, post, restoreSession, setAccessToken } from '../client';

export async function loginAdmin({ email, password }) {
  const payload = await post('/auth/admin/login', { email, password });
  setAccessToken(payload.access_token);

  // Le jeton ne porte pas la matrice de permissions : elle est relue en base à
  // chaque appel de `/auth/me`. La faire voyager dans le jeton la figerait
  // jusqu'à l'expiration, et une révocation resterait sans effet pendant ce
  // temps-là.
  return { admin: await getAdminSession() };
}

/** Reprend la session d'administration si le cookie tient encore. */
export async function restoreAdmin() {
  const payload = await restoreSession();
  if (!payload) return null;
  if (payload.scope !== 'admin') {
    // Le cookie porte une session utilisateur : ce n'est pas une session
    // d'administration, et la traiter comme telle donnerait un écran vide de
    // droits plutôt qu'un renvoi vers la connexion.
    return null;
  }
  return getAdminSession();
}

export async function getAdminSession() {
  const payload = await get('/auth/me');
  return adapt.admin(payload);
}

export async function logoutAdmin() {
  try {
    await post('/auth/logout');
  } finally {
    setAccessToken(null);
  }
}

/** Référentiel des permissions, groupé pour la matrice de l'écran des rôles. */
export async function listPermissionGroups({ signal } = {}) {
  const data = await get('/admin/permissions', { signal });
  return data.map((groupe) => ({
    id: groupe.id,
    code: groupe.code,
    label: groupe.label,
    permissions: groupe.permissions.map((item) => ({
      id: item.id,
      code: item.code,
      label: item.label,
    })),
  }));
}

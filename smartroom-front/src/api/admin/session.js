// src/api/admin/session.js
// Endpoints FastAPI cibles :
//   POST /api/admin/auth/login   { email, password } -> { admin, token }
//   GET  /api/admin/me           session courante et permissions
//   GET  /api/admin/permissions   référentiel des permissions

import { adminCredentials, admins, permissionGroups } from '../../mocks/admin/admins';
import { ApiError, clone, delay } from '../client';

/**
 * Connexion à l'espace d'administration. Distincte de celle de l'espace
 * utilisateur : un compte étudiant ne peut pas s'y authentifier, et toute
 * tentative est journalisée côté serveur.
 */
export async function loginAdmin({ email, password }) {
  await delay();
  const normalise = String(email).trim().toLowerCase();
  const compte = admins.find((admin) => admin.email.toLowerCase() === normalise);
  const identifiants = adminCredentials.find(
    (item) => item.email.toLowerCase() === normalise && item.password === password,
  );

  if (!compte) {
    throw new ApiError('Aucun compte administrateur pour cette adresse.', 404, 'inconnu');
  }
  if (!identifiants) throw new ApiError('Mot de passe incorrect.', 401, 'identifiants');

  return { admin: clone(compte), token: 'jeton-admin-de-demonstration' };
}

export async function getAdminSession(adminId) {
  await delay(150);
  const compte = admins.find((admin) => admin.id === adminId);
  return compte ? clone(compte) : null;
}

export async function listPermissionGroups() {
  await delay(120);
  return clone(permissionGroups);
}

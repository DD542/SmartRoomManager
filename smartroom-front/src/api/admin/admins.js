// src/api/admin/admins.js
// Endpoints FastAPI cibles :
//   GET    /api/admin/admins                    liste des comptes d'administration
//   PATCH  /api/admin/admins/{id}/permissions   mise à jour de la matrice
//   GET    /api/admin/invitations               invitations en attente
//   POST   /api/admin/invitations               inviter un administrateur
//   POST   /api/admin/invitations/{id}/resend   renvoyer l'invitation

import {
  adminInvitations,
  admins as seedAdmins,
  allPermissions,
} from '../../mocks/admin/admins';
import { NOW } from '../../utils/dates';
import { ApiError, clone, createStore, delay, nextId } from '../client';

const adminStore = createStore(seedAdmins);
const invitationStore = createStore(adminInvitations);

export async function listAdmins() {
  await delay();
  return adminStore.all();
}

/**
 * Mise à jour des permissions d'un compte.
 * Le compte propriétaire garde toutes ses permissions : les lui retirer
 * fermerait l'accès à la configuration pour tout le monde.
 */
export async function updateAdminPermissions(adminId, permissions) {
  await delay();
  const compte = adminStore.find((admin) => admin.id === adminId);
  if (!compte) throw new ApiError('Administrateur introuvable.', 404, 'introuvable');
  if (compte.owner) {
    throw new ApiError(
      'Le compte propriétaire conserve toutes les permissions.',
      409,
      'proprietaire',
    );
  }
  return adminStore.update(adminId, { permissions: [...permissions] });
}

export async function listInvitations() {
  await delay(200);
  return invitationStore.all();
}

export async function inviteAdmin({ email, permissions = [] }) {
  await delay();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
    throw new ApiError('Adresse e-mail invalide.', 422, 'email_invalide');
  }
  if (adminStore.find((admin) => admin.email === email)) {
    throw new ApiError('Ce compte est déjà administrateur.', 409, 'deja_admin');
  }
  const inconnues = permissions.filter((item) => !allPermissions.includes(item));
  if (inconnues.length > 0) {
    throw new ApiError(`Permission inconnue : ${inconnues[0]}.`, 422, 'permission_inconnue');
  }

  return invitationStore.insert({
    id: nextId('inv'),
    email,
    permissions: [...permissions],
    sentAt: NOW.toISOString(),
    status: 'en_attente',
  });
}

export async function resendInvitation(invitationId) {
  await delay();
  const updated = invitationStore.update(invitationId, { sentAt: NOW.toISOString() });
  if (!updated) throw new ApiError('Invitation introuvable.', 404, 'introuvable');
  return updated;
}

export async function cancelInvitation(invitationId) {
  await delay();
  invitationStore.remove(invitationId);
  return { invitationId, cancelled: true };
}

export const permissionsDisponibles = () => clone(allPermissions);

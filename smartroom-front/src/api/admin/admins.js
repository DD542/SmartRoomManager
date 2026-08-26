// src/api/admin/admins.js
// Endpoints réels :
//   GET    /api/v1/admin/users?role=admin              comptes d'administration
//   POST   /api/v1/admin/accounts                      promotion d'un compte
//   PATCH  /api/v1/admin/accounts/{id}/permissions     remplacement de la matrice
//   DELETE /api/v1/admin/accounts/{id}                 révocation
//   GET    /api/v1/admin/invitations                   invitations en cours
//   POST   /api/v1/admin/invitations                   inviter un administrateur
//   DELETE /api/v1/admin/invitations/{id}              révoquer une invitation
//   GET    /api/v1/admin/permissions                   référentiel des droits

import { ApiError, abortable, del, get, items, patch, post } from '../client';

const compte = (data) => ({
  id: data.user_id,
  userId: data.user_id,
  email: data.email,
  firstName: data.first_name,
  lastName: data.last_name,
  jobTitle: data.job_title,
  owner: data.is_owner,
  lastLoginAt: data.last_admin_login_at,
  permissions: data.permissions ?? [],
});

const invitation = (data) => ({
  id: data.id,
  email: data.email,
  permissions: data.permissions ?? [],
  sentAt: data.sent_at,
  expiresAt: data.expires_at,
  status: data.revoked_at ? 'revoquee' : data.accepted_at ? 'acceptee' : 'en_attente',
});

export async function listAdmins({ signal } = {}) {
  const page = await get('/admin/accounts', {
    params: { size: 100 },
    signal: signal ?? abortable('admin:admins'),
  });
  return items(page).map(compte);
}

/**
 * Remplacement de la matrice de permissions.
 *
 * La liste envoyée est complète : elle remplace la matrice, elle ne s'y ajoute
 * pas. Le compte propriétaire est exclu côté serveur — lui retirer ses droits
 * fermerait la configuration du système pour tout le monde.
 */
export async function updateAdminPermissions(adminId, permissions) {
  const data = await patch(`/admin/accounts/${adminId}/permissions`, {
    permissions: [...permissions],
  });
  return compte(data);
}

/** Promotion d'un compte existant, avec sa matrice initiale. */
export async function promoteAdmin({ userId, jobTitle, permissions = [] }) {
  const data = await post('/admin/accounts', {
    user_id: userId,
    job_title: jobTitle?.trim() || 'Gestionnaire',
    permissions: [...permissions],
  });
  return compte(data);
}

export async function revokeAdmin(adminId) {
  await del(`/admin/accounts/${adminId}`);
  return { adminId, revoked: true };
}

export async function listInvitations({ signal } = {}) {
  const data = await get('/admin/invitations', { signal });
  return data.map(invitation);
}

/**
 * Invitation.
 *
 * Le jeton en clair ne figure pas dans la réponse : il part dans le courriel,
 * et n'est stocké que haché. L'afficher ici en ferait un secret partagé par
 * tous ceux qui passent devant l'écran.
 */
export async function inviteAdmin({ email, permissions = [] }) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
    throw new ApiError('Adresse e-mail invalide.', 422, 'email_invalide');
  }
  if (permissions.length === 0) {
    throw new ApiError('Choisissez au moins une permission.', 422, 'permissions_requises');
  }

  const data = await post('/admin/invitations', { email, permissions: [...permissions] });
  return invitation(data);
}

/**
 * Renvoi d'une invitation.
 *
 * La précédente est révoquée avant qu'une nouvelle parte : deux jetons valides
 * pour la même adresse laisseraient un lien actif après une révocation.
 */
export async function resendInvitation(invitationId) {
  const existantes = await listInvitations();
  const cible = existantes.find((item) => item.id === invitationId);
  if (!cible) throw new ApiError('Invitation introuvable.', 404, 'introuvable');

  await del(`/admin/invitations/${invitationId}`);
  return inviteAdmin({ email: cible.email, permissions: cible.permissions });
}

export async function cancelInvitation(invitationId) {
  await del(`/admin/invitations/${invitationId}`);
  return { invitationId, cancelled: true };
}

/**
 * Référentiel des droits, groupé comme le serveur le rend.
 *
 * Les libellés viennent de la base et non d'une table écrite en dur : un droit
 * ajouté au référentiel apparaîtrait sinon sous son code technique, et un
 * droit renommé garderait son ancien nom à l'écran.
 */
export async function listPermissionGroups({ signal } = {}) {
  const groupes = await get('/admin/permissions', { signal });
  return groupes.map((groupe) => ({
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

/** Codes de permission connus du serveur, à plat. */
export async function permissionsDisponibles({ signal } = {}) {
  const groupes = await listPermissionGroups({ signal });
  return groupes.flatMap((groupe) => groupe.permissions.map((item) => item.code));
}

/** Comptes promouvables : l'annuaire, moins ceux déjà administrateurs. */
export async function listPromotableUsers({ query, signal } = {}) {
  const page = await get('/admin/users', {
    params: { q: query, role: 'utilisateur', status: 'actif', size: 100 },
    signal,
  });
  return items(page).map((item) => ({
    id: item.id,
    email: item.email,
    firstName: item.first_name,
    lastName: item.last_name,
    department: item.department,
  }));
}

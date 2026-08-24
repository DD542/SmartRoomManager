// src/api/auth.js
// Endpoints réels :
//   POST   /api/v1/auth/login             ouverture de session utilisateur
//   POST   /api/v1/auth/refresh           rotation du jeton, cookie httpOnly
//   POST   /api/v1/auth/logout            révocation de la famille de jetons
//   GET    /api/v1/auth/me                session courante et permissions
//   POST   /api/v1/auth/forgot-password   lien de réinitialisation
//   POST   /api/v1/auth/reset-password    consommation du lien
//   GET    /api/v1/users/me               profil
//   PATCH  /api/v1/users/me               profil
//   PUT    /api/v1/users/me/preferences   préférences

import * as adapt from './adapters';
import { ApiError, get, patch, post, put, restoreSession, setAccessToken } from './client';

/**
 * Ouvre une session. Le jeton d'accès est gardé en mémoire par le client ; le
 * rafraîchissement est posé par le serveur en cookie httpOnly, hors de portée
 * du JavaScript. Rien ne touche localStorage.
 */
export async function login({ email, password }) {
  const payload = await post('/auth/login', { email, password });
  setAccessToken(payload.access_token);

  return {
    user: adapt.user(payload.user),
    // Un compte sans préférence de bâtiment n'a jamais rempli l'accueil :
    // c'est ce qui déclenche l'onboarding, plutôt qu'un drapeau inventé.
    firstLogin: !payload.user?.preferences?.preferred_building_id,
  };
}

/**
 * Connexion par le compte de l'école.
 *
 * Le fournisseur d'identité de l'ECE n'est pas raccordé : la route n'existe pas
 * encore côté API. L'appeler échouerait silencieusement, mieux vaut le dire.
 */
export async function loginWithEce() {
  const erreur = new Error(
    "La connexion par le compte ECE n'est pas encore disponible. "
      + 'Utilisez votre adresse et votre mot de passe.',
  );
  erreur.name = 'ApiError';
  erreur.status = 501;
  erreur.code = 'sso_indisponible';
  throw erreur;
}

/**
 * Reprend la session au chargement de l'application, si le cookie tient encore.
 *
 * Passe par la reprise partagée du client : l'espace utilisateur et l'espace
 * d'administration se montent ensemble, et deux rotations concurrentes du même
 * jeton passeraient pour un rejeu.
 */
export async function restore() {
  const payload = await restoreSession();
  if (!payload) throw new ApiError('Session expirée.', 401, 'session_expiree');
  return { user: adapt.user(payload.user), scope: payload.scope };
}

export async function session() {
  const payload = await get('/auth/me');
  return {
    user: adapt.user(payload.user),
    admin: adapt.admin(payload),
    permissions: payload.permissions ?? [],
  };
}

export async function logout() {
  try {
    await post('/auth/logout');
  } catch {
    // Se déconnecter ne peut pas échouer du point de vue de l'utilisateur : il
    // a demandé à partir. Un serveur injoignable laisserait sinon remonter une
    // erreur alors que l'écran est déjà revenu à la connexion.
    //
    // Le jeton de rafraîchissement reste alors valide côté serveur jusqu'à son
    // expiration : c'est le compromis assumé, et il ne vaut que pour une panne
    // réseau — un serveur joignable révoque toujours la famille.
  } finally {
    setAccessToken(null);
  }
}

export async function forgotPassword(email) {
  await post('/auth/forgot-password', { email });
  // L'API répond 202 même pour une adresse inconnue : elle ne sert pas
  // d'annuaire, et l'écran affiche le même message dans les deux cas.
  return { sent: true, expiresInMin: 30 };
}

export async function resetPassword({ token, password }) {
  await post('/auth/reset-password', { token, password });
  return { reset: true };
}

export async function changePassword({ currentPassword, newPassword }) {
  await post('/auth/change-password', {
    current_password: currentPassword,
    new_password: newPassword,
  });
  // Toutes les sessions tombent côté serveur : le jeton local n'a plus cours.
  setAccessToken(null);
  return { changed: true };
}

export async function getCurrentUser() {
  return adapt.user(await get('/users/me'));
}

export async function updateProfile(_userId, patchBody) {
  const payload = await patch('/users/me', {
    first_name: patchBody.firstName,
    last_name: patchBody.lastName,
    phone: patchBody.phone,
    promotion: patchBody.promotion,
    department: patchBody.department,
  });
  return adapt.user(payload);
}

export async function savePreferences(_userId, preferences) {
  const payload = await put('/users/me/preferences', adapt.preferencesIn(preferences));
  return adapt.user(payload);
}

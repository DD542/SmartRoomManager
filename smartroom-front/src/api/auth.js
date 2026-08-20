// src/api/auth.js
// Endpoints FastAPI cibles :
//   POST /api/auth/login             { email, password } -> { user, token }
//   POST /api/auth/sso/ece           authentification par le compte ECE
//   POST /api/auth/forgot-password   { email } -> lien de réinitialisation
//   GET  /api/users/me               profil de la session
//   PATCH /api/users/me              profil + préférences

import { credentials, currentUserId, userById, users } from '../mocks/users';
import { ApiError, clone, createStore, delay } from './client';

const userStore = createStore(users);

export async function login({ email, password, remember = false }) {
  await delay();
  const normalized = String(email).trim().toLowerCase();
  const match = credentials.find((c) => c.email === normalized && c.password === password);
  const user = userStore.find((u) => u.email.toLowerCase() === normalized);

  if (!user) throw new ApiError('Aucun compte ne correspond à cette adresse.', 404, 'inconnu');
  if (!match) throw new ApiError('Mot de passe incorrect.', 401, 'identifiants');

  // `remember` pilote la durée du jeton côté serveur, jamais un stockage navigateur.
  return {
    user,
    token: 'jeton-de-demonstration',
    tokenExpiresInDays: remember ? 30 : 1,
    firstLogin: false,
  };
}

/** Connexion par le compte de l'école : ouvre directement l'onboarding. */
export async function loginWithEce() {
  await delay();
  return { user: clone(userById[currentUserId]), token: 'jeton-sso', firstLogin: true };
}

export async function forgotPassword(email) {
  await delay();
  if (!String(email).includes('@')) {
    throw new ApiError('Adresse e-mail invalide.', 422, 'email_invalide');
  }
  return { sent: true, expiresInMin: 30 };
}

export async function getCurrentUser(userId = currentUserId) {
  await delay(150);
  return userStore.find((u) => u.id === userId);
}

export async function updateProfile(userId, patch) {
  await delay();
  const updated = userStore.update(userId, patch);
  if (!updated) throw new ApiError('Profil introuvable.', 404, 'introuvable');
  return updated;
}

export async function savePreferences(userId, preferences) {
  await delay();
  const updated = userStore.update(userId, (user) => ({
    preferences: { ...user.preferences, ...preferences },
  }));
  if (!updated) throw new ApiError('Profil introuvable.', 404, 'introuvable');
  return updated;
}

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as authApi from '../api/auth';
import { onSessionExpired } from '../api/client';

const AuthContext = createContext(null);

/**
 * Session de l'utilisateur.
 *
 * Le jeton d'accès vit en mémoire dans le client HTTP, jamais dans
 * `localStorage` ni `sessionStorage` : un script injecté y lirait une session
 * complète. La continuité entre deux chargements de page repose sur le jeton de
 * rafraîchissement, posé en cookie `httpOnly`, hors de portée du JavaScript.
 *
 * D'où le `status` initial « reprise » : au premier rendu, on ne sait pas
 * encore si la session tient. Afficher l'écran de connexion pendant cette
 * seconde d'incertitude déconnecterait visuellement un utilisateur qui ne l'est
 * pas.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('reprise');
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [permissions, setPermissions] = useState([]);

  const logout = useCallback(async () => {
    setUser(null);
    setPermissions([]);
    setNeedsOnboarding(false);
    // « sortie » et non « deconnecte » : une déconnexion voulue. Le garde des
    // pages ne retient alors pas la page quittée, et le compte suivant ouvre
    // son propre accueil au lieu de la dernière page du précédent.
    setStatus('sortie');
    await authApi.logout();
  }, []);

  // Une expiration constatée par le client HTTP — rafraîchissement refusé —
  // doit vider l'écran, sinon l'interface continue d'afficher un profil dont
  // plus aucune requête n'aboutit.
  const expire = useRef(() => {});
  expire.current = () => {
    setUser(null);
    setPermissions([]);
    setStatus('deconnecte');
  };

  useEffect(() => onSessionExpired(() => expire.current()), []);

  useEffect(() => {
    let vivant = true;
    authApi
      .restore()
      .then(({ user: repris }) => {
        if (!vivant) return;
        setUser(repris);
        setNeedsOnboarding(!repris?.preferences?.preferredBuildingId);
        setStatus('connecte');
      })
      .catch(() => {
        // Pas de cookie, ou cookie périmé : ce n'est pas une erreur, c'est
        // l'état normal d'un visiteur qui n'a pas encore ouvert de session.
        if (vivant) setStatus('deconnecte');
      });
    return () => {
      vivant = false;
    };
  }, []);

  const login = useCallback(async (credentials) => {
    setStatus('connexion');
    try {
      const { user: connecte, firstLogin } = await authApi.login(credentials);
      setUser(connecte);
      setNeedsOnboarding(firstLogin);
      setStatus('connecte');
      return connecte;
    } catch (error) {
      setStatus('deconnecte');
      throw error;
    }
  }, []);

  /**
   * Ouvre une session à partir du jeton rendu par Google.
   *
   * Le compte est créé côté serveur s'il n'existe pas : le front n'a pas à
   * distinguer une inscription d'une connexion, et lui faire porter cette
   * décision reviendrait à demander deux fois qui l'on est.
   */
  const loginWithGoogle = useCallback(async (credential) => {
    setStatus('connexion');
    try {
      const resultat = await authApi.loginWithGoogle(credential);
      setUser(resultat.user);
      setNeedsOnboarding(resultat.firstLogin);
      setStatus('connecte');
      return resultat;
    } catch (error) {
      setStatus('deconnecte');
      throw error;
    }
  }, []);

  const updateProfile = useCallback(async (patch) => {
    const modifie = await authApi.updateProfile(null, patch);
    setUser(modifie);
    return modifie;
  }, []);

  const savePreferences = useCallback(async (preferences) => {
    const modifie = await authApi.savePreferences(null, preferences);
    setUser(modifie);
    setNeedsOnboarding(false);
    return modifie;
  }, []);

  /**
   * Remplace le compte affiché par celui que vient de rendre le serveur.
   *
   * Pour les écritures qui ne passent pas par `updateProfile` — la photo de
   * profil se dépose à part. Sans cela, la bulle de la barre haute gardait
   * les initiales jusqu'à l'enregistrement du formulaire, ou au rechargement.
   */
  const replaceUser = useCallback((courant) => setUser(courant), []);

  /** Relit la session côté serveur : c'est là qu'une révocation se constate. */
  const refreshSession = useCallback(async () => {
    const { user: courant, permissions: droits } = await authApi.session();
    setUser(courant);
    setPermissions(droits);
    return courant;
  }, []);

  const value = useMemo(
    () => ({
      user,
      status,
      permissions,
      isRestoring: status === 'reprise',
      isAuthenticated: Boolean(user),
      needsOnboarding,
      login,
      loginWithGoogle,
      logout,
      updateProfile,
      savePreferences,
      refreshSession,
      replaceUser,
      completeOnboarding: () => setNeedsOnboarding(false),
    }),
    [
      user,
      status,
      permissions,
      needsOnboarding,
      login,
      loginWithGoogle,
      logout,
      updateProfile,
      savePreferences,
      refreshSession,
      replaceUser,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth doit être utilisé dans un AuthProvider.');
  return context;
}

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as sessionApi from '../api/admin/session';
import { onSessionExpired } from '../api/client';

// Exporté pour que les tests de composants puissent poser une session sans
// monter le fournisseur entier, qui appellerait le réseau au montage.
export const AdminSessionContext = createContext(null);

/**
 * Session d'administration.
 *
 * Elle repose sur les mêmes identifiants que l'espace utilisateur mais sur un
 * jeton distinct : celui émis par `/auth/admin/login` porte `scope=admin`, et
 * un compte sans droits reçoit le même refus qu'un mot de passe faux — sans
 * quoi la route dirait qui est administrateur.
 *
 * Le jeton et le cookie de rafraîchissement étant uniques par navigateur, une
 * connexion à l'administration remplace la session utilisateur du même onglet.
 *
 * Les permissions ne sont pas déduites du jeton : elles sont relues à chaque
 * reprise, et c'est le seul endroit où une révocation se constate avant la
 * reconnexion.
 */
export function AdminSessionProvider({ children }) {
  const [admin, setAdmin] = useState(null);
  const [status, setStatus] = useState('reprise');

  const expire = useRef(() => {});
  expire.current = () => {
    setAdmin(null);
    setStatus('deconnecte');
  };

  useEffect(() => onSessionExpired(() => expire.current()), []);

  useEffect(() => {
    let vivant = true;
    sessionApi
      .restoreAdmin()
      .then((compte) => {
        if (!vivant) return;
        setAdmin(compte);
        setStatus(compte ? 'connecte' : 'deconnecte');
      })
      .catch(() => {
        if (vivant) setStatus('deconnecte');
      });
    return () => {
      vivant = false;
    };
  }, []);

  const login = useCallback(async (credentials) => {
    setStatus('connexion');
    try {
      const { admin: compte } = await sessionApi.loginAdmin(credentials);
      setAdmin(compte);
      setStatus('connecte');
      return compte;
    } catch (error) {
      setStatus('deconnecte');
      throw error;
    }
  }, []);

  const logout = useCallback(async () => {
    setAdmin(null);
    setStatus('deconnecte');
    await sessionApi.logoutAdmin();
  }, []);

  const setPermissions = useCallback((permissions) => {
    setAdmin((courant) => (courant ? { ...courant, permissions } : courant));
  }, []);

  /** Relit la session : une permission retirée disparaît sans reconnexion. */
  const refresh = useCallback(async () => {
    const compte = await sessionApi.getAdminSession();
    setAdmin(compte);
    return compte;
  }, []);

  const value = useMemo(
    () => ({
      admin,
      status,
      isRestoring: status === 'reprise',
      isAuthenticated: Boolean(admin),
      permissions: admin?.permissions ?? [],
      login,
      logout,
      setPermissions,
      refresh,
    }),
    [admin, status, login, logout, setPermissions, refresh],
  );

  return <AdminSessionContext.Provider value={value}>{children}</AdminSessionContext.Provider>;
}

export function useAdminSession() {
  const context = useContext(AdminSessionContext);
  if (!context) {
    throw new Error('useAdminSession doit être utilisé dans un AdminSessionProvider.');
  }
  return context;
}

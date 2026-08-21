import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import * as sessionApi from '../api/admin/session';

const AdminSessionContext = createContext(null);

/**
 * Session d'administration, distincte de la session utilisateur : se connecter
 * à /app ne donne aucun droit sur /admin, et inversement. Comme pour l'espace
 * utilisateur, rien n'est stocké dans le navigateur.
 */
export function AdminSessionProvider({ children }) {
  const [admin, setAdmin] = useState(null);
  const [status, setStatus] = useState('deconnecte');

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

  const logout = useCallback(() => {
    setAdmin(null);
    setStatus('deconnecte');
  }, []);

  const setPermissions = useCallback((permissions) => {
    setAdmin((current) => (current ? { ...current, permissions } : current));
  }, []);

  const value = useMemo(
    () => ({
      admin,
      status,
      isAuthenticated: Boolean(admin),
      permissions: admin?.permissions ?? [],
      login,
      logout,
      setPermissions,
    }),
    [admin, status, login, logout, setPermissions],
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

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import * as authApi from '../api/auth';

const AuthContext = createContext(null);

/**
 * Session de l'utilisateur. Aucun stockage navigateur : l'état vit en mémoire,
 * un rechargement de page renvoie donc sur l'écran de connexion, ce qui est le
 * comportement attendu de la maquette.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('deconnecte');
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  const login = useCallback(async (credentials) => {
    setStatus('connexion');
    try {
      const { user: signedIn, firstLogin } = await authApi.login(credentials);
      setUser(signedIn);
      setNeedsOnboarding(firstLogin);
      setStatus('connecte');
      return signedIn;
    } catch (error) {
      setStatus('deconnecte');
      throw error;
    }
  }, []);

  const loginWithEce = useCallback(async () => {
    setStatus('connexion');
    const { user: signedIn, firstLogin } = await authApi.loginWithEce();
    setUser(signedIn);
    setNeedsOnboarding(firstLogin);
    setStatus('connecte');
    return signedIn;
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setNeedsOnboarding(false);
    setStatus('deconnecte');
  }, []);

  const updateProfile = useCallback(
    async (patch) => {
      const updated = await authApi.updateProfile(user.id, patch);
      setUser(updated);
      return updated;
    },
    [user],
  );

  const savePreferences = useCallback(
    async (preferences) => {
      const updated = await authApi.savePreferences(user.id, preferences);
      setUser(updated);
      setNeedsOnboarding(false);
      return updated;
    },
    [user],
  );

  const value = useMemo(
    () => ({
      user,
      status,
      isAuthenticated: Boolean(user),
      needsOnboarding,
      login,
      loginWithEce,
      logout,
      updateProfile,
      savePreferences,
      completeOnboarding: () => setNeedsOnboarding(false),
    }),
    [user, status, needsOnboarding, login, loginWithEce, logout, updateProfile, savePreferences],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth doit être utilisé dans un AuthProvider.');
  return context;
}

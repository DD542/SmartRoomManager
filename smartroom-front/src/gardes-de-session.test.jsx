/**
 * @vitest-environment jsdom
 *
 * Les gardes des deux espaces, pendant la reprise de session.
 *
 * Le jeton d'accès vit en mémoire : il ne survit pas à un rechargement. C'est
 * le cookie de rafraîchissement qui reprend la session, par une requête — donc
 * pas avant le premier rendu. Une garde qui décide à ce moment-là juge une
 * session absente alors qu'elle est seulement en route.
 *
 * Ce qui suit vérifie qu'elle attend. Sans cela, recharger `/admin/rapports`
 * traversait l'écran de connexion à chaque fois, visiblement, pour y revenir
 * une seconde plus tard.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const session = { isAuthenticated: false, isRestoring: true, needsOnboarding: false };
const sessionAdmin = { isAuthenticated: false, isRestoring: true };

vi.mock('./hooks/useAuth', () => ({
  useAuth: () => session,
  AuthProvider: ({ children }) => children,
}));

vi.mock('./hooks/useAdminSession', () => ({
  useAdminSession: () => sessionAdmin,
  AdminSessionProvider: ({ children }) => children,
}));

const { RequireAuth, RequireAdmin } = await import('./router');

const monter = (Garde, depart) =>
  render(
    <MemoryRouter
      initialEntries={[depart]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route
          path={depart}
          element={
            <Garde>
              <p>contenu protégé</p>
            </Garde>
          }
        />
        <Route path="/connexion" element={<p>écran de connexion</p>} />
        <Route path="/admin/connexion" element={<p>connexion administration</p>} />
      </Routes>
    </MemoryRouter>,
  );

describe('Pendant la reprise', () => {
  it('l’espace utilisateur attend au lieu de rediriger', () => {
    Object.assign(session, { isAuthenticated: false, isRestoring: true });
    monter(RequireAuth, '/app/reservations');

    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByText('écran de connexion')).toBeNull();
  });

  it('l’administration attend aussi', () => {
    Object.assign(sessionAdmin, { isAuthenticated: false, isRestoring: true });
    monter(RequireAdmin, '/admin/rapports');

    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByText('connexion administration')).toBeNull();
  });
});

describe('Une fois la reprise terminée', () => {
  it('laisse passer la session valide', () => {
    Object.assign(sessionAdmin, { isAuthenticated: true, isRestoring: false });
    monter(RequireAdmin, '/admin/rapports');

    expect(screen.getByText('contenu protégé')).toBeTruthy();
  });

  it('redirige quand il n’y a vraiment aucune session', () => {
    // L'attente ne doit pas devenir un blocage : sans session, la redirection
    // reste due.
    Object.assign(sessionAdmin, { isAuthenticated: false, isRestoring: false });
    monter(RequireAdmin, '/admin/rapports');

    expect(screen.getByText('connexion administration')).toBeTruthy();
  });

  it('renvoie l’utilisateur sans session vers sa propre connexion', () => {
    Object.assign(session, { isAuthenticated: false, isRestoring: false });
    monter(RequireAuth, '/app/reservations');

    expect(screen.getByText('écran de connexion')).toBeTruthy();
  });
});

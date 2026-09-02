/**
 * @vitest-environment jsdom
 *
 * Les écrans de connexion n'affichent aucun identifiant.
 *
 * Pendant le développement, les deux écrans portaient un encadré listant des
 * comptes de démonstration et leur mot de passe. C'était commode pour essayer
 * l'application sans se souvenir de rien.
 *
 * Le développement est terminé : cet encadré n'a plus lieu d'être, et sur une
 * instance ouverte il donnerait des identifiants valables à qui atteint la page.
 *
 * Ces tests existent parce que le retrait a déjà été perdu une fois, emporté
 * par une réécriture d'historique. Un encadré de commodité se réintroduit plus
 * facilement qu'il ne s'enlève.
 *
 * Assertions DOM natives : `jest-dom` n'est pas dans les dépendances.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../hooks/useToast';

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ login: vi.fn(), loginWithGoogle: vi.fn(), isAuthenticated: false }),
}));

vi.mock('../hooks/useAdminSession', () => ({
  useAdminSession: () => ({ login: vi.fn(), isAuthenticated: false }),
}));

vi.mock('../components/auth/BoutonGoogle', () => ({
  BoutonGoogle: () => null,
}));

const { default: LoginPage } = await import('./public/LoginPage');
const { default: AdminLoginPage } = await import('./admin/AdminLoginPage');

const monter = (element) =>
  render(
    <ToastProvider>
      <MemoryRouter>{element}</MemoryRouter>
    </ToastProvider>,
  );

/** Ce qui ne doit jamais figurer sur une page de connexion. */
const INTERDITS = [
  /smartroom2026/i,
  /comptes? de d[ée]monstration/i,
  /d\.menga@/i,
  /s\.boukehila@/i,
  /c\.nkoulou@/i,
  /dylan\.menga@/i,
  /marie\.laurent@/i,
];

describe('Écran de connexion utilisateur', () => {
  it('n’affiche ni compte de démonstration ni mot de passe', () => {
    monter(<LoginPage />);

    const texte = document.body.textContent;
    for (const interdit of INTERDITS) {
      expect(texte, `« ${interdit} » ne doit pas figurer sur la page`).not.toMatch(interdit);
    }
  });

  it('garde ce qui n’est pas un identifiant', () => {
    // Deux informations restent utiles et ne sont pas des comptes : que
    // l'administration a sa propre connexion, et qu'un compte Google inconnu
    // ouvre un compte. La seconde est une divulgation de comportement, pas une
    // commodité de développement.
    monter(<LoginPage />);

    expect(screen.getByText(/administration a sa propre connexion/i)).toBeTruthy();
  });
});

describe('Écran de connexion administration', () => {
  it('n’affiche ni compte de démonstration ni mot de passe', () => {
    monter(<AdminLoginPage />);

    const texte = document.body.textContent;
    for (const interdit of INTERDITS) {
      expect(texte, `« ${interdit} » ne doit pas figurer sur la page`).not.toMatch(interdit);
    }
  });

  it('garde l’avertissement de journalisation', () => {
    monter(<AdminLoginPage />);

    expect(screen.getByText(/Toute connexion est journalisée/i)).toBeTruthy();
  });
});

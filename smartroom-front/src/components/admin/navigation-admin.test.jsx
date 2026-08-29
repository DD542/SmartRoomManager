/**
 * @vitest-environment jsdom
 *
 * Navigation de l'administration : permissions, recherche, repli.
 *
 * Le contrôle qui compte est le premier : la barre latérale et la feuille
 * mobile doivent montrer exactement les mêmes destinations pour un compte
 * donné. Elles partagent `groupesVisibles`, donc c'est vrai par construction —
 * ce test empêche qu'un second filtre naisse un jour à côté.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ADMIN_NAV, AdminNav, AdminSidebar, groupesVisibles } from './AdminSidebar';
import { AdminSessionContext } from '../../hooks/useAdminSession';

const PROFILS = {
  proprietaire: [
    'data.export',
    'conflicts.arbitrate',
    'rooms.manage',
    'rules.configure',
    'users.manage',
    'system.configure',
    'support.handle',
  ],
  support: ['support.handle'],
  aucune: [],
};

const rendre = (element, permissions) =>
  render(
    <MemoryRouter>
      <AdminSessionContext.Provider
        value={{
          admin: { firstName: 'Dylan', lastName: 'Menga', role: 'Direction' },
          permissions,
          status: 'connecte',
          isAuthenticated: true,
          logout: vi.fn(),
        }}
      >
        {element}
      </AdminSessionContext.Provider>
    </MemoryRouter>,
  );

const adresses = (racine) =>
  [...racine.querySelectorAll('nav a[href]')].map((lien) => lien.getAttribute('href'));

describe('Filtrage par permission', () => {
  it.each(Object.entries(PROFILS))(
    'donne les mêmes destinations en barre latérale et en feuille — profil %s',
    (_nom, permissions) => {
      const { container: barre, unmount } = rendre(<AdminSidebar />, permissions);
      const enBarre = adresses(barre);
      unmount();

      const { container: feuille } = rendre(<AdminNav onNavigate={vi.fn()} />, permissions);
      expect(adresses(feuille)).toEqual(enBarre);
    },
  );

  it('n’expose que le pilotage et les réservations à un compte sans droit', () => {
    const attendues = ADMIN_NAV.flatMap((groupe) =>
      groupe.items.filter((item) => !item.permission).map((item) => item.to),
    );

    const { container } = rendre(<AdminNav />, PROFILS.aucune);

    // Deux destinations, jamais zéro : la navigation vide n'existe pas.
    expect(adresses(container)).toEqual(attendues);
    expect(attendues.length).toBeGreaterThan(0);
  });

  it('n’ouvre pas une destination interdite par la recherche', () => {
    // La recherche filtre ce que les permissions ont déjà laissé passer, et
    // jamais l'inverse.
    const visibles = groupesVisibles((permission) => !permission, 'utilisateurs');
    expect(visibles).toEqual([]);
  });
});

describe('Recherche de destination', () => {
  it('réduit la liste, accents et casse ignorés', () => {
    const { container } = rendre(<AdminNav />, PROFILS.proprietaire);

    fireEvent.change(screen.getByLabelText('Rechercher une destination'), {
      target: { value: 'REGLES' },
    });

    expect(adresses(container)).toEqual(['/admin/regles']);
  });

  it('le dit quand rien ne correspond', () => {
    rendre(<AdminNav />, PROFILS.proprietaire);

    fireEvent.change(screen.getByLabelText('Rechercher une destination'), {
      target: { value: 'zzz' },
    });

    expect(screen.getByText(/Aucun écran ne correspond/)).toBeTruthy();
  });
});

describe('Repli de la barre latérale', () => {
  it('garde les mêmes destinations une fois repliée', () => {
    const { container: depliee, unmount } = rendre(<AdminSidebar reduit={false} />, PROFILS.support);
    const avant = adresses(depliee);
    unmount();

    const { container: repliee } = rendre(<AdminSidebar reduit onToggle={vi.fn()} />, PROFILS.support);

    expect(adresses(repliee)).toEqual(avant);
  });

  it('nomme chaque icône quand le libellé disparaît', () => {
    const { container } = rendre(<AdminSidebar reduit onToggle={vi.fn()} />, PROFILS.support);

    const liens = [...container.querySelectorAll('nav a[href]')];
    liens.forEach((lien) => expect(lien.getAttribute('aria-label')).toBeTruthy());
  });

  it('annonce l’état du bouton de repli', () => {
    rendre(<AdminSidebar reduit onToggle={vi.fn()} />, PROFILS.support);

    const bouton = screen.getByRole('button', { name: 'Déplier la navigation' });
    expect(bouton.getAttribute('aria-pressed')).toBe('true');
  });

  it('appelle la bascule', () => {
    const basculer = vi.fn();
    rendre(<AdminSidebar reduit={false} onToggle={basculer} />, PROFILS.support);

    fireEvent.click(screen.getByRole('button', { name: 'Replier la navigation' }));
    expect(basculer).toHaveBeenCalled();
  });
});

describe('Cibles tactiles de la navigation', () => {
  it('donne 44 px de haut à chaque lien', () => {
    const { container } = rendre(<AdminNav onNavigate={vi.fn()} />, PROFILS.proprietaire);

    const nav = container.querySelector('nav');
    within(nav)
      .getAllByRole('link')
      .forEach((lien) => expect(lien.className).toContain('min-h-[44px]'));
  });
});

/**
 * @vitest-environment jsdom
 *
 * L'administration au téléphone.
 *
 * Deux défauts signalés à l'écran : aucune navigation visible sur l'écran des
 * réservations, et un détail de ligne qui n'apparaît nulle part quand on
 * choisit une réservation.
 *
 * Le troisième vient d'un plantage : refermer le plan d'un étage emportait
 * l'écran des bâtiments entier.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../../hooks/useToast';
import { DetailPanel } from './DetailPanel';
import { FloorPlanModal } from './buildings/FloorPlanModal';
import AdminLayout from '../../layouts/AdminLayout';

vi.mock('../../hooks/useAdminSession', () => ({
  useAdminSession: () => ({
    admin: { firstName: 'Dylan', lastName: 'Menga', role: 'Administrateur' },
    logout: vi.fn(),
  }),
}));

vi.mock('../../hooks/usePermission', () => ({
  usePermission: () => ({ peut: () => true }),
}));

vi.mock('../../api/admin/conflicts', () => ({
  countQueue: () => Promise.resolve({ tous: 0 }),
}));

const largeur = (px) => {
  window.matchMedia = vi.fn().mockImplementation((query) => {
    const max = /max-width:\s*(\d+)px/.exec(query);
    const min = /min-width:\s*(\d+)px/.exec(query);
    return {
      matches: max ? px <= Number(max[1]) : min ? px >= Number(min[1]) : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
  });
};

afterEach(() => vi.restoreAllMocks());

const monterCadre = () =>
  render(
    <MemoryRouter
      initialEntries={['/admin/reservations']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AdminLayout />
    </MemoryRouter>,
  );

describe('Navigation au téléphone', () => {
  it('ouvre les dix-huit écrans depuis la barre haute', () => {
    // Sous 768 px la barre latérale disparaît : sans ce bouton, l'écran des
    // réservations est un cul-de-sac.
    largeur(390);
    monterCadre();

    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));

    const feuille = screen.getByRole('dialog');
    expect(within(feuille).getByRole('link', { name: /Bâtiments/ })).toBeTruthy();
    expect(within(feuille).getByRole('link', { name: /Toutes les réservations/ })).toBeTruthy();
  });

  it('nomme le bouton en toutes lettres', () => {
    // Une icône seule ne dit pas qu'elle cache dix-huit écrans : le mot
    // « Menu » est la seule chose qui le dise sans l'avoir déjà essayé.
    largeur(390);
    monterCadre();

    expect(screen.getByText('Menu')).toBeTruthy();
  });

  it('ne double pas la barre latérale au bureau', () => {
    largeur(1440);
    monterCadre();

    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Détail d’une ligne au téléphone', () => {
  it('s’ouvre en boîte de dialogue par-dessus la liste', () => {
    // Le rail droit tombait sous la liste : choisir une réservation ne
    // changeait rien à l'écran, il fallait deviner qu'un panneau était apparu
    // quinze lignes plus bas.
    largeur(390);
    const fermer = vi.fn();
    render(
      <DetailPanel title="Comité de suivi" subtitle="Salle Joule" onClose={fermer}>
        <p>13:00 – 14:30</p>
      </DetailPanel>,
    );

    const boite = screen.getByRole('dialog');
    expect(within(boite).getByText('13:00 – 14:30')).toBeTruthy();

    fireEvent.click(within(boite).getByRole('button', { name: 'Fermer le détail' }));
    expect(fermer).toHaveBeenCalled();
  });

  it('n’affiche pas d’encart « aucune sélection » au téléphone', () => {
    // Il occupait la place sans rien dire qu'une liste sans surbrillance ne
    // dise déjà.
    largeur(390);
    render(<DetailPanel emptyDescription="Choisissez une réservation" onClose={vi.fn()} />);

    expect(screen.queryByText('Choisissez une réservation')).toBeNull();
  });

  it('reste un rail au bureau', () => {
    largeur(1440);
    render(
      <DetailPanel title="Comité de suivi" onClose={vi.fn()}>
        <p>13:00 – 14:30</p>
      </DetailPanel>,
    );

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('13:00 – 14:30')).toBeTruthy();
  });
});

describe('Plan d’étage refermé', () => {
  it('ne lit rien sur l’étage absent', () => {
    // `Modal` rend `null` quand elle est fermée — trop tard : ses enfants sont
    // construits par l'appelant, et le corps lisait `floor.id` sur `null` dès
    // qu'un plan avait été ouvert une fois.
    largeur(1440);
    const { rerender } = render(
      <ToastProvider>
        <FloorPlanModal floor={{ id: 'f-1', label: '2e étage' }} open onClose={vi.fn()} />
      </ToastProvider>,
    );

    expect(() =>
      rerender(
        <ToastProvider>
          <FloorPlanModal floor={null} open={false} onClose={vi.fn()} />
        </ToastProvider>,
      ),
    ).not.toThrow();
  });
});

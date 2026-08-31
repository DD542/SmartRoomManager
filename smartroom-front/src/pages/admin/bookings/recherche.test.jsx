/**
 * @vitest-environment jsdom
 *
 * La recherche de la barre haute mène à cet écran.
 *
 * `AdminTopbar` navigue vers `/admin/reservations?q=…`, et la page ne lisait
 * pas ce paramètre. Taper « salle curie » en haut de l'écran amenait donc sur
 * la liste entière, champ de recherche vide, première page — et rien ne
 * distinguait une recherche sans résultat d'une recherche jamais faite.
 *
 * Le défaut ne produisait aucune erreur : l'écran demandé s'affichait, il
 * ignorait seulement ce qu'on lui demandait d'y chercher.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../../../hooks/useToast';

vi.mock('../../../hooks/usePermission', () => ({
  usePermission: () => ({ peut: () => true }),
}));

vi.mock('../../../api/admin/bookings', () => ({
  listAllBookings: vi.fn().mockResolvedValue({ reservations: [], reste: 0 }),
  listBookableUsers: vi.fn().mockResolvedValue([]),
  listBookingFilters: vi.fn().mockResolvedValue({
    rooms: [],
    buildings: [],
    statuses: [],
    sources: [],
  }),
}));

const { listAllBookings } = await import('../../../api/admin/bookings');
const { default: AllBookingsPage } = await import('./AllBookingsPage');

// `DetailPanel` interroge la largeur pour choisir entre rail et boîte de
// dialogue ; jsdom n'implémente pas `matchMedia`.
beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: query.includes('min-width: 1024px'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

afterEach(() => vi.clearAllMocks());

const monter = (adresse) =>
  render(
    <ToastProvider>
      <MemoryRouter
        initialEntries={[adresse]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/admin/reservations" element={<AllBookingsPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );

describe('Arrivée depuis la barre haute', () => {
  it('reprend le terme cherché dans le champ', async () => {
    monter('/admin/reservations?q=salle%20curie');

    const champ = await screen.findByPlaceholderText(/Objet, salle, organisateur/);
    expect(champ.value).toBe('salle curie');
  });

  it('le transmet à la requête', async () => {
    monter('/admin/reservations?q=salle%20curie');

    await waitFor(() =>
      expect(listAllBookings).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'salle curie' }),
      ),
    );
  });

  it('n’invente rien quand l’adresse ne demande rien', async () => {
    monter('/admin/reservations');

    const champ = await screen.findByPlaceholderText(/Objet, salle, organisateur/);
    expect(champ.value).toBe('');
    await waitFor(() =>
      expect(listAllBookings).toHaveBeenCalledWith(expect.objectContaining({ query: '' })),
    );
  });
});

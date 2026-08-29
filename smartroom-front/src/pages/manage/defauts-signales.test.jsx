/**
 * @vitest-environment jsdom
 *
 * Quatre défauts relevés à l'écran par l'utilisateur, verrouillés ici.
 *
 * Ils partagent une forme : un contrat implicite entre deux couches avait
 * divergé sans que rien ne le signale — une liste de motifs devenue objets, un
 * bouton qui ne transmet pas sa destination, un chargement qui s'arrête sans le
 * dire, une pagination qui suppose peu de pages.
 */

import { describe, expect, it, vi } from 'vitest';
import { HttpResponse, http } from 'msw';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../../hooks/useToast';
import { page, serveur } from '../../test/serveur';
import { Pagination, fenetreDePages } from '../../components/ui/Table';
import { collectAvecReste } from '../../api/client';
import { listAllBookings } from '../../api/admin/bookings';
import CancelBookingModal from './CancelBookingModal';

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u-1', email: 'd.menga@ece.fr' } }),
}));

const BASE = 'http://localhost:5180/api/v1';

const RESERVATION = {
  id: 'bk-1',
  roomId: 'r-1',
  room: { id: 'r-1', name: 'Salle Fermat' },
  start: new Date('2026-08-31T08:00:00Z'),
  end: new Date('2026-08-31T08:30:00Z'),
  attendees: 4,
};

describe('U-11 — motifs d’annulation', () => {
  const monter = () =>
    render(
      <ToastProvider>
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <CancelBookingModal booking={RESERVATION} open onClose={vi.fn()} />
        </MemoryRouter>
      </ToastProvider>,
    );

  it('rend un motif lisible par option', async () => {
    // L’écran réemballait `{ id, label }` en `{ value: item, label: item }` :
    // l’objet entier finissait comme enfant d’un `<option>`, React refuse, et
    // toute la page tombait sur l’écran d’erreur du routeur.
    monter();

    const liste = await screen.findByLabelText(/Motif de l’annulation/);
    const motifs = within(liste).getAllByRole('option');

    expect(motifs.length).toBeGreaterThan(1);
    motifs.forEach((option) => {
      expect(option.textContent).not.toContain('object');
      expect(option.value).not.toBe('[object Object]');
    });
  });

  it('n’émet aucun avertissement de clé dupliquée', async () => {
    const plaintes = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => plaintes.push(String(args[0])));

    monter();
    await screen.findByLabelText(/Motif de l’annulation/);

    expect(plaintes.filter((item) => item.includes('same key'))).toEqual([]);
    vi.restoreAllMocks();
  });
});

describe('Pagination — quarante pages', () => {
  it('borne la rangée à sept numéros et garde les deux flèches', () => {
    // Rendre les quarante boutons poussait « page suivante » hors de l’écran :
    // la liste s’arrêtait à la page 22, sans aucun moyen d’aller plus loin.
    render(<Pagination page={1} pageCount={40} total={589} pageSize={15} onChange={vi.fn()} />);

    const numeros = screen.getAllByRole('button', { name: /^Page \d+$/ });
    expect(numeros.length).toBeLessThanOrEqual(7);
    expect(screen.getByRole('button', { name: 'Page suivante' }).disabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Page précédente' }).disabled).toBe(true);
  });

  it('garde la première, la dernière et le voisinage de la page courante', () => {
    expect(fenetreDePages(20, 40)).toEqual([1, null, 19, 20, 21, null, 40]);
    expect(fenetreDePages(1, 40)).toEqual([1, 2, 3, 4, null, 40]);
    expect(fenetreDePages(40, 40)).toEqual([1, null, 37, 38, 39, 40]);
  });

  it('les rend toutes tant qu’elles tiennent', () => {
    expect(fenetreDePages(2, 5)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('A-03 — chargement tronqué', () => {
  const pageDeCent = (numero, total) => ({
    items: Array.from({ length: Math.min(100, total - (numero - 1) * 100) }, (_, index) => ({
      id: `bk-${(numero - 1) * 100 + index}`,
      room_id: 'r-1',
      slot: { starts_at: '2026-09-01T08:00:00Z', ends_at: '2026-09-01T09:00:00Z' },
      status: 'confirmee',
    })),
    total,
    pagination: { page: numero, size: 100, pages: Math.ceil(total / 100) },
  });

  const servir = (total) =>
    serveur.use(
      http.get(`${BASE}/admin/bookings`, ({ request }) =>
        HttpResponse.json(
          pageDeCent(Number(new URL(request.url).searchParams.get('page') ?? 1), total),
        ),
      ),
    );

  it('annonce ce que le plafond a laissé de côté', async () => {
    // 589 réservations, 500 chargées, rien à l’écran : la route rend par
    // créneau croissant, les 89 abandonnées étaient donc les plus lointaines —
    // là où atterrit une réservation qu’on vient de créer.
    servir(589);

    const { lignes, reste } = await collectAvecReste('/admin/bookings', { max: 500 });
    expect(lignes).toHaveLength(500);
    expect(reste).toBe(89);
  });

  it('charge le parc entier et ne signale alors plus rien', async () => {
    servir(589);

    const { reservations, reste } = await listAllBookings();
    expect(reservations).toHaveLength(589);
    expect(reste).toBe(0);
  });
});

describe('U-18 — itinéraire vers une salle', () => {
  const SALLE = {
    id: 'r-9',
    name: 'Salle Fermat',
    slug: 'fermat',
    building_id: 'b-1',
    building_name: 'Eiffel 2',
    floor_id: 'f-rdc',
    floor_label: 'Rez-de-chaussée',
    floor_level: 0,
    capacity: 8,
    area_m2: '22.00',
    status: 'disponible',
    is_accessible: true,
    badge_required: false,
    equipments: [],
    photos: [],
    placement: { pos_x: 10, pos_y: 10, width: 20, height: 20, is_entrance_marked: true },
  };

  it('ouvre l’étage de la salle demandée et la choisit', async () => {
    // « Voir l’itinéraire » menait à `/app/plan` sans dire de quelle salle :
    // l’écran ouvrait le premier étage du parc, aucune salle choisie.
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    serveur.use(
      // Ces deux routes rendent un tableau nu, pas l'enveloppe paginée.
      http.get(`${BASE}/buildings`, () => HttpResponse.json([{ id: 'b-1', name: 'Eiffel 2' }])),
      http.get(`${BASE}/buildings/:id/floors`, () =>
        HttpResponse.json([
          { id: 'f-2', building_id: 'b-1', label: '2e étage', level: 2, has_plan: false, room_count: 1 },
          { id: 'f-rdc', building_id: 'b-1', label: 'Rez-de-chaussée', level: 0, has_plan: false, room_count: 1 },
        ]),
      ),
      http.get(`${BASE}/rooms/r-9`, () => HttpResponse.json(SALLE)),
      http.get(`${BASE}/rooms`, ({ request }) => {
        const etage = new URL(request.url).searchParams.get('floor_id');
        return HttpResponse.json(page(etage === 'f-rdc' ? [SALLE] : []));
      }),
      http.get(`${BASE}/bookings`, () => HttpResponse.json(page([]))),
    );

    const { default: FloorPlanPage } = await import('../catalog/FloorPlanPage');

    render(
      <ToastProvider>
        <MemoryRouter
          initialEntries={['/app/plan?salle=r-9']}
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
          <Routes>
            <Route path="/app/plan" element={<FloorPlanPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    );

    // L’étage retenu est celui de la salle, et non le premier de la liste.
    const choix = await screen.findByLabelText(/Étage affiché/);
    await waitFor(() => expect(choix.value).toBe('f-rdc'));
    expect(await screen.findByText(/Entrée — Eiffel 2/)).toBeTruthy();
  });
});

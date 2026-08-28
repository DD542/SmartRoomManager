/**
 * @vitest-environment jsdom
 *
 * Écran de confirmation — le dernier endroit où le code d'accès peut être lu.
 *
 * L'écran relisait la réservation par son identifiant, ce qui le rend
 * partageable et rechargeable. Mais le code en clair n'existe qu'à l'instant
 * de sa création : relu, il ne reste que l'indice « E-**** ». L'utilisateur
 * qui venait de réserver ne voyait donc jamais le code de la porte.
 */

import { describe, expect, it, vi } from 'vitest';
import { HttpResponse, http } from 'msw';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../../hooks/useToast';
import { erreur, serveur } from '../../test/serveur';

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u-1', email: 'd.menga@ece.fr' } }),
}));

const { default: ConfirmedPage } = await import('./ConfirmedPage');

const BASE = 'http://localhost:5180/api/v1';

const RESERVATION = {
  id: 'bk-4',
  room_id: 'r-1',
  room_name: 'Salle Descartes',
  building_name: 'Eiffel 5',
  floor_label: '1er étage',
  floor_id: 'f-9',
  floor_has_plan: false,
  room_photo_url: null,
  room_location_plan_url: '/media/reperes/descartes.png',
  room_badge_required: true,
  access_code_hint: 'E-****',
  title: 'Réunion',
  slot: { starts_at: '2026-09-01T08:00:00Z', ends_at: '2026-09-01T08:30:00Z' },
  attendees: 4,
  status: 'confirmee',
  source: 'utilisateur',
  is_forced: false,
  checked_in_at: null,
  events: [],
  participants: [],
};

describe('Écran de confirmation', () => {
  const monter = (etat) =>
    render(
      <ToastProvider>
        <MemoryRouter
          initialEntries={[{ pathname: '/app/reservation/bk-4/confirmee', state: etat }]}
        >
          <Routes>
            <Route path="/app/reservation/:id/confirmee" element={<ConfirmedPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    );

  it('montre le code en clair rendu par la création, une seule fois', async () => {
    serveur.use(http.get(`${BASE}/bookings/bk-4`, () => HttpResponse.json(RESERVATION)));

    monter({ code: 'E-7412' });

    expect(await screen.findByText('E-7412')).toBeTruthy();
    expect(screen.getByText(/affiché qu’une fois/)).toBeTruthy();
  });

  it('retombe sur l’indice quand la page est rechargée', async () => {
    // Rechargée ou partagée, la page n'a plus l'état de navigation : elle dit
    // alors ce qu'elle sait, plutôt que de promettre un code qu'elle n'a pas.
    serveur.use(http.get(`${BASE}/bookings/bk-4`, () => HttpResponse.json(RESERVATION)));

    monter(undefined);

    expect(await screen.findByText('E-****')).toBeTruthy();
    expect(screen.getByText(/Émettez-en un nouveau/)).toBeTruthy();
  });

  it('affiche le plan de la salle sans réclamer celui de l’étage', async () => {
    // L'écran ne connaissait que le plan d'étage, rarement déposé : il
    // annonçait « aucun plan » en ignorant celui de la salle, et laissait un
    // 404 rouge dans la console au passage.
    let demande = false;
    serveur.use(
      http.get(`${BASE}/bookings/bk-4`, () => HttpResponse.json(RESERVATION)),
      http.get(`${BASE}/floors/:id/plan`, () => {
        demande = true;
        return HttpResponse.json(erreur('introuvable', 'Aucun plan.'), { status: 404 });
      }),
    );

    monter({ code: 'E-7412' });

    const image = await screen.findByAltText(/Plan de localisation — Salle Descartes/);
    expect(image.getAttribute('src')).toBe('/media/reperes/descartes.png');
    expect(demande).toBe(false);
  });
});

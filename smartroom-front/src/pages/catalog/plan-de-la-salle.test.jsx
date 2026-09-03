/**
 * @vitest-environment jsdom
 *
 * La fiche d'une salle montre son repère quand l'étage n'a pas de plan.
 *
 * Deux documents répondent à « où est cette salle ? ». Le plan d'étage, déposé
 * par l'administration dans `floor_plans`, situe la salle parmi les autres. Le
 * repère, porté par `rooms.location_plan_url`, accompagne chaque fiche du parc
 * et existe pour les quinze salles du jeu de démonstration.
 *
 * L'écran n'affichait que le premier. Sans plan d'étage — le cas courant, la
 * table est vide tant que personne n'a rien déposé — la section « Plan de
 * localisation » annonçait « Aucun plan déposé pour cet étage » alors que
 * l'API rendait bien `location_plan_url`. La donnée existait, seuls les écrans
 * d'administration s'en servaient.
 */

import { describe, expect, it, vi } from 'vitest';
import { HttpResponse, http } from 'msw';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../../hooks/useToast';
import { serveur } from '../../test/serveur';

const BASE = 'http://localhost:5180/api/v1';
const SALLE_ID = 'b5543686-ce47-4976-aa05-b2ac2a70d188';
const ETAGE_ID = 'f-1';
const REPERE = '/media/reperes/6ba663c03ebc4e5e80e7cf567413aeb6.jpg';

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u-1', firstName: 'Alice' } }),
}));

vi.mock('../../hooks/useAdminSession', () => ({
  useAdminSession: () => ({ permissions: [], admin: null }),
}));

const { default: RoomDetailPage } = await import('./RoomDetailPage');

const salle = (extra = {}) => ({
  id: SALLE_ID,
  name: 'Amphi Eiffel',
  slug: 'amphi-eiffel',
  status: 'disponible',
  capacity: 90,
  area_m2: 180,
  is_accessible: true,
  badge_required: true,
  building_id: 'b-1',
  building_name: 'Eiffel 1',
  floor_id: ETAGE_ID,
  floor_label: 'Rez-de-chaussée',
  floor_level: 0,
  equipments: [],
  photos: [],
  placement: null,
  occupancy_percent: 13,
  booking_count: 0,
  description: null,
  location_plan_url: REPERE,
  ...extra,
});

/**
 * Le reste de ce que la fiche demande.
 *
 * Sans ces réponses, MSW refuse les requêtes et l'écran reste sur son
 * squelette : les trois cas échoueraient pour une raison qui n'est pas leur
 * sujet. `/floors/:id/plan` rend 404 — c'est l'état courant, aucun plan
 * d'étage déposé, et c'est précisément la situation qu'on éprouve.
 */
const annexes = () => [
  http.get(`${BASE}/availability/rooms/${SALLE_ID}/free-slots`, () =>
    HttpResponse.json({ items: [], total: 0 }),
  ),
  http.get(`${BASE}/buildings/b-1`, () =>
    HttpResponse.json({ id: 'b-1', code: 'EIF1', name: 'Eiffel 1', floors: [] }),
  ),
  http.get(`${BASE}/rooms/${SALLE_ID}/booking-rules`, () => HttpResponse.json({})),
  http.get(`${BASE}/rooms/${SALLE_ID}/opening-hours`, () => HttpResponse.json([])),
  http.get(`${BASE}/floors/${ETAGE_ID}/plan`, () => new HttpResponse(null, { status: 404 })),
];

function monter() {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[`/app/salles/${SALLE_ID}`]}>
        <Routes>
          <Route path="/app/salles/:id" element={<RoomDetailPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

describe('plan de localisation d’une salle', () => {
  it('affiche le repère de la salle quand l’étage n’a pas de plan', async () => {
    serveur.use(
      http.get(`${BASE}/rooms/${SALLE_ID}`, () => HttpResponse.json(salle())),
      ...annexes(),
    );

    monter();

    const image = await screen.findByAltText(
      /Plan de localisation : Repère de Amphi Eiffel/i,
    );
    expect(image.getAttribute('src')).toBe(REPERE);
  });

  it('n’annonce plus l’absence de plan quand un repère existe', async () => {
    serveur.use(
      http.get(`${BASE}/rooms/${SALLE_ID}`, () => HttpResponse.json(salle())),
      ...annexes(),
    );

    monter();

    await screen.findByText('Amphi Eiffel');
    await waitFor(() => expect(screen.queryByText(/Aucun plan déposé/i)).toBeNull());
  });

  it('garde le message quand la salle n’a aucun repère', async () => {
    // Contre-épreuve : sans elle, un composant qui afficherait n'importe quoi
    // passerait les deux tests précédents.
    serveur.use(
      http.get(`${BASE}/rooms/${SALLE_ID}`, () =>
        HttpResponse.json(salle({ location_plan_url: null })),
      ),
      ...annexes(),
    );

    monter();

    expect(await screen.findByText(/Aucun plan déposé/i)).toBeTruthy();
  });
});

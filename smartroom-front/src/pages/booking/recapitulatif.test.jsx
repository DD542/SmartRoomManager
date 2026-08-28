/**
 * @vitest-environment jsdom
 *
 * Dernière étape du tunnel : ce qui part réellement au serveur.
 *
 * L'écran ajoutait l'organisateur en tête de la liste des invités, alors que
 * le service l'inscrit lui-même depuis la session. Il était donc posé deux
 * fois, et `uq_booking_participants_email` refusait la réservation entière —
 * après quatre étapes de tunnel, sur un message qui ne disait ni quelle valeur
 * ni où la corriger.
 */

import { describe, expect, it, vi } from 'vitest';
import { HttpResponse, http } from 'msw';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../../hooks/useToast';
import { serveur } from '../../test/serveur';

const MOI = {
  id: 'u-1',
  email: 'd.menga@ece.fr',
  firstName: 'Dylan',
  lastName: 'Menga',
  preferences: { reminderDelayMin: 30 },
};

const BROUILLON = {
  roomId: 'r-1',
  room: { id: 'r-1', name: 'Salle Fermat', building: { name: 'Eiffel 2' }, floor: '2e étage', equipment: [] },
  date: '2026-09-04',
  startTime: '17:30',
  endTime: '18:00',
  attendees: 8,
  equipmentIds: [],
  title: '',
  participants: [{ email: 'djoubissimarc@gmail.com', name: 'Marc' }],
  notifyEmail: true,
  notifyReminder: true,
};

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: MOI }) }));
vi.mock('../../hooks/useBooking', () => ({
  useBooking: () => ({
    draft: BROUILLON,
    update: vi.fn(),
    hasDraft: true,
    hasRoom: true,
  }),
}));

const { default: SummaryPage } = await import('./SummaryPage');

const BASE = 'http://localhost:5180/api/v1';

describe('Récapitulatif de réservation', () => {
  const monter = () =>
    render(
      <ToastProvider>
        <MemoryRouter>
          <SummaryPage />
        </MemoryRouter>
      </ToastProvider>,
    );

  it('n’envoie que les invités, sans l’organisateur', async () => {
    let corps = null;
    serveur.use(
      http.get(`${BASE}/rooms/r-1/directions`, () => HttpResponse.json({ steps: [] })),
      http.post(`${BASE}/bookings`, async ({ request }) => {
        corps = await request.json();
        return HttpResponse.json(
          {
            booking: {
              id: 'bk-1',
              room_id: 'r-1',
              room_name: 'Salle Fermat',
              title: 'Réunion',
              slot: { starts_at: '2026-09-04T15:30:00Z', ends_at: '2026-09-04T16:00:00Z' },
              attendees: 8,
              status: 'confirmee',
              source: 'utilisateur',
              is_forced: false,
              checked_in_at: null,
              cancelled_at: null,
              cancel_reason: null,
              events: [],
            },
            access_code: { code: 'F-4821', hint: 'F-****' },
          },
          { status: 201 },
        );
      }),
    );

    monter();
    fireEvent.click(await screen.findByRole('button', { name: /Confirmer la réservation/ }));

    await waitFor(() => expect(corps).not.toBeNull());
    expect(corps.participants).toEqual([['djoubissimarc@gmail.com', 'Marc']]);
    expect(JSON.stringify(corps.participants)).not.toContain(MOI.email);
  });
});

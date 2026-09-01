/**
 * @vitest-environment jsdom
 *
 * Un ticket s'ouvre par son adresse.
 *
 * `/admin/tickets/:id` figure dans le routeur comme une entrée à part, à côté
 * de `/admin/tickets` — l'intention était donc bien d'ouvrir une demande
 * précise. Mais la page tenait sa sélection dans un état local initialisé à
 * `null` et ne lisait jamais le paramètre : l'adresse menait à la file, avec
 * « Aucun ticket sélectionné ».
 *
 * Ce que cela coûtait : un lien vers un ticket — dans une notification, un
 * courriel, un signet, ou simplement la barre d'adresse — perdait le ticket.
 * Rien ne le signalait : la page s'affichait, complète et vide de son sujet.
 *
 * Assertions DOM natives : `jest-dom` n'est pas dans les dépendances.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../../../hooks/useToast';

const TICKET = {
  id: 'tk-1',
  subject: 'Climatisation défectueuse',
  status: 'ouvert',
  category: 'maintenance',
  messages: [{ at: '2026-09-01T08:00:00Z', author: 'user', body: 'Il fait 30 degrés.' }],
};

const listAdminTickets = vi.fn(async () => [TICKET]);
const getAdminTicket = vi.fn(async () => TICKET);

vi.mock('../../../api/admin/tickets', () => ({
  listAdminTickets: (...a) => listAdminTickets(...a),
  getAdminTicket: (...a) => getAdminTicket(...a),
  countTickets: vi.fn(async () => ({ ouverts: 1, en_cours: 0, resolus: 0, tous: 1 })),
  listResponseTemplates: vi.fn(async () => []),
  replyToAdminTicket: vi.fn(),
  setTicketStatus: vi.fn(),
}));

const { default: TicketsPage } = await import('./TicketsPage');

const monter = (chemin) =>
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={[chemin]}>
        <Routes>
          <Route path="/admin/tickets" element={<TicketsPage />} />
          <Route path="/admin/tickets/:id" element={<TicketsPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );

afterEach(() => vi.clearAllMocks());

describe('Ouverture par l’adresse', () => {
  it('ouvre le ticket que l’adresse désigne', async () => {
    monter('/admin/tickets/tk-1');

    await waitFor(() => expect(getAdminTicket).toHaveBeenCalledWith('tk-1'));
    expect(screen.queryByText(/Aucun ticket sélectionné/)).toBeNull();
  });

  it('laisse la file sans sélection quand l’adresse n’en désigne aucun', async () => {
    monter('/admin/tickets');

    await waitFor(() => expect(listAdminTickets).toHaveBeenCalled());
    expect(await screen.findByText(/Aucun ticket sélectionné/)).toBeTruthy();
    expect(getAdminTicket).not.toHaveBeenCalled();
  });
});

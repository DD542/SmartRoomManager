/**
 * @vitest-environment jsdom
 *
 * Le choix, quand plusieurs réservations attendent une validation.
 *
 * L'écran les listait déjà, mais sans dire laquelle était validable : deux
 * boutons « Valider » identiques, dont l'un menait à une fenêtre fermée pour
 * plusieurs heures. Choisir à l'aveugle entre les deux était la suite
 * naturelle du problème, pas sa solution.
 *
 * Assertions DOM natives : `jest-dom` n'est pas dans les dépendances.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const MAINTENANT = new Date('2026-09-01T04:10:00Z');

const enCours = {
  id: 'bk-ouverte',
  title: 'Essai',
  start: new Date('2026-09-01T04:09:00Z'),
  end: new Date('2026-09-01T06:09:00Z'),
  room: { id: 'r-1', name: 'Salle Curie' },
};

const plusTard = {
  id: 'bk-fermee',
  title: 'Réunion',
  start: new Date('2026-09-01T10:00:00Z'),
  end: new Date('2026-09-01T10:30:00Z'),
  room: { id: 'r-2', name: 'Salle Descartes' },
};

vi.mock('../../api/bookings', () => ({
  listBookings: vi.fn(async () => [plusTard, enCours]),
}));

vi.mock('../../api/rooms', () => ({
  getRoomRules: vi.fn(async () => ({ checkinWindowMin: 10 })),
}));

const { default: CheckInEntryPage } = await import('./CheckInEntryPage');

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(MAINTENANT);
});

afterEach(() => {
  vi.useRealTimers();
});

const ligne = (salle) =>
  screen.getByText(new RegExp(salle)).closest('div[class*="items-center"]') ??
  screen.getByText(new RegExp(salle)).parentElement.parentElement;

describe('Plusieurs réservations à valider', () => {
  it('les propose toutes, sans en choisir une à la place de l’utilisateur', async () => {
    render(
      <MemoryRouter>
        <CheckInEntryPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText(/Salle Curie/)).toBeTruthy());
    expect(screen.getByText(/Salle Descartes/)).toBeTruthy();
  });

  it('dit laquelle est validable maintenant', async () => {
    render(
      <MemoryRouter>
        <CheckInEntryPage />
      </MemoryRouter>,
    );

    // L'étiquette n'apparaît qu'une fois la règle de la salle obtenue :
    // attendre la ligne ne suffit pas, il faut attendre l'étiquette. Sans
    // cela le test passait par chance, selon l'ordre des microtâches.
    await waitFor(() =>
      expect(within(ligne('Salle Curie')).getByText(/Ouverte/)).toBeTruthy(),
    );
  });

  it('annonce l’heure d’ouverture des autres, plutôt qu’un bouton identique', async () => {
    // Deux boutons « Valider » identiques, dont l'un mène à une fenêtre fermée
    // pour six heures : le choix se faisait à l'aveugle.
    render(
      <MemoryRouter>
        <CheckInEntryPage />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(within(ligne('Salle Descartes')).getByText(/Ouvre à/)).toBeTruthy(),
    );
  });

  it('place la validable en premier', async () => {
    // Le tri par heure de début suffisait tant qu'une seule fenêtre pouvait
    // s'ouvrir. Celle qu'on peut valider passe devant.
    render(
      <MemoryRouter>
        <CheckInEntryPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText(/Salle Curie/)).toBeTruthy());
    const salles = screen.getAllByText(/Salle (Curie|Descartes)/).map((n) => n.textContent);
    expect(salles[0]).toMatch(/Curie/);
  });
});

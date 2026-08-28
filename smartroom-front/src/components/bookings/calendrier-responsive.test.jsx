/**
 * @vitest-environment jsdom
 *
 * Vues du calendrier selon la largeur.
 *
 * Sous 768 px, la semaine tasse sept colonnes dans 360 px et l'année en aligne
 * douze mois : les deux débordaient. Ce test monte réellement le composant —
 * un import manquant ne se voit pas à la compilation, seulement au rendu.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CALENDAR_VIEWS, RoomCalendar, vuesDisponibles } from './RoomCalendar';

/** Simule la largeur de la fenêtre pour `useMediaQuery`. */
const largeur = (mobile) => {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: query.includes('max-width: 767px') ? mobile : !mobile,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
};

afterEach(() => vi.restoreAllMocks());

describe('Vues proposées', () => {
  it('retire la semaine et l’année sous 768 px', () => {
    expect(vuesDisponibles(true).map((vue) => vue.value)).toEqual([
      'timeGridDay',
      'dayGridMonth',
    ]);
  });

  it('les propose toutes au-delà', () => {
    expect(vuesDisponibles(false)).toEqual(CALENDAR_VIEWS);
  });
});

describe('Calendrier d’une salle', () => {
  it('s’ouvre sur la journée au téléphone', () => {
    largeur(true);
    render(<RoomCalendar bookings={[]} anchorDate="2026-09-01" />);

    expect(screen.getByRole('radio', { name: 'Jour' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('radio', { name: 'Semaine' })).toBeNull();
  });

  it('s’ouvre sur la semaine au-delà', () => {
    largeur(false);
    render(<RoomCalendar bookings={[]} anchorDate="2026-09-01" />);

    expect(screen.getByRole('radio', { name: 'Semaine' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Année' })).toBeTruthy();
  });
});

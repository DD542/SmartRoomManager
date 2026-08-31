/**
 * @vitest-environment jsdom
 *
 * Vues du calendrier selon la largeur.
 *
 * La semaine et l'année étaient retirées sous 768 px : elles débordaient, et
 * sept colonnes dans 360 px en faisaient 45 chacune. Le calendrier défile
 * maintenant dans sa propre boîte, avec une largeur minimale par vue —
 * mesuré à 360 px : cinq colonnes de 98 px, zéro débordement de page. Les
 * quatre vues sont donc proposées à toute largeur, et l'écran de réservation
 * n'en offre plus deux sur quatre au téléphone.
 *
 * Ce test monte réellement le composant : un import manquant ne se voit pas à
 * la compilation, seulement au rendu.
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
  it('les propose toutes, à toute largeur', () => {
    expect(vuesDisponibles()).toEqual(CALENDAR_VIEWS);
    expect(CALENDAR_VIEWS.map((vue) => vue.value)).toEqual([
      'timeGridDay',
      'timeGridWeek',
      'dayGridMonth',
      'multiMonthYear',
    ]);
  });
});

describe('Calendrier d’une salle', () => {
  it('s’ouvre sur la journée au téléphone', () => {
    largeur(true);
    render(<RoomCalendar bookings={[]} anchorDate="2026-09-01" />);

    expect(screen.getByRole('radio', { name: 'Jour' }).getAttribute('aria-checked')).toBe('true');
    // La vue par défaut suit la largeur ; le choix, lui, reste entier.
    expect(screen.getByRole('radio', { name: 'Semaine' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Année' })).toBeTruthy();
  });

  it('s’ouvre sur la semaine au-delà', () => {
    largeur(false);
    render(<RoomCalendar bookings={[]} anchorDate="2026-09-01" />);

    expect(screen.getByRole('radio', { name: 'Semaine' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Année' })).toBeTruthy();
  });
});

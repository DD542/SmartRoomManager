/**
 * @vitest-environment jsdom
 *
 * Choisir un créneau au doigt.
 *
 * Au doigt, FullCalendar n'émet pas `select` : il attend un appui long — une
 * seconde par défaut — avant d'ouvrir un glisser. Une pression brève ne
 * produit qu'un `dateClick`, et ce gestionnaire rendait la main dans les vues
 * horaires. Toucher une heure ne faisait donc rien du tout, alors que le même
 * geste à la souris réservait le créneau : le tunnel de réservation était
 * impraticable au téléphone.
 *
 * Vérifié aussi dans un navigateur, en émulation tactile : un appui sur la
 * ligne de 10:00 rend « 10:00 → 10:30 ».
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { forwardRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';

//: FullCalendar est remplacé par un mouchard : il ne dessine rien et retient
//: les propriétés reçues, ce qui permet d'appeler les gestionnaires comme la
//: bibliothèque le ferait.
let recues = null;

vi.mock('@fullcalendar/react', () => ({
  default: forwardRef(function FauxCalendrier(props) {
    recues = props;
    return <div data-calendrier="mouchard" />;
  }),
}));

const { RoomCalendar } = await import('./RoomCalendar');

const largeur = (mobile) => {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: query.includes('max-width: 767px') ? mobile : !mobile,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
};

afterEach(() => {
  recues = null;
  vi.restoreAllMocks();
});

const monter = (onSelect) =>
  render(
    <RoomCalendar
      bookings={[]}
      anchorDate="2026-09-01"
      rules={{ openTime: '08:00', closeTime: '20:00', visitDays: [1, 2, 3, 4, 5] }}
      onSelect={onSelect}
    />,
  );

describe('Appui sur une heure', () => {
  it('choisit un créneau de trente minutes au téléphone', () => {
    largeur(true);
    const choisir = vi.fn();
    monter(choisir);

    const dixHeures = new Date('2026-09-01T10:00:00');
    recues.dateClick({ date: dixHeures, dateStr: '2026-09-01T10:00:00' });

    expect(choisir).toHaveBeenCalledTimes(1);
    const [debut, fin] = choisir.mock.calls[0];
    expect(debut).toEqual(dixHeures);
    // Trente minutes : la même durée qu'un clic de souris, qui sélectionne un
    // pas de grille. Le même geste doit donner le même résultat.
    expect((fin - debut) / 60000).toBe(30);
  });

  it('laisse la souris à `select`, qui a déjà tout fait', () => {
    // Sans cette garde, un clic écraserait la sélection que l'utilisateur
    // vient de tracer par un glisser : `select` s'exécute avant `dateClick`.
    largeur(false);
    const choisir = vi.fn();
    monter(choisir);

    recues.dateClick({ date: new Date('2026-09-01T10:00:00'), dateStr: '2026-09-01T10:00:00' });

    expect(choisir).not.toHaveBeenCalled();
  });

  it('raccourcit l’appui long au lieu de le laisser à une seconde', () => {
    largeur(true);
    monter(vi.fn());

    expect(recues.selectLongPressDelay).toBe(200);
    expect(recues.selectable).toBe(true);
  });

  it('ouvre la journée depuis la vue mois, sans rien choisir', () => {
    largeur(true);
    const choisir = vi.fn();
    monter(choisir);

    // La vue se change comme à l'écran, par le contrôle segmenté.
    fireEvent.click(screen.getByRole('radio', { name: 'Mois' }));
    // `act` : appelé hors d'un gestionnaire d'événement, le changement d'état
    // ne serait pas encore rendu au moment de l'assertion.
    act(() => recues.dateClick({ date: new Date('2026-09-04T00:00:00'), dateStr: '2026-09-04' }));

    // Une date de la grille mensuelle n'est pas un créneau : elle mène au
    // jour, où l'heure se choisit.
    expect(choisir).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: 'Jour' }).getAttribute('aria-checked')).toBe('true');
  });
});

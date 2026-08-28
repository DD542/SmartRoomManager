/**
 * @vitest-environment jsdom
 *
 * U-19 — points d'entrée et adaptation.
 *
 * L'écran existait dans le routeur sans qu'aucun chemin d'interface n'y mène
 * en desktop, et l'onglet mobile pointait sur un identifiant de maquette. Ces
 * tests verrouillent les entrées, pas l'apparence.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as adapt from '../../api/adapters';
import { NextBookingCard } from '../../components/home/NextBookingCard';

const rendre = (element) => render(<MemoryRouter>{element}</MemoryRouter>);

const reservation = (debutDansMinutes, extra = {}) => {
  const debut = new Date(Date.now() + debutDansMinutes * 60_000);
  return {
    id: 'bk-5',
    title: 'Point projet',
    start: debut,
    end: new Date(debut.getTime() + 60 * 60_000),
    status: 'confirmee',
    checkedIn: false,
    accessCode: 'E-****',
    room: { id: 'r-1', name: 'Salle Curie', building: { name: 'Eiffel 6' }, floor: '2e étage' },
    ...extra,
  };
};

describe('Entrée depuis la prochaine réservation', () => {
  it('propose la validation dans la demi-heure qui précède', () => {
    rendre(<NextBookingCard booking={reservation(10)} />);

    const lien = screen.getByRole('link', { name: /Valider ma présence/ });
    expect(lien.getAttribute('href')).toBe('/app/check-in/bk-5');
  });

  it('ne la propose pas trop tôt', () => {
    rendre(<NextBookingCard booking={reservation(180)} />);
    expect(screen.queryByRole('link', { name: /Valider ma présence/ })).toBeNull();
  });

  it('ne la propose plus une fois la présence validée', () => {
    rendre(<NextBookingCard booking={reservation(10, { checkedIn: true })} />);
    expect(screen.queryByRole('link', { name: /Valider ma présence/ })).toBeNull();
  });
});

describe('Entrée depuis une notification', () => {
  it('mène un rappel de réunion à la validation de présence', () => {
    // `notification.action` était lu par l'écran des notifications et produit
    // par personne : aucune notification n'a jamais porté d'action.
    const rappel = adapt.notification({
      id: 'n-1',
      title: 'Rappel : réunion dans 30 minutes',
      body: '…',
      channel: 'in_app',
      template_code: 'reservation_rappel',
      booking_id: 'bk-5',
      ticket_id: null,
      sent_at: '2026-09-01T07:30:00Z',
      read_at: null,
    });

    expect(rappel.action).toEqual({
      to: '/app/check-in/bk-5',
      label: 'Valider ma présence',
    });
  });

  it('mène une confirmation à la réservation', () => {
    const confirmation = adapt.notification({
      id: 'n-2',
      title: 'Réservation confirmée',
      channel: 'in_app',
      template_code: 'reservation_confirmation',
      booking_id: 'bk-5',
      ticket_id: null,
      sent_at: '2026-09-01T07:30:00Z',
      read_at: null,
    });

    expect(confirmation.action.to).toBe('/app/reservations/bk-5');
  });

  it('n’invente pas d’action quand la notification ne renvoie à rien', () => {
    const isolee = adapt.notification({
      id: 'n-3',
      title: 'Information',
      channel: 'in_app',
      template_code: null,
      booking_id: null,
      ticket_id: null,
      sent_at: '2026-09-01T07:30:00Z',
      read_at: null,
    });

    expect(isolee.action).toBeNull();
  });
});

/**
 * @vitest-environment jsdom
 *
 * Retirer un compte : un geste distinct de la suspension, et plus grave.
 *
 * La suspension empêche de réserver et se défait. Le retrait efface
 * l'identité, libère les créneaux à venir et ne se défait pas. Les deux
 * partagent la zone de danger de la fiche, jamais leur motif : réutiliser
 * celui de la suspension laisserait une phrase écrite pour une décision servir
 * à une autre, et l'audit garderait la mauvaise.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { UserDetail } from './UserDetail';

const COMPTE = {
  id: 'u-1',
  email: 'alice.leroy@edu.ece.fr',
  firstName: 'Alice',
  lastName: 'Leroy',
  status: 'actif',
  isAdmin: false,
  preferences: { weeklyQuotaHours: 12 },
  metrics: {
    activeBookings: 2,
    cancellations: 0,
    noShows: 0,
    attendanceRate: 1,
    bookedHoursThisWeek: 3,
    weeklyQuotaHours: 12,
    remainingCreditsH: 9,
  },
  recentBookings: [],
};

const monter = (props = {}) =>
  render(
    <UserDetail user={COMPTE} onStatus={vi.fn()} onCredits={vi.fn()} {...props} />,
  );

const ouvrirLaModale = () => {
  fireEvent.click(screen.getByRole('button', { name: /Retirer le compte/i }));
  return screen.getByRole('dialog');
};

describe('retrait d’un compte', () => {
  it('n’offre rien quand l’écran ne sait pas retirer', () => {
    // La fiche sert aussi là où le geste n'existe pas : proposer un bouton
    // sans destinataire produirait un clic sans effet.
    monter();

    expect(screen.queryByRole('button', { name: /Retirer le compte/i })).toBeNull();
  });

  it('exige un motif avant de laisser retirer', () => {
    monter({ onRemove: vi.fn() });

    const modale = ouvrirLaModale();

    // Assertions DOM natives : `jest-dom` n'est pas dans les dépendances.
    expect(
      within(modale).getByRole('button', { name: /Retirer définitivement/i }).disabled,
    ).toBe(true);
  });

  it('transmet le motif saisi, débarrassé de ses espaces', () => {
    const onRemove = vi.fn();
    monter({ onRemove });

    const modale = ouvrirLaModale();
    fireEvent.change(within(modale).getByLabelText(/Motif du retrait/i), {
      target: { value: '  Départ de l’établissement.  ' },
    });
    fireEvent.click(within(modale).getByRole('button', { name: /Retirer définitivement/i }));

    expect(onRemove).toHaveBeenCalledWith('Départ de l’établissement.');
  });

  it('ne confond pas son motif avec celui de la suspension', () => {
    // Contre-épreuve : un champ partagé ferait consigner à l'audit une phrase
    // écrite pour une autre décision.
    const onRemove = vi.fn();
    const onStatus = vi.fn();
    monter({ onRemove, onStatus });

    fireEvent.click(screen.getByRole('button', { name: /Suspendre le compte/i }));
    fireEvent.change(screen.getByLabelText(/Motif de la décision/i), {
      target: { value: 'Trois absences non excusées.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Suspendre$/i }));

    const modale = ouvrirLaModale();

    expect(within(modale).getByLabelText(/Motif du retrait/i).value).toBe('');
  });
});

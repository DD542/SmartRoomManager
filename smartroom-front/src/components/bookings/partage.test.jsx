/**
 * @vitest-environment jsdom
 *
 * Partage d'une réservation, et consigne écrite par l'administration.
 *
 * Le partage a une contrainte que le reste de l'application n'a pas : ce qui
 * en sort échappe définitivement au système. Un code d'accès parti dans une
 * conversation ne se révoque pas — il ouvre la porte à qui lit le message,
 * puis à qui le reçoit ensuite.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ShareModal } from './ShareModal';
import { SlotPanel } from './SlotPanel';
import {
  icsPartageable,
  liensDePartage,
  resumePartage,
} from '../../utils/partage';

const RESERVATION = {
  id: 'bk-1',
  title: 'Comité de suivi',
  start: new Date('2026-09-02T11:00:00Z'),
  end: new Date('2026-09-02T12:30:00Z'),
  accessCode: 'E-7412',
  room: {
    id: 'r-1',
    name: 'Salle Joule',
    floor: '2e étage',
    building: { name: 'Eiffel 2' },
    locationPlanUrl: '/media/reperes/joule.png',
  },
};

afterEach(() => vi.restoreAllMocks());

describe('Ce qui sort de l’application', () => {
  it('porte le lieu, la date et l’heure', () => {
    const texte = resumePartage(RESERVATION);

    expect(texte).toContain('Comité de suivi');
    expect(texte).toContain('Salle Joule');
    expect(texte).toContain('Eiffel 2');
    expect(texte).toContain('2e étage');
  });

  it('ne porte jamais le code d’accès', () => {
    // Un code parti dans une conversation ne se révoque pas.
    expect(resumePartage(RESERVATION)).not.toContain('E-7412');
    expect(icsPartageable(RESERVATION)).not.toContain('E-7412');
    liensDePartage(RESERVATION).forEach((lien) => {
      expect(decodeURIComponent(lien.href)).not.toContain('E-7412');
    });
  });

  it('ne porte pas de lien que le destinataire ne pourrait pas ouvrir', () => {
    // `/app/reservations/:id` exige une session, et le serveur répond 404 à
    // quiconque n'est pas l'organisateur.
    liensDePartage(RESERVATION).forEach((lien) => {
      expect(decodeURIComponent(lien.href)).not.toContain('/app/reservations/');
    });
  });

  it('produit un fichier d’agenda valide', () => {
    const ics = icsPartageable(RESERVATION);

    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect(ics).toContain('SUMMARY:Comité de suivi');
    // Les virgules sont échappées : c'est ce qu'exige RFC 5545, faute de quoi
    // l'agenda du destinataire lit trois champs au lieu d'un lieu.
    expect(ics).toContain('LOCATION:Salle Joule\\, Eiffel 2\\, 2e étage');
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
  });
});

describe('Fenêtre de partage', () => {
  it('montre le résumé et dit ce qu’il ne contient pas', () => {
    render(<ShareModal booking={RESERVATION} open onClose={vi.fn()} />);

    expect(screen.getByText(/Salle Joule/)).toBeTruthy();
    expect(screen.getByText(/Le code d’accès n’est pas partagé/)).toBeTruthy();
  });

  it('copie le résumé sans le code', async () => {
    const ecrit = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: ecrit },
      configurable: true,
    });

    render(<ShareModal booking={RESERVATION} open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Copier le résumé/ }));

    expect(ecrit).toHaveBeenCalled();
    expect(ecrit.mock.calls[0][0]).not.toContain('E-7412');
  });

  it('n’ouvre les applications que dans un onglet isolé', () => {
    render(<ShareModal booking={RESERVATION} open onClose={vi.fn()} />);

    ['WhatsApp', 'X', 'E-mail'].forEach((nom) => {
      const lien = screen.getByRole('link', { name: nom });
      expect(lien.getAttribute('rel')).toContain('noopener');
    });
  });

  it('ne rend rien sans réservation', () => {
    const { container } = render(<ShareModal booking={null} open onClose={vi.fn()} />);
    expect(container.textContent).toBe('');
  });
});

describe('Consigne de la salle', () => {
  const REGLES = {
    minDurationMin: 30,
    maxDurationMin: 240,
    openTime: '08:00',
    closeTime: '20:00',
    visitDays: [1, 2, 3, 4, 5],
    constraints: ['Durée comprise entre 30 et 240 minutes.'],
    notice: 'Laissez la salle rangée, la clé se retire à l’accueil.',
  };

  const CRENEAU = { start: new Date('2026-09-02T09:00:00Z'), end: new Date('2026-09-02T10:00:00Z') };

  it('s’affiche avant que l’utilisateur confirme', () => {
    // Une consigne que personne ne lit au bon moment ne sert à rien : elle
    // doit être là où l'on décide, pas dans un écran qu'on ouvre après.
    render(<SlotPanel slot={CRENEAU} rules={REGLES} />);

    expect(screen.getByText(/Laissez la salle rangée/)).toBeTruthy();
  });

  it('se distingue des règles calculées', () => {
    // Les phrases de `constraints` sont la traduction des seuils. Noyer la
    // consigne parmi elles la ferait lire comme une phrase générée de plus.
    render(<SlotPanel slot={CRENEAU} rules={REGLES} />);

    expect(screen.getByText('Consigne de la salle')).toBeTruthy();
  });

  it('ne laisse pas d’encadré vide quand il n’y a rien à dire', () => {
    render(<SlotPanel slot={CRENEAU} rules={{ ...REGLES, notice: null }} />);

    expect(screen.queryByText('Consigne de la salle')).toBeNull();
  });
});

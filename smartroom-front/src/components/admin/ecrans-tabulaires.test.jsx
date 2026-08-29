/**
 * @vitest-environment jsdom
 *
 * Les cinq écrans tabulaires, après migration vers les rangs de colonnes.
 *
 * Chacun réécrivait sa propre bascule en cartes. Ces tests vérifient ce qui
 * compte une fois la bascule partagée : qu'aucun écran n'a perdu au passage
 * l'information qui identifie une ligne, et qu'à 360 px il rend des cartes et
 * non un tableau.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuditTable } from './audit/AuditTable';
import { BookingsTable } from './bookings/BookingsTable';
import { RoomsTable } from './rooms/RoomsTable';
import { UsersTable } from './people/UsersTable';

const fauxTable = (rows) => ({
  rows,
  page: 1,
  pageCount: 1,
  total: rows.length,
  pageSize: 10,
  setPage: vi.fn(),
  selection: [],
  basculerLigne: vi.fn(),
  basculerPage: vi.fn(),
  basculerTri: vi.fn(),
  toutesSelectionnees: false,
  sort: null,
});

const largeur = (px) => {
  window.matchMedia = vi.fn().mockImplementation((query) => {
    const max = /max-width:\s*(\d+)px/.exec(query);
    const min = /min-width:\s*(\d+)px/.exec(query);
    return {
      matches: max ? px <= Number(max[1]) : min ? px >= Number(min[1]) : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
  });
};

afterEach(() => vi.restoreAllMocks());

const SALLE = {
  id: 'r-1',
  name: 'Salle Curie',
  buildingName: 'Eiffel 6',
  floor: '2e étage',
  area: 32,
  capacity: 12,
  status: 'disponible',
  occupancyRate: 0.42,
  equipment: [],
  equipmentCount: 0,
  bookingCount: 7,
  badgeRequired: true,
  accessible: true,
};

const COMPTE = {
  id: 'u-1',
  name: 'Dylan Menga',
  email: 'd.menga@ece.fr',
  promotion: 'B3',
  department: 'Direction',
  bookings: 14,
  noShowRate: 0.05,
  reliabilityScore: 92,
  remainingCreditsH: 6,
  quotaHours: 12,
  status: 'actif',
};

const RESERVATION = {
  id: 'bk-1',
  title: 'Point projet',
  roomName: 'Salle Curie',
  ownerName: 'Dylan Menga',
  start: new Date('2026-09-02T08:00:00Z'),
  end: new Date('2026-09-02T09:00:00Z'),
  status: 'confirmee',
  source: 'utilisateur',
  attendance: 'attendue',
};

const ACTION = {
  id: 'a-1',
  at: new Date('2026-09-01T10:00:00Z'),
  authorName: 'Marie Laurent',
  action: 'modification',
  target: 'Salle Curie',
  ip: '10.0.0.1',
  flagged: false,
};

const CAS = [
  ['A-03 Salles', <RoomsTable table={fauxTable([SALLE])} />, 'Salle Curie'],
  ['A-10 Utilisateurs', <UsersTable table={fauxTable([COMPTE])} />, 'Dylan Menga'],
  ['A-18 Réservations', <BookingsTable table={fauxTable([RESERVATION])} />, 'Point projet'],
  ['A-16 Journal', <AuditTable table={fauxTable([ACTION])} />, 'Salle Curie'],
];

describe('Bascule en cartes', () => {
  it.each(CAS)('%s rend des cartes à 360 px', (_nom, element, identifiant) => {
    largeur(360);
    render(element);

    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    // Ce qui identifie la ligne survit à la réduction : c'est la définition
    // même du premier rang.
    expect(screen.getAllByText(identifiant).length).toBeGreaterThan(0);
  });

  it.each(CAS)('%s rend un tableau à 1280 px', (_nom, element) => {
    largeur(1280);
    render(element);

    expect(screen.getByRole('table')).toBeTruthy();
  });
});

describe('Colonnes repliées', () => {
  it('cache l’adresse IP du journal à 1024 px, sans la perdre', () => {
    largeur(1024);
    render(<AuditTable table={fauxTable([ACTION])} />);

    expect(screen.queryByText('10.0.0.1')).toBeNull();
    expect(screen.getByRole('button', { name: /Voir le détail/ })).toBeTruthy();
  });

  it('garde le statut d’une réservation en carte', () => {
    // Statut et créneau sont de premier rang : ce sont eux qui disent s'il
    // faut ouvrir la ligne.
    largeur(360);
    render(<BookingsTable table={fauxTable([RESERVATION])} />);

    expect(screen.getByText('Confirmée')).toBeTruthy();
  });
});

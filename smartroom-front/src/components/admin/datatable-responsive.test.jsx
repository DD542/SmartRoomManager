/**
 * @vitest-environment jsdom
 *
 * `DataTable` : une définition de colonnes, trois formes.
 *
 * La bascule table→cartes était réécrite dans six composants. Ces tests
 * verrouillent la règle une fois, là où elle vit désormais : le rang d'une
 * colonne décide de son sort, et aucune page n'a plus à le savoir.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { colonnesRepliees, colonnesVisibles } from './colonnes';
import { DataTable } from './DataTable';

const COLONNES = [
  { key: 'name', label: 'Salle', priority: 'primary' },
  { key: 'capacity', label: 'Capacité', priority: 'primary' },
  { key: 'floor', label: 'Étage', priority: 'secondary' },
  { key: 'updatedAt', label: 'Modifiée le', priority: 'tertiary' },
];

const LIGNES = [
  { id: 'r-1', name: 'Salle Curie', capacity: 12, floor: '2e étage', updatedAt: '01/09' },
  { id: 'r-2', name: 'Salle Vinci', capacity: 20, floor: '1er étage', updatedAt: '28/08' },
];

const table = {
  rows: LIGNES,
  page: 1,
  pageCount: 1,
  total: LIGNES.length,
  pageSize: 10,
  setPage: vi.fn(),
  selection: [],
  basculerLigne: vi.fn(),
  basculerPage: vi.fn(),
  basculerTri: vi.fn(),
  toutesSelectionnees: false,
  sort: null,
};

/** Fixe la largeur vue par `useMediaQuery`. */
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

describe('Règles de rang', () => {
  it('garde tout sur grand écran en densité confortable', () => {
    expect(colonnesVisibles(COLONNES, { large: true, compact: false })).toHaveLength(4);
  });

  it('abandonne le troisième rang en densité compacte', () => {
    const visibles = colonnesVisibles(COLONNES, { large: true, compact: true });
    expect(visibles.map((c) => c.key)).toEqual(['name', 'capacity', 'floor']);
  });

  it('ne garde que le premier rang en dessous de 1280 px', () => {
    expect(colonnesVisibles(COLONNES, { large: false }).map((c) => c.key)).toEqual([
      'name',
      'capacity',
    ]);
  });

  it('replie le second rang, jamais le troisième', () => {
    // Le troisième rang n'est pas caché faute de place : il est jugé inutile
    // hors du grand écran. Le faire réapparaître au dépliage nierait la
    // distinction entre les deux rangs.
    expect(colonnesRepliees(COLONNES, { large: false }).map((c) => c.key)).toEqual(['floor']);
    expect(colonnesRepliees(COLONNES, { large: true })).toEqual([]);
  });

  it('traite une colonne sans rang comme prioritaire', () => {
    const sansRang = [{ key: 'x', label: 'X' }];
    expect(colonnesVisibles(sansRang, { large: false })).toHaveLength(1);
  });
});

describe('Formes rendues', () => {
  it('rend un tableau à 1280 px', () => {
    largeur(1280);
    render(<DataTable columns={COLONNES} table={table} rowLabel="salles" />);

    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: /Étage/ })).toBeTruthy();
  });

  it('rend des cartes à 360 px, sans tableau', () => {
    largeur(360);
    render(<DataTable columns={COLONNES} table={table} rowLabel="salles" />);

    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Salle Curie')).toBeTruthy();
  });

  it('replie le second rang derrière un bouton à 1024 px', () => {
    largeur(1024);
    render(<DataTable columns={COLONNES} table={table} rowLabel="salles" />);

    expect(screen.queryByRole('columnheader', { name: /Étage/ })).toBeNull();
    const boutons = screen.getAllByRole('button', { name: /Voir le détail/ });
    expect(boutons).toHaveLength(2);

    fireEvent.click(boutons[0]);
    expect(screen.getByText('2e étage')).toBeTruthy();
    expect(boutons[0].getAttribute('aria-expanded')).toBe('true');
  });

  it('donne 44 px au bouton de dépliage', () => {
    largeur(360);
    render(<DataTable columns={COLONNES} table={table} rowLabel="salles" />);

    screen
      .getAllByRole('button', { name: /Voir le détail/ })
      .forEach((bouton) => expect(bouton.className).toContain('min-h-[44px]'));
  });

  it('nomme la case de sélection par la ligne, pas par son identifiant', () => {
    largeur(360);
    render(<DataTable columns={COLONNES} table={table} selectable rowLabel="salles" />);

    expect(screen.getByLabelText('Sélectionner Salle Curie')).toBeTruthy();
  });

  it('ouvre une ligne au clavier en mode carte', () => {
    largeur(360);
    const ouvrir = vi.fn();
    render(<DataTable columns={COLONNES} table={table} onRowClick={ouvrir} rowLabel="salles" />);

    const premiere = within(screen.getAllByRole('listitem')[0]);
    fireEvent.click(premiere.getByRole('button', { name: /Ouvrir Salle Curie/ }));
    expect(ouvrir).toHaveBeenCalledWith(LIGNES[0]);
  });
});

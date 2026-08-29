/**
 * @vitest-environment jsdom
 *
 * A-11 matrice et A-06 éditeur : les deux écrans qui ne se plient pas.
 *
 * L'un garde sa forme parce que c'est elle qu'on vient chercher ; l'autre
 * refuse une manipulation qu'il ne peut pas rendre fiable. Ces tests
 * verrouillent les deux décisions, pour qu'un correctif ultérieur ne les
 * défasse pas par distraction.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EDITION_MIN_PX, PlanEditor } from './rooms/PlanEditor';
import { PermissionMatrix } from './people/PermissionMatrix';

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

const GROUPES = [
  {
    id: 'espaces',
    label: 'Espaces',
    permissions: [{ id: 'rooms.manage', label: 'Gérer les salles' }],
  },
];

const COMPTES = [
  { id: 'a-1', firstName: 'Dylan', lastName: 'Menga', permissions: ['rooms.manage'], owner: false },
  { id: 'a-2', firstName: 'Marie', lastName: 'Laurent', permissions: [], owner: true },
];

describe('A-11 — matrice des permissions', () => {
  it('reste un tableau à 360 px', () => {
    // La replier en cartes rendrait l'attribution plus simple et la
    // comparaison impossible ; or c'est la comparaison qu'on vient chercher.
    largeur(360);
    render(<PermissionMatrix groups={GROUPES} admins={COMPTES} onToggle={vi.fn()} />);

    expect(screen.getByRole('table')).toBeTruthy();
  });

  it('garde le nom de la permission visible pendant le défilement', () => {
    // Le vrai défaut n'était pas la table, c'était la perte de l'en-tête de
    // ligne : on cochait une case sans plus savoir laquelle.
    largeur(360);
    render(<PermissionMatrix groups={GROUPES} admins={COMPTES} onToggle={vi.fn()} />);

    const entete = screen.getByRole('rowheader', { name: /Gérer les salles/ });
    expect(entete.className).toContain('sticky');
    expect(entete.className).toContain('left-0');
  });

  it('verrouille le compte propriétaire', () => {
    largeur(1440);
    render(<PermissionMatrix groups={GROUPES} admins={COMPTES} onToggle={vi.fn()} />);

    expect(
      screen.getByLabelText(/Gérer les salles — Marie Laurent : accordée et verrouillée/),
    ).toBeTruthy();
  });
});

const PLAN = {
  label: 'Eiffel 1 — 2e étage',
  document: null,
  placed: [
    {
      room: {
        id: 'r-1',
        name: 'Salle Curie',
        plan: { x: 10, y: 10, w: 20, h: 15 },
      },
    },
  ],
};

describe('A-06 — éditeur de plan', () => {
  it('annonce sa limite au lieu de laisser essayer', () => {
    largeur(390);
    render(<PlanEditor layout={PLAN} onSelect={vi.fn()} onMove={vi.fn()} onCommit={vi.fn()} />);

    expect(screen.getByText(new RegExp(`au moins ${EDITION_MIN_PX} px`))).toBeTruthy();
  });

  it('laisse consulter et sélectionner malgré tout', () => {
    // Une limite n'est pas un mur : on peut toujours toucher une salle pour
    // lire ses propriétés.
    largeur(390);
    const choisir = vi.fn();
    render(<PlanEditor layout={PLAN} onSelect={choisir} onMove={vi.fn()} onCommit={vi.fn()} />);

    expect(screen.getByRole('group', { name: /Éditeur du plan/ })).toBeTruthy();
  });

  it('ne dit rien au-delà du seuil', () => {
    largeur(EDITION_MIN_PX);
    render(<PlanEditor layout={PLAN} onSelect={vi.fn()} onMove={vi.fn()} onCommit={vi.fn()} />);

    expect(screen.queryByText(/au moins/)).toBeNull();
  });
});

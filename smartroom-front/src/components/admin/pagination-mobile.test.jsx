/**
 * @vitest-environment jsdom
 *
 * La pagination au téléphone, et la recherche qui ne tient pas dans la barre.
 *
 * Six écrans d'administration avaient le même défaut, chacun pour la même
 * raison : chacun refaisait à la main le montage « tableau au-dessus de
 * 1024 px, cartes en dessous », et enfermait le tableau *et sa pagination*
 * dans le conteneur masqué au téléphone. On y voyait quinze lignes sur 589,
 * sans aucun moyen d'atteindre les autres.
 *
 * Le dernier test est une garde : il relit les sources et refuse qu'un
 * septième écran recommence.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DataTable } from './DataTable';
import { BarreRecherche } from '../layout/BarreRecherche';

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

const LIGNES = Array.from({ length: 15 }, (_, index) => ({
  id: `r-${index}`,
  nom: `Ligne ${index}`,
}));

const TABLE = {
  rows: LIGNES,
  total: 589,
  page: 1,
  pageCount: 40,
  pageSize: 15,
  setPage: vi.fn(),
  sort: null,
  basculerTri: vi.fn(),
  selection: [],
  basculerLigne: vi.fn(),
  basculerPage: vi.fn(),
  toutesSelectionnees: false,
  viderSelection: vi.fn(),
};

describe('Pagination des écrans d’administration', () => {
  const monter = () =>
    render(
      <DataTable
        columns={[{ key: 'nom', label: 'Nom' }]}
        table={TABLE}
        rowLabel="réservations"
        carte={(row) => <p>{row.nom}</p>}
      />,
    );

  it('reste atteignable au téléphone', () => {
    largeur(390);
    monter();

    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Page suivante' })).toBeTruthy();
    expect(screen.getByText(/sur 589 réservations/)).toBeTruthy();
  });

  it('rend les cartes de la page, et rien d’autre', () => {
    // Un écran lisait la liste complète au téléphone pendant que le tableau
    // lisait la page : quatorze salles y défilaient sans pagination.
    //
    // Les deux rendus coexistent dans le document — c'est la feuille de style
    // qui en masque un —, l'assertion porte donc sur la liste de cartes.
    largeur(390);
    const { container } = monter();

    expect(container.querySelectorAll('ul > li')).toHaveLength(15);
  });

  it('affiche le tableau et non les cartes au bureau', () => {
    largeur(1440);
    const { container } = monter();

    expect(container.querySelector('table')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeTruthy();
  });
});

describe('Recherche de la barre haute', () => {
  const monter = (envoyer = vi.fn()) => {
    const rendu = render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <BarreRecherche
          id="recherche-test"
          label="Rechercher une salle"
          placeholder="Rechercher…"
          value="salle fermat"
          onChange={vi.fn()}
          onSubmit={envoyer}
        />
      </MemoryRouter>,
    );
    return { ...rendu, envoyer };
  };

  it('s’ouvre au centre au téléphone', () => {
    // Inséré entre le menu et quatre icônes, le champ tombait à une centaine
    // de pixels : deux caractères visibles, et une liste de suggestions qui
    // débordait de l'écran.
    largeur(390);
    monter();

    expect(screen.queryByRole('searchbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Rechercher/ }));

    const boite = screen.getByRole('dialog');
    expect(within(boite).getByRole('searchbox')).toBeTruthy();
    expect(within(boite).getByRole('button', { name: 'Rechercher' })).toBeTruthy();
  });

  it('lance la recherche depuis la boîte', () => {
    largeur(390);
    const { envoyer } = monter();

    fireEvent.click(screen.getByRole('button', { name: /Rechercher/ }));
    fireEvent.submit(screen.getByRole('search'));

    expect(envoyer).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('n’expose jamais deux champs pour un même identifiant', () => {
    // Deux `<input>` de même `id`, l'un masqué par une classe, casseraient
    // l'association avec le libellé.
    largeur(390);
    const { container } = monter();
    fireEvent.click(screen.getByRole('button', { name: /Rechercher/ }));

    expect(container.ownerDocument.querySelectorAll('#recherche-test')).toHaveLength(0);
    expect(container.ownerDocument.querySelectorAll('#recherche-test-compact')).toHaveLength(1);
  });

  it('ne montre que l’icône sur un écran étroit', () => {
    // Mesuré : avec « Rechercher » écrit, « Menu » et quatre icônes, la barre
    // réclamait 395 px pour un écran de 375 — et c'est la page entière qui
    // s'élargissait. Le libellé reste lu, il cesse seulement d'être affiché.
    largeur(390);
    monter();

    const bouton = screen.getByRole('button', { name: /Rechercher/ });
    const visible = [...bouton.querySelectorAll('span')].find(
      (item) => item.textContent === 'Rechercher',
    );
    expect(visible.className).toContain('hidden');
    expect(bouton.querySelector('.sr-only').textContent).toBe('Rechercher une salle');
  });

  it('reste un champ posé dans la barre au bureau', () => {
    largeur(1440);
    monter();

    expect(screen.getByRole('searchbox')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Garde de montage', () => {
  const fichiers = (dossier) =>
    readdirSync(dossier).flatMap((entree) => {
      const chemin = join(dossier, entree);
      if (statSync(chemin).isDirectory()) return fichiers(chemin);
      return chemin.endsWith('.jsx') && !chemin.endsWith('.test.jsx') ? [chemin] : [];
    });

  it('aucun écran ne remonte son propre couple tableau / cartes', () => {
    // `hidden lg:block` autour d'un `DataTable` est la signature du défaut :
    // il emporte la pagination avec le tableau.
    const coupables = [...fichiers('src/components/admin'), ...fichiers('src/pages/admin')].filter(
      (chemin) => {
        const source = readFileSync(chemin, 'utf8');
        return source.includes('hidden lg:block') && source.includes('<DataTable');
      },
    );

    expect(coupables).toEqual([]);
  });
});

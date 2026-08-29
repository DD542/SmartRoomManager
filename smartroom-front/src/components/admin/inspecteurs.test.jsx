/**
 * @vitest-environment jsdom
 *
 * Écrans à panneaux : une pile en dessous du seuil, deux colonnes au-dessus.
 *
 * Sous le point de rupture, la grille se défaisait et les panneaux
 * s'empilaient : ouvrir une ligne ne changeait rien à l'écran, il fallait
 * descendre sous la liste entière pour lire la réponse, puis remonter choisir
 * la suivante.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DetailPanel } from './DetailPanel';
import { PileInspecteur } from './PileInspecteur';
import { Tabs } from '../ui/Tabs';

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

const LISTE = <p key="liste">la file</p>;
const DETAIL = <p key="detail">le détail</p>;

describe('Pile liste / détail', () => {
  it('montre les deux au bureau', () => {
    largeur(1440);
    render(<PileInspecteur liste={LISTE} detail={DETAIL} actif />);

    expect(screen.getByText('la file')).toBeTruthy();
    expect(screen.getByText('le détail')).toBeTruthy();
  });

  it('ne montre que la liste tant que rien n’est ouvert', () => {
    largeur(390);
    render(<PileInspecteur liste={LISTE} detail={DETAIL} actif={false} />);

    expect(screen.getByText('la file')).toBeTruthy();
    expect(screen.queryByText('le détail')).toBeNull();
  });

  it('remplace la liste par le détail, avec un retour', () => {
    largeur(390);
    const retour = vi.fn();
    render(<PileInspecteur liste={LISTE} detail={DETAIL} actif onRetour={retour} />);

    expect(screen.queryByText('la file')).toBeNull();
    const bouton = screen.getByRole('button', { name: /Retour à la liste/ });
    // 44 px : ce retour est la seule sortie du détail sur un écran étroit.
    expect(bouton.className).toContain('min-h-[44px]');

    fireEvent.click(bouton);
    expect(retour).toHaveBeenCalled();
  });

  it('suit le seuil demandé par l’écran', () => {
    // A-12 demande trois colonnes : elles ne tiennent qu'à partir de 1280 px.
    largeur(1024);
    render(<PileInspecteur seuil="xl" liste={LISTE} detail={DETAIL} actif />);

    expect(screen.queryByText('la file')).toBeNull();
  });
});

describe('Panneau de détail', () => {
  it('reste une colonne au bureau', () => {
    largeur(1280);
    render(
      <DetailPanel title="Salle Curie" onClose={vi.fn()}>
        <p>contenu du détail</p>
      </DetailPanel>,
    );

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('contenu du détail')).toBeTruthy();
  });

  it('s’ouvre en feuille sous 1024 px', () => {
    largeur(768);
    render(
      <DetailPanel title="Salle Curie" onClose={vi.fn()}>
        <p>contenu du détail</p>
      </DetailPanel>,
    );

    const feuille = screen.getByRole('dialog');
    expect(feuille.getAttribute('aria-label')).toBe('Salle Curie');
    expect(screen.getByText('contenu du détail')).toBeTruthy();
  });

  it('n’ouvre pas une feuille pour ne rien dire', () => {
    // Le vide reste le vide : une feuille annonçant « aucune sélection »
    // demanderait de la fermer pour revenir à la liste qu'on n'a pas quittée.
    largeur(768);
    render(<DetailPanel emptyTitle="Aucune sélection" onClose={vi.fn()} />);

    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Onglets de formulaire', () => {
  const ONGLETS = [
    { id: 'general', label: 'Général' },
    { id: 'acces', label: 'Accès' },
    { id: 'visuels', label: 'Visuels' },
  ];

  it('restent des onglets au bureau', () => {
    largeur(1024);
    render(<Tabs tabs={ONGLETS} value="general" onChange={vi.fn()} label="Sections" />);

    expect(screen.getByRole('tablist')).toBeTruthy();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });

  it('deviennent un sélecteur sous 768 px', () => {
    largeur(390);
    const changer = vi.fn();
    render(<Tabs tabs={ONGLETS} value="general" onChange={changer} label="Sections" />);

    expect(screen.queryByRole('tablist')).toBeNull();
    const liste = screen.getByLabelText('Sections');
    fireEvent.change(liste, { target: { value: 'acces' } });
    expect(changer).toHaveBeenCalledWith('acces');
  });
});

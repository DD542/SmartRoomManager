/**
 * @vitest-environment jsdom
 *
 * Couverture de la navigation aux deux largeurs.
 *
 * Le test qui compte est le dernier : aucune destination de la barre latérale
 * ne doit disparaître sous 768 px. Trois d'entre elles — plan, statistiques,
 * aide — n'étaient atteignables par aucun geste en mobile, alors qu'elles
 * existaient dans le routeur. Une liste partagée et cette vérification
 * empêchent la situation de revenir en ajoutant une huitième entrée.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MobileNav } from './MobileNav';
import { NavDrawer } from './NavDrawer';
import { NAV_ITEMS, Sidebar } from './Sidebar';

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u-1', email: 'd@ece.fr' }, logout: vi.fn() }),
}));

const rendre = (element) => render(<MemoryRouter>{element}</MemoryRouter>);

/** Adresses atteignables dans un arbre rendu. */
const destinations = (conteneur) =>
  [...conteneur.querySelectorAll('a[href]')].map((lien) => lien.getAttribute('href'));

describe('Barre d’onglets mobile', () => {
  it('loge quatre destinations et un accès au reste', () => {
    rendre(<MobileNav onOpenMore={vi.fn()} />);

    expect(screen.getAllByRole('link')).toHaveLength(4);
    const plus = screen.getByRole('button', { name: /Plus/ });
    expect(plus.getAttribute('aria-haspopup')).toBe('dialog');
    expect(plus.getAttribute('aria-expanded')).toBe('false');
  });

  it('annonce le tiroir ouvert', () => {
    rendre(<MobileNav onOpenMore={vi.fn()} moreOpen />);
    expect(screen.getByRole('button', { name: /Plus/ }).getAttribute('aria-expanded')).toBe('true');
  });

  it('appelle l’ouverture du tiroir', () => {
    const ouvrir = vi.fn();
    rendre(<MobileNav onOpenMore={ouvrir} />);

    fireEvent.click(screen.getByRole('button', { name: /Plus/ }));
    expect(ouvrir).toHaveBeenCalled();
  });
});

describe('Tiroir de navigation secondaire', () => {
  it('reprend les destinations absentes de la barre', () => {
    rendre(<NavDrawer open onClose={vi.fn()} />);

    const feuille = screen.getByRole('dialog');
    const adresses = destinations(feuille);
    expect(adresses).toContain('/app/plan');
    expect(adresses).toContain('/app/statistiques');
    expect(adresses).toContain('/app/aide');
    expect(adresses).toContain('/app/notifications');
    expect(adresses).toContain('/app/profil');
  });

  it('ne répète pas ce que la barre porte déjà', () => {
    rendre(<NavDrawer open onClose={vi.fn()} />);

    const adresses = destinations(screen.getByRole('dialog'));
    expect(adresses).not.toContain('/app/salles');
    expect(adresses).not.toContain('/app/reservations');
  });

  it('se ferme en suivant un lien', () => {
    const fermer = vi.fn();
    rendre(<NavDrawer open onClose={fermer} />);

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('link', { name: /Plan du bâtiment/ }));
    expect(fermer).toHaveBeenCalled();
  });

  it('se ferme sur Échap', () => {
    const fermer = vi.fn();
    rendre(<NavDrawer open onClose={fermer} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(fermer).toHaveBeenCalled();
  });

  it('ne rend rien tant qu’il est fermé', () => {
    rendre(<NavDrawer open={false} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Couverture des destinations', () => {
  it('n’abandonne aucune destination de la barre latérale sous 768 px', () => {
    const { container: bureau, unmount } = rendre(<Sidebar />);
    const enBureau = destinations(bureau);
    unmount();

    // Le tiroir se rend par un portail : ses liens vivent dans `document.body`
    // et non dans le conteneur rendu. Les compter depuis le corps du document
    // est donc la seule mesure juste.
    rendre(<MobileNav onOpenMore={vi.fn()} />);
    rendre(<NavDrawer open onClose={vi.fn()} />);
    const enMobile = new Set(destinations(document.body));

    const manquantes = enBureau.filter((adresse) => !enMobile.has(adresse));

    expect(manquantes).toEqual([]);
    // Et la liste partagée est bien la source des deux : une entrée ajoutée
    // dans `NAV_ITEMS` se retrouve forcément d'un côté ou de l'autre.
    NAV_ITEMS.forEach((item) => expect(enMobile.has(item.to)).toBe(true));
  });
});

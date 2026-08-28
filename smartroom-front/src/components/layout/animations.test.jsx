/**
 * @vitest-environment jsdom
 *
 * Apparitions des deux espaces.
 *
 * Une animation ne se voit pas dans un test : ce qui se vérifie, c'est ce qui
 * la déclenche — la classe posée, le décalage calculé, et surtout le remontage
 * à chaque changement d'écran. Sans lui, l'apparition ne jouerait que sur le
 * premier écran de la session, ce qui est précisément le défaut qu'on évite.
 */

import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { PageTransition } from './PageTransition';
import { NAV_ITEMS, Sidebar } from './Sidebar';
import { MobileNav } from './MobileNav';

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u-1', email: 'd@ece.fr' }, logout: vi.fn() }),
}));

describe('Transition d’écran', () => {
  function Ecran({ onMount, suivant }) {
    useEffect(() => {
      onMount();
    }, [onMount]);
    return <Link to={suivant}>continuer</Link>;
  }

  it('rejoue l’apparition à chaque changement d’écran', () => {
    // Même route, paramètre différent : React Router réutilise l'élément sans
    // le remonter. Un second montage ne peut donc venir que de la clé posée
    // sur le chemin — celle qui fait rejouer l'animation.
    const monte = vi.fn();

    render(
      <MemoryRouter initialEntries={['/salle/1']}>
        <PageTransition>
          <Routes>
            <Route path="/salle/:id" element={<Ecran onMount={monte} suivant="/salle/2" />} />
          </Routes>
        </PageTransition>
      </MemoryRouter>,
    );

    expect(monte).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('link', { name: 'continuer' }));
    expect(monte).toHaveBeenCalledTimes(2);
  });

  it('pose l’animation sur le contenu, et rien sur l’enveloppe', () => {
    const { container } = render(
      <MemoryRouter>
        <PageTransition className="max-w-6xl">
          <p>contenu</p>
        </PageTransition>
      </MemoryRouter>,
    );

    const enveloppe = container.firstChild;
    expect(enveloppe.className).toBe('max-w-6xl');
    expect(enveloppe.firstChild.className).toContain('animate-fade-in-up');
  });
});

describe('Cascade des barres de navigation', () => {
  const delais = (elements) =>
    elements.map((item) => item.style.animationDelay).filter(Boolean);

  it('décale les entrées de la barre latérale', () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );

    const liens = NAV_ITEMS.map((item) => screen.getByRole('link', { name: item.label }));
    liens.forEach((lien) => expect(lien.className).toContain('animate-fade-in-up'));
    expect(delais(liens)).toEqual(NAV_ITEMS.map((_, index) => `${index * 35}ms`));
  });

  it('décale les onglets de la barre mobile', () => {
    render(
      <MemoryRouter>
        <MobileNav />
      </MemoryRouter>,
    );

    const onglets = screen.getAllByRole('link');
    onglets.forEach((onglet) => expect(onglet.className).toContain('animate-fade-in-up'));
    expect(delais(onglets)).toEqual(onglets.map((_, index) => `${index * 30}ms`));
  });
});

/**
 * @vitest-environment jsdom
 *
 * Bascule entre le thème clair et le thème sombre.
 *
 * Trois points valent d'être verrouillés, parce qu'ils se cassent sans bruit.
 *
 * Le thème est porté par un attribut sur `<html>` et non par une classe dans
 * l'arbre React : `body`, la barre de défilement et les sélecteurs de date
 * natifs sont hors de cet arbre et ne verraient pas une classe posée dedans.
 *
 * Le choix est mémorisé. Sans cela, chaque chargement ramènerait le thème
 * du système, et le réglage ne servirait à rien.
 *
 * Sans choix mémorisé, la préférence du système décide. Quelqu'un qui a réglé
 * son poste en clair n'a pas à refaire ce choix ici.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BasculeTheme } from './BasculeTheme';
import { CLE, appliquerTheme, themeInitial } from '../../hooks/useTheme';

/**
 * `vi.stubGlobal` et non une affectation directe.
 *
 * `window.matchMedia = ...` survit au fichier : les tests partagent un même
 * environnement jsdom par processus, et le remplacement fauchait un test
 * voisin — `defauts-signales` passait seul et échouait en suite. Un test qui
 * casse son voisin est pire que pas de test.
 */
const systemePrefere = (clair) => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((requete) => ({
      matches: clair && requete.includes('light'),
      media: requete,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
};

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  systemePrefere(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('Choix initial', () => {
  it('suit la préférence du système en l’absence de choix mémorisé', () => {
    systemePrefere(true);
    expect(themeInitial()).toBe('clair');

    systemePrefere(false);
    expect(themeInitial()).toBe('sombre');
  });

  it('préfère le choix mémorisé à la préférence du système', () => {
    systemePrefere(true);
    localStorage.setItem(CLE, 'sombre');

    expect(themeInitial()).toBe('sombre');
  });
});

describe('Application au document', () => {
  it('porte le thème sur la racine, hors de l’arbre React', () => {
    appliquerTheme('clair');
    expect(document.documentElement.dataset.theme).toBe('clair');

    // Le sombre est l'absence d'attribut, et non une valeur : les variables du
    // thème sombre vivent sur `:root` nu.
    appliquerTheme('sombre');
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('accorde la barre d’adresse mobile au thème', () => {
    const balise = document.createElement('meta');
    balise.setAttribute('name', 'theme-color');
    document.head.append(balise);

    appliquerTheme('clair');
    expect(balise.getAttribute('content')).toBe('#F4F7FB');

    appliquerTheme('sombre');
    expect(balise.getAttribute('content')).toBe('#0F1117');

    balise.remove();
  });
});

describe('Le bouton', () => {
  it('annonce le thème vers lequel il mène, pas celui en cours', () => {
    render(<BasculeTheme />);

    // Départ en sombre : le bouton propose le clair.
    expect(screen.getByLabelText('Passer au thème clair')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Passer au thème clair'));
    expect(screen.getByLabelText('Passer au thème sombre')).toBeTruthy();
  });

  it('bascule le document et mémorise le choix', () => {
    render(<BasculeTheme />);

    fireEvent.click(screen.getByLabelText('Passer au thème clair'));
    expect(document.documentElement.dataset.theme).toBe('clair');
    expect(localStorage.getItem(CLE)).toBe('clair');

    fireEvent.click(screen.getByLabelText('Passer au thème sombre'));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem(CLE)).toBe('sombre');
  });
});

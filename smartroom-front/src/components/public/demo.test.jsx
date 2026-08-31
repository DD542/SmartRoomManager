/**
 * @vitest-environment jsdom
 *
 * Section de démonstration de la page d'accueil.
 *
 * La vidéo démarre seule et sans son. Trois choses se perdent au premier
 * remaniement et se vérifient donc ici : qu'elle reste muette, qu'elle ne se
 * télécharge pas chez qui ne descendra jamais jusqu'à elle, et qu'il reste un
 * moyen de la lancer quand le navigateur refuse de le faire.
 *
 * Vérifié aussi dans un navigateur : la lecture part à l'entrée dans la
 * fenêtre — 1280 × 720, 8 s —, le rapport 16:9 tient à 360 comme à 1280 px, et
 * la page ne déborde pas.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LandingDemo } from './LandingDemo';

const VRAI_MATCH_MEDIA = window.matchMedia;

/** Réglage système : par défaut, l'animation est acceptée. */
const animationsReduites = (reduites) => {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: query.includes('prefers-reduced-motion') ? reduites : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
};

let lecture;

beforeEach(() => {
  animationsReduites(false);
  // jsdom n'implémente ni `play` ni `pause`. Le remplacement se fait sur le
  // prototype : l'effet du composant s'exécute au montage, bien avant qu'un
  // test puisse toucher à l'élément rendu.
  lecture = vi.fn().mockResolvedValue(undefined);
  HTMLMediaElement.prototype.play = lecture;
  HTMLMediaElement.prototype.pause = vi.fn();
});

afterEach(() => {
  window.matchMedia = VRAI_MATCH_MEDIA;
  vi.restoreAllMocks();
});

const monter = () => {
  const rendu = render(<LandingDemo />);
  return { ...rendu, video: rendu.container.querySelector('video') };
};

describe('Démonstration filmée', () => {
  it('démarre seule et sans son', async () => {
    const { video } = monter();

    expect(lecture).toHaveBeenCalled();
    expect(video.hasAttribute('muted') || video.muted).toBe(true);
    // Sans `playsinline`, Safari sur iPhone ouvre le lecteur plein écran au
    // lieu de jouer dans la page.
    expect(video.hasAttribute('playsinline')).toBe(true);
    // `loop` reboucle sur le fichier courant : sept séquences dans l'ordre
    // demandent un compteur, pas un drapeau.
    expect(video.hasAttribute('loop')).toBe(false);
  });

  it('ouvre sur la première séquence', () => {
    const { video } = monter();

    expect(video.querySelector('source').getAttribute('src')).toBe('/demo1.mp4');
    expect(screen.getByText('Séquence 1 sur 7')).toBeTruthy();
  });

  it('enchaîne sur la suivante quand une séquence se termine', () => {
    const { video, container } = monter();

    fireEvent.ended(video);

    expect(container.querySelector('source').getAttribute('src')).toBe('/demo2.mp4');
    expect(screen.getByText('Séquence 2 sur 7')).toBeTruthy();
  });

  it('revient à la première après la dernière', () => {
    const { container } = monter();

    for (let passage = 0; passage < 7; passage += 1) {
      fireEvent.ended(container.querySelector('video'));
    }

    expect(container.querySelector('source').getAttribute('src')).toBe('/demo1.mp4');
    expect(screen.getByText('Séquence 1 sur 7')).toBeTruthy();
  });

  it('laisse sauter directement à une séquence', () => {
    // Une séquence qui change toute seule se lit comme un saut de lecture :
    // le repère dit où l'on en est, et permet d'y revenir.
    const { container } = monter();

    fireEvent.click(screen.getByRole('button', { name: 'Séquence 5' }));

    expect(container.querySelector('source').getAttribute('src')).toBe('/demo5.mp4');
  });

  it('retire l’affiche une fois la lecture obtenue', async () => {
    // Sans quoi elle masquerait une vidéo en marche. La promesse de `play()`
    // se résout au tour suivant : l'affiche est donc là, puis ne l'est plus.
    monter();
    expect(screen.getByRole('button', { name: /Lancer la démonstration/ })).toBeTruthy();

    await vi.waitFor(() =>
      expect(screen.queryByRole('button', { name: /Lancer la démonstration/ })).toBeNull(),
    );
  });

  it('ne télécharge la piste qu’au moment de la lire', () => {
    // `metadata` : un visiteur qui ne descend jamais jusqu’ici ne paie pas
    // les 1,7 Mo.
    const { video } = monter();

    expect(video.getAttribute('preload')).toBe('metadata');
  });

  it('laisse de quoi la lancer quand le navigateur refuse', async () => {
    // Mode économie d’énergie, réglage de l’utilisateur : `play()` est
    // rejetée. Une vidéo qui ne part pas et qu’on ne peut pas lancer serait un
    // cadre noir.
    HTMLMediaElement.prototype.play = vi.fn().mockRejectedValue(new Error('refus'));
    monter();

    const bouton = await screen.findByRole('button', { name: /Lancer la démonstration/ });
    fireEvent.click(bouton);

    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: /Lancer la démonstration/ })).toBeTruthy();
  });

  it('survit à un `play()` qui ne rend pas de promesse', () => {
    // La spécification ne l'a imposé que tardivement. Enchaîner un `.then`
    // dessus casserait le montage du composant, donc la page d'accueil.
    HTMLMediaElement.prototype.play = vi.fn().mockReturnValue(undefined);

    expect(() => monter()).not.toThrow();
  });

  it('respecte la demande de moins d’animation', () => {
    // Qui a demandé moins d’animation ne reçoit pas une vidéo qui démarre
    // seule : il reçoit l’affiche et son bouton.
    animationsReduites(true);
    monter();

    expect(lecture).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Lancer la démonstration/ })).toBeTruthy();
  });

  it('garde sa place avant d’être chargée', () => {
    // `aspect-video` : sans hauteur réservée, la page sauterait au démarrage
    // de la lecture — et ce saut se produit sous le doigt du visiteur.
    const { container } = monter();

    expect(container.querySelector('.aspect-video')).toBeTruthy();
  });

  it('porte un nom pour qui ne voit pas l’image', () => {
    const { video } = monter();

    // Le nom porte la position dans la suite : sans elle, un lecteur d'écran
    // annonce sept fois la même vidéo.
    expect(video.getAttribute('aria-label')).toBe(
      'Démonstration de SmartRoom Manager, séquence 1 sur 7, sans son',
    );
  });
});

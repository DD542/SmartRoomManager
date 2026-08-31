/**
 * @vitest-environment jsdom
 *
 * Section de démonstration de la page d'accueil.
 *
 * Une vidéo sur une page publique coûte à qui ne la regarde pas : 1,7 Mo
 * téléchargés à chaque ouverture si rien ne l'en empêche, et l'attention
 * déplacée hors du texte si elle démarre seule. Ces deux choses se vérifient
 * ici, parce qu'elles se perdent au premier remaniement.
 *
 * Vérifié aussi dans un navigateur : après le clic, la vidéo est lue
 * (readyState 4, 1280 × 720, 8 s), le rapport 16:9 tient à 360 comme à
 * 1280 px, et la page ne déborde pas.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LandingDemo } from './LandingDemo';

describe('Démonstration filmée', () => {
  it('ne télécharge rien avant qu’on le demande', () => {
    const { container } = render(<LandingDemo />);
    const video = container.querySelector('video');

    expect(video.getAttribute('preload')).toBe('none');
    // Ni `autoplay` ni `loop` : la vidéo attend un geste.
    expect(video.hasAttribute('autoplay')).toBe(false);
    expect(video.hasAttribute('loop')).toBe(false);
  });

  it('annonce ce que coûte le clic', () => {
    render(<LandingDemo />);

    expect(screen.getByText('Lancer la démonstration')).toBeTruthy();
    expect(screen.getByText(/téléchargée qu’à la lecture/)).toBeTruthy();
  });

  it('rend ses contrôles au premier clic', () => {
    const { container } = render(<LandingDemo />);
    const video = container.querySelector('video');
    // jsdom n'implémente pas la lecture : sans cela, `play()` lève.
    video.play = vi.fn();

    expect(video.hasAttribute('controls')).toBe(false);
    fireEvent.click(screen.getByRole('button'));

    expect(video.hasAttribute('controls')).toBe(true);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('garde sa place avant d’être chargée', () => {
    // `aspect-video` : sans hauteur réservée, la page sauterait au démarrage
    // de la lecture — et ce saut se produit sous le doigt du visiteur.
    const { container } = render(<LandingDemo />);

    expect(container.querySelector('.aspect-video')).toBeTruthy();
  });

  it('porte un nom pour qui ne voit pas l’image', () => {
    const { container } = render(<LandingDemo />);

    expect(container.querySelector('video').getAttribute('aria-label')).toBe(
      'Démonstration de SmartRoom Manager',
    );
  });
});

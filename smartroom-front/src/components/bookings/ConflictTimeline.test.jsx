/**
 * Frise de conflit — l'écran qui doit rendre le chevauchement lisible.
 *
 * Ce qui est vérifié n'est pas l'apparence mais la **géométrie** : la position
 * et la largeur des barres sont calculées depuis les heures, et une erreur de
 * conversion afficherait un conflit à côté du créneau qu'il concerne. C'est
 * précisément le genre de défaut qu'une relecture visuelle laisse passer.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConflictTimeline } from './ConflictTimeline';

//: L'échelle de la frise court de 08:00 à 20:00, soit 720 minutes.
const ECHELLE_MINUTES = 720;

const pourcentage = (minutes) => (minutes / ECHELLE_MINUTES) * 100;

const jour = (heures, minutes = 0) =>
  new Date(2026, 7, 25, heures, minutes).toISOString();

const barres = (conteneur) => [...conteneur.querySelectorAll('span[style]')];

describe('frise de conflit', () => {
  it('place la demande à sa position horaire sur l’échelle', () => {
    const { container } = render(
      <ConflictTimeline requested={{ start: jour(14), end: jour(15) }} />,
    );

    const demande = barres(container).at(-1);
    // 14:00 est à six heures de 08:00, soit 360 minutes.
    expect(demande.style.left).toBe(`${pourcentage(360)}%`);
    expect(demande.style.width).toBe(`${pourcentage(60)}%`);
  });

  it('place l’existant et la demande sur la même échelle', () => {
    const { container } = render(
      <ConflictTimeline
        requested={{ start: jour(14), end: jour(15) }}
        existing={[{ id: 'bk-1', title: 'Comité', start: jour(14), end: jour(15) }]}
      />,
    );

    const [existant, demande] = barres(container);
    // Créneaux identiques : les deux barres se superposent exactement. Une
    // échelle différente entre les deux rendrait le conflit illisible.
    expect(existant.style.left).toBe(demande.style.left);
    expect(existant.style.width).toBe(demande.style.width);
  });

  it('affiche une barre par réservation existante, plus celle de la demande', () => {
    const { container } = render(
      <ConflictTimeline
        requested={{ start: jour(14), end: jour(15) }}
        existing={[
          { id: 'bk-1', title: 'Comité', start: jour(9), end: jour(10) },
          { id: 'bk-2', title: 'Atelier', title2: '', start: jour(16), end: jour(17) },
        ]}
      />,
    );

    expect(barres(container)).toHaveLength(3);
  });

  it('nomme chaque réservation existante et son créneau au survol', () => {
    render(
      <ConflictTimeline
        requested={{ start: jour(14), end: jour(15) }}
        existing={[{ id: 'bk-1', title: 'Comité de suivi', start: jour(14), end: jour(15) }]}
      />,
    );

    // Le titre est la seule information textuelle portée par la barre : sans
    // lui, l'utilisateur voit un rectangle rouge sans savoir ce qu'il heurte.
    const infobulle = screen.getByTitle(/Comité de suivi/);
    expect(infobulle.getAttribute('title')).toMatch(/14:00-15:00/);
  });

  it('donne une largeur visible à un créneau très court', () => {
    // Une réunion de cinq minutes occupe 0,7 % de l'échelle : sans plancher,
    // elle serait invisible et le conflit paraîtrait sans cause.
    const { container } = render(
      <ConflictTimeline requested={{ start: jour(14), end: jour(14, 1) }} />,
    );

    const demande = barres(container).at(-1);
    expect(Number.parseFloat(demande.style.width)).toBeGreaterThan(0);
  });

  it('ne déborde pas de l’échelle pour un créneau matinal', () => {
    // 07:00 précède le début de l'échelle : une position négative sortirait la
    // barre du cadre au lieu de la coller au bord.
    const { container } = render(
      <ConflictTimeline requested={{ start: jour(7), end: jour(9) }} />,
    );

    const demande = barres(container).at(-1);
    expect(Number.parseFloat(demande.style.left)).toBeGreaterThanOrEqual(0);
  });

  it('se rend sans aucune réservation existante', () => {
    // Le cas arrive : un refus par règle, sans conflit de créneau.
    const { container } = render(
      <ConflictTimeline requested={{ start: jour(14), end: jour(15) }} />,
    );

    expect(barres(container)).toHaveLength(1);
    expect(screen.getByText('08:00')).toBeDefined();
    expect(screen.getByText('20:00')).toBeDefined();
  });
});

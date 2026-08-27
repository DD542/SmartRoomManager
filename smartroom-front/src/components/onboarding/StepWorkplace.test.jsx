/**
 * Première étape de la prise en main : le choix du bâtiment principal.
 *
 * L'écran montrait une icône générique à la place de la photo du bâtiment,
 * alors que l'administration en dépose une et que l'API la sert. La donnée
 * arrivait ; personne ne la lisait.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StepWorkplace } from './StepWorkplace';

const REGLAGES = { preferredBuildingId: '', usualCapacity: '5-10' };

describe('Choix du bâtiment principal', () => {
  it('montre la photo déposée pour le bâtiment', () => {
    render(
      <StepWorkplace
        buildings={[
          {
            id: 'b-1',
            name: 'Eiffel 1',
            campus: '12 rue Pasteur',
            imageUrl: '/media/buildings/eiffel-1.jpg',
          },
        ]}
        isLoading={false}
        value={REGLAGES}
        onChange={vi.fn()}
      />,
    );

    const photo = screen.getByRole('presentation', { hidden: true });
    expect(photo.getAttribute('src')).toBe('/media/buildings/eiffel-1.jpg');
  });

  it('retombe sur un symbole quand le bâtiment n’a pas de photo', () => {
    // Un cadre vide dirait moins qu'un symbole, et une image cassée dirait pire.
    const { container } = render(
      <StepWorkplace
        buildings={[{ id: 'b-2', name: 'Eiffel 2', campus: '14 rue Pasteur', imageUrl: null }]}
        isLoading={false}
        value={REGLAGES}
        onChange={vi.fn()}
      />,
    );

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('Eiffel 2')).toBeTruthy();
  });
});

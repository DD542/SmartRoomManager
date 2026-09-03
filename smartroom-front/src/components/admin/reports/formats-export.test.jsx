/**
 * @vitest-environment jsdom
 *
 * Le panneau d'export ne propose que ce qui existe.
 *
 * « Excel » et « PDF » figuraient à côté de « CSV », et la couche de données
 * les refusait à chaque fois :
 *
 *     throw new ApiError('Seul l’export CSV est disponible…', 422,
 *                        'format_indisponible');
 *
 * L'administrateur choisissait ses colonnes, cliquait sur « Générer le
 * fichier », et recevait une erreur. Le message était juste ; l'offre ne
 * l'était pas.
 *
 * C'est la règle que ce projet applique déjà au bouton Google : un bouton
 * présent qui échoue à chaque clic est pire que pas de bouton.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExportPanel } from './ExportPanel';

const COLONNES = [
  { id: 'room', label: 'Salle / Espace' },
  { id: 'volume', label: 'Volume de réservations' },
];

const monter = () =>
  render(
    <ExportPanel
      open
      onClose={vi.fn()}
      onExport={vi.fn()}
      columns={COLONNES}
      filters={{ from: '2026-08-04', to: '2026-09-03' }}
      rows={12}
    />,
  );

describe('formats d’export proposés', () => {
  it('offre le CSV', () => {
    monter();

    expect(screen.getByRole('radio', { name: /CSV/i })).toBeTruthy();
  });

  it('n’offre plus les formats qui échouaient', () => {
    monter();

    expect(screen.queryByRole('radio', { name: /Excel/i })).toBeNull();
    expect(screen.queryByRole('radio', { name: /PDF/i })).toBeNull();
  });

  it('garde le choix des colonnes', () => {
    // Contre-épreuve : retirer des formats ne doit pas amputer le reste du
    // panneau, qui transmet réellement les colonnes retenues.
    monter();

    expect(screen.getByRole('checkbox', { name: /Salle \/ Espace/i })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /Volume de réservations/i })).toBeTruthy();
  });
});

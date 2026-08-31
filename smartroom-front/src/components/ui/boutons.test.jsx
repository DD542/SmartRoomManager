/**
 * @vitest-environment jsdom
 *
 * Un bouton dont le libellé passe à la ligne.
 *
 * Mesuré dans un navigateur, bouton contraint à 110 px de large — la largeur
 * relevée sur la capture du centre d'aide :
 *
 *   hauteur fixe  → bouton 32 px, texte 47 px, 15 px de texte hors du bouton
 *   hauteur mini. → bouton 58 px, texte 47 px, tout à l'intérieur
 *
 * jsdom ne calcule aucune mise en page : ces tests vérifient donc le contrat
 * de classes qui produit ce comportement, pas les pixels. La mesure, elle, est
 * ci-dessus.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button, IconButton } from './Button';
import { Card, CardHeader } from './Card';
import { Plus, X } from 'lucide-react';

describe('Hauteur d’un bouton', () => {
  it('grandit avec son libellé plutôt que de le laisser sortir', () => {
    render(
      <Button size="sm" icon={Plus}>
        Nouvelle demande d’aide
      </Button>,
    );

    const bouton = screen.getByRole('button');
    expect(bouton.className).toContain('min-h-8');
    // Une hauteur fixe rendrait la hauteur minimale inopérante. Comparaison
    // classe par classe : `\b` reconnaîtrait `h-8` à l'intérieur de `min-h-8`,
    // le trait d'union étant une frontière de mot.
    expect(bouton.className.split(' ')).not.toContain('h-8');
  });

  it('vaut pour les trois tailles', () => {
    const { rerender } = render(<Button size="md">Enregistrer</Button>);
    expect(screen.getByRole('button').className).toContain('min-h-10');

    rerender(<Button size="lg">Enregistrer</Button>);
    expect(screen.getByRole('button').className).toContain('min-h-12');
  });

  it('laisse au bouton d’icône sa taille exacte', () => {
    // Celui-ci ne porte pas de texte : il n'a aucune raison de grandir, et les
    // barres d'outils denses de l'administration comptent sur ses 36 px.
    render(<IconButton icon={X} label="Fermer" />);

    expect(screen.getByRole('button').className.split(' ')).toContain('h-9');
  });

  it('centre un libellé qui tient sur deux lignes', () => {
    render(<Button>Nouvelle demande d’aide</Button>);

    expect(screen.getByRole('button').className).toContain('text-center');
  });
});

describe('En-tête de carte', () => {
  it('fait passer l’action à la ligne plutôt que de l’écraser', () => {
    // Sans cela, le titre et l'action se disputaient 288 px : l'action se
    // rétrécissait jusqu'à ce que son libellé s'écrive sur trois lignes.
    const { container } = render(
      <Card>
        <CardHeader
          title="Mes demandes"
          subtitle="Suivez l’état de vos tickets de support récents."
          action={<Button size="sm">Nouvelle demande d’aide</Button>}
        />
      </Card>,
    );

    const entete = container.querySelector('header');
    expect(entete.className).toContain('flex-wrap');
    // Le bloc de titre absorbe la réduction ; l'action garde sa largeur.
    expect(entete.firstChild.className).toContain('min-w-0');
    expect(entete.lastChild.className).toContain('shrink-0');
  });
});

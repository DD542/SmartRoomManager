/**
 * @vitest-environment node
 *
 * Aucune grille de l'administration ne doit oublier `[&>*]:min-w-0`.
 *
 * Mesuré dans un navigateur : un enfant de grille sans cette permission refuse
 * de descendre sous la largeur de son contenu — c'est la règle `min-width:
 * auto` des éléments de grille. Un tableau à largeur minimale, un graphique,
 * une carte thermique élargissent alors la piste, puis la page, et l'écran
 * entier défile latéralement. 178 px de débordement mesurés sur le cas réel.
 *
 * Le défaut ne se voit pas dans un diff et ne casse aucun test de rendu : il
 * ne se lit qu'à l'écran, sur un téléphone. D'où cette vérification de source,
 * qui coûte une milliseconde et couvre les quarante grilles d'un coup.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const RACINES = ['src/pages/admin', 'src/components/admin'];

function fichiers(racine) {
  return readdirSync(racine, { withFileTypes: true }).flatMap((entree) => {
    const chemin = join(racine, entree.name);
    if (entree.isDirectory()) return fichiers(chemin);
    if (!entree.name.endsWith('.jsx') || entree.name.endsWith('.test.jsx')) return [];
    return [chemin];
  });
}

/** Grilles de disposition : celles qui portent un espacement entre leurs enfants. */
const GRILLE = /className="grid gap-\d[^"]*"/g;

describe('Grilles de l’administration', () => {
  const manquantes = RACINES.flatMap(fichiers).flatMap((chemin) => {
    const source = readFileSync(chemin, 'utf-8');
    return (source.match(GRILLE) ?? [])
      .filter((classe) => !classe.includes('min-w-0'))
      .map((classe) => `${chemin} → ${classe}`);
  });

  it('donnent toutes à leurs enfants le droit de se rétrécir', () => {
    expect(manquantes).toEqual([]);
  });

  it('en compte assez pour que le contrôle ait un sens', () => {
    // Garde-fou du garde-fou : si l'expression cessait de reconnaître les
    // grilles, la liste des manquantes serait vide et le test passerait pour
    // de mauvaises raisons.
    const total = RACINES.flatMap(fichiers).reduce(
      (somme, chemin) => somme + (readFileSync(chemin, 'utf-8').match(GRILLE) ?? []).length,
      0,
    );
    expect(total).toBeGreaterThan(30);
  });
});

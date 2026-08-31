/**
 * @vitest-environment node
 *
 * Aucune grille de l'application ne doit oublier `[&>*]:min-w-0`.
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

//: Toute l'application, et non l'administration seule. Le premier
//: débordement mesuré venait de là, mais le second est venu de l'espace
//: utilisateur : la grille de l'écran de réservation refusait de descendre
//: sous la largeur du calendrier, et la page entière se décalait vers la
//: droite. La règle CSS ne connaît pas la frontière entre les deux espaces.
const RACINES = ['src/pages', 'src/components'];

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

describe('Grilles de l’application', () => {
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

/**
 * Toute valeur de plan employée dans le code doit exister dans l'échelle.
 *
 * Une classe `z-…` inconnue de Tailwind ne produit **rien** : pas d'erreur,
 * pas d'avertissement, aucun `z-index`. L'élément retombe alors dans l'ordre
 * du document, et un menu se retrouve derrière la page. C'est exactement ce
 * qui s'est produit : la configuration avait gagné les plans, le serveur de
 * développement tournait encore avec l'ancienne — et rien ne le signalait.
 *
 * Ce contrôle ne remplace pas le redémarrage du serveur après une
 * modification de `tailwind.config.js`. Il attrape l'autre moitié du
 * problème : une faute de frappe ou un plan employé avant d'être déclaré.
 */
describe('Échelle des plans d’affichage', () => {
  const config = readFileSync('tailwind.config.js', 'utf-8');
  const bloc = /zIndex:\s*\{([^}]*)\}/s.exec(config);
  const declares = new Set(
    [...(bloc?.[1] ?? '').matchAll(/(\w+):\s*'(\d+)'/g)].map((m) => m[1]),
  );

  // Uniquement dans les chaînes de classes : ailleurs, `z-index` d'un
  // commentaire ou d'une propriété de style ferait un faux positif.
  const employes = new Set(
    RACINES.flatMap(fichiers).flatMap((chemin) => {
      const source = readFileSync(chemin, 'utf-8');
      const classes = [...source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)].map(
        (m) => m[1] ?? m[2] ?? '',
      );
      return classes.flatMap((valeur) =>
        [...valeur.matchAll(/(?:^|[\s:])z-([a-z][a-z-]*)/g)].map((m) => m[1]),
      );
    }),
  );

  it('déclare tous les plans employés dans l’administration', () => {
    const inconnus = [...employes].filter((nom) => !declares.has(nom));
    expect(inconnus).toEqual([]);
  });

  it('porte bien les plans attendus', () => {
    ['base', 'sticky', 'topbar', 'menu', 'drawer', 'modal', 'toast'].forEach((plan) =>
      expect(declares.has(plan)).toBe(true),
    );
  });
});

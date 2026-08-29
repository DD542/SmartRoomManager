/**
 * Règles de survie des colonnes à la réduction de largeur.
 *
 * Trois rangs, déclarés dans la définition de colonnes de chaque écran :
 *
 *   primary   toujours visible, y compris en carte — ce sans quoi la ligne
 *             ne s'identifie plus ;
 *   secondary utile, mais repliable : montré à partir de 1280 px, sinon
 *             accessible en dépliant la ligne ou la carte ;
 *   tertiary  confort de grand écran : montré à partir de 1280 px en densité
 *             confortable, omis partout ailleurs, y compris au dépliage —
 *             une date de modification ne se cherche pas au doigt.
 *
 * Une colonne sans rang déclaré est traitée comme `primary` : l'oubli rend la
 * table plus large, jamais moins complète.
 */

export const RANGS = ['primary', 'secondary', 'tertiary'];

const rangDe = (colonne) => (RANGS.includes(colonne.priority) ? colonne.priority : 'primary');

/**
 * Colonnes montrées dans le tableau, à une largeur et une densité données.
 *
 * `large` vaut vrai à partir de 1280 px, où la table peut porter ses colonnes
 * secondaires sans compresser les premières.
 */
export function colonnesVisibles(colonnes = [], { large = false, compact = false } = {}) {
  return colonnes.filter((colonne) => {
    const rang = rangDe(colonne);
    if (rang === 'primary') return true;
    if (rang === 'secondary') return large;
    return large && !compact;
  });
}

/**
 * Colonnes reléguées au dépliage — celles qu'on cache sans les perdre.
 *
 * Les `tertiary` n'y figurent pas : elles ne sont pas cachées faute de place,
 * elles sont jugées inutiles hors du grand écran. Les faire réapparaître dans
 * un dépliage reviendrait à nier la distinction entre les deux rangs.
 */
export function colonnesRepliees(colonnes = [], { large = false } = {}) {
  if (large) return [];
  return colonnes.filter((colonne) => rangDe(colonne) === 'secondary');
}

/** Valeur affichable d'une cellule, quelle que soit l'enveloppe. */
export const valeurCellule = (colonne, ligne) =>
  colonne.render ? colonne.render(ligne) : ligne[colonne.key];

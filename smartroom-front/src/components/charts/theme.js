/**
 * Réglages communs à tous les graphiques Recharts (espace utilisateur et
 * administration). Centralisés pour que la palette reste unique et que les
 * pièges déjà rencontrés ne soient pas réintroduits écran par écran.
 *
 * Les couleurs pointent sur les jetons de `index.css` plutôt que d'être
 * écrites en dur. Ces constantes sont évaluées une fois à l'import, mais ce
 * qu'elles portent est une **chaîne CSS** : le navigateur résout `var()` au
 * moment du rendu, dans un attribut `fill` de SVG comme dans un style inline.
 * Les graphiques suivent donc le thème sans qu'aucun code ne les en avertisse.
 */

// Recharts colore le texte des graduations par `fill`, pas par `stroke` :
// sans cela, les axes restent au gris #666 par défaut, illisible sur fond sombre.
export const AXIS = {
  fill: 'rgb(var(--content-muted))',
  fontSize: 11,
  fontFamily: 'ui-monospace, monospace',
};

// Palette de séries : des teintes franches, distinguables aussi en niveaux de
// gris (bleu, vert, jaune, violet, corail). Les quatre premières suivent les
// jetons d'état, qui s'assombrissent en thème clair — un jaune de fond sombre
// serait illisible sur du blanc. Le violet n'a pas de jeton et porte donc ses
// deux valeurs, choisies au même écart de luminance que ses voisines.
export const SLICES = [
  'rgb(var(--accent))',
  'rgb(var(--success))',
  'rgb(var(--warning))',
  'var(--serie-violette)',
  'rgb(var(--danger))',
];

export const ACCENT = 'rgb(var(--accent))';

export const tooltipStyle = {
  background: 'rgb(var(--surface-raised))',
  border: '1px solid rgb(var(--line-strong))',
  borderRadius: 10,
  boxShadow: 'var(--ombre-portee)',
  fontSize: 12,
  padding: '6px 10px',
  color: 'rgb(var(--content))',
};

export const tooltipLabelStyle = {
  color: 'rgb(var(--content-muted))',
  fontSize: 11,
  marginBottom: 2,
};

export const tooltipItemStyle = {
  color: 'rgb(var(--content))',
  fontFamily: 'ui-monospace, monospace',
  padding: 0,
};

/** Bande de survol arrondie : sans arrondi, elle se lit comme une seconde barre. */
export const hoverCursor = { fill: 'rgb(var(--accent) / 0.07)', radius: 8 };

/**
 * Marges positives uniquement : une marge négative fait calculer à Recharts une
 * largeur de bande nulle, et plus aucune barre ne sort.
 */
export const chartMargin = { top: 8, right: 8, bottom: 0, left: 0 };

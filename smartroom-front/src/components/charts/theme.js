/**
 * Réglages communs à tous les graphiques Recharts (espace utilisateur et
 * administration). Centralisés pour que la palette reste unique et que les
 * pièges déjà rencontrés ne soient pas réintroduits écran par écran.
 */

// Recharts colore le texte des graduations par `fill`, pas par `stroke` :
// sans cela, les axes restent au gris #666 par défaut, illisible sur fond sombre.
export const AXIS = { fill: '#B4C0D4', fontSize: 11, fontFamily: 'ui-monospace, monospace' };

// Palette de séries : des teintes franches, distinguables aussi en niveaux de gris
// (bleu clair, vert, jaune, violet, corail).
export const SLICES = ['#5B9BFF', '#3DDBA6', '#FCC63F', '#C084FC', '#FF8080'];

export const ACCENT = '#5B9BFF';

export const tooltipStyle = {
  background: '#222C3E',
  border: '1px solid #3B4A66',
  borderRadius: 10,
  boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
  fontSize: 12,
  padding: '6px 10px',
  color: '#F7FAFF',
};

export const tooltipLabelStyle = { color: '#B4C0D4', fontSize: 11, marginBottom: 2 };

export const tooltipItemStyle = {
  color: '#F7FAFF',
  fontFamily: 'ui-monospace, monospace',
  padding: 0,
};

/** Bande de survol arrondie : sans arrondi, elle se lit comme une seconde barre. */
export const hoverCursor = { fill: 'rgba(91,155,255,0.07)', radius: 8 };

/**
 * Marges positives uniquement : une marge négative fait calculer à Recharts une
 * largeur de bande nulle, et plus aucune barre ne sort.
 */
export const chartMargin = { top: 8, right: 8, bottom: 0, left: 0 };

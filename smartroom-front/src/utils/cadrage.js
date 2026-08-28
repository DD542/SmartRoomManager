/**
 * Géométrie du recadrage carré d'une photo de profil.
 *
 * Séparée du composant parce qu'elle se vérifie : le canevas n'existe pas
 * dans l'environnement de test, la règle de calcul si.
 *
 * Le repère est celui de l'image d'origine, en pixels. `zoom` vaut 1 quand la
 * fenêtre carrée est aussi grande que le petit côté de l'image — le cadrage
 * le plus large possible — et grandit vers un cadrage plus serré.
 */

const borner = (valeur, min, max) => Math.min(Math.max(valeur, min), max);

/** Côté du carré retenu dans l'image d'origine, pour un zoom donné. */
export const coteSource = (largeur, hauteur, zoom = 1) =>
  Math.min(largeur, hauteur) / Math.max(1, zoom);

/**
 * Carré retenu dans l'image d'origine.
 *
 * Sans décalage ni zoom, c'est le carré centré — exactement ce que fait
 * `object-fit: cover`. Les décalages sont exprimés dans le même repère et
 * bornés au cadre de l'image : on ne peut pas sortir du papier.
 */
export function cadreSource({
  largeur,
  hauteur,
  zoom = 1,
  decalageX = 0,
  decalageY = 0,
}) {
  const cote = coteSource(largeur, hauteur, zoom);
  return {
    cote,
    x: borner((largeur - cote) / 2 + decalageX, 0, largeur - cote),
    y: borner((hauteur - cote) / 2 + decalageY, 0, hauteur - cote),
  };
}

/**
 * Position de l'image dans la fenêtre de prévisualisation.
 *
 * Le même cadre, exprimé en pixels d'écran : ce que l'utilisateur voit est
 * donc ce qui sera découpé, sans second calcul qui pourrait diverger.
 */
export function apercu(cadre, largeur, hauteur, fenetre) {
  const facteur = fenetre / cadre.cote;
  return {
    width: largeur * facteur,
    height: hauteur * facteur,
    left: -cadre.x * facteur,
    top: -cadre.y * facteur,
  };
}

/** Zoom maximal utile : au-delà, le carré retenu tiendrait sous la sortie. */
export const zoomMax = (largeur, hauteur, sortie = 512) =>
  Math.max(1, Math.min(4, Math.min(largeur, hauteur) / sortie));

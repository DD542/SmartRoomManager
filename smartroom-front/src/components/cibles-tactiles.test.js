/**
 * @vitest-environment node
 *
 * Les actions d'une liste doivent se viser au doigt.
 *
 * Mesuré à 375 px dans l'administration : « Voir » et « Traiter » sur le
 * tableau de bord, « Réinitialiser » sur les écrans de liste, tous **16 px de
 * haut**. C'est sous le minimum de 24 px du référentiel d'accessibilité, et
 * loin des 44 px que l'espace utilisateur a adoptés après une remarque sur les
 * boutons difficiles à toucher.
 *
 * Ces liens sont l'action principale de leur ligne : ce sont eux qu'on vise en
 * premier depuis un téléphone.
 *
 * La hauteur ne se mesure pas dans jsdom, qui ne fait pas de mise en page. Le
 * test vérifie donc la source, comme celui des grilles : la classe manquante
 * ne manque à personne tant qu'on ne regarde pas l'écran.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Chaque entrée nomme un contrôle constaté trop petit, et son écran. */
const CONTROLES = [
  {
    fichier: 'src/components/admin/dashboard/AlertList.jsx',
    ancre: '{alerte.action.label}',
    quoi: '« Voir » et « Traiter » du tableau de bord',
  },
  {
    fichier: 'src/components/admin/FilterBar.jsx',
    ancre: 'Réinitialiser',
    quoi: '« Réinitialiser » des barres de filtres',
  },
];

/**
 * `min-h-[44px]` ou `min-h-11` : quarante-quatre pixels, la cible confortable
 * retenue dans l'espace utilisateur. `py-*` seul ne suffit pas — il dépend de
 * la taille du texte, qui est ici de 12 px.
 */
const CIBLE = /min-h-\[44px\]|min-h-11/;

describe('Cibles tactiles', () => {
  for (const { fichier, ancre, quoi } of CONTROLES) {
    it(`laisse 44 px à ${quoi}`, () => {
      const source = readFileSync(fichier, 'utf8');
      const position = source.indexOf(ancre);
      expect(position, `${ancre} introuvable dans ${fichier}`).toBeGreaterThan(-1);

      // La balise ouvrante du contrôle : on remonte au `<` qui précède, en
      // sautant les éventuelles balises internes (une icône, un libellé).
      const avant = source.slice(0, position);
      const ouverture = Math.max(avant.lastIndexOf('<Link'), avant.lastIndexOf('<button'));
      expect(ouverture, `aucun contrôle avant ${ancre}`).toBeGreaterThan(-1);
      const balise = source.slice(ouverture, position);

      expect(balise, `${fichier} : ${quoi} reste sous 44 px`).toMatch(CIBLE);
    });
  }
});

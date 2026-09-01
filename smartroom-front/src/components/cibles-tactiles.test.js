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
  {
    fichier: 'src/components/public/LandingDemo.jsx',
    ancre: 'aria-label={`Séquence',
    quoi: 'les pastilles de séquence de la page de présentation',
  },
  {
    fichier: 'src/components/layout/PageHeader.jsx',
    ancre: '{backLabel}',
    quoi: 'le lien de retour des en-têtes de page',
  },
  {
    fichier: 'src/components/rooms/RoomCard.jsx',
    ancre: '{room.name}',
    quoi: 'le nom de salle des cartes de résultat',
  },
  {
    fichier: 'src/pages/onsite/CheckInPage.jsx',
    // Ancée sur le geste et non sur le libellé : celui-ci apparaît d'abord
    // dans un commentaire, bien avant la balise.
    ancre: 'setRetardOuvert(true)',
    quoi: '« Je suis en retard » de la validation de présence',
  },
];

/**
 * `min-h-[44px]` ou `min-h-11` : quarante-quatre pixels, la cible confortable
 * retenue dans l'espace utilisateur. `py-*` seul ne suffit pas — il dépend de
 * la taille du texte, qui est ici de 12 px.
 */
const CIBLE = /min-h-\[44px\]|min-h-11/;

/**
 * La balise ouvrante qui porte l'ancre.
 *
 * On remonte au `<Link` ou `<button` qui précède, puis on avance jusqu'au `>`
 * qui ferme cette balise — en ignorant ceux qui vivent dans une expression
 * `{...}`, où un `=>` en produit à lui seul. Découper jusqu'à l'ancre
 * seulement laisserait de côté les attributs écrits après elle, et le test
 * echouerait sur du code correct.
 */
function baliseOuvrante(source, ancre) {
  const position = source.indexOf(ancre);
  if (position < 0) return null;

  const avant = source.slice(0, position);
  const debut = Math.max(avant.lastIndexOf('<Link'), avant.lastIndexOf('<button'));
  if (debut < 0) return null;

  let profondeur = 0;
  for (let i = debut; i < source.length; i += 1) {
    const c = source[i];
    if (c === '{') profondeur += 1;
    else if (c === '}') profondeur -= 1;
    else if (c === '>' && profondeur === 0) return source.slice(debut, i + 1);
  }
  return source.slice(debut);
}

describe('Cibles tactiles', () => {
  for (const { fichier, ancre, quoi } of CONTROLES) {
    it(`laisse 44 px à ${quoi}`, () => {
      const source = readFileSync(fichier, 'utf8');
      const balise = baliseOuvrante(source, ancre);

      expect(balise, `${ancre} introuvable dans ${fichier}`).not.toBeNull();
      expect(balise, `${fichier} : ${quoi} reste sous 44 px`).toMatch(CIBLE);
    });
  }
});

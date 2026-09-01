/**
 * @vitest-environment node
 *
 * Les textes que l'application ne compose pas doivent pouvoir se couper.
 *
 * Un corps de notification, un message de ticket, une consigne d'administrateur
 * : leur contenu vient d'ailleurs, et rien n'empêche qu'il porte une adresse
 * web. Une URL est un mot insécable de soixante caractères — la coupure par
 * défaut, `overflow-wrap: normal`, ne la casse jamais. Le texte sort alors de
 * sa boîte.
 *
 * Mesuré sur l'écran des notifications, à 375 px : **11 cartes sur 14
 * débordaient, de 54 à 64 px chacune**, à cause du lien « Pour gérer votre
 * réservation : http://… » que porte le courriel de confirmation.
 *
 * Le défaut ne casse aucun test de rendu et ne se voit pas dans un diff : jsdom
 * ne fait pas de mise en page, et la classe manquante ne manque à personne tant
 * qu'on ne regarde pas l'écran. D'où cette vérification de source, du même
 * genre que celle des grilles.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Les endroits où un texte venu d'ailleurs est rendu tel quel.
 *
 * La liste est tenue à la main : elle nomme des cas connus plutôt que de
 * deviner, et un cas de plus se constate à l'écran avant de s'ajouter ici.
 */
const RENDUS = [
  {
    fichier: 'src/pages/account/NotificationsPage.jsx',
    expression: '{notification.body}',
    quoi: 'le corps d’une notification, recopié du courriel',
  },
];

/**
 * Les résumés d'une liste dépliable tiennent sur deux lignes, pas une.
 *
 * `truncate` coupe à une ligne, ellipse comprise. Sur un téléphone, la colonne
 * du centre d'aide fait 237 px : mesuré sur les 24 articles, les résumés
 * réclamaient jusqu'à 373 px et perdaient donc leur tiers final — « Réserver une
 * salle du campus, en connaît… ». Le teaser ne renseignait plus.
 *
 * Deux lignes suffisent : sur un écran large, la plupart tiennent toujours sur
 * une seule et rien ne change.
 */
const RESUMES = [
  {
    fichier: 'src/components/support/HelpArticleList.jsx',
    expression: '{article.excerpt}',
    quoi: 'le résumé d’un article d’aide',
  },
];

describe('Résumés de liste', () => {
  for (const { fichier, expression, quoi } of RESUMES) {
    it(`laisse deux lignes à ${quoi}`, () => {
      const source = readFileSync(fichier, 'utf8');
      const position = source.indexOf(expression);
      expect(position, `${expression} introuvable dans ${fichier}`).toBeGreaterThan(-1);

      const balise = source.slice(source.lastIndexOf('<', position), position);

      expect(balise, `${fichier} : le résumé est coupé à une ligne`).toMatch(
        /line-clamp-2/,
      );
      expect(balise, `${fichier} : \`truncate\` ramène à une ligne`).not.toMatch(
        /truncate/,
      );
    });
  }
});

describe('Textes non maîtrisés', () => {
  for (const { fichier, expression, quoi } of RENDUS) {
    it(`coupe ${quoi}`, () => {
      const source = readFileSync(fichier, 'utf8');
      const position = source.indexOf(expression);
      expect(position, `${expression} introuvable dans ${fichier}`).toBeGreaterThan(-1);

      // La balise qui porte le texte : on remonte au `<` qui précède.
      const ouverture = source.lastIndexOf('<', position);
      const balise = source.slice(ouverture, position);

      expect(balise, `${fichier} : le texte ne pourra pas se couper`).toMatch(/break-words/);
    });

    it(`garde les retours à la ligne de ${quoi}`, () => {
      // Le corps vient d'un courriel : ses paragraphes sont des `\n`. Sans
      // `whitespace-pre-line`, tout se recolle en un pavé et « Bonjour Dylan, »
      // se retrouve accroché à la phrase suivante.
      const source = readFileSync(fichier, 'utf8');
      const position = source.indexOf(expression);
      const balise = source.slice(source.lastIndexOf('<', position), position);

      expect(balise, `${fichier} : les paragraphes seront recollés`).toMatch(
        /whitespace-pre-line/,
      );
    });
  }
});

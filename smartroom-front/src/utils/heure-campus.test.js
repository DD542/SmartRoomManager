/**
 * L'heure du campus, et non celle du poste.
 *
 * Les repartitions par tranche horaire groupent les reservations dans les
 * creneaux d'ouverture de l'etablissement : 08-10, 10-12, 14-16, 16-18. Le
 * code lisait `Date.getHours()`, c'est-a-dire l'heure du navigateur.
 *
 * Sur un poste regle a Paris, personne ne voyait rien. En UTC — le fuseau de
 * la chaine d'integration — une reservation de 9 h devenait 7 h, ne tombait
 * dans aucune tranche, et la page annoncait « Pas encore assez de
 * reservations pour degager une tendance » sur un jeu qui en contenait.
 *
 * Ces assertions portent sur des instants absolus : leur resultat ne depend
 * pas du fuseau dans lequel elles sont jouees. C'est ce qui les rend capables
 * d'attraper la regression, ici comme en integration.
 */

import { describe, expect, it } from 'vitest';
import { heureCampus } from './dates';

describe('heure du campus', () => {
  it('rend l’heure de Paris en heure d’été', () => {
    // 15 juin, 07:00 UTC = 09:00 a Paris (UTC+2).
    expect(heureCampus('2026-06-15T07:00:00Z')).toBe(9);
  });

  it('rend l’heure de Paris en heure d’hiver', () => {
    // 15 janvier, 07:00 UTC = 08:00 a Paris (UTC+1).
    expect(heureCampus('2026-01-15T07:00:00Z')).toBe(8);
  });

  it('rend minuit comme 0, jamais comme 24', () => {
    // La locale francaise rend minuit « 24 » dans certains moteurs : une
    // heure hors de [0, 23] sortirait silencieusement de toute tranche.
    expect(heureCampus('2026-06-14T22:00:00Z')).toBe(0);
  });

  it('accepte une date comme une chaine', () => {
    expect(heureCampus(new Date('2026-06-15T07:00:00Z'))).toBe(9);
  });
});

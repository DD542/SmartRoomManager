/**
 * @vitest-environment node
 *
 * Géométrie du recadrage de la photo de profil.
 */

import { describe, expect, it } from 'vitest';
import { apercu, cadreSource, coteSource, zoomMax } from './cadrage';

describe('cadre retenu dans l’image', () => {
  const portrait = { largeur: 750, hauteur: 1080 };

  it('retient le carré centré, sans zoom ni décalage', () => {
    // C'est ce que faisait déjà `object-fit: cover` : le recadrage manuel part
    // donc de ce que l'utilisateur voyait, et ne le surprend pas.
    expect(cadreSource(portrait)).toEqual({ cote: 750, x: 0, y: 165 });
  });

  it('resserre le cadre quand on zoome', () => {
    expect(coteSource(750, 1080, 2)).toBe(375);
    expect(cadreSource({ ...portrait, zoom: 2 })).toEqual({ cote: 375, x: 187.5, y: 352.5 });
  });

  it('remonte le cadre sur le visage', () => {
    const cadre = cadreSource({ ...portrait, zoom: 2, decalageY: -200 });
    expect(cadre.y).toBe(152.5);
  });

  it('ne sort jamais de l’image', () => {
    // Un glissement à outrance laisserait sinon une bande transparente sur le
    // bord du portrait, que rien ne remplirait.
    const trop = cadreSource({ ...portrait, zoom: 2, decalageX: -9999, decalageY: 9999 });
    expect(trop.x).toBe(0);
    expect(trop.y).toBe(1080 - 375);
  });

  it('traite le paysage comme le portrait', () => {
    expect(cadreSource({ largeur: 1600, hauteur: 900 })).toEqual({ cote: 900, x: 350, y: 0 });
  });

  it('refuse un dézoom sous le cadrage le plus large', () => {
    expect(coteSource(750, 1080, 0.5)).toBe(750);
  });
});

describe('aperçu à l’écran', () => {
  it('montre exactement ce qui sera découpé', () => {
    const cadre = cadreSource({ largeur: 750, hauteur: 1080, zoom: 2 });
    const vue = apercu(cadre, 750, 1080, 300);

    // La fenêtre de 300 px montre un carré de 375 px de l'original : l'image
    // entière y occupe donc le double de sa part.
    expect(vue.width).toBe(600);
    expect(vue.height).toBe(864);
    expect(vue.left).toBe(-150);
    expect(vue.top).toBe(-282);
  });
});

describe('zoom maximal', () => {
  it('s’arrête là où la découpe passerait sous la taille de sortie', () => {
    // 750 px de petit côté pour une sortie de 512 : au-delà de 1,46, le carré
    // retenu serait agrandi à l'enregistrement, ce qui n'ajoute rien.
    expect(zoomMax(750, 1080, 512)).toBeCloseTo(1.46, 2);
  });

  it('reste possible sur une petite image', () => {
    expect(zoomMax(300, 300, 512)).toBe(1);
  });

  it('ne dépasse pas quatre', () => {
    expect(zoomMax(8000, 6000, 512)).toBe(4);
  });
});

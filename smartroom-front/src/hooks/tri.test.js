/**
 * @vitest-environment jsdom
 *
 * Tri des tableaux d'administration.
 *
 * Les dates y étaient comparées comme du texte. `String(new Date(...))` donne
 * « Tue Sep 01 2026 11:30:00 GMT+0200 » : trier là-dessus range les lignes par
 * **nom de jour de la semaine**, puis par mois en anglais. La colonne
 * « Créneau » de l'écran des réservations triait donc faux depuis toujours.
 *
 * Le désordre passait inaperçu parce que le premier écran restait plausible :
 * les lignes d'un même jour se suivent, et il faut comparer deux semaines pour
 * voir que l'ordre n'a aucun sens.
 */

import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useDataTable } from './useDataTable';

/** Trois dates dont l'ordre alphabétique contredit l'ordre chronologique. */
const LIGNES = [
  { id: 'a', quand: new Date('2026-09-01T10:00:00Z') }, // mardi
  { id: 'b', quand: new Date('2026-12-25T10:00:00Z') }, // vendredi, plus tard
  { id: 'c', quand: new Date('2026-04-06T10:00:00Z') }, // lundi, plus tôt
];

const trier = (direction) =>
  renderHook(() =>
    useDataTable(LIGNES, { pageSize: 10, initialSort: { key: 'quand', direction } }),
  ).result.current.rows.map((ligne) => ligne.id);

describe('Tri par date', () => {
  it('range du plus ancien au plus récent', () => {
    expect(trier('asc')).toEqual(['c', 'a', 'b']);
  });

  it('range du plus récent au plus ancien', () => {
    expect(trier('desc')).toEqual(['b', 'a', 'c']);
  });

  it('ne se laisse pas prendre par l’ordre alphabétique', () => {
    // « Fri Dec 25 » < « Mon Apr 06 » < « Tue Sep 01 » en texte : l'ordre
    // attendu ci-dessus est exactement celui qu'un tri textuel ne produit pas.
    const textuel = [...LIGNES]
      .sort((x, y) => String(x.quand).localeCompare(String(y.quand), 'fr'))
      .map((ligne) => ligne.id);

    expect(textuel).not.toEqual(trier('asc'));
  });
});

describe('Tri des autres types', () => {
  it('compare les nombres comme des nombres', () => {
    const nombres = [{ id: 'a', n: 9 }, { id: 'b', n: 100 }, { id: 'c', n: 20 }];
    const { result } = renderHook(() =>
      useDataTable(nombres, { pageSize: 10, initialSort: { key: 'n', direction: 'asc' } }),
    );

    expect(result.current.rows.map((ligne) => ligne.id)).toEqual(['a', 'c', 'b']);
  });

  it('compare le texte selon l’alphabet français', () => {
    const mots = [{ id: 'a', t: 'Étage' }, { id: 'b', t: 'Amphi' }, { id: 'c', t: 'Zone' }];
    const { result } = renderHook(() =>
      useDataTable(mots, { pageSize: 10, initialSort: { key: 't', direction: 'asc' } }),
    );

    // « Étage » se range après « Amphi » et avant « Zone » : l'accent ne le
    // rejette pas en fin de liste.
    expect(result.current.rows.map((ligne) => ligne.id)).toEqual(['b', 'a', 'c']);
  });

  it('renvoie les valeurs absentes en fin de liste', () => {
    const trous = [{ id: 'a', quand: null }, { id: 'b', quand: new Date('2026-01-01') }];
    const { result } = renderHook(() =>
      useDataTable(trous, { pageSize: 10, initialSort: { key: 'quand', direction: 'asc' } }),
    );

    expect(result.current.rows.map((ligne) => ligne.id)).toEqual(['b', 'a']);
  });
});

/**
 * @vitest-environment jsdom
 *
 * Un champ contrôlé ne reçoit jamais `null`.
 *
 * React le refuse explicitement : « `value` prop on `select` should not be
 * null ». L'avertissement s'imprimait à chaque rendu de l'écran des
 * préférences, où « bâtiment principal » vaut `null` tant que personne n'en a
 * choisi — l'adaptateur le rend ainsi, et c'est la bonne valeur à renvoyer au
 * serveur.
 *
 * La normalisation vit donc dans le champ, pas chez l'appelant : chaque écran
 * qui affiche une préférence non renseignée retomberait sinon dans le même
 * piège, et `null` reste ce qu'il faut envoyer.
 *
 * Assertions DOM natives : `jest-dom` n'est pas dans les dépendances.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Input, Select, Textarea } from './Form';

const OPTIONS = [
  { value: 'b-1', label: 'Eiffel 1' },
  { value: 'b-2', label: 'Eiffel 2' },
];

/** Guette les avertissements de React, qui ne lèvent rien par eux-mêmes. */
function guetter() {
  const vus = [];
  const espion = vi.spyOn(console, 'error').mockImplementation((...args) => {
    vus.push(args.map(String).join(' '));
  });
  return { vus, espion };
}

afterEach(() => vi.restoreAllMocks());

describe('Valeur nulle', () => {
  it("n'arrache aucun avertissement à React sur un select", () => {
    const { vus } = guetter();

    render(
      <Select
        label="Bâtiment principal"
        value={null}
        onChange={() => {}}
        options={OPTIONS}
        placeholder="Aucun"
      />,
    );

    expect(vus.filter((ligne) => /should not be null/.test(ligne))).toEqual([]);
  });

  it('laisse le champ vide plutôt que de choisir à la place de l’utilisateur', () => {
    // Sans normalisation, un `select` non contrôlé affiche sa première option :
    // l'écran annoncerait « Eiffel 1 » alors que rien n'est choisi.
    render(
      <Select
        label="Bâtiment principal"
        value={null}
        onChange={() => {}}
        options={OPTIONS}
        placeholder="Aucun"
      />,
    );

    expect(screen.getByLabelText('Bâtiment principal').value).toBe('');
  });

  it('ne touche pas à une valeur renseignée', () => {
    render(
      <Select label="Bâtiment principal" value="b-2" onChange={() => {}} options={OPTIONS} />,
    );

    expect(screen.getByLabelText('Bâtiment principal').value).toBe('b-2');
  });

  it('vaut aussi pour les champs de saisie', () => {
    const { vus } = guetter();

    render(
      <>
        <Input label="Téléphone" value={null} onChange={() => {}} />
        <Textarea label="Consigne" value={null} onChange={() => {}} />
      </>,
    );

    expect(vus.filter((ligne) => /should not be null/.test(ligne))).toEqual([]);
  });
});

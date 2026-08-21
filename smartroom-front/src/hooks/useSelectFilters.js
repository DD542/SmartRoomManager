import { useState } from 'react';

/**
 * État des barres de filtres à sélecteurs des écrans d'administration.
 *
 * Fournit la liste attendue par `FilterBar`, les chips de rappel des filtres
 * actifs et la remise à zéro. Chaque écran n'a plus qu'à décrire ses champs :
 * `{ id, label, options }`.
 */
export function useSelectFilters(champs = []) {
  const vide = Object.fromEntries(champs.map((champ) => [champ.id, null]));
  const [valeurs, setValeurs] = useState(vide);

  const definir = (id, valeur) => setValeurs((current) => ({ ...current, [id]: valeur }));

  const filters = champs.map((champ) => ({
    ...champ,
    value: valeurs[champ.id] ?? null,
    onChange: (valeur) => definir(champ.id, valeur),
  }));

  const active = filters
    .filter((filtre) => filtre.value)
    .map((filtre) => ({
      key: filtre.id,
      label: filtre.options.find((option) => option.value === filtre.value)?.label ?? filtre.value,
      remove: () => definir(filtre.id, null),
    }));

  return {
    valeurs,
    filters,
    active,
    reset: () => setValeurs(vide),
    // Clé stable pour les dépendances de rechargement des écrans.
    cle: champs.map((champ) => valeurs[champ.id] ?? '').join('|'),
  };
}

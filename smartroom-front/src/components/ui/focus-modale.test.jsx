import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Modal } from './Modal';

/**
 * Le focus doit rester dans le champ qu'on est en train de remplir.
 *
 * Le défaut : `useFocusTrap` dépendait de `onEscape`. Les appelants passent
 * une fonction anonyme — `onClose={() => setDraft(null)}` — dont l'identité
 * change à chaque rendu. Or un champ contrôlé provoque un rendu par lettre
 * frappée : l'effet se démontait et se remontait à chaque touche, et sa
 * remise en place redonnait le focus au premier élément focalisable de la
 * modale, c'est-à-dire la croix de fermeture.
 *
 * Une lettre, un saut sur la croix. Le formulaire d'aide était inutilisable,
 * et toutes les modales à champ contrôlé de l'application avec lui.
 *
 * Assertions DOM natives : `jest-dom` n'est pas dans les dépendances du
 * projet, et n'a pas à y entrer pour ce test.
 */
function Formulaire({ valeur = '', onChange = () => {}, onClose = () => {} } = {}) {
  return (
    <Modal open onClose={onClose} title="Nouvelle demande d’aide">
      <input
        aria-label="Sujet"
        value={valeur}
        onChange={(event) => onChange(event.target.value)}
      />
    </Modal>
  );
}

/**
 * Reproduit l'appelant réel : le brouillon vit dans la **page**, pas dans la
 * modale. Chaque lettre frappée rend donc la page, qui recrée `onChange` et
 * `onClose` — c'est cette identité changeante qui remontait le piège à focus.
 * Une modale qui garderait son état pour elle ne reproduirait rien.
 */
function PageAppelante() {
  const [brouillon, setBrouillon] = useState({ sujet: '' });
  if (!brouillon) return null;
  return (
    <Formulaire
      valeur={brouillon.sujet}
      onChange={(sujet) => setBrouillon((actuel) => ({ ...actuel, sujet }))}
      onClose={() => setBrouillon(null)}
    />
  );
}

describe('Focus dans une modale', () => {
  it('reste dans le champ pendant la saisie', () => {
    render(<PageAppelante />);
    const champ = screen.getByLabelText('Sujet');

    champ.focus();
    for (const lettre of 'test') {
      fireEvent.change(champ, { target: { value: champ.value + lettre } });
      expect(
        document.activeElement,
        `le focus a quitté le champ après « ${lettre} »`,
      ).toBe(champ);
    }

    expect(champ.value).toBe('test');
  });

  it('donne le focus à la modale à son ouverture', () => {
    // Ce que le piège doit faire — et ne doit faire qu'une fois.
    render(<Formulaire />);

    const dialogue = screen.getByRole('dialog');
    expect(dialogue.contains(document.activeElement)).toBe(true);
  });

  it('ferme toujours sur Échap', () => {
    // La dépendance retirée du tableau ne doit pas figer la fonction appelée :
    // le piège doit toujours joindre la dernière fermeture connue.
    let ferme = 0;
    render(<Formulaire onClose={() => { ferme += 1; }} />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(ferme).toBe(1);
  });
});

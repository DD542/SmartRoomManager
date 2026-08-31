/**
 * @vitest-environment jsdom
 *
 * La consigne de l'administration, tout au long du parcours.
 *
 * Elle était affichée au moment de choisir un créneau, et nulle part ensuite.
 * Or c'est en confirmant qu'on la lit — « laissez la salle rangée » se
 * retient une minute avant d'entrer, pas dix minutes avant de choisir une
 * heure —, et c'est l'écran de confirmation qu'on garde ouvert en marchant
 * vers la salle.
 *
 * Un texte absent ne casse rien : c'est pourquoi ces trois emplacements sont
 * vérifiés plutôt que confiés à la relecture.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConsigneSalle } from './ConsigneSalle';
import { SlotPanel } from './SlotPanel';

const CONSIGNE = 'Laissez la salle rangée, la clé se retire à l’accueil.';

describe('Encadré de consigne', () => {
  it('affiche le texte écrit par l’administration', () => {
    render(<ConsigneSalle notice={CONSIGNE} />);

    expect(screen.getByText(CONSIGNE)).toBeTruthy();
    expect(screen.getByText('Consigne de la salle')).toBeTruthy();
  });

  it('ne laisse pas d’encadré vide', () => {
    const { container } = render(<ConsigneSalle notice={null} />);
    expect(container.innerHTML).toBe('');
  });

  it('traite une consigne blanche comme absente', () => {
    // La base refuse le blanc, mais un adaptateur pourrait en produire : un
    // encadré vierge dans le tunnel serait pire que rien.
    const { container } = render(<ConsigneSalle notice="   " />);
    expect(container.innerHTML).toBe('');
  });
});

describe('Au moment de choisir le créneau', () => {
  const CRENEAU = {
    start: new Date('2026-09-02T09:00:00Z'),
    end: new Date('2026-09-02T10:00:00Z'),
  };
  const REGLES = {
    openTime: '08:00',
    closeTime: '20:00',
    visitDays: [1, 2, 3, 4, 5],
    constraints: ['Durée comprise entre 30 et 240 minutes.'],
    notice: CONSIGNE,
  };

  it('la montre au-dessus des règles calculées', () => {
    render(<SlotPanel slot={CRENEAU} rules={REGLES} />);

    const consigne = screen.getByText(CONSIGNE);
    const calculee = screen.getByText('Durée comprise entre 30 et 240 minutes.');
    // `compareDocumentPosition` : la consigne précède les phrases générées à
    // partir des seuils, sans quoi elle se lirait comme l'une d'elles.
    expect(consigne.compareDocumentPosition(calculee)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('n’affiche rien quand l’administration n’a rien écrit', () => {
    render(<SlotPanel slot={CRENEAU} rules={{ ...REGLES, notice: null }} />);

    expect(screen.queryByText('Consigne de la salle')).toBeNull();
  });
});

describe('Les écrans qui la relisent', () => {
  it('la demandent à l’API plutôt que de la reprendre du brouillon', () => {
    // Le brouillon porte la salle choisie à l'étape précédente : une consigne
    // écrite entre-temps n'y serait pas. Le récapitulatif est le dernier écran
    // avant l'écriture, il doit être juste.
    const sources = [
      'src/pages/booking/SummaryPage.jsx',
      'src/pages/booking/ConfirmedPage.jsx',
    ].map((chemin) => readFileSync(chemin, 'utf8'));

    sources.forEach((source) => expect(source).toContain('getRoomRules('));
  });
});

describe('Composant partagé', () => {
  it('sert les trois emplacements', () => {
    // Trois markups indépendants divergeraient, et l'un finirait par ne plus
    // rien afficher sans que personne ne s'en aperçoive.
    const utilisent = [
      'src/components/bookings/SlotPanel.jsx',
      'src/pages/booking/SummaryPage.jsx',
      'src/pages/booking/ConfirmedPage.jsx',
    ].filter((chemin) => readFileSync(chemin, 'utf8').includes('<ConsigneSalle'));

    expect(utilisent).toHaveLength(3);
  });
});

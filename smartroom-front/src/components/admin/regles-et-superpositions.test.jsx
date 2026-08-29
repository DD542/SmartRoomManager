/**
 * @vitest-environment jsdom
 *
 * Trois défauts constatés à l'écran, verrouillés ici.
 *
 * Aucun ne produisait d'erreur : deux champs restaient vides, un menu passait
 * derrière la page, une fiche s'ouvrait hors de vue. Ce sont les défauts qui
 * ne cassent rien qui survivent le plus longtemps.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CHAMPS_REGLES, RulesForm } from './rules/RulesForm';
import { PileInspecteur } from './PileInspecteur';

const largeur = (px) => {
  window.matchMedia = vi.fn().mockImplementation((query) => {
    const max = /max-width:\s*(\d+)px/.exec(query);
    const min = /min-width:\s*(\d+)px/.exec(query);
    return {
      matches: max ? px <= Number(max[1]) : min ? px >= Number(min[1]) : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
  });
};

afterEach(() => vi.restoreAllMocks());

/** Ce que l'adaptateur produit réellement à partir de la réponse de l'API. */
const REGLES = {
  minDurationMin: 30,
  maxDurationMin: 240,
  bufferMin: 15,
  maxAdvanceDays: 60,
  minAdvanceMin: 15,
  cancelDeadlineMin: 60,
  checkinWindowMin: 10,
  weeklyQuotaHours: 12,
  maxActiveBookings: 10,
  validationThreshold: null,
};

describe('A-07 — règles de réservation', () => {
  it('affiche une valeur dans chaque champ', () => {
    // Deux champs restaient vides en permanence : le formulaire lisait
    // `maxConcurrentSlots` et `checkInWindowMin`, absents des données.
    render(<RulesForm draft={REGLES} onChange={vi.fn()} scopeLabel="toutes les salles" />);

    expect(screen.getByLabelText(/Réservations simultanées/).value).toBe('10');
    expect(screen.getByLabelText(/Fenêtre de validation de présence/).value).toBe('10');
  });

  it('expose les quatre règles que le moteur applique déjà', () => {
    // Horizon, préavis, délai d'annulation et seuil de validation étaient
    // appliqués, récités à l'utilisateur, acceptés par l'API — et réglables
    // nulle part.
    render(<RulesForm draft={REGLES} onChange={vi.fn()} scopeLabel="toutes les salles" />);

    expect(screen.getByLabelText(/Horizon de réservation/).value).toBe('60');
    expect(screen.getByLabelText(/Préavis minimal/).value).toBe('15');
    expect(screen.getByLabelText(/Délai d’annulation/).value).toBe('60');
    expect(screen.getByLabelText(/Seuil de validation administrative/)).toBeTruthy();
  });

  it('couvre exactement les dix règles du moteur', () => {
    expect(CHAMPS_REGLES.map((champ) => champ.id).sort()).toEqual(
      Object.keys(REGLES).sort(),
    );
  });

  it('rend un seuil vidé comme « aucune règle », pas comme zéro', () => {
    // Envoyer 0 imposerait une validation administrative sur toutes les
    // salles, y compris celles de deux places.
    const changer = vi.fn();
    render(
      <RulesForm
        draft={{ ...REGLES, validationThreshold: 20 }}
        onChange={changer}
        scopeLabel="toutes les salles"
      />,
    );

    fireEvent.change(screen.getByLabelText(/Seuil de validation administrative/), {
      target: { value: '' },
    });
    expect(changer).toHaveBeenCalledWith({ validationThreshold: null });
  });

  it('n’émet aucun avertissement React sur un seuil nul', () => {
    const plaintes = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => plaintes.push(String(args[0])));

    render(<RulesForm draft={REGLES} onChange={vi.fn()} scopeLabel="toutes les salles" />);

    expect(plaintes.filter((item) => item.includes('should not be null'))).toEqual([]);
  });
});

describe('A-06 — fiche de bâtiment au téléphone', () => {
  const LISTE = <p key="l">le parc</p>;
  const DETAIL = <p key="d">la fiche</p>;

  it('montre les deux au bureau', () => {
    largeur(1440);
    render(<PileInspecteur liste={LISTE} detail={DETAIL} actif titre="Eiffel 1" />);

    expect(screen.getByText('le parc')).toBeTruthy();
    expect(screen.getByText('la fiche')).toBeTruthy();
  });

  it('ouvre la fiche devant la liste, avec un bouton pour fermer', () => {
    largeur(390);
    const fermer = vi.fn();
    render(
      <PileInspecteur
        liste={LISTE}
        detail={DETAIL}
        actif
        titre="Eiffel 1"
        libelleFermer="Retour au parc"
        onFermer={fermer}
      />,
    );

    expect(screen.queryByText('le parc')).toBeNull();
    expect(screen.getByText('Eiffel 1')).toBeTruthy();

    const bouton = screen.getByRole('button', { name: /Retour au parc/ });
    expect(bouton.className).toContain('min-h-[44px]');
    fireEvent.click(bouton);
    expect(fermer).toHaveBeenCalled();
  });

  it('montre la liste tant que rien n’est choisi', () => {
    largeur(390);
    render(<PileInspecteur liste={LISTE} detail={DETAIL} actif={false} />);

    expect(screen.getByText('le parc')).toBeTruthy();
    expect(screen.queryByText('la fiche')).toBeNull();
  });
});

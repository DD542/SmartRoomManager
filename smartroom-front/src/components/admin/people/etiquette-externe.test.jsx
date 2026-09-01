import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { useDataTable } from '../../../hooks/useDataTable';
import { UsersTable } from './UsersTable';

/**
 * L'étiquette « Hors organisation », dans la colonne Promotion.
 *
 * Deux défauts se sont succédé au même endroit, et aucun des deux n'a produit
 * d'erreur :
 *
 * 1. le champ `is_external` n'était posé que sur l'un des deux schémas de
 *    comptes du back — l'annuaire recevait une réponse sans le champ, donc
 *    `undefined`, donc aucune étiquette nulle part ;
 * 2. la colonne rendait `promotion ?? étiquette` : un compte externe **ayant**
 *    une promotion affichait sa promotion et perdait son étiquette. Le
 *    signalement disparaissait précisément sur les lignes renseignées.
 *
 * D'où le troisième cas ci-dessous, celui qui a échoué avant la correction.
 */
const LIGNE = {
  id: 'u-1',
  name: 'Dylan Menga',
  email: 'personne@gmail.com',
  promotion: null,
  department: 'Informatique',
  bookings: 3,
  noShowRate: 0,
  reliabilityScore: 90,
  isExternal: true,
};

/**
 * On passe par le vrai `useDataTable` plutôt que par un objet façonné à la
 * main : un faux qui ne ressemble plus au contrat rend des tests verts sur un
 * écran cassé.
 */
function Annuaire({ rows }) {
  return <UsersTable table={useDataTable(rows)} />;
}

function cellulePromotion(nom) {
  // La cellule de la colonne Promotion, repérée par l'en-tête plutôt que par
  // un indice : l'ordre des colonnes n'est pas ce que ce test défend.
  const entetes = screen.getAllByRole('columnheader').map((e) => e.textContent.trim());
  const rang = entetes.indexOf('Promotion');
  expect(rang, 'colonne Promotion introuvable').toBeGreaterThanOrEqual(0);

  const ligne = screen.getByRole('row', { name: new RegExp(nom) });
  return within(ligne).getAllByRole('cell')[rang];
}

describe('Étiquette hors organisation', () => {
  it("signale un compte externe sans promotion", () => {
    render(<Annuaire rows={[LIGNE]} />);

    expect(cellulePromotion('Dylan Menga').textContent).toContain('Hors organisation');
  });

  it("laisse la case au rattachement d'un compte de l'école", () => {
    render(
      <Annuaire
        rows={[
          {
            ...LIGNE,
            id: 'u-2',
            name: 'Alice Leroy',
            email: 'alice@edu.ece.fr',
            promotion: 'B3 Cyber',
            isExternal: false,
          },
        ]}
      />,
    );

    const cellule = cellulePromotion('Alice Leroy');
    expect(cellule.textContent).toContain('B3 Cyber');
    expect(cellule.textContent).not.toContain('Hors organisation');
  });

  it("garde le signalement même quand le compte a une promotion", () => {
    // Le cas réel : un compte créé par mot de passe, rattaché à une promotion,
    // qui se connecte ensuite avec une adresse personnelle.
    render(<Annuaire rows={[{ ...LIGNE, name: 'Invité Externe', promotion: 'B3 Data & IA' }]} />);

    const cellule = cellulePromotion('Invité Externe');
    expect(cellule.textContent).toContain('B3 Data & IA');
    expect(cellule.textContent).toContain('Hors organisation');
  });

  it("nomme le domaine, au survol comme à la lecture d'écran", () => {
    render(<Annuaire rows={[LIGNE]} />);

    const etiquette = within(cellulePromotion('Dylan Menga')).getByLabelText(/gmail\.com/);
    expect(etiquette.getAttribute('title')).toContain('gmail.com');
  });
});

/**
 * @vitest-environment jsdom
 *
 * Le brouillon du tunnel survit-il au passage d'une étape à l'autre ?
 *
 * `WizardLayout` monte `BookingProvider` : le besoin exprimé à la première
 * étape doit se retrouver à la deuxième. L'enveloppe d'apparition posée dans
 * `AppLayout` remontait tout le sous-arbre à chaque navigation — fournisseur
 * compris. Le brouillon repartait vide, l'étape suivante n'y trouvait plus de
 * besoin et renvoyait à la première : plus aucune réservation n'aboutissait.
 *
 * Ce test reproduit exactement cet emboîtement.
 */

import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { PageTransition } from '../components/layout/PageTransition';
import { useBooking } from '../hooks/useBooking';
import WizardLayout from './WizardLayout';

function EtapeBesoin() {
  const { update } = useBooking();
  return (
    <>
      <button type="button" onClick={() => update({ title: 'Atelier data', attendees: 8 })}>
        Exprimer le besoin
      </button>
      <Link to="/app/reservation/salles">Étape suivante</Link>
    </>
  );
}

function EtapeSalles() {
  const { draft, hasDraft } = useBooking();
  return (
    <p>
      {hasDraft ? `besoin conservé : ${draft.title} pour ${draft.attendees}` : 'brouillon perdu'}
    </p>
  );
}

describe('Tunnel de réservation', () => {
  it('garde le besoin exprimé d’une étape à l’autre', () => {
    render(
      // `PageTransition` extérieure : celle d'`AppLayout`, dans laquelle le
      // tunnel est rendu.
      <MemoryRouter initialEntries={['/app/reservation/besoin']}>
        <PageTransition>
          <Routes>
            <Route path="/app/reservation" element={<WizardLayout />}>
              <Route path="besoin" element={<EtapeBesoin />} />
              <Route path="salles" element={<EtapeSalles />} />
            </Route>
          </Routes>
        </PageTransition>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Exprimer le besoin' }));
    fireEvent.click(screen.getByRole('link', { name: 'Étape suivante' }));

    expect(screen.getByText('besoin conservé : Atelier data pour 8')).toBeTruthy();
  });
});

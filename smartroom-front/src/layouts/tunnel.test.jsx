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
import WizardLayout, { retourDe } from './WizardLayout';

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

describe('Retour dans le tunnel', () => {
  const CHEMINS = [
    ['/app/reservation/besoin', '/app', 'Quitter la réservation'],
    ['/app/reservation/salles', '/app/reservation/besoin', 'Retour au besoin'],
    ['/app/reservation/salles/r-1', '/app/reservation/salles', 'Retour aux salles'],
    ['/app/reservation/recapitulatif', '/app/reservation/salles/r-1', 'Retour au créneau'],
    ['/app/reservation/conflit', '/app/reservation/salles/r-1', 'Retour au créneau'],
    ['/app/reservation/recurrente', '/app/reservation/salles/r-1', 'Retour au créneau'],
    ['/app/reservation/acces-exceptionnel', '/app/reservation/salles/r-1', 'Retour au créneau'],
  ];

  it.each(CHEMINS)('depuis %s, ramène à %s', (depuis, vers, libelle) => {
    expect(retourDe(depuis, 'r-1')).toEqual({ to: vers, label: libelle });
  });

  it('ramène aux salles quand aucune n’est encore choisie', () => {
    // Récapitulatif atteint par lien profond, brouillon vide : renvoyer vers
    // `/salles/undefined` produirait un 422 au lieu d'un retour.
    expect(retourDe('/app/reservation/recapitulatif', undefined)).toEqual({
      to: '/app/reservation/salles',
      label: 'Retour aux salles',
    });
  });

  it('affiche le retour sur la première étape du tunnel', () => {
    render(
      <MemoryRouter initialEntries={['/app/reservation/besoin']}>
        <Routes>
          <Route path="/app/reservation" element={<WizardLayout />}>
            <Route path="besoin" element={<p>étape</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const retour = screen.getByRole('link', { name: /Quitter la réservation/ });
    expect(retour.getAttribute('href')).toBe('/app');
  });
});

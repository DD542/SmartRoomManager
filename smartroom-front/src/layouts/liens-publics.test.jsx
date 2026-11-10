/**
 * @vitest-environment jsdom
 *
 * Les liens de l'en-tête public, hors de la page de présentation.
 *
 * Le logo menait à `/`, qui renvoie à l'écran de connexion quiconque n'a pas
 * de session : depuis les mentions légales, cliquer le logo pour revenir à
 * l'accueil du site ouvrait la connexion. Les liens « Démo », « FAQ »… étaient
 * des ancres seules, qui ne menaient nulle part hors de la présentation.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PublicLayout from './PublicLayout';

const monter = (adresse) =>
  render(
    <MemoryRouter
      initialEntries={[adresse]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route element={<PublicLayout />}>
          <Route path="/presentation" element={<p>présentation</p>} />
          <Route path="/mentions-legales" element={<p>mentions</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

describe('En-tête des pages publiques', () => {
  it('le logo ramène à la présentation, pas à la connexion', () => {
    monter('/mentions-legales');
    const logo = screen.getByRole('link', { name: /SmartRoom Manager, accueil/ });
    expect(logo.getAttribute('href')).toBe('/presentation');
  });

  it('hors de la présentation, les sections y renvoient', () => {
    monter('/mentions-legales');
    const faq = screen.getAllByRole('link', { name: 'FAQ' })[0];
    expect(faq.getAttribute('href')).toBe('/presentation#faq');
  });

  it('sur la présentation, une ancre suffit', () => {
    monter('/presentation');
    const faq = screen.getAllByRole('link', { name: 'FAQ' })[0];
    expect(faq.getAttribute('href')).toBe('#faq');
  });
});

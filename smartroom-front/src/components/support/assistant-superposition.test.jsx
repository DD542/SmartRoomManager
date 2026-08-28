/**
 * @vitest-environment jsdom
 *
 * L'assistant et les surfaces qui le recouvrent.
 *
 * Deux défauts mesurés : la bulle flottait au-dessus de la barre d'onglets et
 * rendait « Profil » intouchable au doigt ; le panneau restait déployé
 * par-dessus une modale, volant des pixels à la décision demandée.
 */

import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { declarerSurfaceBloquante, useSurfaceBloquante } from '../../hooks/useSurfaceBloquante';
import { Modal } from '../ui/Modal';
import { ChatbotPanel } from './ChatbotPanel';

vi.mock('../../api/assistant', () => ({
  demander: vi.fn(),
  confirmer: vi.fn(),
  relireConversation: vi.fn().mockResolvedValue({ messages: [] }),
}));

const rendre = (element) => render(<MemoryRouter>{element}</MemoryRouter>);

describe('Compte des surfaces bloquantes', () => {
  function Temoin() {
    return <p>{useSurfaceBloquante() ? 'bloquee' : 'libre'}</p>;
  }

  it('suit l’ouverture et la fermeture', () => {
    render(<Temoin />);
    expect(screen.getByText('libre')).toBeTruthy();

    let relacher;
    act(() => {
      relacher = declarerSurfaceBloquante();
    });
    expect(screen.getByText('bloquee')).toBeTruthy();

    act(() => relacher());
    expect(screen.getByText('libre')).toBeTruthy();
  });

  it('ne descend pas sous zéro sur un double relâchement', () => {
    // React en mode strict monte et démonte deux fois : un compte négatif
    // empêcherait tout repli ultérieur.
    render(<Temoin />);
    let relacher;
    act(() => {
      relacher = declarerSurfaceBloquante();
    });
    act(() => {
      relacher();
      relacher();
    });

    let second;
    act(() => {
      second = declarerSurfaceBloquante();
    });
    expect(screen.getByText('bloquee')).toBeTruthy();
    act(() => second());
  });
});

describe('Assistant', () => {
  it('place sa bulle au-dessus de la barre d’onglets, et sous elle', () => {
    rendre(<ChatbotPanel />);

    const bulle = screen.getByRole('button', { name: /Ouvrir l’assistant/ });
    // Sous la barre dans l'échelle des plans : un bouton flottant ne masque
    // pas une destination.
    expect(bulle.className).toContain('z-chatbubble');
    // Et posée au-dessus d'elle à l'écran, marge du système comprise.
    expect(bulle.className).toContain('bottom-[calc(env(safe-area-inset-bottom)+4.5rem)]');
  });

  it('occupe l’écran entier en mobile et redevient fenêtre au-delà', () => {
    rendre(<ChatbotPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Ouvrir l’assistant/ }));

    const panneau = screen.getByRole('region', { name: 'Assistant SmartBot' });
    expect(panneau.className).toContain('inset-0');
    expect(panneau.className).toContain('md:inset-auto');
    expect(panneau.className).toContain('z-chatpanel');
  });

  it('se replie quand une surface bloquante s’ouvre', () => {
    rendre(
      <>
        <ChatbotPanel />
        <Modal open title="Confirmer" onClose={vi.fn()}>
          <p>contenu</p>
        </Modal>
      </>,
    );

    // Le panneau ne peut pas s'ouvrir tant que la modale vit : la bulle reste.
    expect(screen.getByRole('button', { name: /Ouvrir l’assistant/ })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Assistant SmartBot' })).toBeNull();
  });
});

/**
 * @vitest-environment jsdom
 *
 * Le bouton de connexion Google.
 *
 * Il décide seul de s'afficher : rien tant que le serveur n'a pas dit que la
 * connexion est configurée. Un bouton présent qui échoue à chaque clic est
 * pire que pas de bouton — il fait croire à une panne là où il n'y a qu'une
 * option non activée, et c'est exactement ce que faisait le bouton « compte
 * ECE » qu'il remplace.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpResponse, http } from 'msw';
import { render, screen, waitFor } from '@testing-library/react';
import { serveur } from '../../test/serveur';
import { BoutonGoogle } from './BoutonGoogle';

const BASE = 'http://localhost:5180/api/v1';

/** Ce que la bibliothèque de Google expose, réduit à ce qu'on lui demande. */
const poserGoogle = () => {
  const initialise = vi.fn();
  const dessine = vi.fn((element) => {
    element.appendChild(document.createTextNode('Continuer avec Google'));
  });
  window.google = { accounts: { id: { initialize: initialise, renderButton: dessine } } };
  return { initialise, dessine };
};

afterEach(() => {
  delete window.google;
  vi.restoreAllMocks();
});

const active = (enabled, clientId = 'abc.apps.googleusercontent.com') =>
  serveur.use(
    http.get(`${BASE}/auth/google/config`, () =>
      HttpResponse.json({ enabled, client_id: enabled ? clientId : '' }),
    ),
  );

describe('Quand le serveur n’a pas configuré Google', () => {
  it('n’affiche rien du tout', async () => {
    active(false);
    const { container } = render(<BoutonGoogle onCredential={vi.fn()} />);

    await waitFor(() => expect(container.innerHTML).toBe(''));
  });

  it('ne charge pas le script de Google', async () => {
    active(false);
    render(<BoutonGoogle onCredential={vi.fn()} />);

    await waitFor(() =>
      expect(document.querySelector('script[src*="accounts.google.com"]')).toBeNull(),
    );
  });
});

describe('Quand elle est configurée', () => {
  it('laisse Google dessiner son propre bouton', async () => {
    // Leurs conditions d'utilisation l'imposent, et lui seul ouvre la fenêtre
    // de choix de compte dans les conditions que la bibliothèque attend.
    active(true);
    const { dessine, initialise } = poserGoogle();

    render(<BoutonGoogle onCredential={vi.fn()} />);

    await waitFor(() => expect(dessine).toHaveBeenCalled());
    expect(initialise).toHaveBeenCalledWith(
      expect.objectContaining({ client_id: 'abc.apps.googleusercontent.com' }),
    );
  });

  it('n’ouvre aucune session sans qu’on la demande', async () => {
    // `auto_select` ouvrirait une session au simple chargement de la page.
    active(true);
    const { initialise } = poserGoogle();

    render(<BoutonGoogle onCredential={vi.fn()} />);

    await waitFor(() => expect(initialise).toHaveBeenCalled());
    expect(initialise.mock.calls[0][0].auto_select).toBe(false);
  });

  it('transmet le jeton reçu de Google', async () => {
    active(true);
    const { initialise } = poserGoogle();
    const recevoir = vi.fn();

    render(<BoutonGoogle onCredential={recevoir} />);
    await waitFor(() => expect(initialise).toHaveBeenCalled());

    initialise.mock.calls[0][0].callback({ credential: 'jeton-identite' });

    expect(recevoir).toHaveBeenCalledWith('jeton-identite');
  });
});

describe('Quand le script ne se charge pas', () => {
  it('le dit, et laisse le mot de passe comme voie de secours', async () => {
    // Extension de blocage, réseau filtré, coupure : l'utilisateur doit
    // comprendre que c'est cette voie-là qui manque, pas l'application.
    active(true);
    const prevenir = vi.fn();

    render(<BoutonGoogle onCredential={vi.fn()} onError={prevenir} />);

    // Le script inséré n'aboutit jamais dans jsdom : on déclenche son échec.
    await waitFor(() =>
      expect(document.querySelector('script[src*="accounts.google.com"]')).toBeTruthy(),
    );
    document.querySelector('script[src*="accounts.google.com"]').onerror();

    expect(await screen.findByText(/indisponible sur ce poste/)).toBeTruthy();
    await waitFor(() => expect(prevenir).toHaveBeenCalled());
  });
});

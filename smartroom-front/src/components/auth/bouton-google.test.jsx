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
  it('n’affiche rien du tout, séparateur compris', async () => {
    // Le « ou » appartient au bouton : posé à côté, il restait seul au milieu
    // de la page — un séparateur qui n'introduit rien.
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
  it('ramène le séparateur avec le bouton', async () => {
    active(true);
    poserGoogle();
    render(<BoutonGoogle onCredential={vi.fn()} />);

    expect(await screen.findByText('ou')).toBeTruthy();
  });

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

describe('Quand la page se remonte', () => {
  it("n'appelle `initialize` qu'une seule fois", async () => {
    // Google le dit lui-même en console : « initialize() is called multiple
    // times [...] only the last initialized instance will be used ». En mode
    // strict, React monte, démonte et remonte chaque effet ; le composant
    // réinitialisait donc la bibliothèque sous le bouton déjà dessiné.
    active(true);
    const { initialise } = poserGoogle();

    const premier = render(<BoutonGoogle onCredential={vi.fn()} />);
    await waitFor(() => expect(initialise).toHaveBeenCalled());
    premier.unmount();

    render(<BoutonGoogle onCredential={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('ou')).toBeTruthy());

    expect(initialise).toHaveBeenCalledTimes(1);
  });

  it('remet le jeton au bouton actuellement monté', async () => {
    // Conséquence de la règle précédente : puisque `initialize` n'est plus
    // rappelé, son rappel ne doit pas rester attaché au premier bouton, parti
    // depuis longtemps.
    active(true);
    const { initialise } = poserGoogle();

    const premier = render(<BoutonGoogle onCredential={vi.fn()} />);
    await waitFor(() => expect(initialise).toHaveBeenCalled());
    premier.unmount();

    const recevoir = vi.fn();
    render(<BoutonGoogle onCredential={recevoir} />);
    await waitFor(() => expect(screen.getByText('ou')).toBeTruthy());

    initialise.mock.calls[0][0].callback({ credential: 'jeton-du-second' });

    expect(recevoir).toHaveBeenCalledWith('jeton-du-second');
  });

  it('ne parle plus à un bouton démonté', async () => {
    active(true);
    const { initialise } = poserGoogle();
    const oublie = vi.fn();

    const parti = render(<BoutonGoogle onCredential={oublie} />);
    await waitFor(() => expect(initialise).toHaveBeenCalled());
    parti.unmount();

    initialise.mock.calls[0][0].callback({ credential: 'jeton-perdu' });

    expect(oublie).not.toHaveBeenCalled();
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

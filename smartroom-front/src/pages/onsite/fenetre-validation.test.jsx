/**
 * @vitest-environment jsdom
 *
 * La fenêtre de validation de présence, telle que le serveur la connaît.
 *
 * L'écran annonçait « Validation ouverte 10 minutes **avant** le début ». Le
 * serveur, lui, refuse tout ce qui précède le début du créneau :
 * `now < creneau.start` → « La validation ouvre au début du créneau ». La
 * fenêtre est `[début, début + checkin_window)`, et le reste du code le dit
 * correctement — « Présence à confirmer dans les N minutes suivant le début ».
 *
 * Trois défauts en découlaient, tous visibles sur le même écran :
 *
 * 1. l'écran invitait à valider une demi-heure trop tôt, et le serveur
 *    répondait 422 à chaque essai ;
 * 2. « Je suis en retard » n'attrapait pas son erreur : la promesse rejetée
 *    partait en console et l'utilisateur ne voyait strictement rien ;
 * 3. le décompte ne battait pas — calculé une fois au montage, jamais depuis.
 *
 * Assertions DOM natives : `jest-dom` n'est pas dans les dépendances.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../../hooks/useToast';

const DEBUT = new Date('2026-09-01T10:00:00Z');

const reservation = {
  id: 'bk-1',
  roomId: 'r-1',
  room: { id: 'r-1', name: 'Salle Descartes' },
  start: DEBUT,
  end: new Date('2026-09-01T10:30:00Z'),
  status: 'confirmee',
  checkedIn: false,
  checkedInAt: null,
  accessCode: 'E-****',
};

vi.mock('../../api/bookings', () => ({
  getBooking: vi.fn(async () => reservation),
}));

vi.mock('../../api/rooms', () => ({
  getRoomRules: vi.fn(async () => ({ checkinWindowMin: 10 })),
}));

vi.mock('../../api/client', () => ({
  post: vi.fn(),
  get: vi.fn(),
}));

const { getCheckInWindow, declareLate } = await import('../../api/checkin');
const { post } = await import('../../api/client');
const { default: CheckInPage } = await import('./CheckInPage');

/** Place l'horloge à un instant donné, exprimé en minutes depuis le début. */
const maintenant = (minutesDepuisLeDebut) =>
  vi.setSystemTime(new Date(DEBUT.getTime() + minutesDepuisLeDebut * 60_000));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('La fenêtre suit la règle du serveur', () => {
  it("est fermée avant le début — c'est là que l'écran mentait", async () => {
    maintenant(-30);

    const fenetre = await getCheckInWindow('bk-1');

    expect(fenetre.open).toBe(false);
    expect(fenetre.opensInMin).toBe(30);
  });

  it("reste fermée une minute avant, si près soit-on", async () => {
    maintenant(-1);

    expect((await getCheckInWindow('bk-1')).open).toBe(false);
  });

  it("s'ouvre au début du créneau", async () => {
    maintenant(0);
    const fenetre = await getCheckInWindow('bk-1');

    expect(fenetre.open).toBe(true);
    expect(fenetre.remainingMin).toBe(10);
    expect(fenetre.opensInMin).toBe(0);
  });

  it('décompte pendant la fenêtre', async () => {
    maintenant(4);

    expect((await getCheckInWindow('bk-1')).remainingMin).toBe(6);
  });

  it('se referme une fois la fenêtre écoulée', async () => {
    maintenant(11);
    const fenetre = await getCheckInWindow('bk-1');

    expect(fenetre.open).toBe(false);
    expect(fenetre.remainingMin).toBe(0);
  });
});

const monter = () =>
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/app/check-in/bk-1']}>
        <Routes>
          <Route path="/app/check-in/:id" element={<CheckInPage />} />
          <Route path="/app/reservations/:id" element={<p>Fiche</p>} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );

describe("L'écran avant l'ouverture", () => {
  it("annonce l'heure d'ouverture au lieu de se dire ouvert", async () => {
    maintenant(-30);
    monter();

    // Le texte fautif disait « ouverte 10 minutes avant le début ».
    await waitFor(() => expect(screen.queryByText(/avant le début/)).toBeNull());
    expect(screen.getByText(/ouvre au début du créneau/i)).toBeTruthy();
  });

  it('empêche de valider plutôt que de laisser le serveur refuser', async () => {
    // Six 422 de suite en console, et un bouton qui invite à recommencer.
    maintenant(-30);
    monter();

    // Code complet : sans quoi le bouton serait fermé pour une tout autre
    // raison, et le test passerait au vert sans rien défendre.
    const bouton = await screen.findByRole('button', { name: /Valider mon arrivée/ });
    for (const [rang, chiffre] of ['9', '2', '5', '5'].entries()) {
      fireEvent.change(screen.getByLabelText(`Chiffre ${rang + 1} du code d’accès`), {
        target: { value: chiffre },
      });
    }

    expect(bouton.disabled).toBe(true);
  });

  it('ouvre le bouton à la seconde où le créneau commence', async () => {
    // La contrepartie : une fenêtre fermée trop largement vaudrait un écran
    // inutile.
    maintenant(-1 / 60);
    monter();

    const bouton = await screen.findByRole('button', { name: /Valider mon arrivée/ });
    for (const [rang, chiffre] of ['9', '2', '5', '5'].entries()) {
      fireEvent.change(screen.getByLabelText(`Chiffre ${rang + 1} du code d’accès`), {
        target: { value: chiffre },
      });
    }
    expect(bouton.disabled).toBe(true);

    maintenant(0);
    vi.advanceTimersByTime(1000);

    await waitFor(() => expect(bouton.disabled).toBe(false));
  });

  it('ne propose pas de se déclarer en retard avant l’heure', async () => {
    maintenant(-30);
    monter();

    await screen.findByRole('button', { name: /Valider mon arrivée/ });
    expect(screen.queryByRole('button', { name: /en retard/ })).toBeNull();
  });
});

describe('Le décompte', () => {
  it("compte les minutes qui restent avant l'ouverture", async () => {
    // C'est là que l'utilisateur l'a vu figé : bien avant son créneau, sur un
    // 10:00 immobile qui n'était le décompte de rien.
    maintenant(-2);
    monter();

    const lu = () => screen.getByLabelText(/Temps restant|avant l’ouverture|avant l'ouverture/).textContent;
    await waitFor(() => expect(lu()).toBe('02:00'));

    vi.advanceTimersByTime(1000);
    await waitFor(() => expect(lu()).toBe('01:59'));
  });

  it("écrit les heures quand l'ouverture est loin", async () => {
    // `MM:SS` débordait : une réservation du matin consultée la veille au soir
    // affichait « 375:52 », qui ne se lit pas.
    maintenant(-375.5);
    monter();

    await waitFor(() =>
      expect(screen.getByLabelText(/avant l’ouverture/).textContent).toBe('6:15:30'),
    );
  });

  it("bat au lieu de rester figé", async () => {
    maintenant(2);
    monter();

    const lu = () => screen.getByLabelText(/Temps restant/).textContent;
    await waitFor(() => expect(lu()).toBe('08:00'));

    vi.advanceTimersByTime(1000);
    await waitFor(() => expect(lu()).toBe('07:59'));
  });
});

describe('Quand le serveur refuse un retard', () => {
  it("le dit à l'écran, au lieu de laisser filer la promesse", async () => {
    // La promesse rejetée partait en « Uncaught (in promise) » : l'utilisateur
    // cliquait, rien ne se passait, et rien ne lui était dit.
    maintenant(5);
    post.mockRejectedValueOnce(new Error('Le créneau est écoulé.'));
    monter();

    fireEvent.click(await screen.findByRole('button', { name: /en retard/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Signaler mon retard/ }));

    expect(await screen.findByText('Le créneau est écoulé.')).toBeTruthy();
  });
});

describe('Ce que « Je suis en retard » fait vraiment', () => {
  it('valide la présence, et le dit', async () => {
    // Le serveur pose `checked_in_at` : la marque **vaut** validation. L'écran
    // promettait « la fenêtre est prolongée de 10 minutes » — elle ne l'est
    // pas, et rien dans l'API ne prolonge quoi que ce soit.
    maintenant(5);
    post.mockResolvedValueOnce({ ...reservation, checked_in_at: new Date().toISOString() });

    const resultat = await declareLate('bk-1');

    expect(post).toHaveBeenCalledWith('/bookings/bk-1/late', {});
    expect(resultat.booking).toBeTruthy();
  });
});

describe('Le code envoyé au serveur', () => {
  it("garde le tiret que le serveur a haché", async () => {
    // Le code émis a la forme `E-3716`, et c'est cette chaîne exacte dont la
    // base garde l'empreinte. L'écran retirait le tiret avant d'envoyer : le
    // serveur recevait `E3716` et répondait « Code d'accès incorrect » pour
    // un code parfaitement valable.
    maintenant(3);
    post.mockResolvedValueOnce({ ...reservation, checked_in_at: new Date().toISOString() });
    monter();

    const bouton = await screen.findByRole('button', { name: /Valider mon arrivée/ });
    for (const [rang, chiffre] of ['3', '7', '1', '6'].entries()) {
      fireEvent.change(screen.getByLabelText(`Chiffre ${rang + 1} du code d’accès`), {
        target: { value: chiffre },
      });
    }
    fireEvent.click(bouton);

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/bookings/bk-1/check-in', { code: 'E-3716' }),
    );
  });

  it("prend le préfixe de l'indice, pas une lettre inventée", async () => {
    // `accessCode` vaut « E-**** » : la lettre vient du bâtiment, et un
    // repli sur « A » enverrait le code d'une autre aile.
    maintenant(3);
    post.mockResolvedValueOnce({ ...reservation });
    monter();

    // Le rendu d'abord : les champs n'existent qu'une fois la réservation
    // chargée, et une saisie tapée dans le vide ne prouve rien.
    await screen.findByRole('button', { name: /Valider mon arrivée/ });
    for (const [rang, chiffre] of ['1', '2', '3', '4'].entries()) {
      fireEvent.change(screen.getByLabelText(`Chiffre ${rang + 1} du code d’accès`), {
        target: { value: chiffre },
      });
    }
    fireEvent.click(await screen.findByRole('button', { name: /Valider mon arrivée/ }));

    await waitFor(() => expect(post.mock.calls[0][1].code).toBe('E-1234'));
  });
});

describe('La durée annoncée du retard', () => {
  it("part avec la déclaration quand elle est saisie", async () => {
    maintenant(5);
    post.mockResolvedValueOnce({ ...reservation });
    monter();

    fireEvent.click(await screen.findByRole('button', { name: /en retard/ }));
    fireEvent.change(await screen.findByLabelText(/Retard estimé/), {
      target: { value: '15' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Signaler mon retard/ }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/bookings/bk-1/late', { delay_min: 15 }),
    );
  });

  it('reste facultative', async () => {
    // Le geste le plus court de l'écran ne doit pas devenir un formulaire.
    maintenant(5);
    post.mockResolvedValueOnce({ ...reservation });
    monter();

    fireEvent.click(await screen.findByRole('button', { name: /en retard/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Signaler mon retard/ }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/bookings/bk-1/late', {}));
  });
});

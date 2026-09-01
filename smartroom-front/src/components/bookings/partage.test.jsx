/**
 * @vitest-environment jsdom
 *
 * Partage d'une réservation, et consigne écrite par l'administration.
 *
 * Le partage a une contrainte que le reste de l'application n'a pas : ce qui
 * en sort échappe définitivement au système. Un code d'accès parti dans une
 * conversation ne se révoque pas — il ouvre la porte à qui lit le message,
 * puis à qui le reçoit ensuite.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ShareModal } from './ShareModal';
import { SlotPanel } from './SlotPanel';
import {
  icsPartageable,
  liensDePartage,
  resumePartage,
} from '../../utils/partage';

const RESERVATION = {
  id: 'bk-1',
  title: 'Comité de suivi',
  start: new Date('2026-09-02T11:00:00Z'),
  end: new Date('2026-09-02T12:30:00Z'),
  accessCode: 'E-7412',
  room: {
    id: 'r-1',
    name: 'Salle Joule',
    floor: '2e étage',
    building: { name: 'Eiffel 2' },
    locationPlanUrl: '/media/reperes/joule.png',
  },
};

afterEach(() => vi.restoreAllMocks());

describe('Ce qui sort de l’application', () => {
  it('porte le lieu, la date et l’heure', () => {
    const texte = resumePartage(RESERVATION);

    expect(texte).toContain('Comité de suivi');
    expect(texte).toContain('Salle Joule');
    expect(texte).toContain('Eiffel 2');
    expect(texte).toContain('2e étage');
  });

  it('ne porte jamais le code d’accès', () => {
    // Un code parti dans une conversation ne se révoque pas.
    expect(resumePartage(RESERVATION)).not.toContain('E-7412');
    expect(icsPartageable(RESERVATION)).not.toContain('E-7412');
    liensDePartage(RESERVATION).forEach((lien) => {
      expect(decodeURIComponent(lien.href)).not.toContain('E-7412');
    });
  });

  it('ne porte pas de lien que le destinataire ne pourrait pas ouvrir', () => {
    // `/app/reservations/:id` exige une session, et le serveur répond 404 à
    // quiconque n'est pas l'organisateur.
    liensDePartage(RESERVATION).forEach((lien) => {
      expect(decodeURIComponent(lien.href)).not.toContain('/app/reservations/');
    });
  });

  it('produit un fichier d’agenda valide', () => {
    const ics = icsPartageable(RESERVATION);

    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect(ics).toContain('SUMMARY:Comité de suivi');
    // Les virgules sont échappées : c'est ce qu'exige RFC 5545, faute de quoi
    // l'agenda du destinataire lit trois champs au lieu d'un lieu.
    expect(ics).toContain('LOCATION:Salle Joule\\, Eiffel 2\\, 2e étage');
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
  });
});

describe('Fenêtre de partage', () => {
  it('montre le résumé et dit ce qu’il ne contient pas', () => {
    render(<ShareModal booking={RESERVATION} open onClose={vi.fn()} />);

    expect(screen.getByText(/Salle Joule/)).toBeTruthy();
    expect(screen.getByText(/Le code d’accès n’est pas partagé/)).toBeTruthy();
  });

  it('copie le résumé sans le code', async () => {
    const ecrit = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: ecrit },
      configurable: true,
    });

    render(<ShareModal booking={RESERVATION} open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Copier le résumé/ }));

    expect(ecrit).toHaveBeenCalled();
    expect(ecrit.mock.calls[0][0]).not.toContain('E-7412');
  });

  it('n’ouvre les applications que dans un onglet isolé', () => {
    render(<ShareModal booking={RESERVATION} open onClose={vi.fn()} />);

    ['WhatsApp', 'X', 'E-mail'].forEach((nom) => {
      const lien = screen.getByRole('link', { name: nom });
      expect(lien.getAttribute('rel')).toContain('noopener');
    });
  });

  it('appelle le partage sans attendre, pendant le geste', async () => {
    // `share()` exige une activation par un geste, et cette activation ne
    // survit pas à un `await`. La version précédente préparait les pièces
    // jointes — dont une requête réseau pour le plan — puis appelait
    // `share()`, qui refusait avec `NotAllowedError`. Le partage échouait
    // systématiquement.
    const partager = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: partager, configurable: true });
    Object.defineProperty(navigator, 'canShare', {
      value: () => false,
      configurable: true,
    });

    render(<ShareModal booking={RESERVATION} open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Partager…/ }));

    // Aucun `await` entre le clic et l'appel : l'assertion tient sans céder
    // la main, ce qui est précisément ce que le navigateur exige.
    expect(partager).toHaveBeenCalledTimes(1);
    expect(partager.mock.calls[0][0].text).toContain('Salle Joule');
  });

  it('copie le résumé et nomme la cause quand le navigateur refuse', async () => {
    // Un refus laissait l'utilisateur devant un message et rien de fait. Il
    // voulait envoyer un texte : il l'a maintenant dans le presse-papiers.
    const ecrit = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: ecrit }, configurable: true });
    Object.defineProperty(navigator, 'canShare', { value: () => false, configurable: true });
    Object.defineProperty(navigator, 'share', {
      value: () => Promise.reject(Object.assign(new Error('refus'), { name: 'NotAllowedError' })),
      configurable: true,
    });

    render(<ShareModal booking={RESERVATION} open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Partager…/ }));

    // Le nom de l'erreur est affiché : c'est la seule chose qui distingue un
    // navigateur incapable de partager d'un réglage qui l'en empêche.
    expect(await screen.findByText(/NotAllowedError/)).toBeTruthy();
    expect(ecrit).toHaveBeenCalledWith(expect.stringContaining('Salle Joule'));

    // Et le bouton disparaît : le proposer encore enverrait l'utilisateur
    // droit sur le même mur.
    expect(screen.queryByRole('button', { name: /Partager…/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Copier le résumé/ })).toBeTruthy();
  });

  it("met les applications au-dessus des explications quand le partage est refusé", async () => {
    // Le message disait « passez par les boutons ci-dessous » en désignant un
    // bloc situé hors du champ visible : mesuré sur une fenêtre de 700 px,
    // 143 px de contenu étaient masqués et le bloc « Ouvrir dans » commençait
    // 57 px sous le bas de la zone. L'utilisateur devait deviner qu'il y avait
    // une suite.
    //
    // L'ordre du document est ce que ce test défend : ce qui marche vient
    // avant ce qui explique.
    const ecrit = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: ecrit }, configurable: true });
    Object.defineProperty(navigator, 'canShare', { value: () => false, configurable: true });
    Object.defineProperty(navigator, 'share', {
      value: () => Promise.reject(Object.assign(new Error('refus'), { name: 'NotAllowedError' })),
      configurable: true,
    });

    render(<ShareModal booking={RESERVATION} open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Partager…/ }));
    await screen.findByText(/NotAllowedError/);

    // La modale vit dans un portail : c'est `document.body` qui la porte, pas
    // la racine du rendu.
    const texte = document.querySelector('[role=dialog]').textContent;
    const rang = (motif) => texte.search(motif);

    expect(rang(/Ouvrir dans/), 'bloc des applications introuvable').toBeGreaterThan(-1);
    expect(rang(/ne permet pas la feuille/)).toBeLessThan(rang(/Ouvrir dans/));
    expect(rang(/Ouvrir dans/)).toBeLessThan(rang(/Le code d’accès n’est pas partagé/));
  });

  it("garde les applications joignables même sans refus", async () => {
    // Sur un navigateur de bureau sans feuille de partage, l'écran n'affiche
    // aucun message : les applications doivent rester la voie évidente.
    render(<ShareModal booking={RESERVATION} open onClose={vi.fn()} />);

    const texte = document.querySelector('[role=dialog]').textContent;
    expect(texte.search(/Ouvrir dans/)).toBeLessThan(
      texte.search(/Le code d’accès n’est pas partagé/),
    );
  });

  it("ne promet pas des pièces jointes que le navigateur ne joindra pas", async () => {
    // « Le plan de la salle et l'invitation d'agenda sont joints au partage »
    // n'est vrai que par la feuille du système. Sur un navigateur qui la
    // refuse — Brave, Firefox — rien n'est joint à rien, et la phrase
    // décrivait un partage qui n'a pas lieu.
    const ecrit = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: ecrit }, configurable: true });
    Object.defineProperty(navigator, 'canShare', { value: () => false, configurable: true });
    Object.defineProperty(navigator, 'share', {
      value: () => Promise.reject(Object.assign(new Error('refus'), { name: 'NotAllowedError' })),
      configurable: true,
    });

    render(<ShareModal booking={RESERVATION} open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Partager…/ }));
    await screen.findByText(/NotAllowedError/);

    expect(screen.queryByText(/joints au partage/)).toBeNull();
    // À la place, de quoi les joindre soi-même.
    expect(screen.getByRole('button', { name: /Télécharger le plan/ })).toBeTruthy();
  });

  it('ne signale rien quand l’utilisateur ferme la feuille lui-même', async () => {
    // `AbortError` n'est pas un échec : c'est un choix.
    const ecrit = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: ecrit }, configurable: true });
    Object.defineProperty(navigator, 'canShare', { value: () => false, configurable: true });
    Object.defineProperty(navigator, 'share', {
      value: () => Promise.reject(Object.assign(new Error('annule'), { name: 'AbortError' })),
      configurable: true,
    });

    render(<ShareModal booking={RESERVATION} open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Partager…/ }));
    await Promise.resolve();

    expect(screen.queryByText(/refusé le partage/)).toBeNull();
    expect(ecrit).not.toHaveBeenCalled();
  });

  it('ne rend rien sans réservation', () => {
    const { container } = render(<ShareModal booking={null} open onClose={vi.fn()} />);
    expect(container.textContent).toBe('');
  });
});

describe('Consigne de la salle', () => {
  const REGLES = {
    minDurationMin: 30,
    maxDurationMin: 240,
    openTime: '08:00',
    closeTime: '20:00',
    visitDays: [1, 2, 3, 4, 5],
    constraints: ['Durée comprise entre 30 et 240 minutes.'],
    notice: 'Laissez la salle rangée, la clé se retire à l’accueil.',
  };

  const CRENEAU = { start: new Date('2026-09-02T09:00:00Z'), end: new Date('2026-09-02T10:00:00Z') };

  it('s’affiche avant que l’utilisateur confirme', () => {
    // Une consigne que personne ne lit au bon moment ne sert à rien : elle
    // doit être là où l'on décide, pas dans un écran qu'on ouvre après.
    render(<SlotPanel slot={CRENEAU} rules={REGLES} />);

    expect(screen.getByText(/Laissez la salle rangée/)).toBeTruthy();
  });

  it('se distingue des règles calculées', () => {
    // Les phrases de `constraints` sont la traduction des seuils. Noyer la
    // consigne parmi elles la ferait lire comme une phrase générée de plus.
    render(<SlotPanel slot={CRENEAU} rules={REGLES} />);

    expect(screen.getByText('Consigne de la salle')).toBeTruthy();
  });

  it('ne laisse pas d’encadré vide quand il n’y a rien à dire', () => {
    render(<SlotPanel slot={CRENEAU} rules={{ ...REGLES, notice: null }} />);

    expect(screen.queryByText('Consigne de la salle')).toBeNull();
  });
});

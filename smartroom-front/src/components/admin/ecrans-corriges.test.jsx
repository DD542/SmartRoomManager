/**
 * Composants d'administration corrigés après ouverture réelle des écrans.
 *
 * Ces défauts ne cassaient ni la compilation ni un import : ils rendaient une
 * page blanche, une case invisible, ou une action irréversible sans garde-fou.
 * Aucun ne se voit dans un diff — tous se voient à l'écran.
 */

import { describe, expect, it, vi } from 'vitest';
// `fireEvent` et non `user-event` : la liste de dépendances du projet est
// arrêtée, et ces interactions — un clic, une saisie — ne demandent pas la
// simulation fine que la seconde apporterait.
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HttpResponse, http } from 'msw';
// Assertions DOM natives plutôt que `jest-dom` : la liste de dépendances du
// projet est arrêtée, et `toBeTruthy` sur un nœud dit la même chose que
// `toBeInTheDocument`.
import { AlternativeList } from './conflicts/AlternativeList';
import { YearOverview } from './rules/YearOverview';
import { UserDetail } from './people/UserDetail';
import { Pill } from '../ui/Badge';
import { KpiTile } from '../stats/KpiTile';
import { BookingTable } from '../bookings/BookingTable';
import { SANS_DATE, fmtDate, fmtDateLong, fmtRelative, fmtTime } from '../../utils/dates';
import { AccessCodePanel } from '../ui/AccessCode';
import { ToastProvider } from '../../hooks/useToast';
import { serveur } from '../../test/serveur';
import * as adapt from '../../api/adapters';
import { RoomCard } from '../rooms/RoomCard';
import { FloorPlan } from '../rooms/FloorPlan';
import { FloorRoomPicker, RoomLocationPlan } from '../rooms/RoomLocationPlan';
import { SlotPanel } from '../bookings/SlotPanel';
import BookingDetailPage from '../../pages/manage/BookingDetailPage';

describe('Liste des salles de repli', () => {
  const PROPOSITION = {
    kind: 'autre_salle_meme_creneau',
    roomId: 'r-2',
    score: 88,
    justification: 'Même créneau dans Salle Curie.',
    room: { id: 'r-2', name: 'Salle Curie', capacity: 20 },
  };

  it('affiche le nom et la capacité de la salle proposée', () => {
    // Le composant lit `entree.room.id` : sans la salle résolue, il levait
    // « Cannot read properties of undefined » et emportait l'écran entier.
    render(<AlternativeList alternatives={[PROPOSITION]} />);

    expect(screen.getByText('Salle Curie')).toBeTruthy();
    expect(screen.getByText('88/100')).toBeTruthy();
    expect(screen.getByText(/20 pers/)).toBeTruthy();
  });

  it('reste informative quand aucun gestionnaire de sélection n’est fourni', () => {
    render(<AlternativeList alternatives={[PROPOSITION]} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('remonte l’identifiant de la salle choisie, pas celui de la proposition', () => {
    const choisir = vi.fn();
    render(<AlternativeList alternatives={[PROPOSITION]} onSelect={choisir} />);

    fireEvent.click(screen.getByRole('button'));

    expect(choisir).toHaveBeenCalledWith('r-2');
  });

  it('annonce honnêtement l’absence de repli', () => {
    // « Aucune salle disponible » est la bonne réponse quand rien n'est libre
    // sur le créneau : l'arbitre retombe alors sur maintien ou refus.
    render(<AlternativeList alternatives={[]} />);
    expect(screen.getByText(/Aucune salle de repli/)).toBeTruthy();
  });
});

describe('Aperçu annuel des fermetures', () => {
  const JOUR = '2026-03-10';

  const rendre = (nature) =>
    render(
      <YearOverview
        year={2026}
        days={{ [JOUR]: nature }}
        closures={[{ id: 'c-1', label: 'Vacances', from: JOUR, to: JOUR, kind: nature }]}
      />,
    );

  it('teinte la case d’une journée fermée', () => {
    // L'API émet `fermeture` ; le composant mappait `ferme`. `TONS[kind]`
    // valait alors `undefined` : la case gardait le fond de la carte tout en
    // recevant `text-ink`, soit de l'encre sur fond sombre — 1,29:1, invisible.
    // La case marquée porte le motif en `title` : c'est la seule façon de la
    // distinguer des douze grilles mensuelles, où le « 10 » revient partout.
    const { container } = rendre('fermeture');
    const cellule = container.querySelector('[title="Vacances"]');

    expect(cellule).toBeTruthy();
    expect(cellule.className).toContain('bg-danger');
    expect(cellule.className).not.toContain('undefined');
  });

  it('teinte différemment une exception', () => {
    const { container } = rendre('exception');
    const cellule = container.querySelector('[title="Vacances"]');
    expect(cellule.className).toContain('bg-warning');
  });
});

describe('Fiche utilisateur', () => {
  const COMPTE = {
    id: 'u-1',
    firstName: 'Adam',
    lastName: 'David',
    email: 'adam.david@edu.ece.fr',
    promotion: 'B2 Généraliste',
    department: 'Ingénierie',
    badgeNumber: 'B-0042',
    status: 'actif',
    preferences: { weeklyQuotaHours: 12 },
    metrics: {
      bookings: 6,
      noShowRate: 0.2,
      reliabilityScore: 80,
      remainingCreditsH: 6,
      attendanceRate: 0.8,
    },
    recentBookings: [],
  };

  it('exige un motif avant de suspendre', () => {
    // La suspension ferme les sessions ouvertes et bloque toute réservation.
    // Elle partait d'un seul clic, sans confirmation, le motif étant fabriqué
    // par défaut — remplissant le journal d'audit d'entrées interchangeables.
    const suspendre = vi.fn();
    render(<UserDetail user={COMPTE} onStatus={suspendre} onCredits={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Suspendre le compte/ }));

    const modale = screen.getByRole('dialog');
    const valider = within(modale).getByRole('button', { name: 'Suspendre' });
    expect(valider.disabled).toBe(true);
    expect(suspendre).not.toHaveBeenCalled();

    fireEvent.change(within(modale).getByLabelText(/Motif de la décision/), {
      target: { value: 'Trois absences non excusées.' },
    });

    expect(valider.disabled).toBe(false);
    fireEvent.click(valider);
    expect(suspendre).toHaveBeenCalledWith('suspendu', 'Trois absences non excusées.');
  });

  it('laisse renoncer sans rien décider', () => {
    const suspendre = vi.fn();
    render(<UserDetail user={COMPTE} onStatus={suspendre} onCredits={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Suspendre le compte/ }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Annuler' }),
    );

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(suspendre).not.toHaveBeenCalled();
  });
});

describe('Pastille de filtre', () => {
  it('renforce son compteur à l’état actif', () => {
    // `content-faint` sur le fond `accent-soft`, plus clair que la surface, ne
    // donnait que 4:1 — sous le seuil AA. Inactive, le fond reste sombre et la
    // teinte faible passe.
    const { rerender, container } = render(<Pill count={3}>Conflits</Pill>);
    expect(container.querySelector('.text-content-faint')).toBeTruthy();

    rerender(
      <Pill active count={3}>
        Conflits
      </Pill>,
    );
    expect(container.querySelector('.text-content-muted')).toBeTruthy();
    expect(container.querySelector('.text-content-faint')).toBeNull();
  });
});

describe('Formateurs de date', () => {
  it('rend une marque lisible quand la date est absente', () => {
    // Plusieurs colonnes sont nullables et le resteront : une dernière
    // connexion qui n'a jamais eu lieu, une résolution qui n'est pas venue.
    // `format` levait sur la date invalide, et l'exception remontait jusqu'à
    // la frontière d'erreur — un administrateur jamais connecté rendait
    // l'écran des rôles entièrement inaccessible.
    expect(fmtDate(null)).toBe(SANS_DATE);
    expect(fmtDateLong(undefined)).toBe(SANS_DATE);
    expect(fmtRelative(null)).toBe(SANS_DATE);
    expect(fmtTime('')).toBe(SANS_DATE);
  });

  it('formate normalement une date présente', () => {
    expect(fmtDate('2026-08-25T10:00:00Z')).toBe('25/08/2026');
  });

  it('laisse lever sur une valeur malformée', () => {
    // Une valeur absente est un état ; une valeur illisible est un défaut, et
    // la masquer derrière un tiret le rendrait introuvable.
    expect(() => fmtDate('pas une date')).toThrow();
  });
});

describe('Tuile de chiffre clé', () => {
  it('n’abrège pas le libellé qui explique le chiffre', () => {
    // « Occupation moyenne des salles expl… » : la tuile coupait son libellé
    // sur une ligne, et le chiffre ne disait plus de quoi il parlait.
    //
    // L'abrègement est purement visuel — `text-overflow: ellipsis` laisse le
    // texte entier dans le DOM — donc aucune assertion sur le contenu ne peut
    // le voir. Le seul garde-fou mécanique porte sur la classe qui le
    // produisait ; la vérification du rendu s'est faite à l'écran, à 1440 px
    // comme à 375 px.
    render(<KpiTile value="20 %" label="Occupation moyenne des salles exploitables" />);

    const libelle = screen.getByText('Occupation moyenne des salles exploitables');
    expect(libelle.className.split(' ')).not.toContain('truncate');
    expect(libelle.className).not.toMatch(/line-clamp-/);
  });
});

describe('Liste des réservations', () => {
  const RESERVATION = {
    id: 'bk-1',
    title: 'Point projet',
    start: new Date('2026-09-03T12:00:00Z'),
    end: new Date('2026-09-03T13:00:00Z'),
    status: 'confirmee',
    attendees: 4,
    room: { id: 'r-1', name: 'Salle Curie', photos: [] },
  };

  it('affiche un repère quand la salle n’a pas de photo', () => {
    // Un `<img>` sans adresse rendait un cadre vide, sans erreur nulle part.
    const { container } = render(
      <MemoryRouter>
        <BookingTable bookings={[RESERVATION]} isMobile={false} />
      </MemoryRouter>,
    );

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('Salle Curie')).toBeTruthy();
  });

  it('affiche la photo de la salle quand elle existe', () => {
    const { container } = render(
      <MemoryRouter>
        <BookingTable
          bookings={[{ ...RESERVATION, room: { ...RESERVATION.room, photos: ['/media/photos/x.jpg'] } }]}
          isMobile={false}
        />
      </MemoryRouter>,
    );

    expect(container.querySelector('img').getAttribute('src')).toBe('/media/photos/x.jpg');
  });
});

describe('Encart du code d’accès', () => {
  const monter = (props) =>
    render(<AccessCodePanel onReissue={vi.fn()} canReissue {...props} />);

  it('montre le code en clair une seule fois, à son émission', () => {
    monter({ code: 'A-4821', hint: 'A-****', badgeRequired: true });

    expect(screen.getByText('A-4821')).toBeTruthy();
    expect(screen.getByText(/affiché qu’une fois/)).toBeTruthy();
    // Rien à réémettre tant que le code est sous les yeux.
    expect(screen.queryByRole('button', { name: /Émettre/ })).toBeNull();
  });

  it('propose une émission quand plus aucun code n’est actif', () => {
    // L'écran affichait « cette réservation n’est plus active » — faux pour une
    // réservation à venir dont le code avait simplement été révoqué, et sans
    // aucun recours proposé.
    monter({ code: null, hint: null, badgeRequired: true });

    expect(screen.getByText(/Aucun code actif/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Émettre un code' })).toBeTruthy();
  });

  it('n’offre pas d’émission sur une réservation qui n’est plus active', () => {
    // Le serveur refuse d'émettre pour un créneau terminé ou annulé : un bouton
    // ne servirait qu'à produire une erreur.
    monter({ code: null, hint: null, badgeRequired: true, canReissue: false });

    expect(screen.queryByRole('button', { name: /Émettre/ })).toBeNull();
  });

  it('remplace un code encore valable sans jamais prétendre le relire', () => {
    monter({ code: null, hint: 'A-****', badgeRequired: true });

    expect(screen.getByText('A-****')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Émettre un nouveau code' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Révéler/ })).toBeNull();
  });
});

describe('Détail de réservation — code d’accès', () => {
  const BASE = 'http://localhost:5180/api/v1';

  const RESERVATION = {
    id: 'bk-9',
    room_id: 'r-1',
    room_name: 'Salle Curie',
    building_name: 'Bâtiment A',
    floor_label: '2e',
    floor_id: null,
    room_photo_url: null,
    room_location_plan_url: null,
    title: 'Entretien RH',
    slot: { starts_at: '2026-09-03T12:00:00Z', ends_at: '2026-09-03T13:00:00Z' },
    attendees: 2,
    status: 'confirmee',
    source: 'utilisateur',
    is_forced: false,
    checked_in_at: null,
    access_code_hint: null,
    room_badge_required: true,
    events: [],
    participants: [],
  };

  const monter = () =>
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/app/reservations/bk-9']}>
          <Routes>
            <Route path="/app/reservations/:id" element={<BookingDetailPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    );

  it('propose un code quand la salle en demande un et qu’aucun n’est actif', async () => {
    // Le défaut : l'encart était conditionné à l'indice. Une salle passée sous
    // badge après coup — ou un code révoqué — faisait disparaître toute
    // mention du code côté utilisateur, alors que l'administration montrait
    // bien la salle comme exigeant un badge.
    serveur.use(http.get(`${BASE}/bookings/bk-9`, () => HttpResponse.json(RESERVATION)));

    monter();

    expect(await screen.findByRole('button', { name: 'Émettre un code' })).toBeTruthy();
    expect(screen.queryByText(/n’est plus active/)).toBeNull();
  });

  it('affiche le code neuf rendu par le serveur, une seule fois', async () => {
    serveur.use(
      http.get(`${BASE}/bookings/bk-9`, () => HttpResponse.json(RESERVATION)),
      http.post(`${BASE}/bookings/bk-9/access-code`, () =>
        HttpResponse.json({ code: 'C-7310', hint: 'C-****', expires_at: null }),
      ),
    );

    monter();
    fireEvent.click(await screen.findByRole('button', { name: 'Émettre un code' }));

    expect(await screen.findByText('C-7310')).toBeTruthy();
  });

  it('dit franchement qu’une salle sans badge n’a pas de code', async () => {
    serveur.use(
      http.get(`${BASE}/bookings/bk-9`, () =>
        HttpResponse.json({ ...RESERVATION, room_badge_required: false }),
      ),
    );

    monter();

    expect(await screen.findByText(/Accès libre/)).toBeTruthy();
  });
});

describe('Carte de salle du tunnel de réservation', () => {
  // La forme servie par `/recommendations`, passée par l'adaptateur.
  const PROPOSEE = adapt.roomSummary({
    id: 'r-7',
    name: 'Salle Fermat',
    capacity: 10,
    building_id: 'b-1',
    floor_level: 2,
    equipment_ids: [],
    is_accessible: true,
    is_available: true,
    occupancy_percent: 23,
    building_name: 'Eiffel 1',
    floor_label: '2e',
    area_m2: '34.50',
    photo_url: '/media/photos/fermat.jpg',
  });

  it('affiche le bâtiment, l’étage et la surface servis par le moteur', () => {
    // Le résumé du classement ne portait ni bâtiment, ni étage, ni surface :
    // la carte, écrite pour la fiche complète, affichait « • • undefined m² ».
    render(
      <MemoryRouter>
        <RoomCard room={PROPOSEE} />
      </MemoryRouter>,
    );

    expect(screen.getByText(/Eiffel 1 • 2e • 34.5 m²/)).toBeTruthy();
    expect(screen.queryByText(/undefined/)).toBeNull();
  });

  it('affiche la photo de la salle proposée', () => {
    const { container } = render(
      <MemoryRouter>
        <RoomCard room={PROPOSEE} />
      </MemoryRouter>,
    );

    expect(container.querySelector('img').getAttribute('src')).toBe('/media/photos/fermat.jpg');
  });

  it('remplace l’image manquante par un repère, sans cadre vide', () => {
    const { container } = render(
      <MemoryRouter>
        <RoomCard room={{ ...PROPOSEE, photos: [] }} />
      </MemoryRouter>,
    );

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('Salle Fermat')).toBeTruthy();
  });

  it('n’écrit pas de séparateur pour une information absente', () => {
    render(
      <MemoryRouter>
        <RoomCard room={{ ...PROPOSEE, building: null, area: null }} />
      </MemoryRouter>,
    );

    expect(screen.getByText('2e')).toBeTruthy();
    expect(screen.queryByText(/•/)).toBeNull();
  });
});

describe('Plan d’étage', () => {
  const SALLE = {
    id: 'r-1',
    name: 'Salle Vinci',
    floor: '2e',
    capacity: 12,
    status: 'disponible',
    plan: { x: 10, y: 10, w: 20, h: 15, rotation: 0, entrance: true },
  };

  const PLAN = {
    id: 'f-1',
    label: 'Eiffel 1 — 2e étage',
    corridors: [],
    entrance: null,
    legend: [],
    rooms: [SALLE],
  };

  it('se dessine sans entrée déclarée', () => {
    // `getFloorPlan` rend toujours `entrance: null` — l'API n'a jamais servi
    // d'entrée d'étage. Le composant la lisait sans vérifier : toute la page
    // tombait sur « Cannot read properties of null (reading 'x') » dès qu'un
    // étage n'avait pas d'image de plan déposée.
    render(<FloorPlan plan={PLAN} rooms={[SALLE]} />);

    expect(screen.getByRole('button', { name: /Salle Vinci/ })).toBeTruthy();
  });

  it('dessine l’entrée quand le plan en porte une', () => {
    render(
      <FloorPlan
        plan={{ ...PLAN, entrance: { x: 5, y: 90, w: 8, h: 4, label: 'Entrée nord' } }}
        rooms={[SALLE]}
      />,
    );

    expect(screen.getByText('Entrée nord')).toBeTruthy();
  });
});

describe('Plan de localisation côté utilisateur', () => {
  const SALLE = {
    id: 'r-3',
    name: 'Salle Hopper',
    floor: '2e étage',
    locationPlanUrl: '/media/reperes/hopper.png',
  };

  it('montre le plan déposé pour la salle choisie', () => {
    // L'administration consultait ces images ; l'écran utilisateur ne
    // connaissait que le plan d'étage, rarement déposé, et retombait sur son
    // schéma indicatif.
    render(
      <RoomLocationPlan room={SALLE} onBack={() => {}}>
        <p>schéma indicatif</p>
      </RoomLocationPlan>,
    );

    const image = screen.getByRole('img', { name: /Plan de localisation de Salle Hopper/ });
    expect(image.getAttribute('src')).toBe('/media/reperes/hopper.png');
    expect(screen.queryByText('schéma indicatif')).toBeNull();
  });

  it('laisse le schéma quand la salle n’a pas de plan', () => {
    render(
      <RoomLocationPlan room={{ ...SALLE, locationPlanUrl: null }}>
        <p>schéma indicatif</p>
      </RoomLocationPlan>,
    );

    expect(screen.getByText('schéma indicatif')).toBeTruthy();
  });

  it('laisse le schéma tant qu’aucune salle n’est choisie', () => {
    render(
      <RoomLocationPlan room={null}>
        <p>schéma indicatif</p>
      </RoomLocationPlan>,
    );

    expect(screen.getByText('schéma indicatif')).toBeTruthy();
  });

  it('permet d’atteindre une salle absente du schéma', () => {
    // Une salle sans position n'est pas dessinée : sans cette liste, rien ne
    // permettait de l'ouvrir.
    const choisir = vi.fn();
    render(
      <FloorRoomPicker
        rooms={[SALLE, { id: 'r-4', name: 'Salle Curie', locationPlanUrl: null }]}
        onSelect={choisir}
      />,
    );

    expect(screen.getByText(/2 salles — 1 plan déposé/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Salle Curie/ }));
    expect(choisir).toHaveBeenCalledWith(expect.objectContaining({ id: 'r-4' }));
  });
});

describe('Rail de vérification du créneau', () => {
  const CONFLIT = adapt.conflict({
    booking_id: 'bk-7',
    title: 'Revue de sprint',
    kind: 'chevauchement',
    overlap_minutes: 30,
    blocking: true,
    message: 'Ce créneau recouvre une réservation existante.',
    slot: { starts_at: '2026-09-02T12:00:00Z', ends_at: '2026-09-02T13:30:00Z' },
  });

  const CRENEAU = {
    start: new Date('2026-09-02T13:00:00Z'),
    end: new Date('2026-09-02T14:00:00Z'),
  };

  // Le rail porte des boutons-liens : sans routeur, ils lèvent avant même que
  // le conflit soit rendu.
  const rendre = (element) => render(<MemoryRouter>{element}</MemoryRouter>);

  it('affiche un conflit au lieu d’emporter l’écran', () => {
    // L'écran lisait `conflit.booking.id` — la forme des maquettes. Le premier
    // conflit rencontré faisait tomber tout le tunnel de réservation sur
    // « Cannot read properties of undefined (reading 'id') ».
    rendre(<SlotPanel slot={CRENEAU} conflicts={[CONFLIT]} />);

    expect(screen.getByText(/recouvre une réservation existante/)).toBeTruthy();
    expect(screen.getByText('Conflit détecté')).toBeTruthy();
  });

  it('affiche un conflit qui n’oppose aucune réservation', () => {
    // Fermeture, battement contre une plage close : `bookingId` est alors nul,
    // et la clé doit tenir quand même.
    const fermeture = adapt.conflict({
      booking_id: null,
      kind: 'fermeture',
      blocking: true,
      message: 'La salle est fermée sur ce créneau.',
      slot: { starts_at: '2026-09-02T12:00:00Z', ends_at: '2026-09-02T13:30:00Z' },
    });

    rendre(<SlotPanel slot={CRENEAU} conflicts={[fermeture]} />);

    expect(screen.getByText(/La salle est fermée/)).toBeTruthy();
  });

  it('sépare les conflits bloquants des simples avertissements', () => {
    const battement = adapt.conflict({
      booking_id: 'bk-9',
      kind: 'battement',
      blocking: false,
      message: 'Il ne reste que 5 minutes entre deux réunions.',
      slot: { starts_at: '2026-09-02T14:00:00Z', ends_at: '2026-09-02T15:00:00Z' },
    });

    rendre(<SlotPanel slot={CRENEAU} conflicts={[CONFLIT, battement]} />);

    expect(screen.getByText('Conflit détecté')).toBeTruthy();
    expect(screen.getByText('Conflit potentiel')).toBeTruthy();
  });
});

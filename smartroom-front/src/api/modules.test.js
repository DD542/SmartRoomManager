/**
 * Modules d'appel : ce que chaque écran demande à l'API.
 *
 * Les tests portent sur la **jonction** — le chemin appelé, les paramètres
 * envoyés, la forme rendue aux écrans. Pas sur la logique métier, qui vit côté
 * serveur et y est éprouvée.
 *
 * Ce que ces tests attrapent : un paramètre mal nommé, un chemin qui a bougé,
 * une réponse mal transcrite. Autant de défauts qui ne cassent rien à la
 * compilation et se manifestent par un écran vide.
 */

import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { erreur, page, serveur } from '../test/serveur';
import { setAccessToken } from './client';
import * as auth from './auth';
import * as rooms from './rooms';
import * as buildings from './buildings';
import * as availability from './availability';
import * as bookings from './bookings';
import * as checkin from './checkin';
import * as equipment from './equipment';
import * as notifications from './notifications';
import * as recommendations from './recommendations';
import * as stats from './stats';
import * as tickets from './tickets';
import * as search from './search';
import * as chatbot from './chatbot';

const BASE = 'http://localhost:5180/api/v1';

const SALLE = {
  id: 'r-1',
  name: 'Salle Vinci',
  slug: 'salle-vinci',
  building_id: 'b-1',
  building_name: 'Campus Eiffel',
  floor_id: 'f-1',
  floor_label: '2e étage',
  floor_level: 2,
  capacity: 12,
  area_m2: '28.00',
  status: 'disponible',
  is_accessible: true,
  badge_required: false,
  description: 'Salle de réunion',
  occupancy_percent: 72,
  equipments: [],
  photos: [],
};

const CRENEAU = {
  starts_at: '2026-08-25T12:30:00Z',
  ends_at: '2026-08-25T13:30:00Z',
  duration_minutes: 60,
  local_label: '25/08 14:30–15:30',
};

const RESERVATION = {
  id: 'bk-1',
  room_id: 'r-1',
  owner_id: 'u-1',
  title: 'Revue de sprint',
  slot: CRENEAU,
  attendees: 4,
  status: 'confirmee',
  source: 'utilisateur',
  is_forced: false,
  checked_in_at: null,
  cancelled_at: null,
  cancel_reason: null,
  room_name: 'Salle Vinci',
  building_name: 'Campus Eiffel',
  floor_label: '2e étage',
  owner_name: 'Camille Durand',
  access_code_hint: 'A-****',
};

const REGLES = {
  id: 'br-1',
  scope: 'salle',
  building_id: null,
  room_id: 'r-1',
  min_duration_min: 30,
  max_duration_min: 240,
  buffer_min: 15,
  max_advance_days: 60,
  min_advance_min: 15,
  cancel_deadline_min: 60,
  checkin_window_min: 10,
  weekly_quota_hours: 12,
  max_active_bookings: 10,
  validation_capacity_threshold: 20,
};

const HORAIRES = Array.from({ length: 7 }, (_, jour) => ({
  id: `o-${jour}`,
  scope: 'salle',
  building_id: null,
  room_id: 'r-1',
  weekday: jour,
  is_open: jour >= 1 && jour <= 5,
  opens_at: '08:00:00',
  closes_at: '20:00:00',
}));

/** Les deux appels que fait toute lecture de règles de salle. */
const servirRegles = () => [
  http.get(`${BASE}/rooms/r-1/booking-rules`, () => HttpResponse.json(REGLES)),
  http.get(`${BASE}/rooms/r-1/opening-hours`, () => HttpResponse.json(HORAIRES)),
];

describe('authentification', () => {
  it('ouvre une session et pose le jeton en mémoire', async () => {
    serveur.use(
      http.post(`${BASE}/auth/login`, () =>
        HttpResponse.json({
          access_token: 'jeton',
          scope: 'user',
          user: { id: 'u-1', email: 'camille@edu.ece.fr', first_name: 'Camille', last_name: 'Durand' },
        }),
      ),
    );

    const { user, firstLogin } = await auth.login({
      email: 'camille@edu.ece.fr',
      password: 'smartroom2026',
    });
    expect(user.email).toBe('camille@edu.ece.fr');
    // Sans bâtiment de préférence, le compte n'a jamais rempli l'accueil :
    // c'est ce qui déclenche l'onboarding, plutôt qu'un drapeau inventé.
    expect(firstLogin).toBe(true);
  });

  it('n’ouvre pas l’onboarding pour un compte déjà configuré', async () => {
    serveur.use(
      http.post(`${BASE}/auth/login`, () =>
        HttpResponse.json({
          access_token: 'jeton',
          scope: 'user',
          user: { id: 'u-1', email: 'x@ece.fr', preferences: { preferred_building_id: 'b-1' } },
        }),
      ),
    );

    const { firstLogin } = await auth.login({ email: 'x@ece.fr', password: 'x' });
    expect(firstLogin).toBe(false);
  });

  it('dit si la connexion Google est active sur ce serveur', async () => {
    // Le front n'affiche pas de bouton tant que le serveur n'a pas répondu :
    // un bouton qui échoue à chaque clic fait croire à une panne là où il n'y
    // a qu'une option non activée.
    serveur.use(
      http.get(`${BASE}/auth/google/config`, () =>
        HttpResponse.json({ enabled: true, client_id: 'abc.apps.googleusercontent.com' }),
      ),
    );

    await expect(auth.getGoogleConfig()).resolves.toEqual({
      enabled: true,
      clientId: 'abc.apps.googleusercontent.com',
    });
  });

  it('échange le jeton Google contre une session', async () => {
    serveur.use(
      http.post(`${BASE}/auth/google`, () =>
        HttpResponse.json({
          access_token: 'jeton',
          expires_in: 900,
          scope: 'user',
          created: true,
          user: {
            id: 'u-9',
            email: 'nouvelle@gmail.com',
            first_name: 'Nouvelle',
            last_name: 'Personne',
          },
        }),
      ),
    );

    const resultat = await auth.loginWithGoogle('jeton-google');

    expect(resultat.user.email).toBe('nouvelle@gmail.com');
    // Un compte créé n'a aucune préférence : il part remplir son accueil.
    expect(resultat.created).toBe(true);
    expect(resultat.firstLogin).toBe(true);
  });

  it('rend la session courante et ses permissions', async () => {
    serveur.use(
      http.get(`${BASE}/auth/me`, () =>
        HttpResponse.json({
          user: { id: 'u-1', email: 'lea@ece.fr', first_name: 'Léa', last_name: 'Martin' },
          admin: { user_id: 'u-1', job_title: 'Responsable', is_owner: false },
          scope: 'admin',
          permissions: ['rooms.manage'],
        }),
      ),
    );

    const session = await auth.session();
    expect(session.permissions).toEqual(['rooms.manage']);
    expect(session.admin.jobTitle).toBe('Responsable');
  });

  it('ferme la session même si le serveur ne répond pas', async () => {
    // L'utilisateur a demandé à partir : l'écran ne doit pas le retenir.
    serveur.use(
      http.post(`${BASE}/auth/logout`, () => HttpResponse.error()),
    );
    setAccessToken('jeton');

    await expect(auth.logout()).resolves.toBeUndefined();
  });

  it('répond pareil pour une adresse connue ou inconnue', async () => {
    serveur.use(
      // 202 avec un corps, comme le rend l'API : elle ne dit jamais si
      // l'adresse existe, mais elle répond.
      http.post(`${BASE}/auth/forgot-password`, () =>
        HttpResponse.json({ status: 'accepted' }, { status: 202 }),
      ),
    );

    await expect(auth.forgotPassword('inconnu@ece.fr')).resolves.toMatchObject({ sent: true });
  });

  it('consomme un lien de réinitialisation', async () => {
    serveur.use(
      http.post(`${BASE}/auth/reset-password`, () => new HttpResponse(null, { status: 204 })),
    );

    await expect(auth.resetPassword({ token: 'abc', password: 'nouveau' })).resolves.toMatchObject({
      reset: true,
    });
  });

  it('abandonne le jeton après un changement de mot de passe', async () => {
    // Toutes les sessions tombent côté serveur : le garder localement
    // laisserait l'écran croire à une session encore ouverte.
    serveur.use(
      http.post(`${BASE}/auth/change-password`, () => new HttpResponse(null, { status: 204 })),
    );
    setAccessToken('jeton');

    await auth.changePassword({ currentPassword: 'a', newPassword: 'b' });
    const { getAccessToken } = await import('./client');
    expect(getAccessToken()).toBeNull();
  });

  it('met à jour le profil sous les noms de colonnes de l’API', async () => {
    let recu = null;
    serveur.use(
      http.patch(`${BASE}/users/me`, async ({ request }) => {
        recu = await request.json();
        return HttpResponse.json({ id: 'u-1', email: 'x@ece.fr', first_name: 'Camille' });
      }),
    );

    await auth.updateProfile(null, { firstName: 'Camille', phone: '06' });
    expect(recu).toMatchObject({ first_name: 'Camille', phone: '06' });
  });

  it('enregistre les préférences et rend le profil complet', async () => {
    serveur.use(
      http.put(`${BASE}/users/me/preferences`, () =>
        HttpResponse.json({
          id: 'u-1',
          email: 'x@ece.fr',
          preferences: { reminder_delay_min: 60 },
        }),
      ),
    );

    const compte = await auth.savePreferences(null, { reminderDelayMin: 60 });
    expect(compte.preferences.reminderDelayMin).toBe(60);
  });
});

describe('parc', () => {
  it('traduit les filtres d’écran en paramètres de requête', async () => {
    let recus = null;
    serveur.use(
      http.get(`${BASE}/rooms`, ({ request }) => {
        recus = new URL(request.url).searchParams;
        return HttpResponse.json(page([SALLE]));
      }),
    );

    await rooms.listRooms({ capacity: 8, building: 'b-1', equipment: ['eq-1'], accessibleOnly: true });
    expect(recus.get('min_capacity')).toBe('8');
    expect(recus.get('building_id')).toBe('b-1');
    expect(recus.getAll('equipment_ids')).toEqual(['eq-1']);
    expect(recus.get('accessible_only')).toBe('true');
  });

  it('compose la fiche salle depuis trois ressources', async () => {
    serveur.use(
      http.get(`${BASE}/rooms/r-1`, () => HttpResponse.json(SALLE)),
      http.get(`${BASE}/buildings/b-1`, () =>
        HttpResponse.json({ id: 'b-1', code: 'A', name: 'Campus Eiffel', address: 'Paris' }),
      ),
      ...servirRegles(),
    );

    const salle = await rooms.getRoom('r-1');
    expect(salle.building.name).toBe('Campus Eiffel');
    expect(salle.rules.openTime).toBe('08:00');
    expect(salle.rules.visitDays).toEqual([1, 2, 3, 4, 5]);
  });

  it('mesure les valeurs proposées par les filtres sur le parc réel', async () => {
    serveur.use(
      http.get(`${BASE}/rooms/filters`, () =>
        HttpResponse.json({
          buildings: [{ id: 'b-1', code: 'A', name: 'Campus', floor_count: 1, room_count: 2 }],
          floors: [{ id: 'f-1', building_id: 'b-1', code: 'R2', label: '2e', level: 2 }],
          equipments: [{ id: 'eq-1', code: 'video', label: 'Vidéo', category: 'audiovisuel', icon: 'p' }],
          statuses: ['disponible'],
          capacity_min: 4,
          capacity_max: 30,
        }),
      ),
    );

    const filtres = await rooms.getRoomFilters();
    expect(filtres.capacityMax).toBe(30);
    expect(filtres.equipment[0].label).toBe('Vidéo');
  });

  it('rend les créneaux libres d’une salle sur une période', async () => {
    serveur.use(
      http.get(`${BASE}/availability/rooms/r-1/free-slots`, () =>
        HttpResponse.json({
          room_id: 'r-1',
          first_day: '2026-08-25',
          last_day: '2026-08-25',
          slots: [CRENEAU],
        }),
      ),
    );

    const libres = await rooms.getRoomAvailability('r-1', { from: '2026-08-25' });
    expect(libres.slots).toHaveLength(1);
    expect(libres.slots[0].durationMin).toBe(60);
  });

  it('rend une occupation nulle pour une salle absente du classement', async () => {
    serveur.use(
      http.get(`${BASE}/admin/stats/rooms`, () => HttpResponse.json([])),
    );

    const occupation = await rooms.getRoomOccupancy('r-1');
    expect(occupation.occupancyRate).toBe(0);
  });

  it('déduit les salles favorites des réservations passées', async () => {
    serveur.use(
      http.get(`${BASE}/bookings`, () =>
        HttpResponse.json(
          page([
            { ...RESERVATION, id: 'bk-1', room_id: 'r-1' },
            { ...RESERVATION, id: 'bk-2', room_id: 'r-1' },
            { ...RESERVATION, id: 'bk-3', room_id: 'r-2', status: 'annulee' },
          ]),
        ),
      ),
      http.get(`${BASE}/rooms/r-1`, () => HttpResponse.json(SALLE)),
      http.get(`${BASE}/buildings/b-1`, () =>
        HttpResponse.json({ id: 'b-1', code: 'A', name: 'Campus', address: null }),
      ),
      ...servirRegles(),
    );

    const favorites = await rooms.listFavoriteRooms(null, { limit: 1 });
    // La salle annulée ne compte pas : un favori se mesure à l'usage réel.
    expect(favorites).toHaveLength(1);
    expect(favorites[0].id).toBe('r-1');
  });

  it('rend le référentiel des équipements', async () => {
    serveur.use(
      http.get(`${BASE}/equipments`, () =>
        HttpResponse.json(page([{ id: 'eq-1', code: 'video', label: 'Vidéo', category: 'audiovisuel', icon: 'p' }])),
      ),
    );

    expect(await equipment.listEquipment()).toHaveLength(1);
  });
});

describe('plan d’étage', () => {
  it('ne demande pas le plan déposé en même temps que les salles', async () => {
    // Deux requêtes pour une réponse, et deux 404 rouges dans la console pour
    // un étage sans plan — état normal — dont personne ne lisait le résultat :
    // l'écran demande déjà le document par `getPlanDocumentForPlan`.
    const chemins = [];
    serveur.use(
      http.get(`${BASE}/rooms`, ({ request }) => {
        chemins.push(new URL(request.url).pathname);
        return HttpResponse.json(page([]));
      }),
      http.get(`${BASE}/floors/:id/plan`, ({ request }) => {
        chemins.push(new URL(request.url).pathname);
        return HttpResponse.json(erreur('introuvable', 'Aucun plan.'), { status: 404 });
      }),
    );

    await buildings.getFloorPlan('f-1');

    expect(chemins).toEqual(['/api/v1/rooms']);
  });

  it('ne demande rien quand la liste dit qu’aucun plan n’est déposé', async () => {
    let appele = false;
    serveur.use(
      http.get(`${BASE}/floors/:id/plan`, () => {
        appele = true;
        return HttpResponse.json({});
      }),
    );

    expect(await buildings.getPlanDocumentForPlan('f-1', { exists: false })).toBeNull();
    expect(appele).toBe(false);
  });

  it('écarte du plan les salles sans position', async () => {
    // Le plan dessine des rectangles à des coordonnées : une salle que
    // l'administration n'a pas posée n'en a aucune, et l'écran lisait
    // `salle.plan.x` dessus.
    const salle = (id, placement) => ({
      id,
      name: `Salle ${id}`,
      floor_id: 'f-1',
      building_id: 'b-1',
      building_name: 'Eiffel 1',
      floor_label: '2e étage',
      capacity: 10,
      area_m2: '30',
      status: 'disponible',
      is_accessible: true,
      placement,
    });
    serveur.use(
      http.get(`${BASE}/rooms`, () =>
        HttpResponse.json(
          page([
            salle('r-1', { pos_x: 10, pos_y: 10, width: 20, height: 15, rotation: 0 }),
            salle('r-2', null),
          ]),
        ),
      ),
    );

    const plan = await buildings.getFloorPlan('f-1');

    expect(plan.rooms.map((item) => item.id)).toEqual(['r-1']);
    expect(plan.unplaced).toBe(1);
  });
});

describe('disponibilité', () => {
  it('compose la grille d’une journée depuis les trous et les réservations', async () => {
    serveur.use(
      ...servirRegles(),
      http.get(`${BASE}/availability/rooms/r-1/free-slots`, () =>
        HttpResponse.json({ room_id: 'r-1', slots: [CRENEAU] }),
      ),
      http.get(`${BASE}/availability/calendar`, () => HttpResponse.json({ events: [] })),
    );

    const journee = await availability.getDayAvailability('r-1', '2026-08-25');
    expect(journee.rules.openTime).toBe('08:00');
    // Pas de 30 minutes entre 08:00 et 20:00 : vingt-quatre cases.
    expect(journee.slots).toHaveLength(24);
    expect(journee.slots.every((item) => ['libre', 'occupe', 'ferme'].includes(item.state))).toBe(true);
  });

  it('marque occupées les cases couvertes par une réservation', async () => {
    serveur.use(
      ...servirRegles(),
      http.get(`${BASE}/availability/rooms/r-1/free-slots`, () =>
        HttpResponse.json({ room_id: 'r-1', slots: [] }),
      ),
      http.get(`${BASE}/availability/calendar`, () =>
        HttpResponse.json({
          events: [
            {
              id: 'bk-1',
              room_id: 'r-1',
              title: 'Comité',
              start: '2026-08-25T12:30:00Z',
              end: '2026-08-25T13:30:00Z',
              status: 'confirmee',
              is_mine: true,
              is_blocking: false,
            },
          ],
        }),
      ),
    );

    const journee = await availability.getDayAvailability('r-1', '2026-08-25');
    expect(journee.slots.some((item) => item.state === 'occupe')).toBe(true);
    expect(journee.bookings[0].title).toBe('Comité');
  });

  it('rend les réservations d’une plage pour le calendrier', async () => {
    serveur.use(
      ...servirRegles(),
      http.get(`${BASE}/availability/calendar`, () => HttpResponse.json({ events: [] })),
    );

    const plage = await availability.getAvailabilityRange(
      'r-1',
      '2026-08-25T00:00:00Z',
      '2026-08-26T00:00:00Z',
    );
    expect(plage.hours).toHaveLength(12);
    expect(plage.bookings).toEqual([]);
  });

  it('rend le prochain créneau libre, borné à une heure', async () => {
    serveur.use(
      http.get(`${BASE}/availability/rooms/r-1/free-slots`, () =>
        HttpResponse.json({
          room_id: 'r-1',
          slots: [{ ...CRENEAU, starts_at: '2099-01-01T08:00:00Z', ends_at: '2099-01-01T12:00:00Z' }],
        }),
      ),
    );

    const suivant = await availability.getNextFreeSlot('r-1', '2026-08-25');
    expect(suivant.end - suivant.start).toBe(3_600_000);
  });

  it('rend null quand aucun trou ne reste à venir', async () => {
    serveur.use(
      http.get(`${BASE}/availability/rooms/r-1/free-slots`, () =>
        HttpResponse.json({ room_id: 'r-1', slots: [] }),
      ),
    );

    expect(await availability.getNextFreeSlot('r-1', '2026-08-25')).toBeNull();
  });

  it('marque les salles inéligibles sans les retirer de la recherche', async () => {
    serveur.use(
      http.post(`${BASE}/availability/search`, () =>
        HttpResponse.json([
          { room: { id: 'r-1', name: 'Vinci', capacity: 12 }, score: 40, eligible: false, justification: 'Occupée' },
        ]),
      ),
    );

    const resultats = await availability.searchRooms({ attendees: 4 });
    // Leur absence pure et simple laisserait croire que la salle n'existe pas.
    expect(resultats[0].eligible).toBe(false);
    expect(resultats[0].justification).toBe('Occupée');
  });

  it('n’envoie pas un bâtiment vide à la recherche', async () => {
    let recu = null;
    serveur.use(
      http.post(`${BASE}/availability/search`, async ({ request }) => {
        recu = await request.json();
        return HttpResponse.json([]);
      }),
    );

    await availability.searchRooms({ attendees: 4, buildingId: '' });
    expect(recu.building_id).toBeNull();
  });
});

describe('réservations', () => {
  it('liste les siennes et les transcrit', async () => {
    serveur.use(http.get(`${BASE}/bookings`, () => HttpResponse.json(page([RESERVATION]))));

    const liste = await bookings.listBookings();
    expect(liste[0].room.name).toBe('Salle Vinci');
  });

  it('rend la prochaine réservation à venir, ou rien', async () => {
    serveur.use(http.get(`${BASE}/bookings`, () => HttpResponse.json(page([]))));
    expect(await bookings.getNextBooking()).toBeNull();
  });

  it('passe par le calendrier pour les réservations d’une salle', async () => {
    // `GET /bookings` ne rend que les siennes : les réservations d'une salle
    // appartiennent à tout le monde.
    let chemin = null;
    serveur.use(
      http.get(`${BASE}/availability/calendar`, ({ request }) => {
        chemin = new URL(request.url).pathname;
        return HttpResponse.json({ events: [] });
      }),
    );

    await bookings.listRoomBookings('r-1');
    expect(chemin).toBe('/api/v1/availability/calendar');
  });

  it('rend un verdict de créneau sans alternative quand il est libre', async () => {
    serveur.use(
      http.post(`${BASE}/availability/rooms/r-1/check`, () =>
        HttpResponse.json({ available: true, forcible: false, requires_validation: false }),
      ),
    );

    const verdict = await bookings.checkSlot({
      roomId: 'r-1',
      start: new Date('2026-08-25T10:00:00Z'),
      end: new Date('2026-08-25T11:00:00Z'),
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.alternatives).toEqual([]);
  });

  it('demande des alternatives dès qu’un conflit bloque', async () => {
    serveur.use(
      http.post(`${BASE}/availability/rooms/r-1/check`, () =>
        HttpResponse.json({
          available: false,
          forcible: false,
          requires_validation: false,
          conflicts: [{ booking_id: 'bk-1', kind: 'identique', overlap_minutes: 60, blocking: true }],
          violations: [],
        }),
      ),
      http.post(`${BASE}/recommendations/rooms/r-1/alternatives`, () =>
        HttpResponse.json([
          { kind: 'meme_salle_autre_creneau', room_id: 'r-1', score: 81, justification: 'Plus tard', slot: CRENEAU },
        ]),
      ),
    );

    const verdict = await bookings.checkSlot({
      roomId: 'r-1',
      start: new Date('2026-08-25T10:00:00Z'),
      end: new Date('2026-08-25T11:00:00Z'),
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.alternatives).toHaveLength(1);
  });

  it('n’efface pas le conflit si les alternatives échouent', async () => {
    // Le refus prime : l'écran doit l'afficher, même sans consolation.
    serveur.use(
      http.post(`${BASE}/availability/rooms/r-1/check`, () =>
        HttpResponse.json({
          available: false,
          forcible: false,
          requires_validation: false,
          conflicts: [{ booking_id: 'bk-1', kind: 'identique', overlap_minutes: 60, blocking: true }],
          violations: [],
        }),
      ),
      http.post(`${BASE}/recommendations/rooms/r-1/alternatives`, () =>
        HttpResponse.json(erreur('erreur', 'Indisponible.'), { status: 500 }),
      ),
    );

    const verdict = await bookings.checkSlot({
      roomId: 'r-1',
      start: new Date('2026-08-25T10:00:00Z'),
      end: new Date('2026-08-25T11:00:00Z'),
    });
    expect(verdict.conflicts).toHaveLength(1);
    expect(verdict.alternatives).toEqual([]);
  });

  it('crée une réservation et rend son code d’accès', async () => {
    let recu = null;
    serveur.use(
      http.post(`${BASE}/bookings`, async ({ request }) => {
        recu = await request.json();
        return HttpResponse.json({
          booking: RESERVATION,
          access_code: { code: 'A-4821', hint: 'A-****', expires_at: CRENEAU.ends_at },
        });
      }),
    );

    const creee = await bookings.createBooking({
      roomId: 'r-1',
      start: new Date('2026-08-25T10:00:00Z'),
      end: new Date('2026-08-25T11:00:00Z'),
      title: 'Revue',
      attendees: 4,
      participants: [{ email: 'invite@ece.fr', name: 'Invité' }],
    });

    expect(recu.participants).toEqual([['invite@ece.fr', 'Invité']]);
    expect(creee.accessCode).toBe('A-4821');
  });

  it('laisse remonter un 409 avec son conflit et ses alternatives', async () => {
    serveur.use(
      http.post(`${BASE}/bookings`, () =>
        HttpResponse.json(
          erreur('conflit', 'Créneau pris.', {
            conflict: { kind: 'identique', overlap_minutes: 60, blocking: true },
            alternatives: [{ kind: 'meme_salle_autre_creneau', score: 81 }],
          }),
          { status: 409 },
        ),
      ),
    );

    const refus = await bookings
      .createBooking({ roomId: 'r-1', start: new Date(), end: new Date() })
      .catch((e) => e);
    expect(refus.status).toBe(409);
    expect(refus.conflict.kind).toBe('identique');
  });

  it('traduit la récurrence de l’écran vers le corps du serveur', async () => {
    let recu = null;
    serveur.use(
      http.post(`${BASE}/bookings/recurring/preview`, async ({ request }) => {
        recu = await request.json();
        return HttpResponse.json({
          occurrences: [{ slot: CRENEAU, accepted: true, reason: null }],
          accepted_count: 1,
          rejected_count: 0,
        });
      }),
    );

    const apercu = await bookings.previewSeries({
      roomId: 'r-1',
      date: '2026-08-25',
      startTime: '14:00',
      endTime: '15:00',
      rule: { freq: 'hebdomadaire', interval: 1, weekdays: [2], until: '2026-09-29' },
    });

    expect(recu.byweekday).toEqual([2]);
    expect(apercu.acceptedCount).toBe(1);
  });

  it('crée une série et rend les occurrences écartées', async () => {
    serveur.use(
      http.post(`${BASE}/bookings/recurring`, () =>
        HttpResponse.json({
          rule_id: 'rr-1',
          bookings: [RESERVATION],
          skipped: [{ slot: CRENEAU, reason: 'Créneau pris' }],
        }),
      ),
    );

    const serie = await bookings.createSeries({
      roomId: 'r-1',
      date: '2026-08-25',
      startTime: '14:00',
      endTime: '15:00',
      rule: { freq: 'hebdomadaire' },
    });
    expect(serie.skipped[0].reason).toBe('Créneau pris');
  });

  it('n’envoie que les champs modifiés', async () => {
    let recu = null;
    serveur.use(
      http.patch(`${BASE}/bookings/bk-1`, async ({ request }) => {
        recu = await request.json();
        return HttpResponse.json(RESERVATION);
      }),
    );

    await bookings.updateBooking('bk-1', { title: 'Nouveau titre' });
    expect(recu).toEqual({ title: 'Nouveau titre' });
  });

  it('assemble le motif d’annulation depuis le choix et le commentaire', async () => {
    let recu = null;
    serveur.use(
      http.post(`${BASE}/bookings/bk-1/cancel`, async ({ request }) => {
        recu = await request.json();
        return HttpResponse.json({ ...RESERVATION, status: 'annulee' });
      }),
    );

    await bookings.cancelBooking('bk-1', { reason: 'reporte', comment: 'Décalée à jeudi' });
    expect(recu.reason).toBe('Réunion reportée — Décalée à jeudi');
  });

  it('refuse une annulation sans motif, sans appeler le serveur', async () => {
    // Le serveur l'exige aussi ; le refuser ici évite un aller-retour et un
    // message d'erreur technique là où une phrase suffit.
    await expect(bookings.cancelBooking('bk-1', { reason: '' })).rejects.toMatchObject({
      code: 'motif_requis',
    });
  });

  it('propose une liste de motifs stable', async () => {
    const motifs = await bookings.listCancelReasons();
    expect(motifs.map((item) => item.id)).toContain('reporte');
  });

  it('gère les participants d’une réservation', async () => {
    serveur.use(
      http.get(`${BASE}/bookings/bk-1/participants`, () =>
        HttpResponse.json([
          { id: 'p-1', booking_id: 'bk-1', email: 'a@ece.fr', display_name: 'A', response: 'en_attente', is_organizer: false },
        ]),
      ),
      http.post(`${BASE}/bookings/bk-1/participants`, () =>
        HttpResponse.json({
          participant: { id: 'p-2', booking_id: 'bk-1', email: 'b@ece.fr', display_name: 'B', response: 'en_attente', is_organizer: false },
          invitation_token: 'jeton-invitation',
        }),
      ),
      http.delete(`${BASE}/bookings/bk-1/participants/p-1`, () => new HttpResponse(null, { status: 204 })),
      http.post(`${BASE}/bookings/participants/respond`, () =>
        HttpResponse.json({ id: 'p-2', booking_id: 'bk-1', email: 'b@ece.fr', display_name: 'B', response: 'accepte', is_organizer: false }),
      ),
    );

    expect(await bookings.listParticipants('bk-1')).toHaveLength(1);
    expect((await bookings.inviteParticipant('bk-1', { email: 'b@ece.fr', name: 'B' })).invitationToken).toBe('jeton-invitation');
    expect(await bookings.removeParticipant('bk-1', 'p-1')).toMatchObject({ removed: true });
    expect((await bookings.respondToInvitation('bk-1', { token: 'x', response: 'accepte' })).response).toBe('accepte');
  });

  it('rend les alternatives d’une réservation refusée', async () => {
    serveur.use(
      http.get(`${BASE}/bookings/bk-1/alternatives`, () =>
        HttpResponse.json([{ kind: 'autre_salle_meme_creneau', room_id: 'r-2', score: 70, justification: 'x', slot: CRENEAU }]),
      ),
    );

    expect(await bookings.getAlternatives('bk-1')).toHaveLength(1);
  });
});

describe('présence sur place', () => {
  it('ouvre la fenêtre de validation au début du créneau', async () => {
    serveur.use(
      http.get(`${BASE}/bookings/bk-1`, () =>
        HttpResponse.json({
          ...RESERVATION,
          slot: { ...CRENEAU, starts_at: new Date().toISOString() },
        }),
      ),
      ...servirRegles(),
    );

    const fenetre = await checkin.getCheckInWindow('bk-1');
    expect(fenetre.windowMin).toBe(10);
    expect(fenetre.open).toBe(true);
    expect(fenetre.checkedIn).toBe(false);
  });

  it('nettoie la saisie sans toucher au code', async () => {
    let recu = null;
    serveur.use(
      http.post(`${BASE}/bookings/bk-1/check-in`, async ({ request }) => {
        recu = await request.json();
        return HttpResponse.json({ ...RESERVATION, checked_in_at: CRENEAU.starts_at });
      }),
    );

    await checkin.checkIn('bk-1', ' a-4821 ');

    // Ce test attendait « A4821 » : il verrouillait le défaut.
    //
    // Le serveur émet `A-4821` et n'en garde que l'empreinte, tiret compris.
    // Retirer le tiret produisait une chaîne que l'empreinte ne reconnaît pas,
    // et l'utilisateur lisait « Code d'accès incorrect » en tapant le bon code.
    //
    // Les espaces partent, la casse est imposée : ils viennent de la saisie.
    // Le tiret, lui, fait partie du code.
    expect(recu.code).toBe('A-4821');
  });

  it('signale un retard sans prolonger la fenêtre', async () => {
    // `extendedByMin: 0` décrivait une prolongation qui n'existe pas : le
    // serveur pose `checked_in_at`, la marque **vaut** validation de présence.
    // Un champ toujours nul ne décrivait rien et laissait croire le contraire.
    let recu = 'jamais appelé';
    serveur.use(
      http.post(`${BASE}/bookings/bk-1/late`, async ({ request }) => {
        recu = await request.json();
        return HttpResponse.json({ ...RESERVATION, checked_in_at: CRENEAU.starts_at });
      }),
    );

    const retard = await checkin.declareLate('bk-1');

    expect(recu).toEqual({});
    expect(retard.delayMin).toBeNull();
    expect(retard.booking.checkedIn).toBe(true);
  });

  it('transmet la durée annoncée quand elle est donnée', async () => {
    let recu = null;
    serveur.use(
      http.post(`${BASE}/bookings/bk-1/late`, async ({ request }) => {
        recu = await request.json();
        return HttpResponse.json({ ...RESERVATION, checked_in_at: CRENEAU.starts_at });
      }),
    );

    const retard = await checkin.declareLate('bk-1', '15');

    expect(recu).toEqual({ delay_min: 15 });
    expect(retard.delayMin).toBe(15);
  });
});

describe('recommandation', () => {
  it('classe les salles pour un besoin', async () => {
    let recu = null;
    serveur.use(
      http.post(`${BASE}/recommendations`, async ({ request }) => {
        recu = await request.json();
        return HttpResponse.json([
          { room: { id: 'r-1', name: 'Vinci', capacity: 12 }, score: 81, eligible: true, justification: 'x' },
        ]);
      }),
    );

    await recommendations.recommendRooms({ attendees: 6, equipmentIds: ['eq-1'] });
    // L'équipement est une préférence et non un filtre : l'exiger écarterait
    // toute salle à laquelle il manque un seul élément.
    expect(recu.equipment_strict).toBe(false);
    expect(recu.attendees).toBe(6);
  });

  it('traite « aucun bâtiment » comme une absence de filtre', async () => {
    // La liste déroulante rend la chaîne vide quand rien n'est choisi.
    // Envoyée telle quelle, l'API refusait la recherche pour identifiant
    // invalide, et le tunnel s'arrêtait à l'étape des salles éligibles.
    let recu = null;
    serveur.use(
      http.post(`${BASE}/recommendations`, async ({ request }) => {
        recu = await request.json();
        return HttpResponse.json([]);
      }),
    );

    await recommendations.recommendRooms({ attendees: 6, buildingId: '' });
    expect(recu.building_id).toBeNull();

    await recommendations.recommendRooms({ attendees: 6, buildingId: 'b-1' });
    expect(recu.building_id).toBe('b-1');
  });

  it('rend null quand aucune salle ne convient', async () => {
    serveur.use(http.post(`${BASE}/recommendations/best`, () => HttpResponse.json(null)));
    expect(await recommendations.recommendBest({ attendees: 200 })).toBeNull();
  });

  it('rend le dossier d’arbitrage avec ses prétendants', async () => {
    serveur.use(
      http.post(`${BASE}/recommendations/rooms/r-1/arbitration`, () =>
        HttpResponse.json({
          room_id: 'r-1',
          slot: CRENEAU,
          claimants: [
            {
              user_id: 'u-1',
              display_name: 'Camille',
              requested_at: CRENEAU.starts_at,
              booking_id: 'bk-1',
              factors: [{ key: 'anteriorite', label: 'Antériorité', value: 2, detail: '2 jours', favours: true }],
            },
          ],
        }),
      ),
    );

    const dossier = await recommendations.getArbitrationBrief('r-1', {
      start: new Date('2026-08-25T10:00:00Z'),
      end: new Date('2026-08-25T11:00:00Z'),
    });
    expect(dossier.claimants[0].factors[0].detail).toBe('2 jours');
  });
});

describe('notifications, statistiques, support', () => {
  it('filtre les notifications par onglet', async () => {
    serveur.use(
      http.get(`${BASE}/notifications`, () =>
        HttpResponse.json(
          page([
            { id: 'n-1', title: 'A', channel: 'in_app', sent_at: CRENEAU.starts_at, booking_id: 'bk-1' },
            { id: 'n-2', title: 'B', channel: 'in_app', sent_at: CRENEAU.starts_at, ticket_id: 't-1' },
          ]),
        ),
      ),
    );

    expect(await notifications.listNotifications('toutes')).toHaveLength(2);
    expect(await notifications.listNotifications('aide')).toHaveLength(1);
  });

  it('lit la pastille sans charger le fil', async () => {
    serveur.use(http.get(`${BASE}/notifications/unread-count`, () => HttpResponse.json(3)));
    expect(await notifications.countUnread()).toBe(3);
  });

  it('marque une notification lue', async () => {
    serveur.use(
      http.patch(`${BASE}/notifications/n-1`, () =>
        HttpResponse.json({ id: 'n-1', title: 'A', channel: 'in_app', sent_at: CRENEAU.starts_at, read_at: CRENEAU.starts_at }),
      ),
    );
    expect((await notifications.markAsRead('n-1')).read).toBe(true);
  });

  it('rend les onglets du fil', async () => {
    expect((await notifications.listTabs()).map((item) => item.id)).toContain('rappel');
  });

  it('compose les chiffres personnels depuis les agrégats et les réservations', async () => {
    serveur.use(
      http.get(`${BASE}/stats/me`, () =>
        HttpResponse.json({
          window_days: 92,
          total_bookings: 3,
          active_bookings: 3,
          cancelled_bookings: 0,
          upcoming_bookings: 1,
          booked_hours: 4.5,
          distinct_rooms: 1,
          attendance_rate: 0.9,
          no_show_rate: 0.1,
        }),
      ),
      http.get(`${BASE}/bookings`, () => HttpResponse.json(page([RESERVATION]))),
    );

    const chiffres = await stats.getMyStats('trimestre');
    expect(chiffres.kpis.hours).toBe(5);
    expect(chiffres.byRoom[0].name).toBe('Salle Vinci');
    expect(chiffres.observation).toContain('Salle Vinci');
  });

  it('annonce l’absence de tendance quand rien n’a été réservé', async () => {
    serveur.use(
      http.get(`${BASE}/stats/me`, () =>
        HttpResponse.json({
          window_days: 92,
          total_bookings: 0,
          active_bookings: 0,
          cancelled_bookings: 0,
          upcoming_bookings: 0,
          booked_hours: 0,
          distinct_rooms: 0,
          attendance_rate: null,
          no_show_rate: null,
        }),
      ),
      http.get(`${BASE}/bookings`, () => HttpResponse.json(page([]))),
    );

    const chiffres = await stats.getMyStats('mois');
    expect(chiffres.observation).toContain('Pas encore assez');
  });

  it('rend les chiffres publics, double réservation comprise', async () => {
    serveur.use(
      http.get(`${BASE}/stats/public`, () =>
        HttpResponse.json({ rooms: 7, buildings: 3, seats: 93, bookings_last_30_days: 263 }),
      ),
    );

    const publics = await stats.getPublicStats();
    // Zéro par construction et non par mesure : la contrainte d'exclusion rend
    // le chevauchement impossible en base.
    expect(publics.doubleBookings).toBe(0);
    expect(publics.seats).toBe(93);
  });

  it('ouvre un ticket avec son message initial', async () => {
    let recu = null;
    serveur.use(
      http.post(`${BASE}/tickets`, async ({ request }) => {
        recu = await request.json();
        return HttpResponse.json({ id: 't-1', reference: '#1001', created_at: CRENEAU.starts_at, message_count: 1 });
      }),
    );

    await tickets.createTicket({ subject: 'Code refusé', category: 'acces', body: 'Bonjour' });
    expect(recu.body).toBe('Bonjour');
  });

  it('rend les catégories d’aide avec leur compteur', async () => {
    serveur.use(
      http.get(`${BASE}/faq/categories`, () =>
        HttpResponse.json([{ id: 'c-1', code: 'reserver', label: 'Réserver', icon: 'x', article_count: 7 }]),
      ),
    );

    expect((await tickets.listHelpCategories())[0].count).toBe(7);
  });

  it('cherche les articles par le serveur, pas en mémoire', async () => {
    let recus = null;
    serveur.use(
      http.get(`${BASE}/faq/articles`, ({ request }) => {
        recus = new URL(request.url).searchParams;
        return HttpResponse.json(page([]));
      }),
    );

    await tickets.searchHelpArticles({ query: 'code', category: 'c-1' });
    expect(recus.get('q')).toBe('code');
    expect(recus.get('category_id')).toBe('c-1');
  });

  it('lit un article par son slug', async () => {
    serveur.use(
      http.get(`${BASE}/faq/articles/reserver-une-salle`, () =>
        HttpResponse.json({ id: 'a-1', category_id: 'c-1', slug: 'reserver-une-salle', title: 'Réserver', excerpt: 'x', body: 'y', status: 'publie', view_count: 1 }),
      ),
    );

    expect((await tickets.getHelpArticle('reserver-une-salle')).title).toBe('Réserver');
  });

  it('propose les catégories de ticket', async () => {
    expect((await tickets.listTicketCategories()).map((item) => item.id)).toContain('acces');
  });
});

describe('recherche globale et assistant', () => {
  it('ignore une recherche trop courte', async () => {
    // Deux caractères au moins : chercher sur une lettre rapatrierait tout.
    expect(await search.globalSearch('a')).toMatchObject({ total: 0, groups: [] });
  });

  it('interroge les trois collections et groupe les résultats', async () => {
    serveur.use(
      http.get(`${BASE}/rooms`, () => HttpResponse.json(page([SALLE]))),
      http.get(`${BASE}/bookings`, () => HttpResponse.json(page([RESERVATION]))),
      http.get(`${BASE}/faq/articles`, () =>
        HttpResponse.json(page([{ id: 'a-1', category_id: 'c-1', slug: 'x', title: 'Vinci et vous', excerpt: 'x', body: 'y', status: 'publie', view_count: 0 }])),
      ),
    );

    const resultats = await search.globalSearch('vinci');
    expect(resultats.groups.map((groupe) => groupe.id)).toEqual(['salles', 'reservations', 'aide']);
    expect(resultats.total).toBe(3);
  });

  it('accueille sans appeler le serveur', async () => {
    const accueil = await chatbot.greet();
    expect(accueil.quickReplies.length).toBeGreaterThan(0);
  });

  it('rend la réponse de l’assistant et son degré de confiance', async () => {
    serveur.use(
      http.post(`${BASE}/chatbot/messages`, () =>
        HttpResponse.json({
          intent_code: 'code_acces',
          intent_label: 'Code d’accès',
          answer: 'Le code figure sur votre réservation.',
          quick_replies: ['Autre question'],
          escalates_to_ticket: false,
          faq_article_id: null,
          confidence: 0.82,
        }),
      ),
    );

    const reponse = await chatbot.sendMessage('où est mon code ?');
    expect(reponse.intent).toBe('code_acces');
    expect(reponse.confidence).toBeCloseTo(0.82);
    expect(reponse.room).toBeNull();
  });

  it('accompagne une intention de recherche d’une carte de salle', async () => {
    serveur.use(
      http.post(`${BASE}/chatbot/messages`, () =>
        HttpResponse.json({
          intent_code: 'recherche_salle',
          intent_label: 'Trouver une salle',
          answer: 'Voici une proposition.',
          quick_replies: [],
          escalates_to_ticket: false,
          faq_article_id: null,
          confidence: 0.9,
        }),
      ),
      http.post(`${BASE}/recommendations/best`, () =>
        HttpResponse.json({
          room: { id: 'r-1', name: 'Vinci', capacity: 12, is_available: true },
          score: 81,
          eligible: true,
          justification: 'Capacité ajustée',
        }),
      ),
    );

    // Répondre « utilisez la recherche » à qui demande une salle pour quatre
    // personnes reviendrait à lui renvoyer sa question.
    const reponse = await chatbot.sendMessage('une salle pour 4 personnes');
    expect(reponse.room.name).toBe('Vinci');
    expect(reponse.room.justification).toBe('Capacité ajustée');
  });
});

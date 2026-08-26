/**
 * Défauts trouvés en ouvrant l'espace d'administration dans un navigateur.
 *
 * Ils ont un trait commun : la couche `src/api/admin/` a été réécrite en
 * gardant les soixante-dix noms exportés, donc sans jamais casser un import.
 * Les formes rendues, elles, avaient divergé de ce que les composants
 * consomment — et rien ne l'a vu, parce que ces écrans n'avaient pas été
 * ouverts depuis la réécriture.
 *
 * Chaque test ci-dessous échouait avant la correction du lot correspondant.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { page, serveur } from '../../test/serveur';
import { ApiError, setAccessToken } from '../client';
import * as conflicts from './conflicts';
import * as rooms from './rooms';
import * as schedules from './schedules';
import * as users from './users';
import * as auth from '../auth';
import * as buildings from '../buildings';
import { USER_ROLE_LABEL } from '../../utils/format';
import { creneau } from './creneau.fixture';

const BASE = 'http://localhost:5180/api/v1';

const SALLE = (extra = {}) => ({
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
  description: '',
  occupancy_percent: 40,
  equipments: [],
  photos: [],
  ...extra,
});

beforeEach(() => setAccessToken('jeton-de-test'));

describe('File d’arbitrage', () => {
  const DEMANDE = {
    id: 'ar-1',
    reference: 'CONF-8492',
    requester_id: 'u-1',
    requester_name: 'Dylan Menga',
    room_id: 'r-1',
    room_name: 'Salle Vinci',
    access_type: 'conflit_reservation',
    reason: 'Double réservation',
    status: 'ouvert',
    decision_comment: null,
    alternative_room_id: null,
    alternative_room_name: null,
    booking_id: null,
    decided_at: null,
    created_at: '2026-08-24T10:00:00Z',
    slot: creneau('2026-08-25T12:00:00Z', '2026-08-25T13:30:00Z'),
  };

  const brancher = (alternatives) =>
    serveur.use(
      http.get(`${BASE}/access-requests/ar-1`, () => HttpResponse.json(DEMANDE)),
      http.post(`${BASE}/recommendations/rooms/r-1/alternatives`, () =>
        HttpResponse.json(alternatives),
      ),
      http.get(`${BASE}/availability/calendar`, () => HttpResponse.json({ events: [] })),
      http.get(`${BASE}/rooms`, () =>
        HttpResponse.json(
          page([SALLE(), SALLE({ id: 'r-2', name: 'Salle Curie', capacity: 20 })]),
        ),
      ),
    );

  it('nomme les salles proposées au lieu de rendre un identifiant nu', async () => {
    // `AlternativeList` lit `entree.room.id`, `.name` et `.capacity` ; l'API ne
    // rend qu'un `room_id`. L'écran entier plantait sur un `undefined`.
    brancher([
      {
        kind: 'autre_salle_meme_creneau',
        room_id: 'r-2',
        slot: DEMANDE.slot,
        score: 88,
        justification: 'Même créneau dans Salle Curie.',
      },
    ]);

    const item = await conflicts.getQueueItem('ar-1');

    expect(item.alternatives).toHaveLength(1);
    expect(item.alternatives[0].room).toEqual({
      id: 'r-2',
      name: 'Salle Curie',
      capacity: 20,
    });
  });

  it('n’offre que les repli que la décision peut appliquer', async () => {
    // `decide` réserve toujours le créneau demandé et ne fait varier que la
    // salle : proposer un report ferait choisir une décision impossible, et
    // renverrait le demandeur sur le créneau litigieux.
    brancher([
      {
        kind: 'meme_salle_autre_creneau',
        room_id: 'r-1',
        slot: creneau('2026-08-25T14:00:00Z', '2026-08-25T15:30:00Z'),
        score: 78,
        justification: 'Même salle, décalée de 2 h.',
      },
      {
        kind: 'proche',
        room_id: 'r-2',
        slot: creneau('2026-08-25T16:00:00Z', '2026-08-25T17:30:00Z'),
        score: 40,
        justification: 'Salle Curie plus tard.',
      },
      {
        kind: 'autre_salle_meme_creneau',
        room_id: 'r-2',
        slot: DEMANDE.slot,
        score: 88,
        justification: 'Même créneau dans Salle Curie.',
      },
    ]);

    const item = await conflicts.getQueueItem('ar-1');

    expect(item.alternatives.map((entree) => entree.kind)).toEqual([
      'autre_salle_meme_creneau',
    ]);
  });

  it('porte la capacité de la salle contestée dans l’en-tête du détail', async () => {
    brancher([]);
    const item = await conflicts.getQueueItem('ar-1');
    expect(item.room).toEqual({ id: 'r-1', name: 'Salle Vinci', capacity: 12 });
  });

  it('traduit le type de dérogation dans le vocabulaire de l’écran', async () => {
    // Sans la table de correspondance, chaque élément retombait sur le libellé
    // par défaut : un conflit de réservation s'affichait « Validation ».
    serveur.use(
      http.get(`${BASE}/admin/access-requests`, () => HttpResponse.json(page([DEMANDE]))),
    );
    const [ligne] = await conflicts.listQueue('conflits');
    expect(ligne.type).toBe('conflit_double');
    expect(ligne.reference).toBe('CONF-8492');
  });
});

describe('Référentiels de filtres', () => {
  it('distingue les étages homonymes par leur bâtiment', async () => {
    // Chaque bâtiment a son « 1er étage » : la seule étiquette produisait
    // autant d'entrées indiscernables que de bâtiments.
    serveur.use(
      http.get(`${BASE}/rooms/filters`, () =>
        HttpResponse.json({
          buildings: [
            { id: 'b-1', name: 'Campus Eiffel', address: '', floors: 3, rooms: 8 },
            { id: 'b-2', name: 'Annexe', address: '', floors: 2, rooms: 4 },
          ],
          floors: [
            {
              id: 'f-1',
              building_id: 'b-1',
              code: '1',
              label: '1er étage',
              level: 1,
              room_count: 3,
            },
            {
              id: 'f-2',
              building_id: 'b-2',
              code: '1',
              label: '1er étage',
              level: 1,
              room_count: 2,
            },
          ],
          equipments: [],
          statuses: [],
          capacity_min: 0,
          capacity_max: 30,
        }),
      ),
      http.get(`${BASE}/rooms`, () => HttpResponse.json(page([SALLE()]))),
    );

    const referentiels = await rooms.listRoomFilters();
    const etiquettes = referentiels.floors.map((item) => item.label);

    expect(new Set(etiquettes).size).toBe(etiquettes.length);
    expect(etiquettes).toContain('Campus Eiffel — 1er étage');
    expect(etiquettes).toContain('Annexe — 1er étage');
  });
});

describe('Grille hebdomadaire', () => {
  it('se lit du lundi au dimanche sans changer les valeurs transmises', async () => {
    // `0 = dimanche` est la convention d'`EXTRACT(DOW)`, imposée par la base et
    // inchangée. Seul l'ordre d'affichage bougeait : présenter dimanche en tête
    // faisait lire le week-end en premier.
    serveur.use(http.get(`${BASE}/opening-hours`, () => HttpResponse.json([])));

    const grille = await schedules.getSchedule();

    expect(grille.days.map((jour) => jour.label)).toEqual([
      'Lundi',
      'Mardi',
      'Mercredi',
      'Jeudi',
      'Vendredi',
      'Samedi',
      'Dimanche',
    ]);
    expect(grille.days.map((jour) => jour.day)).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });
});

describe('Suspension de compte', () => {
  it('refuse de partir sans motif au lieu d’en fabriquer un', async () => {
    // L'API l'exige (trois caractères au moins) parce qu'il constitue la trace
    // au journal d'audit. Le compléter par défaut remplissait le journal de
    // « Suspension administrative » identiques, qui ne disent rien.
    await expect(users.setUserStatus('u-1', 'suspendu')).rejects.toThrow(ApiError);
    await expect(users.setUserStatus('u-1', 'suspendu', { reason: '  ' })).rejects.toThrow(
      /motif/i,
    );
  });
});

describe('Plan d’étage', () => {
  const brancherPlan = (statut) =>
    serveur.use(
      http.get(`${BASE}/floors/f-1/plan`, () =>
        statut === 200
          ? HttpResponse.json({
              floor_id: 'f-1',
              file_url: '/media/plan.png',
              file_name: 'plan.png',
              kind: 'image',
              uploaded_at: '2026-08-01T00:00:00Z',
            })
          : new HttpResponse(null, { status: statut }),
      ),
    );

  it('traite le 404 comme un état vide', async () => {
    brancherPlan(404);
    await expect(buildings.getPlanDocumentForPlan('f-1')).resolves.toBeNull();
  });

  it('laisse remonter les autres échecs au lieu de les avaler', async () => {
    // Un `catch(() => null)` global affichait « aucun plan » sur un étage qui
    // en a un, dès que le serveur bronchait.
    brancherPlan(500);
    await expect(buildings.getPlanDocumentForPlan('f-1')).rejects.toThrow(ApiError);
  });
});

describe('Libellés de rôle', () => {
  it('couvre le vocabulaire que les données produisent réellement', () => {
    // `etudiant / enseignant / gestionnaire` venait des maquettes ; aucune
    // source ne le produit. Le filtre « Rôle » retombait donc sur la clé
    // technique et affichait « utilisateur » en minuscules.
    expect(USER_ROLE_LABEL.utilisateur).toBe('Utilisateur');
    expect(USER_ROLE_LABEL.admin).toBe('Administrateur');
    expect(USER_ROLE_LABEL.gestionnaire).toBeUndefined();
  });
});

describe('Photo de profil et sessions', () => {
  it('refuse un format que le serveur refuserait, sans aller-retour', async () => {
    // Le contrôle local n'est pas une sécurité — le serveur applique la même
    // liste — mais une réponse immédiate : refuser un fichier après l'avoir
    // téléversé serait discourtois.
    const pdf = new File(['x'], 'plan.pdf', { type: 'application/pdf' });
    await expect(auth.uploadAvatar(pdf)).rejects.toThrow(/PNG, JPEG ou WebP/);
  });

  it('refuse au-delà de cinq mégaoctets', async () => {
    const lourd = new File(['x'], 'moi.png', { type: 'image/png' });
    Object.defineProperty(lourd, 'size', { value: 6 * 1024 * 1024 });
    await expect(auth.uploadAvatar(lourd)).rejects.toThrow(/trop lourd/i);
  });

  it('refuse l’absence de fichier plutôt que d’envoyer un corps vide', async () => {
    await expect(auth.uploadAvatar(null)).rejects.toThrow(ApiError);
  });

  it('rend les sessions groupées par famille, la courante signalée', async () => {
    serveur.use(
      http.get(`${BASE}/users/me/sessions`, () =>
        HttpResponse.json([
          {
            id: 'fam-1',
            scope: 'admin',
            ip_address: '203.0.113.7',
            user_agent: 'Mozilla/5.0 Chrome/120.0',
            started_at: '2026-08-25T09:00:00Z',
            expires_at: '2026-09-24T09:00:00Z',
            current: true,
          },
        ]),
      ),
    );

    const [session] = await auth.listSessions();

    expect(session).toMatchObject({ id: 'fam-1', ip: '203.0.113.7', current: true });
    expect(session.startedAt).toBeInstanceOf(Date);
  });

  it('rend le nombre de sessions fermées', async () => {
    serveur.use(
      http.delete(`${BASE}/users/me/sessions`, () => HttpResponse.json({ closed: 3 })),
    );
    await expect(auth.revokeOtherSessions()).resolves.toBe(3);
  });
});

/**
 * Adaptateurs : la couture entre le vocabulaire de l'API et celui des écrans.
 *
 * Rien de spectaculaire à tester ici, et c'est justement pourquoi il faut le
 * faire. Une transcription est du code sans logique apparente : personne ne la
 * relit, et une clé mal orthographiée produit un `undefined` qui traverse
 * silencieusement l'application jusqu'à s'afficher comme une case vide.
 *
 * Ces tests sont purs — aucun réseau, aucun DOM. Ils s'exécutent en quelques
 * millisecondes et couvrent le tiers du code de `src/api`.
 */

import { describe, expect, it } from 'vitest';
import * as adapt from './adapters';

const ISO = '2026-08-25T12:30:00Z';

describe('conversion des instants', () => {
  it('transforme une chaîne ISO en date', () => {
    expect(adapt.toDate(ISO)).toBeInstanceOf(Date);
    expect(adapt.toDate(ISO).toISOString()).toBe('2026-08-25T12:30:00.000Z');
  });

  it('reconstruit une date à partir d’une date, sans la partager', () => {
    // Une copie et non la même référence : les écrans manipulent les dates
    // qu'ils reçoivent, et rendre l'originale les laisserait modifier la
    // charge utile d'où elle vient.
    const date = new Date(ISO);
    const copie = adapt.toDate(date);
    expect(copie).not.toBe(date);
    expect(copie.getTime()).toBe(date.getTime());
  });

  it('rend null pour une valeur absente', () => {
    // Une date nulle est un état normal — un créneau jamais annulé, une
    // présence jamais validée. La convertir en « Invalid Date » afficherait
    // une erreur là où il n'y a rien à montrer.
    expect(adapt.toDate(null)).toBeNull();
    expect(adapt.toDate(undefined)).toBeNull();
  });
});

describe('créneaux', () => {
  it('sérialise un créneau pour le corps d’une requête', () => {
    const debut = new Date('2026-08-25T10:00:00Z');
    const fin = new Date('2026-08-25T11:00:00Z');

    expect(adapt.slotIn(debut, fin)).toEqual({
      starts_at: '2026-08-25T10:00:00.000Z',
      ends_at: '2026-08-25T11:00:00.000Z',
    });
  });

  it('accepte des chaînes aussi bien que des dates', () => {
    const charge = adapt.slotIn('2026-08-25T10:00:00Z', '2026-08-25T11:00:00Z');
    expect(charge.starts_at).toContain('2026-08-25');
  });

  it('désérialise un créneau avec sa durée et son libellé', () => {
    const slot = adapt.slotOut({
      starts_at: ISO,
      ends_at: '2026-08-25T13:30:00Z',
      duration_minutes: 60,
      local_label: '25/08 14:30–15:30',
    });

    expect(slot.start).toBeInstanceOf(Date);
    expect(slot.durationMin).toBe(60);
    expect(slot.label).toBe('25/08 14:30–15:30');
  });

  it('rend null pour un créneau absent', () => {
    expect(adapt.slotOut(null)).toBeNull();
  });
});

describe('comptes', () => {
  const brut = {
    id: 'u-1',
    first_name: 'Camille',
    last_name: 'Durand',
    email: 'camille@edu.ece.fr',
    phone: '06 12 34 56 78',
    promotion: 'B3 Data & IA',
    department: 'Ingénierie',
    badge_number: '20841',
    status: 'actif',
  };

  it('transcrit un profil complet', () => {
    const compte = adapt.user(brut);
    expect(compte.firstName).toBe('Camille');
    expect(compte.badgeNumber).toBe('20841');
    expect(compte.status).toBe('actif');
  });

  it('déduit le rôle de la promotion', () => {
    // La promotion commence par « B » pour les étudiants ; le personnel n'en a
    // pas. C'est la seule information disponible pour distinguer les deux.
    expect(adapt.user(brut).role).toBe('etudiant');
    expect(adapt.user({ ...brut, promotion: null }).role).toBe('personnel');
    expect(adapt.user({ ...brut, promotion: 'Pédagogie' }).role).toBe('personnel');
  });

  it('rend null pour un compte absent', () => {
    expect(adapt.user(null)).toBeNull();
  });

  it('donne des préférences par défaut quand aucune n’est enregistrée', () => {
    // Un compte neuf n'a pas de ligne de préférences : les écrans doivent
    // afficher les valeurs par défaut, pas des cases vides.
    const compte = adapt.user(brut);
    expect(compte.preferences.reminderDelayMin).toBe(30);
    expect(compte.preferences.weeklyQuotaHours).toBe(12);
    expect(compte.preferences.emailConfirmation).toBe(true);
    expect(compte.preferences.preferredBuildingId).toBeNull();
  });

  it('assemble la fourchette de capacité habituelle', () => {
    const compte = adapt.user({
      ...brut,
      preferences: { usual_capacity_min: 5, usual_capacity_max: 10 },
    });
    expect(compte.preferences.usualCapacity).toBe('5-10');
  });

  it('laisse la fourchette nulle si une borne manque', () => {
    const compte = adapt.user({
      ...brut,
      preferences: { usual_capacity_min: 5, usual_capacity_max: null },
    });
    expect(compte.preferences.usualCapacity).toBeNull();
  });

  it('renvoie la fourchette vers l’API en deux bornes', () => {
    expect(adapt.preferencesIn({ usualCapacity: '5-10', reminderDelayMin: 60 })).toMatchObject({
      usual_capacity_min: 5,
      usual_capacity_max: 10,
      reminder_delay_min: 60,
    });
  });

  it('accepte une fourchette vide sans produire NaN', () => {
    const charge = adapt.preferencesIn({});
    expect(charge.usual_capacity_min).toBeNull();
    expect(charge.usual_capacity_max).toBeNull();
  });

  it('transcrit un compte d’administration avec sa matrice', () => {
    const compte = adapt.admin({
      user: { first_name: 'Léa', last_name: 'Martin', email: 'lea@ece.fr' },
      admin: { user_id: 'a-1', job_title: 'Responsable', is_owner: true },
      permissions: ['rooms.manage'],
    });

    expect(compte.jobTitle).toBe('Responsable');
    expect(compte.isOwner).toBe(true);
    expect(compte.permissions).toEqual(['rooms.manage']);
  });

  it('rend null quand la session ne porte pas de compte d’administration', () => {
    expect(adapt.admin({ user: {}, admin: null })).toBeNull();
    expect(adapt.admin(null)).toBeNull();
  });
});

describe('parc', () => {
  const salleBrute = {
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
  };

  it('transcrit un bâtiment et son adresse tenant lieu de campus', () => {
    const batiment = adapt.building({
      id: 'b-1',
      code: 'A',
      name: 'Campus Eiffel',
      address: 'Paris 15e',
      floor_count: 3,
      room_count: 8,
    });
    expect(batiment.campus).toBe('Paris 15e');
    expect(batiment.roomCount).toBe(8);
  });

  it('transcrit une salle et niche sa localisation', () => {
    const salle = adapt.room(salleBrute);
    expect(salle.floor).toBe('2e étage');
    expect(salle.building.name).toBe('Campus Eiffel');
    expect(salle.area).toBe(28);
    expect(salle.occupancyRate).toBeCloseTo(0.72);
  });

  it('mémorise l’étage de la salle pour les écrans de plan', () => {
    // `planIdForRoom` est synchrone alors que l'information est distante :
    // l'adaptateur la retient au passage.
    adapt.room(salleBrute);
    expect(adapt.floorOfRoom.get('r-1')).toBe('f-1');
  });

  it('met à plat les équipements et les photos', () => {
    const salle = adapt.room({
      ...salleBrute,
      equipments: [
        { equipment_id: 'eq-1', code: 'video', label: 'Vidéo', category: 'audiovisuel', quantity: 1 },
      ],
      photos: [{ id: 'p-1', file_url: '/media/photos/a.png', alt_text: 'Vue' }],
    });

    expect(salle.equipmentIds).toEqual(['eq-1']);
    expect(salle.equipment[0].label).toBe('Vidéo');
    // Une adresse, pas un objet. Cette assertion disait `photos[0].url` et
    // décrivait fidèlement l'adaptateur — sans jamais vérifier qu'un écran
    // pouvait s'en servir. Les six qui consomment `photos` écrivent
    // `src={room.photos?.[0]}` : toutes les photos de salle rendaient
    // « [object Object] », et le test restait vert.
    expect(salle.photos).toEqual(['/media/photos/a.png']);
    expect(typeof salle.photos[0]).toBe('string');
  });

  it('accepte une salle sans équipement ni photo', () => {
    const salle = adapt.room(salleBrute);
    expect(salle.equipment).toEqual([]);
    expect(salle.photos).toEqual([]);
    expect(salle.plan).toBeNull();
  });

  it('convertit le placement sur le plan en nombres', () => {
    const salle = adapt.room({
      ...salleBrute,
      placement: {
        pos_x: '10.5',
        pos_y: '20.0',
        width: '30.0',
        height: '15.0',
        rotation: 90,
        is_entrance_marked: true,
      },
    });
    expect(salle.plan).toEqual({ x: 10.5, y: 20, w: 30, h: 15, rotation: 90, entrance: true });
  });

  it('porte le marqueur d’entrée, même absent de la réponse', () => {
    // Il ne figurait pas dans l'adaptateur : `entrance` valait `undefined`
    // jusqu'à l'écriture, qui le remplaçait par `false`. Déplacer une salle
    // effaçait donc l'entrée marquée, sans erreur et sans que rien ne le dise.
    const marquee = adapt.room({
      ...salleBrute,
      placement: { pos_x: '0', pos_y: '0', width: '10', height: '10', rotation: 0, is_entrance_marked: true },
    });
    const sans = adapt.room({
      ...salleBrute,
      placement: { pos_x: '0', pos_y: '0', width: '10', height: '10', rotation: 0 },
    });
    expect(marquee.plan.entrance).toBe(true);
    expect(sans.plan.entrance).toBe(false);
  });

  it('transcrit un étage et un équipement', () => {
    expect(adapt.floor({ id: 'f-1', building_id: 'b-1', code: 'R2', label: '2e', level: 2, room_count: 4 }).label).toBe('2e');
    expect(adapt.equipment({ id: 'eq-1', code: 'video', label: 'Vidéo', category: 'audiovisuel', icon: 'projector' }).icon).toBe('projector');
  });

  it('transcrit la salle résumée du moteur de recommandation', () => {
    const resume = adapt.roomSummary({
      id: 'r-1',
      name: 'Vinci',
      capacity: 12,
      building_id: 'b-1',
      floor_level: 2,
      equipment_ids: ['eq-1'],
      is_accessible: true,
      is_available: false,
      occupancy_percent: 40,
    });

    // `is_available: false` devient « maintenance » : les cartes n'affichent
    // qu'un statut, et une salle indisponible ne se réserve pas.
    expect(resume.status).toBe('maintenance');
    expect(resume.occupancyRate).toBeCloseTo(0.4);
  });
});

describe('disponibilité et recommandation', () => {
  it('transcrit une suggestion et le détail de son score', () => {
    const suggestion = adapt.suggestion({
      room: { id: 'r-1', name: 'Vinci', capacity: 12, is_available: true },
      score: 81,
      eligible: true,
      justification: 'Capacité ajustée',
      breakdown: [
        { key: 'capacity', label: 'Capacité', points: 27, max_points: 30, detail: '12 places' },
      ],
    });

    expect(suggestion.score).toBe(81);
    expect(suggestion.breakdown[0].max).toBe(30);
  });

  it('accepte une suggestion sans détail de score', () => {
    const suggestion = adapt.suggestion({
      room: { id: 'r-1', name: 'Vinci', capacity: 12 },
      score: 50,
      eligible: false,
      justification: 'Salle occupée',
    });
    expect(suggestion.breakdown).toEqual([]);
  });

  it('transcrit un conflit qualifié', () => {
    const conflit = adapt.conflict({
      booking_id: 'bk-1',
      title: 'Comité',
      kind: 'identique',
      overlap_minutes: 60,
      gap_minutes: 0,
      blocking: true,
    });
    expect(conflit.overlapMin).toBe(60);
    expect(conflit.blocking).toBe(true);
  });

  it('transcrit une alternative avec son créneau', () => {
    const alternative = adapt.alternative({
      kind: 'meme_salle_autre_creneau',
      room_id: 'r-1',
      score: 81,
      justification: 'Une heure plus tard',
      slot: { starts_at: ISO, ends_at: '2026-08-25T13:30:00Z', duration_minutes: 60 },
    });
    expect(alternative.durationMin).toBe(60);
    expect(alternative.roomId).toBe('r-1');
  });

  it('transcrit le verdict d’un créneau, violations comprises', () => {
    const verdict = adapt.slotCheck({
      available: false,
      forcible: true,
      requires_validation: false,
      conflicts: [{ booking_id: 'bk-1', kind: 'identique', overlap_minutes: 60, blocking: true }],
      violations: [{ code: 'duree_min', message: 'Trop court.', severity: 'bloquant' }],
    });

    expect(verdict.available).toBe(false);
    expect(verdict.conflicts).toHaveLength(1);
    expect(verdict.violations[0].code).toBe('duree_min');
  });

  it('accepte un verdict sans conflit ni violation', () => {
    const verdict = adapt.slotCheck({ available: true, forcible: false, requires_validation: false });
    expect(verdict.conflicts).toEqual([]);
    expect(verdict.violations).toEqual([]);
  });
});

describe('réservations', () => {
  const brute = {
    id: 'bk-1',
    room_id: 'r-1',
    owner_id: 'u-1',
    title: 'Revue de sprint',
    slot: { starts_at: ISO, ends_at: '2026-08-25T13:30:00Z', duration_minutes: 60, local_label: '14:30–15:30' },
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

  it('transcrit une réservation et sa localisation', () => {
    const reservation = adapt.booking(brute);
    expect(reservation.title).toBe('Revue de sprint');
    expect(reservation.room.name).toBe('Salle Vinci');
    expect(reservation.room.building.name).toBe('Campus Eiffel');
    expect(reservation.room.floor).toBe('2e étage');
    expect(reservation.accessCode).toBe('A-****');
  });

  it('déduit l’assiduité du moment et de la présence', () => {
    // Quatre états, tous atteignables : à venir, présent, absent, ou rien à
    // dire pour une réservation annulée. Les dates sont ancrées loin dans le
    // passé et l'avenir : un test qui daterait « d'aujourd'hui » basculerait
    // d'état au fil de la journée.
    const passee = { ...brute, slot: { ...brute.slot, ends_at: '2020-01-01T10:00:00Z' } };
    const future = { ...brute, slot: { ...brute.slot, ends_at: '2099-01-01T10:00:00Z' } };

    expect(adapt.booking(passee).attendance).toBe('absente');
    expect(adapt.booking(future).attendance).toBe('attendue');
    expect(adapt.booking({ ...passee, checked_in_at: ISO }).attendance).toBe('presente');
    expect(adapt.booking({ ...passee, status: 'annulee' }).attendance).toBeNull();
  });

  it('marque la présence validée par un booléen lisible', () => {
    expect(adapt.booking(brute).checkedIn).toBe(false);
    expect(adapt.booking({ ...brute, checked_in_at: ISO }).checkedIn).toBe(true);
  });

  it('transcrit la frise des faits quand le détail la porte', () => {
    const reservation = adapt.booking({
      ...brute,
      events: [
        { id: 'ev-1', event_type: 'creation', label: 'Réservation créée', occurred_at: ISO, actor_label: 'Camille' },
      ],
    });
    expect(reservation.history[0].label).toBe('Réservation créée');
    expect(reservation.history[0].actor).toBe('Camille');
  });

  it('rend une frise vide pour une ligne de liste', () => {
    expect(adapt.booking(brute).history).toEqual([]);
  });

  it('laisse la salle nulle quand le nom n’accompagne pas la ligne', () => {
    const reservation = adapt.booking({ ...brute, room_name: null, building_name: null });
    expect(reservation.room).toBeNull();
    expect(reservation.building).toBeNull();
  });

  it('transcrit un participant et sa réponse', () => {
    const participant = adapt.participant({
      id: 'p-1',
      booking_id: 'bk-1',
      user_id: 'u-2',
      email: 'invite@ece.fr',
      display_name: 'Invité',
      response: 'accepte',
      is_organizer: false,
      responded_at: ISO,
    });
    expect(participant.name).toBe('Invité');
    expect(participant.organizer).toBe(false);
  });

  it('transcrit un événement de calendrier pour FullCalendar', () => {
    const evenement = adapt.calendarEvent({
      id: 'bk-1',
      title: 'Revue',
      start: ISO,
      end: '2026-08-25T13:30:00Z',
      room_id: 'r-1',
      room_name: 'Vinci',
      status: 'confirmee',
      source: 'utilisateur',
      is_mine: true,
      is_blocking: false,
    });

    // FullCalendar attend `start` et `end` bruts, et range le reste dans
    // `extendedProps` : lui donner des dates converties le ferait échouer.
    expect(evenement.start).toBe(ISO);
    expect(evenement.extendedProps.isMine).toBe(true);
  });
});

describe('règles', () => {
  const brutes = {
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

  it('transcrit les contraintes de réservation', () => {
    const regles = adapt.rules(brutes);
    expect(regles.minDurationMin).toBe(30);
    expect(regles.validationThreshold).toBe(20);
  });

  it('rend null quand aucune règle n’est configurée', () => {
    expect(adapt.rules(null)).toBeNull();
  });

  it('assemble amplitude et contraintes en une seule règle d’écran', () => {
    const horaires = [
      { id: 'o-1', scope: 'salle', weekday: 1, is_open: true, opens_at: '08:00:00', closes_at: '20:00:00' },
      { id: 'o-2', scope: 'salle', weekday: 0, is_open: false, opens_at: '00:00:00', closes_at: '23:59:00' },
    ].map(adapt.openingWindow);

    const regles = adapt.roomRules(brutes, horaires);
    expect(regles.visitDays).toEqual([1]);
    expect(regles.openTime).toBe('08:00');
    expect(regles.closeTime).toBe('20:00');
  });

  it('retombe sur une amplitude par défaut si aucun jour n’est ouvert', () => {
    const regles = adapt.roomRules(brutes, []);
    expect(regles.openTime).toBe('08:00');
    expect(regles.closeTime).toBe('20:00');
    expect(regles.visitDays).toEqual([]);
  });

  it('traduit les seuils configurés en contraintes lisibles', () => {
    // Les phrases sont construites depuis les valeurs, jamais figées : le
    // texte affiché et la règle appliquée ne peuvent pas diverger.
    const regles = adapt.roomRules(brutes, []);
    expect(regles.constraints.join(' ')).toContain('30');
    expect(regles.constraints.join(' ')).toContain('240');
    expect(regles.constraints.some((ligne) => /battement/i.test(ligne))).toBe(true);
  });

  it('n’énonce que les contraintes réellement posées', () => {
    const sansSeuil = adapt.roomRules({ ...brutes, validation_capacity_threshold: null, buffer_min: 0 }, []);
    expect(sansSeuil.constraints.some((ligne) => ligne.includes('validation'))).toBe(false);
    expect(sansSeuil.constraints.some((ligne) => /battement/i.test(ligne))).toBe(false);
  });

  it('renvoie les règles vers l’API sous leurs noms de colonnes', () => {
    expect(adapt.rulesIn({ minDurationMin: 45, bufferMin: 5 })).toMatchObject({
      min_duration_min: 45,
      buffer_min: 5,
    });
  });

  it('transcrit une fermeture exceptionnelle', () => {
    const fermeture = adapt.closure({
      id: 'cl-1',
      label: 'Journée pédagogique',
      first_day: '2026-09-03',
      last_day: '2026-09-03',
      kind: 'fermeture',
      is_global: true,
    });
    expect(fermeture.label).toBe('Journée pédagogique');
  });
});

describe('support et notifications', () => {
  it('transcrit un ticket et son fil', () => {
    const ticket = adapt.ticket({
      id: 't-1',
      reference: '#1001',
      requester_id: 'u-1',
      requester_name: 'Camille Durand',
      subject: 'Code refusé',
      category: 'acces',
      status: 'ouvert',
      room_id: 'r-1',
      booking_id: null,
      assigned_admin_id: null,
      first_response_at: null,
      resolved_at: null,
      message_count: 1,
      created_at: ISO,
      messages: [
        { id: 'm-1', ticket_id: 't-1', body: 'Bonjour', author_user_id: 'u-1', is_from_support: false, is_internal: false, sent_at: ISO },
      ],
    });

    expect(ticket.reference).toBe('#1001');
    expect(ticket.messages[0].fromSupport).toBe(false);
  });

  it('accepte un ticket sans message chargé', () => {
    const ticket = adapt.ticket({ id: 't-1', reference: '#1', message_count: 0, created_at: ISO });
    expect(ticket.messages).toEqual([]);
  });

  it('transcrit une catégorie et un article d’aide', () => {
    expect(adapt.faqCategory({ id: 'c-1', code: 'reserver', label: 'Réserver', icon: 'CalendarPlus', article_count: 7 }).articleCount).toBe(7);
    expect(adapt.faqArticle({ id: 'a-1', category_id: 'c-1', slug: 'reserver', title: 'Réserver', excerpt: 'x', body: 'y', status: 'publie', view_count: 12, published_at: ISO }).views).toBe(12);
  });

  it('range une notification dans l’onglet correspondant à sa cible', () => {
    // La catégorie n'est pas stockée : elle se déduit du lien. Une colonne
    // dédiée dupliquerait l'information, et les deux finiraient par diverger.
    const base = { id: 'n-1', title: 'Titre', body: null, channel: 'in_app', sent_at: ISO, read_at: null };
    expect(adapt.notification({ ...base, ticket_id: 't-1' }).category).toBe('aide');
    expect(adapt.notification({ ...base, booking_id: 'bk-1' }).category).toBe('reservation');
    expect(adapt.notification(base).category).toBe('rappel');
  });

  it('marque une notification lue depuis son horodatage', () => {
    const base = { id: 'n-1', title: 'Titre', channel: 'in_app', sent_at: ISO };
    expect(adapt.notification({ ...base, read_at: null }).read).toBe(false);
    expect(adapt.notification({ ...base, read_at: ISO }).read).toBe(true);
  });

  it('transcrit un gabarit de courriel', () => {
    const gabarit = adapt.emailTemplate({
      id: 'g-1',
      code: 'reservation_rappel',
      name: 'Rappel',
      trigger_label: 'Avant la réunion',
      subject: 'Objet',
      body: 'Corps',
      is_enabled: true,
      updated_at: ISO,
    });
    expect(gabarit.trigger).toBe('Avant la réunion');
    expect(gabarit.enabled).toBe(true);
  });
});

describe('demandes d’accès, statistiques et audit', () => {
  it('transcrit une demande d’accès et sa décision', () => {
    const demande = adapt.accessRequest({
      id: 'ac-1',
      reference: '#CONF-8492',
      requester_id: 'u-1',
      requester_name: 'Camille',
      room_id: 'r-1',
      room_name: 'Vinci',
      access_type: 'hors_jour_ouverture',
      reason: 'Comité',
      status: 'ouvert',
      decision_comment: null,
      alternative_room_id: null,
      alternative_room_name: null,
      booking_id: null,
      decided_at: null,
      created_at: ISO,
      slot: { starts_at: ISO, ends_at: '2026-08-25T13:30:00Z', duration_minutes: 60 },
    });

    expect(demande.reference).toBe('#CONF-8492');
    expect(demande.accessType).toBe('hors_jour_ouverture');
    expect(demande.start).toBeInstanceOf(Date);
  });

  it('transcrit les chiffres personnels', () => {
    const chiffres = adapt.myStats({
      window_days: 30,
      total_bookings: 18,
      active_bookings: 16,
      cancelled_bookings: 2,
      upcoming_bookings: 3,
      booked_hours: 25.5,
      distinct_rooms: 4,
      attendance_rate: 0.9,
      no_show_rate: 0.1,
    });

    expect(chiffres.hours).toBe(25.5);
    expect(chiffres.attendanceRate).toBeCloseTo(0.9);
  });

  it('transcrit une entrée d’audit et son signalement', () => {
    const entree = adapt.auditEntry({
      id: 'au-1',
      actor_label: 'Système',
      actor_admin_id: null,
      action: 'modification',
      target_type: 'room',
      target_label: 'Salle Vinci',
      target_id: 'r-1',
      diff_before: { name: 'Ancien' },
      diff_after: { name: 'Salle Vinci' },
      ip_address: '10.0.0.1',
      session_id: 'req-1',
      flagged_at: ISO,
      flag_reason: 'À relire',
      occurred_at: ISO,
    });

    expect(entree.actor).toBe('Système');
    expect(entree.flagged).toBe(true);
    expect(entree.before.name).toBe('Ancien');
  });

  it('ne marque pas signalée une entrée sans horodatage de signalement', () => {
    const entree = adapt.auditEntry({
      id: 'au-2',
      actor_label: 'Léa',
      action: 'creation',
      target_type: 'room',
      target_label: 'Vinci',
      flagged_at: null,
      occurred_at: ISO,
    });
    expect(entree.flagged).toBe(false);
  });
});

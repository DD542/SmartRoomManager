/**
 * Adaptateurs entre les formes de l'API et celles qu'attendent les écrans.
 *
 * L'API parle en `snake_case` et sépare ce que le modèle relationnel sépare ;
 * les composants ont été écrits contre des objets `camelCase` déjà mis à plat.
 * Toute la divergence est absorbée ici : aucun composant ne change, c'est la
 * règle que se donne ce branchement.
 *
 * Chaque adaptateur est une fonction pure : elle reçoit la réponse de l'API et
 * rend l'objet attendu, sans effet de bord ni appel réseau.
 */

/* -------------------------------------------------------------------------- */
/* Temps                                                                       */
/* -------------------------------------------------------------------------- */

/** Le front manipule des `Date` ; l'API rend des ISO 8601 en UTC. */
export const toDate = (valeur) => (valeur ? new Date(valeur) : null);

/** Créneau de l'API vers la paire attendue par les écrans. */
export const slotIn = (debut, fin) => ({
  starts_at: debut instanceof Date ? debut.toISOString() : debut,
  ends_at: fin instanceof Date ? fin.toISOString() : fin,
});

export const slotOut = (slot) =>
  slot
    ? {
        start: toDate(slot.starts_at),
        end: toDate(slot.ends_at),
        durationMin: slot.duration_minutes,
        label: slot.local_label,
      }
    : null;

/* -------------------------------------------------------------------------- */
/* Comptes                                                                     */
/* -------------------------------------------------------------------------- */

export const user = (data) =>
  data
    ? {
        id: data.id,
        firstName: data.first_name,
        lastName: data.last_name,
        email: data.email,
        phone: data.phone,
        promotion: data.promotion,
        department: data.department,
        badgeNumber: data.badge_number,
        avatarUrl: data.avatar_url ?? null,
        status: data.status,
        role: data.promotion?.startsWith('B') ? 'etudiant' : 'personnel',
        preferences: preferences(data.preferences),
      }
    : null;

const preferences = (data) => ({
  preferredBuildingId: data?.preferred_building_id ?? null,
  usualCapacity:
    data?.usual_capacity_min && data?.usual_capacity_max
      ? `${data.usual_capacity_min}-${data.usual_capacity_max}`
      : null,
  emailConfirmation: data?.email_notifications ?? true,
  inAppAlerts: data?.in_app_notifications ?? true,
  reminderDelayMin: data?.reminder_delay_min ?? 30,
  weeklyQuotaHours: data?.weekly_quota_hours ?? 12,
});

/** Sens inverse : le formulaire de préférences vers la charge utile de l'API. */
export const preferencesIn = (form) => {
  const [min, max] = String(form.usualCapacity ?? '').split('-');
  return {
    preferred_building_id: form.preferredBuildingId ?? null,
    usual_capacity_min: min ? Number(min) : null,
    usual_capacity_max: max ? Number(max) : null,
    email_notifications: form.emailConfirmation,
    in_app_notifications: form.inAppAlerts,
    reminder_delay_min: form.reminderDelayMin,
  };
};

export const admin = (session) =>
  session?.admin
    ? {
        id: session.admin.user_id,
        userId: session.admin.user_id,
        firstName: session.user.first_name,
        lastName: session.user.last_name,
        email: session.user.email,
        avatarUrl: session.user.avatar_url ?? null,
        jobTitle: session.admin.job_title,
        isOwner: session.admin.is_owner,
        permissions: session.permissions ?? [],
      }
    : null;

/* -------------------------------------------------------------------------- */
/* Parc                                                                        */
/* -------------------------------------------------------------------------- */

export const building = (data) => ({
  id: data.id,
  code: data.code,
  name: data.name,
  address: data.address,
  imageUrl: data.image_url ?? null,
  // Les écrans affichent un « campus » sous le nom du bâtiment. Le modèle n'en
  // tient pas : l'adresse en tient lieu, elle porte la même information pour
  // un lecteur.
  campus: data.address,
  floorCount: data.floor_count,
  roomCount: data.room_count,
});

export const floor = (data) => ({
  id: data.id,
  buildingId: data.building_id,
  code: data.code,
  label: data.label,
  level: data.level,
  roomCount: data.room_count,
});

export const equipment = (data) => ({
  id: data.id,
  code: data.code,
  label: data.label,
  category: data.category,
  icon: data.icon,
  description: data.description,
  filterable: data.is_filterable,
  roomCount: data.room_count,
});

/**
 * Salle mise à plat.
 *
 * `equipmentIds` est conservé sous ce nom : une dizaine d'écrans le
 * consomment, et le renommer aurait demandé de les toucher.
 */
/**
 * Étage de chaque salle déjà lue.
 *
 * `planIdForRoom` est synchrone — la signature vient des écrans, qui l'appellent
 * pendant le rendu — alors que l'information est désormais distante. Ce cache la
 * rend disponible sans appel : les écrans concernés ont tous chargé la fiche de
 * la salle auparavant.
 */
export const floorOfRoom = new Map();

export const room = (data) => {
  floorOfRoom.set(data.id, data.floor_id);
  return {
    id: data.id,
    name: data.name,
    slug: data.slug,
    buildingId: data.building_id,
    buildingName: data.building_name,
    // Les cartes lisent `room.building?.name` : la fiche aplatie du serveur est
    // renichée ici plutôt que dans le composant.
    building: data.building_name ? { id: data.building_id, name: data.building_name } : null,
    floorId: data.floor_id,
    floor: data.floor_label,
    locationPlanUrl: data.location_plan_url ?? null,
    floorLevel: data.floor_level,
    capacity: data.capacity,
    area: Number(data.area_m2),
    status: data.status,
    accessible: data.is_accessible,
    badgeRequired: data.badge_required,
    description: data.description,
    equipmentIds: (data.equipments ?? []).map((item) => item.equipment_id),
    equipment: (data.equipments ?? []).map((item) => ({
      id: item.equipment_id,
      code: item.code,
      label: item.label,
      category: item.category,
      icon: item.icon,
      quantity: item.quantity,
    })),
    photos: (data.photos ?? []).map((item) => ({
      id: item.id,
      url: item.file_url,
      alt: item.alt_text,
    })),
    plan: data.placement
      ? {
          x: Number(data.placement.pos_x),
          y: Number(data.placement.pos_y),
          w: Number(data.placement.width),
          h: Number(data.placement.height),
          rotation: data.placement.rotation,
        }
      : null,
    occupancyRate: (data.occupancy_percent ?? 0) / 100,
    bookingCount: data.booking_count ?? 0,
  };
};

/** Salle résumée, telle que la rend le moteur de recommandation. */
export const roomSummary = (data) => ({
  id: data.id,
  name: data.name,
  capacity: data.capacity,
  buildingId: data.building_id,
  floorLevel: data.floor_level,
  equipmentIds: data.equipment_ids ?? [],
  accessible: data.is_accessible,
  status: data.is_available ? 'disponible' : 'maintenance',
  occupancyRate: (data.occupancy_percent ?? 0) / 100,
});

/* -------------------------------------------------------------------------- */
/* Disponibilité et recommandation                                             */
/* -------------------------------------------------------------------------- */

export const suggestion = (data) => ({
  room: roomSummary(data.room),
  score: data.score,
  eligible: data.eligible,
  justification: data.justification,
  breakdown: (data.breakdown ?? []).map((item) => ({
    key: item.key,
    label: item.label,
    points: item.points,
    max: item.max_points,
    detail: item.detail,
  })),
});

export const conflict = (data) => ({
  bookingId: data.booking_id,
  title: data.title,
  kind: data.kind,
  overlapMin: data.overlap_minutes,
  gapMin: data.gap_minutes,
  blocking: data.blocking,
  message: data.message,
  ...slotOut(data.slot),
});

export const alternative = (data) => ({
  kind: data.kind,
  roomId: data.room_id,
  score: data.score,
  justification: data.justification,
  ...slotOut(data.slot),
});

export const slotCheck = (data) => ({
  available: data.available,
  forcible: data.forcible,
  requiresValidation: data.requires_validation,
  conflicts: (data.conflicts ?? []).map(conflict),
  violations: (data.violations ?? []).map((item) => ({
    code: item.code,
    message: item.message,
    forcible: item.forcible,
  })),
});

/* -------------------------------------------------------------------------- */
/* Réservations                                                                */
/* -------------------------------------------------------------------------- */

export const booking = (data) => ({
  id: data.id,
  roomId: data.room_id,
  ownerId: data.owner_id,
  title: data.title,
  start: toDate(data.slot?.starts_at),
  end: toDate(data.slot?.ends_at),
  durationMin: data.slot?.duration_minutes,
  label: data.slot?.local_label,
  attendees: data.attendees,
  status: data.status,
  source: data.source,
  forced: data.is_forced,
  checkedInAt: toDate(data.checked_in_at),
  checkedIn: Boolean(data.checked_in_at),
  cancelledAt: toDate(data.cancelled_at),
  cancelReason: data.cancel_reason,
  roomName: data.room_name,
  // Les écrans lisent `booking.room?.building?.name` et `booking.room?.floor`.
  // Le détail complet de la salle n'a pas sa place dans une liste de
  // réservations : seuls son nom et sa localisation y sont affichés.
  room: data.room_name
    ? {
        id: data.room_id,
        name: data.room_name,
        floor: data.floor_label,
        building: data.building_name ? { name: data.building_name } : null,
      }
    : null,
  building: data.building_name ? { name: data.building_name } : null,
  owner: data.owner_name ? { firstName: data.owner_name, lastName: '' } : null,
  accessCode: data.access_code_hint,
  attendance: attendanceOf(data),
  history: (data.events ?? []).map((item) => ({
    id: item.id,
    type: item.event_type,
    at: item.occurred_at,
    label: item.label,
    actor: item.actor_label,
  })),
});

/**
 * Assiduité affichée par le badge de l'écran d'administration : présence
 * validée, absence constatée, ou rien tant que le créneau n'est pas écoulé.
 */
const attendanceOf = (data) => {
  if (data.checked_in_at) return 'presente';
  if (data.status === 'annulee') return null;
  return toDate(data.slot?.ends_at) < new Date() ? 'absente' : 'attendue';
};

export const participant = (data) => ({
  id: data.id,
  bookingId: data.booking_id,
  userId: data.user_id,
  email: data.email,
  name: data.display_name,
  response: data.response,
  organizer: data.is_organizer,
  respondedAt: toDate(data.responded_at),
});

/** Événement de calendrier : les noms sont ceux de FullCalendar. */
export const calendarEvent = (data) => ({
  id: data.id,
  title: data.title,
  start: data.start,
  end: data.end,
  extendedProps: {
    roomId: data.room_id,
    roomName: data.room_name,
    status: data.status,
    source: data.source,
    isMine: data.is_mine,
    isBlocking: data.is_blocking,
  },
});

export const accessRequest = (data) => ({
  id: data.id,
  reference: data.reference,
  requesterId: data.requester_id,
  requesterName: data.requester_name,
  roomId: data.room_id,
  roomName: data.room_name,
  accessType: data.access_type,
  reason: data.reason,
  status: data.status,
  comment: data.decision_comment,
  alternativeRoomId: data.alternative_room_id,
  alternativeRoomName: data.alternative_room_name,
  bookingId: data.booking_id,
  decidedAt: toDate(data.decided_at),
  createdAt: toDate(data.created_at),
  ...slotOut(data.slot),
});

/* -------------------------------------------------------------------------- */
/* Règles                                                                      */
/* -------------------------------------------------------------------------- */

export const rules = (data) =>
  data
    ? {
        id: data.id,
        scope: data.scope,
        buildingId: data.building_id,
        roomId: data.room_id,
        minDurationMin: data.min_duration_min,
        maxDurationMin: data.max_duration_min,
        bufferMin: data.buffer_min,
        maxAdvanceDays: data.max_advance_days,
        minAdvanceMin: data.min_advance_min,
        cancelDeadlineMin: data.cancel_deadline_min,
        checkinWindowMin: data.checkin_window_min,
        weeklyQuotaHours: data.weekly_quota_hours,
        maxActiveBookings: data.max_active_bookings,
        validationThreshold: data.validation_capacity_threshold,
      }
    : null;

/**
 * Règles telles que les écrans les lisent.
 *
 * Le back sépare deux référentiels — contraintes de réservation d'un côté,
 * amplitude d'ouverture de l'autre — parce qu'ils se configurent séparément.
 * Les écrans, eux, parlent d'une seule « règle de la salle ». La couture se
 * fait ici plutôt que dans un composant.
 */
export const roomRules = (bookingRules, openings = []) => {
  const ouverts = openings.filter((item) => item.open);
  const base = rules(bookingRules) ?? {};
  return {
    ...base,
    visitDays: ouverts.map((item) => item.weekday),
    openTime: ouverts.length ? hhmm(ouverts.map((item) => item.opensAt).sort()[0]) : '08:00',
    closeTime: ouverts.length
      ? hhmm(ouverts.map((item) => item.closesAt).sort().at(-1))
      : '20:00',
    constraints: constraintsOf(base),
  };
};

const hhmm = (heure) => (heure ?? '').slice(0, 5);

/**
 * Contraintes en clair. Elles ne sont pas stockées comme des phrases : les
 * afficher revient à traduire les seuils configurés, ce qui garantit que le
 * texte affiché et la règle appliquée ne divergent jamais.
 */
const constraintsOf = (regles) => {
  const lignes = [];
  if (regles.minDurationMin && regles.maxDurationMin) {
    lignes.push(
      `Durée comprise entre ${regles.minDurationMin} et ${regles.maxDurationMin} minutes.`,
    );
  }
  if (regles.bufferMin) {
    lignes.push(`Battement de ${regles.bufferMin} minutes entre deux réservations.`);
  }
  if (regles.maxAdvanceDays) {
    lignes.push(`Réservable jusqu’à ${regles.maxAdvanceDays} jours à l’avance.`);
  }
  if (regles.minAdvanceMin) {
    lignes.push(`À réserver au moins ${regles.minAdvanceMin} minutes à l’avance.`);
  }
  if (regles.cancelDeadlineMin) {
    lignes.push(`Annulation possible jusqu’à ${regles.cancelDeadlineMin} minutes avant.`);
  }
  if (regles.checkinWindowMin) {
    lignes.push(
      `Présence à confirmer dans les ${regles.checkinWindowMin} minutes suivant le début.`,
    );
  }
  if (regles.weeklyQuotaHours) {
    lignes.push(`Quota de ${regles.weeklyQuotaHours} heures par semaine.`);
  }
  if (regles.validationThreshold) {
    lignes.push(
      `Au-delà de ${regles.validationThreshold} participants, une validation est requise.`,
    );
  }
  return lignes;
};

export const rulesIn = (form) => ({
  min_duration_min: form.minDurationMin,
  max_duration_min: form.maxDurationMin,
  buffer_min: form.bufferMin,
  max_advance_days: form.maxAdvanceDays,
  min_advance_min: form.minAdvanceMin,
  cancel_deadline_min: form.cancelDeadlineMin,
  checkin_window_min: form.checkinWindowMin,
  weekly_quota_hours: form.weeklyQuotaHours,
  max_active_bookings: form.maxActiveBookings,
  validation_capacity_threshold: form.validationThreshold,
});

export const openingWindow = (data) => ({
  id: data.id,
  scope: data.scope,
  buildingId: data.building_id,
  roomId: data.room_id,
  weekday: data.weekday,
  open: data.is_open,
  opensAt: data.opens_at,
  closesAt: data.closes_at,
});

export const closure = (data) => ({
  id: data.id,
  label: data.label,
  from: data.first_day,
  to: data.last_day,
  kind: data.kind,
  global: data.is_global,
  buildingIds: data.building_ids ?? [],
  roomIds: data.room_ids ?? [],
  createdAt: toDate(data.created_at),
});

/* -------------------------------------------------------------------------- */
/* Support et notifications                                                    */
/* -------------------------------------------------------------------------- */

export const ticket = (data) => ({
  id: data.id,
  reference: data.reference,
  requesterId: data.requester_id,
  requesterName: data.requester_name,
  subject: data.subject,
  category: data.category,
  status: data.status,
  roomId: data.room_id,
  bookingId: data.booking_id,
  assignedTo: data.assigned_admin_id,
  firstResponseAt: toDate(data.first_response_at),
  resolvedAt: toDate(data.resolved_at),
  messageCount: data.message_count,
  createdAt: toDate(data.created_at),
  messages: (data.messages ?? []).map(ticketMessage),
});

export const ticketMessage = (data) => ({
  id: data.id,
  ticketId: data.ticket_id,
  body: data.body,
  authorId: data.author_user_id,
  fromSupport: data.is_from_support,
  internal: data.is_internal,
  sentAt: toDate(data.sent_at),
});

export const faqCategory = (data) => ({
  id: data.id,
  code: data.code,
  label: data.label,
  icon: data.icon,
  articleCount: data.article_count,
});

export const faqArticle = (data) => ({
  id: data.id,
  categoryId: data.category_id,
  slug: data.slug,
  title: data.title,
  excerpt: data.excerpt,
  body: data.body,
  status: data.status,
  views: data.view_count,
  publishedAt: toDate(data.published_at),
});

export const notification = (data) => ({
  id: data.id,
  title: data.title,
  body: data.body,
  channel: data.channel,
  bookingId: data.booking_id,
  ticketId: data.ticket_id,
  read: Boolean(data.read_at),
  readAt: toDate(data.read_at),
  sentAt: toDate(data.sent_at),
  at: data.sent_at,
  // L'onglet se déduit de ce à quoi la notification renvoie. Une colonne
  // « catégorie » dupliquerait cette information, et les deux finiraient par
  // diverger — une notification rattachée à un ticket est une notification
  // d'aide, il n'y a rien à décider.
  category: data.ticket_id ? 'aide' : data.booking_id ? 'reservation' : 'rappel',
});

export const emailTemplate = (data) => ({
  id: data.id,
  code: data.code,
  name: data.name,
  trigger: data.trigger_label,
  subject: data.subject,
  body: data.body,
  enabled: data.is_enabled,
  updatedAt: toDate(data.updated_at),
});

/* -------------------------------------------------------------------------- */
/* Statistiques et audit                                                       */
/* -------------------------------------------------------------------------- */

export const myStats = (data) => ({
  windowDays: data.window_days,
  total: data.total_bookings,
  active: data.active_bookings,
  cancelled: data.cancelled_bookings,
  upcoming: data.upcoming_bookings,
  hours: data.booked_hours,
  rooms: data.distinct_rooms,
  attendanceRate: data.attendance_rate,
  noShowRate: data.no_show_rate,
});

export const auditEntry = (data) => ({
  id: data.id,
  actor: data.actor_label,
  actorId: data.actor_admin_id,
  action: data.action,
  targetType: data.target_type,
  target: data.target_label,
  targetId: data.target_id,
  before: data.diff_before,
  after: data.diff_after,
  ip: data.ip_address,
  requestId: data.session_id,
  flagged: Boolean(data.flagged_at),
  flagReason: data.flag_reason,
  at: toDate(data.occurred_at),
});

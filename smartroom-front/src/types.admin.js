// Modèle de données de l'espace administration — documentation JSDoc uniquement.
// Complète src/types.js : les entités Room, Booking, User, Ticket, Notification
// et HelpArticle y sont déjà décrites et ne sont pas redéfinies ici.

/**
 * Permissions accordables à un administrateur. Elles correspondent une à une aux
 * lignes de la matrice de l'écran A-12, et conditionnent l'accès aux routes.
 *
 * @typedef {'rooms.manage'       // gérer les salles et les équipements
 *         | 'rules.configure'    // configurer les règles de réservation
 *         | 'users.manage'       // gérer les comptes utilisateurs
 *         | 'support.handle'     // traiter les demandes d'aide
 *         | 'conflicts.arbitrate'// arbitrer les conflits
 *         | 'data.export'        // exporter les données
 *         | 'system.configure'   // configurer le système
 * } Permission
 */

/**
 * @typedef {Object} AdminAccount
 * @property {string} id                  'adm-01'
 * @property {string} firstName
 * @property {string} lastName
 * @property {string} email               adresse @ece.fr
 * @property {string} role                intitulé affiché, ex. 'Directeur de site'
 * @property {Permission[]} permissions
 * @property {string|null} lastLoginAt    ISO
 * @property {boolean} owner              compte propriétaire, permissions non retirables
 *
 * @typedef {Object} AdminInvitation
 * @property {string} id
 * @property {string} email
 * @property {Permission[]} permissions   aperçu affiché sous l'invitation
 * @property {string} sentAt              ISO
 * @property {'en_attente'|'acceptee'|'expiree'} status
 */

/**
 * Entrée du journal d'audit (A-16). Toute écriture administrative en produit une.
 *
 * @typedef {Object} AuditEntry
 * @property {string} id                  '4028'
 * @property {string} at                  ISO
 * @property {string|null} authorId       null pour les actions système
 * @property {string} authorName
 * @property {'modification'|'maintenance'|'permission'|'suppression'|'connexion'} action
 * @property {string} target              cible lisible, ex. 'Règles de réservation'
 * @property {string} targetId
 * @property {string} ip
 * @property {{before: Object, after: Object}|null} diff   valeurs avant/après
 * @property {AuditMetadata} metadata
 *
 * @typedef {Object} AuditMetadata
 * @property {string} browser
 * @property {string} os
 * @property {string} location
 * @property {string} sessionId
 */

/**
 * Modèle d'e-mail éditable (A-15). Le corps accepte les variables listées dans
 * `variables`, rendues par Jinja2 côté FastAPI.
 *
 * @typedef {Object} EmailTemplate
 * @property {string} id                  'tpl-confirmation'
 * @property {string} name
 * @property {string} trigger             description du déclencheur
 * @property {boolean} enabled
 * @property {string} subject
 * @property {string} body                texte ou HTML selon `format`
 * @property {'texte'|'html'} format
 * @property {string[]} variables         ex. ['prenom', 'salle', 'code_acces']
 * @property {string} updatedAt
 */

/**
 * Fermeture exceptionnelle et grille hebdomadaire (A-09).
 *
 * @typedef {Object} ClosurePeriod
 * @property {string} id
 * @property {string} label               'Vacances de printemps'
 * @property {string} from                'YYYY-MM-DD'
 * @property {string} to                  'YYYY-MM-DD'
 * @property {'global'|'batiment'|'salles'} scopeType
 * @property {string[]} scopeIds          vide si global
 * @property {'ferme'|'exception'} kind
 *
 * @typedef {Object} OpeningDay
 * @property {WeekDay} day
 * @property {string} openTime
 * @property {string} closeTime
 * @property {boolean} open
 *
 * @typedef {Object} OpeningSchedule
 * @property {'global'|string} scope      'global' ou identifiant de bâtiment
 * @property {OpeningDay[]} days
 * @property {ClosurePeriod[]} closures
 */

/**
 * Règles de réservation applicables (A-10), globales ou surchargées par salle.
 *
 * @typedef {Object} BookingRuleSet
 * @property {'global'|string} scope      'global' ou identifiant de salle
 * @property {number} minDurationMin
 * @property {number} maxDurationMin
 * @property {number} maxActiveBookings   réservations simultanées par utilisateur
 * @property {number} weeklyQuotaHours
 * @property {number} checkinWindowMin    délai de validation avant libération
 * @property {number} bufferMin
 */

/**
 * Métriques utilisateur affichées dans la fiche (A-11).
 *
 * @typedef {Object} UserMetrics
 * @property {number} reliabilityScore    0 → 100
 * @property {number} remainingCreditsH   heures restantes sur le quota
 * @property {number} bookedHours
 * @property {number} attendanceRate      0 → 1
 * @property {number} noShowRate          0 → 1
 * @property {'actif'|'suspendu'} status
 */

/**
 * Élément de la file d'arbitrage (A-04) : conflit de créneau, demande d'accès
 * dérogatoire ou validation requise.
 *
 * @typedef {Object} QueueItem
 * @property {string} id                  '#CONF-8492'
 * @property {'conflit_double'|'conflit_materiel'|'demande_acces'|'validation'} type
 * @property {'haute'|'moyenne'|'basse'} urgency
 * @property {string} createdAt
 * @property {string} roomId
 * @property {string} title
 * @property {Claimant[]} claimants       deux demandeurs pour un conflit double
 * @property {ScoredRoom[]} alternatives  proposées par utils/recommendation.js
 * @property {'ouvert'|'arbitre'|'refuse'} status
 *
 * @typedef {Object} Claimant
 * @property {string} userId
 * @property {string} name
 * @property {string} role
 * @property {string} start                 ISO
 * @property {string} end                   ISO
 * @property {string} createdAt
 * @property {number} monthlyBookings
 * @property {number} remainingQuotaH
 */

/**
 * Réponse type du support (A-13), insérable dans le fil de discussion.
 *
 * @typedef {Object} ResponseTemplate
 * @property {string} id
 * @property {string} label
 * @property {string} body
 * @property {string} category
 */

/**
 * Article de la base de connaissances vu depuis l'administration (A-14) :
 * l'article public de src/types.js, augmenté de son état de publication.
 *
 * @typedef {Object} ManagedArticle
 * @property {string} id
 * @property {string} category
 * @property {string} title
 * @property {string} excerpt
 * @property {string} body
 * @property {'publie'|'brouillon'} status
 * @property {number} views
 * @property {string} updatedAt
 * @property {string[]} related
 */

export {};

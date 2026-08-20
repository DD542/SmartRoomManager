// Modèle de données partagé — documentation JSDoc uniquement, aucun code exécuté.
// Contrat entre src/mocks/, src/api/ et les pages ; miroir des schémas Pydantic
// attendus côté FastAPI.

/**
 * @typedef {Object} Building
 * @property {string} id                 'b-a'
 * @property {'A'|'B'|'C'} code
 * @property {string} name               'Bâtiment A'
 * @property {string} campus             'Campus Eiffel'
 * @property {string[]} floors           ['RDC','1er','2e']
 * @property {string} entranceLabel
 * @property {string[]} directions       Itinéraire depuis l'entrée
 */

/**
 * @typedef {Object} Equipment
 * @property {string} id                 'eq-visio'
 * @property {string} label              'Visio-conférence'
 * @property {string} icon               Nom d'icône lucide-react
 * @property {'av'|'confort'|'mobilier'} category
 */

/**
 * @typedef {0|1|2|3|4|5|6} WeekDay      0 = dimanche (convention date-fns)
 *
 * @typedef {Object} OpeningRules
 * @property {WeekDay[]} visitDays       Jours de visite autorisés pour cette salle
 * @property {string} openTime           '08:00'
 * @property {string} closeTime          '20:00'
 * @property {number} minDurationMin
 * @property {number} maxDurationMin
 * @property {number} bufferMin          Battement imposé entre deux réservations
 * @property {string[]} constraints      Règles affichées à l'utilisateur
 *
 * @typedef {Object} Room
 * @property {string} id
 * @property {string} name
 * @property {string} buildingId
 * @property {string} floor
 * @property {number} capacity
 * @property {number} area
 * @property {string[]} equipmentIds
 * @property {boolean} accessible
 * @property {boolean} badgeRequired
 * @property {'disponible'|'occupee'|'maintenance'} status
 * @property {string} description
 * @property {string[]} photos
 * @property {number} occupancyRate      0 → 1
 * @property {OpeningRules} rules
 * @property {{x:number,y:number,w:number,h:number}} plan
 */

/**
 * @typedef {Object} Preferences
 * @property {string} preferredBuildingId
 * @property {'2-4'|'5-10'|'10+'} usualCapacity
 * @property {boolean} emailConfirmation
 * @property {boolean} inAppAlerts
 * @property {15|30|60} reminderDelayMin
 *
 * @typedef {Object} User
 * @property {string} id
 * @property {string} firstName
 * @property {string} lastName
 * @property {string} email
 * @property {string} phone
 * @property {string} promotion
 * @property {string} department
 * @property {string} badgeNumber
 * @property {'etudiant'|'enseignant'|'gestionnaire'} role
 * @property {Preferences} preferences
 */

/**
 * @typedef {Object} Participant
 * @property {string} name
 * @property {string} email
 * @property {string|null} userId
 * @property {boolean} organizer
 * @property {'accepte'|'en_attente'|'decline'} status
 *
 * @typedef {Object} RecurrenceRule
 * @property {'quotidienne'|'hebdomadaire'|'mensuelle'} frequency
 * @property {WeekDay[]} weekDays
 * @property {{type:'count'|'until', value:any}} end
 *
 * @typedef {Object} BookingEvent
 * @property {'creee'|'confirmee'|'modifiee'|'rappel_envoye'|'annulee'|'checkin'} type
 * @property {string} at
 * @property {string} label
 *
 * @typedef {Object} Booking
 * @property {string} id
 * @property {string} roomId
 * @property {string} ownerId
 * @property {string} title
 * @property {string} start              ISO
 * @property {string} end                ISO
 * @property {number} attendees
 * @property {string[]} requiredEquipmentIds
 * @property {'en_attente'|'confirmee'|'terminee'|'annulee'} status
 * @property {string|null} accessCode
 * @property {boolean} checkedIn
 * @property {Participant[]} participants
 * @property {RecurrenceRule|null} recurrence
 * @property {string|null} seriesId
 * @property {BookingEvent[]} history
 * @property {string|null} cancelReason
 */

/**
 * @typedef {Object} AccessRequest
 * @property {string} id
 * @property {string} roomId
 * @property {string} date
 * @property {string} reason
 * @property {string} approverId
 * @property {number} attendees
 * @property {'envoyee'|'validee'|'refusee'} status
 */

/**
 * @typedef {Object} Notification
 * @property {string} id
 * @property {'reservation'|'rappel'|'aide'|'conflit'} category
 * @property {string} title
 * @property {string} body
 * @property {string} at
 * @property {boolean} read
 * @property {{label:string,to:string}|null} action
 */

/**
 * @typedef {Object} TicketMessage
 * @property {'utilisateur'|'support'} author
 * @property {string} at
 * @property {string} body
 *
 * @typedef {Object} Ticket
 * @property {string} id
 * @property {string} subject
 * @property {'acces'|'equipement'|'maintenance'|'compte'} category
 * @property {'ouvert'|'en_cours'|'resolu'} status
 * @property {string} updatedAt
 * @property {string|null} roomId
 * @property {TicketMessage[]} messages
 */

/**
 * @typedef {Object} HelpArticle
 * @property {string} id
 * @property {string} category
 * @property {string} title
 * @property {string} excerpt
 * @property {string} body
 * @property {string} updatedAt
 */

/**
 * @typedef {Object} Conflict            Sortie de utils/conflicts.js
 * @property {Booking} booking
 * @property {'total'|'partiel'|'adjacent'} kind
 * @property {number} overlapMin
 * @property {number|null} gapMin
 * @property {boolean} blocking
 * @property {string} message
 *
 * @typedef {Object} ScoredRoom          Sortie de utils/recommendation.js
 * @property {Room} room
 * @property {number} score              0 → 100
 * @property {{key:string,label:string,points:number,max:number,detail:string}[]} breakdown
 * @property {boolean} eligible
 * @property {string} justification
 */

export {};

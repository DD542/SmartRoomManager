/**
 * Modèles d'e-mails éditables (A-15).
 * Les deux premiers correspondent aux gabarits HTML déjà livrés dans emails/.
 */

export const templateVariables = [
  'prenom',
  'salle',
  'batiment',
  'date',
  'creneau',
  'code_acces',
  'lien_reservation',
];

export const emailTemplates = [
  {
    id: 'tpl-confirmation',
    name: 'Confirmation de réservation',
    trigger: 'Déclenché lors de la création d’une réservation',
    enabled: true,
    format: 'texte',
    subject: 'Votre réservation {{salle}} est confirmée',
    body:
      'Bonjour {{prenom}},\n\n' +
      'Votre réservation pour la salle {{salle}} ({{batiment}}) est confirmée pour le {{date}} ' +
      'sur le créneau {{creneau}}.\n\n' +
      'Votre code d’accès temporaire est : {{code_acces}}\n\n' +
      'Pour gérer votre réservation, utilisez ce lien : {{lien_reservation}}\n\n' +
      'L’équipe Support.',
    updatedAt: '2026-03-10T09:00:00',
  },
  {
    id: 'tpl-rappel',
    name: 'Rappel avant réunion',
    trigger: 'Déclenché selon le délai de rappel choisi par l’utilisateur',
    enabled: true,
    format: 'texte',
    subject: 'Votre réservation {{salle}} commence bientôt',
    body:
      'Bonjour {{prenom}},\n\n' +
      'Votre réunion en salle {{salle}} commence à {{creneau}}. Pensez à valider votre présence ' +
      'sur place, sans quoi le créneau sera libéré.\n\n' +
      'Code d’accès : {{code_acces}}\n\n' +
      'L’équipe Support.',
    updatedAt: '2026-03-10T09:05:00',
  },
  {
    id: 'tpl-annulation',
    name: 'Annulation de réservation',
    trigger: 'Déclenché lorsqu’une réservation est annulée',
    enabled: true,
    format: 'texte',
    subject: 'Votre réservation {{salle}} du {{date}} est annulée',
    body:
      'Bonjour {{prenom}},\n\n' +
      'La réservation de la salle {{salle}} prévue le {{date}} sur le créneau {{creneau}} a été ' +
      'annulée. Le créneau est de nouveau disponible à la réservation.\n\n' +
      'L’équipe Support.',
    updatedAt: '2026-02-28T14:30:00',
  },
  {
    id: 'tpl-conflit',
    name: 'Conflit arbitré',
    trigger: 'Déclenché après arbitrage d’un conflit par un administrateur',
    enabled: false,
    format: 'texte',
    subject: 'Votre demande sur la salle {{salle}} a été arbitrée',
    body:
      'Bonjour {{prenom}},\n\n' +
      'Votre demande sur la salle {{salle}} pour le créneau {{creneau}} du {{date}} a été examinée ' +
      'par l’administration.\n\n' +
      'L’équipe Support.',
    updatedAt: '2026-03-18T11:45:00',
  },
];

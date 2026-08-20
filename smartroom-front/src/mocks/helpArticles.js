/** Base de connaissances du centre d'aide (U-22) et de la recherche globale (U-25). */

export const helpCategories = [
  { id: 'reserver', label: 'Réserver une salle', icon: 'CalendarPlus', count: 12 },
  { id: 'codes', label: 'Codes d’accès', icon: 'KeyRound', count: 8 },
  { id: 'annulation', label: 'Annulation', icon: 'XCircle', count: 5 },
  { id: 'equipements', label: 'Équipements', icon: 'Monitor', count: 15 },
  { id: 'compte', label: 'Compte', icon: 'User', count: 9 },
];

export const helpArticles = [
  {
    id: 'ha-01',
    category: 'codes',
    title: 'Comment obtenir le code d’accès de la Salle Vinci ?',
    excerpt: 'Le code est généré une heure avant le début de la réunion et envoyé par e-mail.',
    body:
      "Le code d'accès est généré automatiquement une heure avant le début de votre réservation. " +
      "Il apparaît sur la fiche de la réservation, dans l'e-mail de confirmation et dans le rappel. " +
      "Toute modification de la salle ou de l'horaire entraîne la génération d'un nouveau code.",
    updatedAt: '2026-01-20T10:00:00',
  },
  {
    id: 'ha-02',
    category: 'reserver',
    title: 'Réserver une salle en quatre étapes',
    excerpt: 'Besoin, sélection, validation du créneau, confirmation.',
    body:
      "Décrivez d'abord votre besoin (date, capacité, équipements), puis choisissez une salle parmi " +
      "les propositions classées par pertinence. Validez ensuite le créneau sur le calendrier de la " +
      'salle, enfin confirmez : le code d’accès et l’e-mail de confirmation sont envoyés immédiatement.',
    updatedAt: '2026-02-02T09:00:00',
  },
  {
    id: 'ha-03',
    category: 'annulation',
    title: 'Jusqu’à quand puis-je annuler une réservation ?',
    excerpt: 'À tout moment avant le début du créneau, avec un motif obligatoire.',
    body:
      "Une réservation peut être annulée tant qu'elle n'a pas commencé. Le motif est obligatoire : il " +
      "alimente les statistiques d'occupation. Les participants sont prévenus par e-mail si vous " +
      'laissez la case correspondante cochée, et le créneau est libéré immédiatement.',
    updatedAt: '2026-02-11T14:30:00',
  },
  {
    id: 'ha-04',
    category: 'equipements',
    title: 'Signaler un équipement défectueux',
    excerpt: 'Ouvrez un ticket depuis la fiche de la salle ou le centre d’aide.',
    body:
      "Depuis la fiche d'une salle, utilisez « Signaler un problème » pour créer un ticket de " +
      'maintenance. Précisez l’équipement et le créneau concerné : le service technique traite les ' +
      'demandes sous 24 h ouvrées.',
    updatedAt: '2026-03-01T08:00:00',
  },
  {
    id: 'ha-05',
    category: 'compte',
    title: 'Modifier mon délai de rappel',
    excerpt: '15, 30 ou 60 minutes avant le début de la réunion.',
    body:
      'Rendez-vous dans Profil et paramètres, section Notifications. Le délai choisi s’applique à ' +
      'toutes vos réservations futures, y compris celles déjà créées.',
    updatedAt: '2026-03-05T17:45:00',
  },
  {
    id: 'ha-06',
    category: 'reserver',
    title: 'Réserver en dehors des jours de visite',
    excerpt: 'Une demande d’accès exceptionnel doit être validée par le gestionnaire de site.',
    body:
      "Certaines salles ne sont ouvertes que certains jours. Pour un créneau hors de ces jours, une " +
      "demande d'accès exceptionnel est nécessaire : motivez la demande, indiquez l'effectif attendu " +
      'et attendez la validation du directeur de site (délai indicatif de 24 h).',
    updatedAt: '2026-03-12T11:20:00',
  },
];

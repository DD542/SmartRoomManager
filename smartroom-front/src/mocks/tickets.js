/** Tickets de support de l'utilisateur connecté (U-22). */
export const tickets = [
  {
    id: '148',
    subject: 'Code d’accès invalide — Salle Vinci',
    category: 'acces',
    status: 'en_cours',
    updatedAt: '2026-03-25T15:10:00',
    roomId: 'r-vinci',
    messages: [
      {
        author: 'utilisateur',
        at: '2026-03-24T14:20:00',
        body: 'Le code A-4821 est refusé par le terminal de la salle Vinci depuis ce matin.',
      },
      {
        author: 'support',
        at: '2026-03-25T15:10:00',
        body: 'Le terminal a été resynchronisé. Merci de réessayer avec le même code et de nous confirmer.',
      },
    ],
  },
  {
    id: '131',
    subject: 'Demande d’ajout de projecteur',
    category: 'equipement',
    status: 'resolu',
    updatedAt: '2026-03-10T09:00:00',
    roomId: 'r-eiffel',
    messages: [
      {
        author: 'utilisateur',
        at: '2026-03-08T10:00:00',
        body: 'Serait-il possible d’ajouter un vidéoprojecteur en salle Eiffel ?',
      },
      {
        author: 'support',
        at: '2026-03-10T09:00:00',
        body: 'Un projecteur mobile est désormais disponible à l’accueil du bâtiment A sur demande.',
      },
    ],
  },
  {
    id: '152',
    subject: 'Climatisation défectueuse — Salle Curie',
    category: 'maintenance',
    status: 'ouvert',
    updatedAt: '2026-03-26T09:50:00',
    roomId: 'r-curie',
    messages: [
      {
        author: 'utilisateur',
        at: '2026-03-26T09:50:00',
        body: 'La climatisation ne démarre plus, la salle est difficilement utilisable l’après-midi.',
      },
    ],
  },
];

export const ticketCategories = [
  { id: 'acces', label: 'Accès' },
  { id: 'equipement', label: 'Équipement' },
  { id: 'maintenance', label: 'Maintenance' },
  { id: 'compte', label: 'Compte' },
];

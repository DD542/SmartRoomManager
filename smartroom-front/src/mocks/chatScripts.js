/**
 * Scénarios du chatbot (U-23). Chaque intention est reconnue par mots-clés ;
 * la réponse peut porter une carte de salle et des réponses rapides.
 * Côté FastAPI, cette table sera remplacée par POST /api/chatbot/messages.
 */
export const chatIntents = [
  {
    id: 'salle_libre',
    keywords: ['salle', 'libre', 'disponible', 'trouver', 'réserver', 'reserver'],
    reply: 'J’ai cherché une salle correspondant à votre besoin :',
    withRoomCard: true,
    quickReplies: ['Autre créneau', 'Plus grande salle', 'Parler à un humain'],
  },
  {
    id: 'code_acces',
    keywords: ['code', 'accès', 'acces', 'badge', 'porte', 'entrer'],
    reply:
      'Le code d’accès est généré une heure avant le début de la réunion. Il figure sur la fiche de votre réservation et dans l’e-mail de confirmation.',
    withRoomCard: false,
    quickReplies: ['Voir mes réservations', 'Mon code ne marche pas'],
  },
  {
    id: 'annuler',
    keywords: ['annuler', 'annulation', 'supprimer', 'décommander'],
    reply:
      'Vous pouvez annuler depuis le détail de la réservation, tant que le créneau n’a pas commencé. Un motif est demandé et les participants sont prévenus.',
    withRoomCard: false,
    quickReplies: ['Voir mes réservations', 'Modifier plutôt'],
  },
  {
    id: 'humain',
    keywords: ['humain', 'support', 'ticket', 'personne', 'conseiller'],
    reply:
      'Je transmets votre demande au support. Vous pouvez aussi ouvrir un ticket depuis le centre d’aide, une réponse arrive sous 24 h ouvrées.',
    withRoomCard: false,
    quickReplies: ['Ouvrir le centre d’aide'],
  },
];

export const chatFallback = {
  reply:
    'Je n’ai pas compris cette demande. Je sais trouver une salle, expliquer les codes d’accès, ou vous aider à annuler une réservation.',
  quickReplies: ['Une salle de 6 personnes demain matin ?', 'Comment obtenir mon code ?'],
};

export const chatGreeting = {
  reply: 'Bonjour, je suis SmartBot. Que puis-je faire pour vous ?',
  quickReplies: ['Une salle de 6 personnes demain matin ?', 'Où est la salle Vinci ?'],
};

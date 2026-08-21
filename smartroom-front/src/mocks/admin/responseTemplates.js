/** Réponses types insérables dans le fil d'un ticket (A-13). */
export const responseTemplates = [
  {
    id: 'rep-code',
    category: 'acces',
    label: 'Code d’accès resynchronisé',
    body:
      'Bonjour, je viens de forcer une mise à jour du terminal de la salle. ' +
      'Pouvez-vous réessayer avec le même code et me confirmer que l’accès fonctionne ?',
  },
  {
    id: 'rep-nouveau-code',
    category: 'acces',
    label: 'Nouveau code généré',
    body:
      'Bonjour, un nouveau code d’accès vient d’être généré pour votre réservation. ' +
      'Il vous a été envoyé par e-mail et apparaît sur la fiche de la réservation.',
  },
  {
    id: 'rep-maintenance',
    category: 'maintenance',
    label: 'Intervention programmée',
    body:
      'Bonjour, votre signalement a été transmis au service technique. ' +
      'Une intervention est programmée sous 24 h ouvrées ; la salle reste réservable entre-temps.',
  },
  {
    id: 'rep-equipement',
    category: 'equipement',
    label: 'Équipement mobile disponible',
    body:
      'Bonjour, un équipement mobile équivalent est disponible à l’accueil du bâtiment sur ' +
      'simple demande, le temps du remplacement.',
  },
  {
    id: 'rep-cloture',
    category: 'compte',
    label: 'Clôture après résolution',
    body:
      'Bonjour, sans retour de votre part sous 48 h, nous clôturerons cette demande. ' +
      'Vous pouvez la rouvrir à tout moment depuis le centre d’aide.',
  },
];

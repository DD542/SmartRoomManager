/**
 * Base de connaissances du centre d'aide (U-22) et de la recherche globale (U-25).
 *
 * Les réponses décrivent le comportement réel de l'application : battement de
 * 15 minutes, jours de visite, régénération du code d'accès, fenêtre de
 * validation de présence. Les compteurs de catégories sont calculés à partir de
 * cette liste, jamais saisis à la main.
 */

export const helpCategories = [
  { id: 'reserver', label: 'Réserver une salle', icon: 'CalendarPlus' },
  { id: 'codes', label: 'Codes d’accès', icon: 'KeyRound' },
  { id: 'annulation', label: 'Annulation et modification', icon: 'XCircle' },
  { id: 'equipements', label: 'Équipements et salles', icon: 'Monitor' },
  { id: 'compte', label: 'Compte et notifications', icon: 'User' },
];

export const helpArticles = [
  {
    id: 'ha-01',
    category: 'reserver',
    title: 'Réserver une salle en quatre étapes',
    excerpt: 'Besoin, sélection, validation du créneau, confirmation.',
    body:
      'Décrivez d’abord votre besoin : date, créneau, effectif et équipements requis. ' +
      'Le système propose ensuite les salles compatibles, classées par pertinence. ' +
      'Choisissez-en une pour ouvrir son calendrier, sélectionnez le créneau puis confirmez : ' +
      'le code d’accès et l’e-mail de confirmation partent immédiatement.',
    updatedAt: '2026-02-02T09:00:00',
    related: ['ha-02', 'ha-04'],
  },
  {
    id: 'ha-02',
    category: 'reserver',
    title: 'Sur quels critères une salle m’est-elle recommandée ?',
    excerpt: 'Un score sur 100 pondère capacité, équipements, bâtiment et occupation.',
    body:
      'Quatre critères sont pondérés : l’ajustement de la capacité (35 points, un surdimensionnement ' +
      'est pénalisé), la présence des équipements demandés (30), votre bâtiment de préférence (15) ' +
      'et le taux d’occupation de la salle (20). La justification affichée sous chaque proposition ' +
      'est construite à partir de ce calcul : elle change avec vos critères.',
    updatedAt: '2026-02-14T11:00:00',
    related: ['ha-03', 'ha-10'],
  },
  {
    id: 'ha-03',
    category: 'reserver',
    title: 'Pourquoi une salle apparaît-elle « à capacité juste » ?',
    excerpt: 'Elle accueille votre effectif, mais sans marge.',
    body:
      'Une salle dont la capacité correspond exactement à votre effectif reste proposée, mais ' +
      'signalée : aucune place supplémentaire n’est disponible si un participant s’ajoute. ' +
      'Les salles trop petites, elles, sont écartées de la sélection.',
    updatedAt: '2026-02-14T11:10:00',
    related: ['ha-02'],
  },
  {
    id: 'ha-04',
    category: 'reserver',
    title: 'Un conflit est détecté sur mon créneau, que faire ?',
    excerpt: 'Décaler l’horaire, ou changer de salle sur le même créneau.',
    body:
      'Le moteur distingue trois cas : le créneau est déjà entièrement pris, il chevauche ' +
      'partiellement une autre réunion, ou il est trop proche de la précédente. L’écran de conflit ' +
      'propose des créneaux libres dans la même salle et des salles équivalentes sur le créneau ' +
      'initial, chacun noté en pourcentage de compatibilité.',
    updatedAt: '2026-03-02T16:20:00',
    related: ['ha-05', 'ha-02'],
  },
  {
    id: 'ha-05',
    category: 'reserver',
    title: 'Pourquoi dois-je laisser 15 minutes entre deux réunions ?',
    excerpt: 'C’est le battement exigé pour l’aération et la remise en état.',
    body:
      'Chaque salle impose un battement entre deux réservations. Une demande qui démarre moins de ' +
      '15 minutes après la fin de la précédente est signalée comme conflit potentiel : elle reste ' +
      'possible, mais l’écran vous propose un créneau décalé.',
    updatedAt: '2026-03-02T16:25:00',
    related: ['ha-04'],
  },
  {
    id: 'ha-06',
    category: 'reserver',
    title: 'Réserver plusieurs occurrences d’un coup',
    excerpt: 'Activez la récurrence, puis vérifiez l’aperçu des dates générées.',
    body:
      'Activez « Réunion récurrente » à l’étape 1, choisissez une salle, puis configurez la règle : ' +
      'quotidienne, hebdomadaire ou mensuelle, avec une fin après N occurrences ou à une date. ' +
      'L’aperçu qualifie chaque date : les occurrences en conflit sont signalées et seront ignorées ' +
      'à la création, les autres sont réservées en une fois.',
    updatedAt: '2026-03-08T10:15:00',
    related: ['ha-04', 'ha-07'],
  },
  {
    id: 'ha-07',
    category: 'reserver',
    title: 'Réserver en dehors des jours d’ouverture d’une salle',
    excerpt: 'Une demande d’accès exceptionnel doit être validée par le gestionnaire de site.',
    body:
      'Certaines salles ne sont ouvertes que certains jours. Pour un créneau en dehors, une demande ' +
      'd’accès exceptionnel est nécessaire : motivez-la, indiquez l’effectif attendu et acceptez les ' +
      'consignes de sécurité. Le gestionnaire répond sous 24 h ouvrées.',
    updatedAt: '2026-03-12T11:20:00',
    related: ['ha-16'],
  },
  {
    id: 'ha-08',
    category: 'codes',
    title: 'Comment obtenir le code d’accès de ma salle ?',
    excerpt: 'Il est généré une heure avant la réunion et visible sur la réservation.',
    body:
      'Le code est généré automatiquement une heure avant le début de votre réservation. Il apparaît ' +
      'sur la fiche de la réservation, dans l’e-mail de confirmation et dans le rappel. Sur le tableau ' +
      'de bord, il reste masqué jusqu’à ce que vous cliquiez sur « Révéler ».',
    updatedAt: '2026-01-20T10:00:00',
    related: ['ha-09', 'ha-11'],
  },
  {
    id: 'ha-09',
    category: 'codes',
    title: 'Mon code d’accès ne fonctionne pas',
    excerpt: 'Vérifiez qu’il s’agit du dernier code envoyé, puis ouvrez un ticket.',
    body:
      'Toute modification de l’horaire ou de la salle régénère le code : assurez-vous d’utiliser ' +
      'celui du dernier e-mail reçu. Si le terminal refuse toujours un code valide, ouvrez une ' +
      'demande d’assistance en catégorie « Accès » : le terminal sera resynchronisé.',
    updatedAt: '2026-03-25T15:10:00',
    related: ['ha-08', 'ha-13'],
  },
  {
    id: 'ha-10',
    category: 'codes',
    title: 'Quelles salles exigent un badge en plus du code ?',
    excerpt: 'Les salles de conseil et les salles premium, signalées « Badge requis ».',
    body:
      'Certaines salles demandent un badge d’accès actif en plus du code numérique. La mention ' +
      '« Badge requis » apparaît sur la fiche de la salle, sur le détail de la réservation et dans ' +
      'l’e-mail de confirmation. Le numéro de badge figure dans votre profil.',
    updatedAt: '2026-02-18T09:40:00',
    related: ['ha-08', 'ha-19'],
  },
  {
    id: 'ha-11',
    category: 'codes',
    title: 'Valider ma présence sur place',
    excerpt: 'La validation s’ouvre 10 minutes avant le début du créneau.',
    body:
      'Sur place, saisissez les quatre chiffres du code affiché sur l’écran de la salle. La fenêtre ' +
      'de validation s’ouvre 10 minutes avant le début et se ferme 10 minutes après. Sans validation, ' +
      'le créneau est libéré et la salle redevient réservable. Le bouton « Je suis en retard » ' +
      'prolonge la fenêtre de 10 minutes.',
    updatedAt: '2026-03-18T08:30:00',
    related: ['ha-09', 'ha-20'],
  },
  {
    id: 'ha-12',
    category: 'annulation',
    title: 'Jusqu’à quand puis-je annuler une réservation ?',
    excerpt: 'À tout moment avant le début du créneau, avec un motif obligatoire.',
    body:
      'Une réservation s’annule tant qu’elle n’a pas commencé. Le motif est obligatoire : il alimente ' +
      'les statistiques d’occupation. Les participants sont prévenus par e-mail si vous laissez la ' +
      'case correspondante cochée, et le créneau est libéré immédiatement.',
    updatedAt: '2026-02-11T14:30:00',
    related: ['ha-13', 'ha-14'],
  },
  {
    id: 'ha-13',
    category: 'annulation',
    title: 'Modifier l’horaire ou la salle d’une réservation',
    excerpt: 'La modification régénère le code d’accès et prévient les participants.',
    body:
      'Depuis le détail de la réservation, « Modifier » permet de changer la date, le créneau, la ' +
      'salle, l’effectif et les participants. Le nouveau créneau est revérifié : s’il entre en ' +
      'conflit, la modification est refusée avec le motif. Tout changement d’horaire ou de salle ' +
      'génère un nouveau code, envoyé à l’ensemble des participants.',
    updatedAt: '2026-03-05T09:15:00',
    related: ['ha-12', 'ha-09'],
  },
  {
    id: 'ha-14',
    category: 'annulation',
    title: 'Annuler une seule occurrence d’une série',
    excerpt: 'Chaque occurrence est une réservation indépendante.',
    body:
      'Les occurrences d’une réunion récurrente sont créées comme des réservations distinctes, ' +
      'rattachées à la même série. Annuler l’une d’elles depuis « Mes réservations » ne touche pas ' +
      'les autres dates.',
    updatedAt: '2026-03-08T10:30:00',
    related: ['ha-06'],
  },
  {
    id: 'ha-15',
    category: 'equipements',
    title: 'Filtrer les salles par équipement',
    excerpt: 'Visio, écran, tableau blanc, vidéoprojecteur, micro, prises, climatisation.',
    body:
      'Les équipements requis se sélectionnent à l’étape 1 du tunnel ou depuis le rail de filtres du ' +
      'catalogue. Une salle n’est proposée que si elle possède la totalité des équipements demandés : ' +
      'retirez-en un pour élargir les résultats.',
    updatedAt: '2026-02-20T13:00:00',
    related: ['ha-02', 'ha-17'],
  },
  {
    id: 'ha-16',
    category: 'equipements',
    title: 'Trouver une salle accessible PMR',
    excerpt: 'Un filtre dédié écarte les salles non accessibles.',
    body:
      'L’option « Salle accessible PMR » ne retient que les salles de plain-pied ou desservies par un ' +
      'ascenseur. Elle est disponible à l’étape 1 du tunnel et dans les filtres du catalogue, et ' +
      'reste active pendant toute la recherche.',
    updatedAt: '2026-02-20T13:10:00',
    related: ['ha-15'],
  },
  {
    id: 'ha-17',
    category: 'equipements',
    title: 'Signaler un équipement défectueux',
    excerpt: 'Ouvrez un ticket en catégorie « Maintenance » ou « Équipement ».',
    body:
      'Depuis le centre d’aide, créez une demande en précisant la salle, l’équipement concerné et le ' +
      'créneau. Le service technique traite les demandes sous 24 h ouvrées ; l’avancement se suit ' +
      'dans « Mes demandes ».',
    updatedAt: '2026-03-01T08:00:00',
    related: ['ha-18'],
  },
  {
    id: 'ha-18',
    category: 'equipements',
    title: 'Pourquoi une salle est-elle indisponible ?',
    excerpt: 'Elle est occupée sur le créneau, ou en maintenance.',
    body:
      'Une salle « Occupée » est réservée sur le créneau demandé : un autre horaire la rend à nouveau ' +
      'disponible. Une salle « En maintenance » est retirée de la réservation le temps de ' +
      'l’intervention, et n’apparaît pas dans les recommandations.',
    updatedAt: '2026-03-04T17:45:00',
    related: ['ha-17', 'ha-04'],
  },
  {
    id: 'ha-19',
    category: 'compte',
    title: 'Modifier mon délai de rappel',
    excerpt: '15, 30 ou 60 minutes avant le début de la réunion.',
    body:
      'Dans Profil et paramètres, section Notifications, choisissez le délai souhaité. Il s’applique ' +
      'à toutes vos réservations, y compris celles déjà créées.',
    updatedAt: '2026-03-05T17:45:00',
    related: ['ha-20'],
  },
  {
    id: 'ha-20',
    category: 'compte',
    title: 'Quelles notifications vais-je recevoir ?',
    excerpt: 'Confirmation, rappel avant la réunion, conflits et réponses du support.',
    body:
      'Deux réglages indépendants : l’e-mail de confirmation à chaque réservation, et les alertes ' +
      'dans l’application pour les conflits, les validations et les réponses du support. Le rappel ' +
      'avant réunion suit le délai choisi dans votre profil.',
    updatedAt: '2026-03-06T09:00:00',
    related: ['ha-19'],
  },
  {
    id: 'ha-21',
    category: 'compte',
    title: 'À quoi servent mes statistiques ?',
    excerpt: 'Heures réservées, répartition par salle, créneaux préférés, taux de présence.',
    body:
      'L’écran Mes statistiques agrège vos réservations sur le mois, le trimestre ou l’année : heures ' +
      'réservées, annulations, répartition par salle et créneaux les plus utilisés. Le taux de ' +
      'présence compte les réunions passées pour lesquelles vous avez validé votre arrivée.',
    updatedAt: '2026-03-10T14:20:00',
    related: ['ha-11'],
  },
  {
    id: 'ha-22',
    category: 'compte',
    title: 'Changer mon mot de passe',
    excerpt: 'L’authentification est gérée par le compte de l’école.',
    body:
      'Le mot de passe se modifie depuis l’intranet ECE, pas depuis SmartRoom Manager. En cas d’oubli, ' +
      'utilisez « Mot de passe oublié » sur l’écran de connexion : un lien valable 30 minutes est ' +
      'envoyé sur votre adresse institutionnelle.',
    updatedAt: '2026-01-28T10:05:00',
    related: ['ha-20'],
  },
];

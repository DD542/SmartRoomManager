/** Annuaire. `u-01` est l'utilisateur connecté dans toute la maquette. */
export const users = [
  {
    id: 'u-01',
    firstName: 'Dylan',
    lastName: 'Menga Wanda',
    email: 'dylan.menga@edu.ece.fr',
    phone: '06 12 34 56 78',
    promotion: 'B3 Data & IA',
    department: 'Ingénierie',
    badgeNumber: '20841',
    role: 'etudiant',
    preferences: {
      preferredBuildingId: 'b-a',
      usualCapacity: '5-10',
      emailConfirmation: true,
      inAppAlerts: true,
      reminderDelayMin: 30,
    },
  },
  {
    id: 'u-02',
    firstName: 'Jean',
    lastName: 'Dupont',
    email: 'jean.dupont@entreprise.com',
    phone: '06 22 11 90 04',
    promotion: 'B3 Data & IA',
    department: 'Ingénierie',
    badgeNumber: '20718',
    role: 'etudiant',
    preferences: { preferredBuildingId: 'b-a', usualCapacity: '5-10', emailConfirmation: true, inAppAlerts: true, reminderDelayMin: 15 },
  },
  {
    id: 'u-03',
    firstName: 'Alice',
    lastName: 'Leroy',
    email: 'alice.leroy@entreprise.com',
    phone: '06 44 78 12 30',
    promotion: 'B3 Cyber',
    department: 'Ingénierie',
    badgeNumber: '20902',
    role: 'etudiant',
    preferences: { preferredBuildingId: 'b-b', usualCapacity: '2-4', emailConfirmation: true, inAppAlerts: false, reminderDelayMin: 30 },
  },
  {
    id: 'u-04',
    firstName: 'Marc',
    lastName: 'Blanc',
    email: 'marc.blanc@entreprise.com',
    phone: '06 71 65 22 18',
    promotion: 'B3 Data & IA',
    department: 'Ingénierie',
    badgeNumber: '20655',
    role: 'etudiant',
    preferences: { preferredBuildingId: 'b-a', usualCapacity: '5-10', emailConfirmation: false, inAppAlerts: true, reminderDelayMin: 60 },
  },
  {
    id: 'u-05',
    firstName: 'Marie',
    lastName: 'Laurent',
    email: 'marie.laurent@entreprise.com',
    phone: '06 39 55 40 71',
    promotion: '—',
    department: 'Pédagogie',
    badgeNumber: '10233',
    role: 'enseignant',
    preferences: { preferredBuildingId: 'b-b', usualCapacity: '10+', emailConfirmation: true, inAppAlerts: true, reminderDelayMin: 30 },
  },
  {
    id: 'u-06',
    firstName: 'Samir',
    lastName: 'Boukehila',
    email: 's.boukehila@ece.fr',
    phone: '01 44 39 06 00',
    promotion: '—',
    department: 'Direction de site',
    badgeNumber: '10001',
    role: 'gestionnaire',
    preferences: { preferredBuildingId: 'b-b', usualCapacity: '10+', emailConfirmation: true, inAppAlerts: true, reminderDelayMin: 60 },
  },
  {
    id: 'u-07',
    firstName: 'Amadou',
    lastName: 'Diallo',
    email: 'a.diallo@ece.fr',
    phone: '01 44 39 06 12',
    promotion: '—',
    department: 'Pédagogie',
    badgeNumber: '10087',
    role: 'enseignant',
    preferences: { preferredBuildingId: 'b-a', usualCapacity: '10+', emailConfirmation: true, inAppAlerts: false, reminderDelayMin: 15 },
  },
];

export const userById = Object.fromEntries(users.map((u) => [u.id, u]));

/** Session de démonstration : aucun stockage navigateur, l'état vit dans React. */
export const currentUserId = 'u-01';

/**
 * Comptes acceptés par l'écran de connexion (mot de passe factice partagé).
 * Le second compte est un gestionnaire de site : il voit les zones de dépôt
 * réservées à l'administration, comme l'import du plan d'étage.
 */
export const credentials = [
  { email: 'dylan.menga@edu.ece.fr', password: 'smartroom' },
  { email: 's.boukehila@ece.fr', password: 'smartroom' },
];

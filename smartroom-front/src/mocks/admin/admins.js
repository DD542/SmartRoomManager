/**
 * Comptes d'administration et invitations.
 * `adm-02` est le gestionnaire de site déjà utilisé par l'espace utilisateur
 * pour valider les accès dérogatoires et déposer les plans d'étage.
 */

/** Les sept permissions de la matrice A-12, groupées comme sur la maquette. */
export const permissionGroups = [
  {
    id: 'espaces',
    label: 'Gestion des espaces',
    permissions: [
      { id: 'rooms.manage', label: 'Gérer les salles et équipements' },
      { id: 'rules.configure', label: 'Configurer les règles de réservation' },
    ],
  },
  {
    id: 'utilisateurs',
    label: 'Gestion des utilisateurs',
    permissions: [
      { id: 'users.manage', label: 'Gérer les comptes utilisateurs' },
      { id: 'support.handle', label: 'Traiter les demandes d’aide' },
    ],
  },
  {
    id: 'operations',
    label: 'Opérations',
    permissions: [
      { id: 'conflicts.arbitrate', label: 'Arbitrer les conflits' },
      { id: 'data.export', label: 'Exporter les données' },
    ],
  },
  {
    id: 'administration',
    label: 'Administration',
    permissions: [{ id: 'system.configure', label: 'Configurer le système' }],
  },
];

export const allPermissions = permissionGroups.flatMap((group) =>
  group.permissions.map((permission) => permission.id),
);

export const admins = [
  {
    id: 'adm-01',
    firstName: 'Dylan',
    lastName: 'Menga',
    email: 'd.menga@ece.fr',
    role: 'Directeur IT',
    permissions: [...allPermissions],
    lastLoginAt: '2026-03-26T09:05:00',
    owner: true,
  },
  {
    id: 'adm-02',
    firstName: 'Samir',
    lastName: 'Boukehila',
    email: 's.boukehila@ece.fr',
    role: 'Directeur de site',
    permissions: ['rooms.manage', 'support.handle', 'conflicts.arbitrate'],
    lastLoginAt: '2026-03-26T08:40:00',
    owner: false,
  },
  {
    id: 'adm-03',
    firstName: 'Claire',
    lastName: 'Nkoulou',
    email: 'c.nkoulou@ece.fr',
    role: 'Référente support',
    permissions: ['support.handle', 'conflicts.arbitrate'],
    lastLoginAt: '2026-03-25T16:02:00',
    owner: false,
  },
];

export const adminInvitations = [
  {
    id: 'inv-01',
    email: 'j.martin@ece.fr',
    permissions: ['rooms.manage', 'support.handle', 'conflicts.arbitrate'],
    sentAt: '2026-03-24T10:15:00',
    status: 'en_attente',
  },
];

/** Mot de passe partagé de démonstration, comme pour l'espace utilisateur. */
export const adminCredentials = admins.map((admin) => ({
  email: admin.email,
  password: 'smartroom',
}));

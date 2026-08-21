# Espace administration — routes et permissions

Toutes les routes vivent sous `/admin`, en dehors de `/app` réservé à l'espace
utilisateur. Un même navigateur peut donc être connecté aux deux sans collision.

| Écran | Route | Composant | Permission requise |
|---|---|---|---|
| A-00 Connexion administrateur | `/admin/connexion` | AdminLoginPage | publique |
| A-01 Tableau de bord d'occupation | `/admin` | OccupancyDashboardPage | toute session admin |
| A-02 Statistiques & rapports | `/admin/rapports` | ReportsPage | `data.export` |
| A-03 Toutes les réservations | `/admin/reservations` | AllBookingsPage | toute session admin |
| A-03b Créer une réservation | `/admin/reservations?creer=1` | AdminBookingModal | `rooms.manage` |
| A-04 File des conflits et demandes | `/admin/conflits` | ConflictQueuePage | `conflicts.arbitrate` |
| A-05 Gestion des salles | `/admin/salles` | RoomsPage | `rooms.manage` |
| A-06 Création / édition de salle | `/admin/salles/:id` · `/admin/salles/nouvelle` | RoomEditPage | `rooms.manage` |
| A-07 Catalogue des équipements | `/admin/equipements` | EquipmentPage | `rooms.manage` |
| A-08 Gestion des plans | `/admin/plans` | PlansPage | `rooms.manage` |
| A-09 Calendriers d'ouverture | `/admin/ouvertures` | SchedulesPage | `rules.configure` |
| A-10 Règles de réservation | `/admin/regles` | BookingRulesPage | `rules.configure` |
| A-11 Utilisateurs | `/admin/utilisateurs` | UsersPage | `users.manage` |
| A-12 Rôles et permissions | `/admin/roles` | RolesPage | `system.configure` |
| A-13 Tickets | `/admin/tickets` · `/admin/tickets/:id` | TicketsPage | `support.handle` |
| A-14 Base de connaissances & chatbot | `/admin/connaissances` | KnowledgePage | `support.handle` |
| A-15 Modèles d'e-mails | `/admin/modeles` | EmailTemplatesPage | `system.configure` |
| A-16 Journal d'audit | `/admin/audit` | AuditLogPage | `system.configure` |

## Gardes

- `RequireAdmin` protège `/admin/*` sauf `/admin/connexion` : sans session
  administrateur, redirection vers la connexion en mémorisant la destination,
  chaîne de requête comprise.
- `RequireAdminPermission` enveloppe chaque route du tableau : sans la permission,
  l'écran renvoie vers `/admin` avec un message, plutôt que d'afficher une page
  vide. La sidebar masque les entrées correspondantes, et `PermissionGate`
  désactive les actions ponctuelles à l'intérieur d'un écran autorisé.
- La session utilisateur (`/app`) et la session administrateur sont distinctes :
  se connecter à l'une ne connecte pas à l'autre. Un lien discret « Retour à
  l'espace utilisateur » figure en pied de sidebar, comme sur les maquettes.

## Correspondance avec l'espace utilisateur

| Sujet | Écran utilisateur | Écran administration |
|---|---|---|
| Réservations | U-07 mes réservations | A-03 toutes les réservations |
| Conflits | U-12 conflit détecté | A-04 arbitrage du conflit |
| Accès dérogatoire | U-13 demande | A-04 onglet « Demandes d'accès » |
| Salles | U-16 / U-17 consultation | A-05 / A-06 administration |
| Plans | U-18 consultation | A-08 placement des salles |
| Aide | U-22 articles et tickets | A-13 / A-14 traitement et rédaction |
| Statistiques | U-24 personnelles | A-01 / A-02 établissement |

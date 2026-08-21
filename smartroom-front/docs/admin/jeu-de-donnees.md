# Espace administration — jeu de données

Prolonge `docs/jeu-de-donnees.md`. Mêmes salles, mêmes utilisateurs, mêmes
réservations : l'administration voit les données que l'espace utilisateur écrit,
et inversement. Horloge de référence inchangée : **jeudi 26 mars 2026, 11 h 45**.

## Administrateurs

| id | nom | intitulé | permissions | mot de passe |
|---|---|---|---|---|
| `adm-01` | D. Menga | Directeur IT | les 7 (compte propriétaire) | `smartroom` |
| `adm-02` | A. Boukehila | Directeur de site | `rooms.manage`, `support.handle`, `conflicts.arbitrate` | `smartroom` |
| `adm-03` | C. Nkoulou | Référent support | `support.handle`, `conflicts.arbitrate` | `smartroom` |

Invitation en attente : `j.martin@ece.fr`, envoyée il y a 2 jours, aperçu
« Salles, Aide, Conflits ». `adm-02` correspond au gestionnaire déjà utilisé par
l'espace utilisateur pour les accès dérogatoires et le dépôt des plans.

## File d'arbitrage (A-04) — 9 éléments

- `#CONF-8492` **conflit double**, Salle Vinci, jeudi 26/03 : D. Menga 14:00-15:30
  (créé hier 16h42, 6 réservations ce mois, quota restant 14 h) contre M. Diallo
  14:00-15:00 (créé aujourd'hui 11h30, 12 réservations, quota restant 2 h).
  Les alternatives proposées sortent de `utils/recommendation.js`.
- `#CONF-8493` **conflit matériel**, Salle Curie : projecteur requis, déjà assigné.
- 3 demandes d'accès dérogatoire, 2 validations requises, 2 conflits résolus.

## Journal d'audit (A-16) — 128 entrées, 5 détaillées

| id | horodatage | auteur | action | cible | IP |
|---|---|---|---|---|---|
| 4028 | 26/03 09:12 | D. Menga | modification | Règles de réservation | 192.168.1.42 |
| 4027 | 26/03 08:47 | A. Boukehila | maintenance | Salle Ampère | 192.168.1.15 |
| 4026 | 25/03 17:30 | D. Menga | permission | C. Nkoulou | 192.168.1.42 |
| 4025 | 25/03 16:02 | C. Nkoulou | suppression | Article FAQ | 10.0.0.5 |
| 4024 | 25/03 14:20 | (système) | connexion | Login admin | 81.194.x.x |

L'entrée 4028 porte le diff `durée max : 3 h → 4 h` et `quota hebdo : 10 h → 12 h`,
avec ses métadonnées : Chrome 122, macOS 14.3, Paris FR, session `sess_8f92a3b1c4`.

## Ouvertures et fermetures (A-09)

Grille hebdomadaire globale : lundi au vendredi 08:00-20:00, samedi 09:00-13:00,
dimanche fermé. Quatre fermetures actives : vacances de printemps (22 avr → 30 avr,
global), 1er mai (global), maintenance bâtiment C (15 mai 08:00-12:00), journée
portes ouvertes (10 juin, salles de conférence).

## Règles de réservation (A-10)

Globales : durée 30 min à 4 h, 10 créneaux simultanés maximum, quota hebdomadaire
12 h, battement 15 min, validation de présence sous 10 min. Ces valeurs sont
celles déjà appliquées par `utils/openingRules.js` et `api/checkin.js` : l'écran
les édite, il ne les duplique pas.

## Modèles d'e-mails (A-15)

Quatre modèles, reprenant les deux gabarits HTML déjà livrés : confirmation de
réservation (actif), rappel avant réunion (actif), annulation (actif), conflit
arbitré (inactif). Variables disponibles : `prenom`, `salle`, `batiment`, `date`,
`creneau`, `code_acces`, `lien_reservation`.

## Métriques utilisateurs (A-11)

| utilisateur | réservations | no-show | fiabilité | crédits restants | statut |
|---|---|---|---|---|---|
| Dylan Menga Wanda | 18 | 6 % | 94/100 | 12 h | actif |
| Marc Blanc | 24 | 8 % | 88/100 | 6 h | actif |
| Alice Leroy | 9 | 22 % | 61/100 | 9 h | actif |
| Thomas Nguyen | 3 | 0 % | 70/100 | 12 h | suspendu |

Le taux de présence et le nombre de réservations sont calculés depuis le magasin
de réservations, comme les statistiques personnelles de U-24 : créer ou annuler
une réservation déplace immédiatement ces chiffres.

# SmartRoom Manager — Rapport de projet

**Bachelor 3 Data & IA — ECE Paris**
Réservation de salles de campus : analyse, conception, réalisation, qualité et déploiement.

---

## Sommaire

1. [Contexte et problème posé](#1-contexte-et-problème-posé)
2. [Analyse](#2-analyse)
3. [Conception fonctionnelle et maquettage](#3-conception-fonctionnelle-et-maquettage)
4. [Architecture technique](#4-architecture-technique)
5. [Modèle de données](#5-modèle-de-données)
6. [Réalisation — le back-end](#6-réalisation--le-back-end)
7. [Réalisation — le front-end](#7-réalisation--le-front-end)
8. [L'assistant conversationnel](#8-lassistant-conversationnel)
9. [Sécurité et conformité](#9-sécurité-et-conformité)
10. [Stratégie de tests](#10-stratégie-de-tests)
11. [Intégration continue](#11-intégration-continue)
12. [Exploitation en local](#12-exploitation-en-local)
13. [Déploiement en ligne](#13-déploiement-en-ligne)
14. [Journal des incidents et de leur résolution](#14-journal-des-incidents-et-de-leur-résolution)
15. [Écarts assumés entre local et production](#15-écarts-assumés-entre-local-et-production)
16. [Limites connues et perspectives](#16-limites-connues-et-perspectives)
17. [Bilan](#17-bilan)
18. [Annexes](#18-annexes)

---

## 1. Contexte et problème posé

### 1.1 La situation de départ

Un campus dispose de salles — amphithéâtres, laboratoires, salles de réunion — réparties dans plusieurs bâtiments. Leur réservation se fait souvent par un tableur partagé, un courriel au secrétariat, ou un affichage papier sur la porte.

Trois problèmes en découlent, et ce sont eux que le projet traite.

**On ne sait pas ce qui est libre.** Chercher une salle revient à ouvrir plusieurs sources et à les recouper. La personne renonce, ou réserve « au cas où », ce qui aggrave la pénurie.

**Deux personnes réservent le même créneau.** Sans arbitre technique, le conflit se découvre devant la porte. Le coût n'est pas la double écriture : c'est la réunion qui n'a pas lieu.

**Les salles réservées restent vides.** Personne ne vient, et le créneau reste bloqué pour les autres. Un système qui ne mesure pas la présence ne peut pas libérer ce qui ne sert pas.

### 1.2 Ce que le projet livre

Une application web complète — interface utilisateur, interface d'administration, API, base de données, assistant conversationnel — qui répond à ces trois problèmes :

- **trouver** une salle réellement libre et conforme aux règles, par une recherche guidée ou par recommandation ;
- **réserver** sans jamais produire de conflit, la garantie étant portée par la base de données elle-même et non par du code applicatif ;
- **entrer** grâce à un code d'accès émis au bon moment, et **libérer** automatiquement le créneau lorsque personne ne se présente.

### 1.3 Cadre académique

Projet individuel de **Bachelor 3 Data & IA** à l'ECE Paris. Il n'est pas exploité commercialement et ne constitue pas un service ouvert au public — ce que rappellent ses mentions légales.

La dimension « Data & IA » n'est pas un habillage : elle porte deux briques réelles du produit, le **moteur de recommandation** de salles (pondération explicite et traçable) et l'**assistant conversationnel** adossé à une base de connaissances vectorisée. Ces deux briques sont décrites en détail aux sections 6.6 et 8.

---

## 2. Analyse

### 2.1 Acteurs

| Acteur | Ce qu'il fait | Ce qu'il ne peut pas faire |
|---|---|---|
| **Utilisateur** | cherche, réserve, annule, valide sa présence, consulte ses statistiques, demande de l'aide | voir les données d'autrui, modifier le parc, changer les règles |
| **Administrateur** | gère le parc, arbitre les conflits, configure les règles, traite le support, exporte | agir hors de son périmètre de permissions |
| **Propriétaire** | administrateur portant toutes les permissions, gère les autres administrateurs | — |
| **Ordonnanceur** | libère les créneaux sans présence, clôt les réservations passées, envoie rappels et courriels, rafraîchit les agrégats | — |

Le choix de séparer **administrateur** et **propriétaire** vient d'une observation simple : une matrice de permissions où tout le monde a tout ne prouve rien, et l'écran des rôles n'aurait rien à montrer. Le jeu de démonstration porte donc cinq comptes d'administration aux périmètres volontairement différents.

### 2.2 Cas d'usage principaux

**U1 — Réserver une salle.** L'utilisateur décrit son besoin (date, plage, effectif, équipements). Le système ne propose que des salles libres et conformes. Il confirme, reçoit une confirmation par courriel, et le code d'accès une heure avant.

**U2 — Valider sa présence.** À l'ouverture du créneau, l'utilisateur saisit le code affiché sur l'écran de la salle. La fenêtre dure dix minutes ; passé ce délai, le créneau est libéré.

**U3 — Annuler ou modifier.** Jusqu'à une heure avant le début, avec motif obligatoire. Les participants sont prévenus.

**U4 — Demander un accès.** Certaines salles exigent un badge. L'utilisateur formule une demande, un administrateur arbitre.

**U5 — Arbitrer un conflit.** Deux demandes concurrentes sur un créneau contraint remontent à l'administration, qui tranche avec une trace.

**U6 — Configurer les règles.** Durées minimale et maximale, battement entre réservations, préavis, horizon, quota hebdomadaire, délai d'annulation, fenêtre de validation. Par établissement, par bâtiment ou par salle.

**U7 — Interroger l'assistant.** En langage naturel : ses réservations, une salle libre, l'emplacement d'une salle, une procédure, l'ouverture d'un ticket.

**U8 — Administrer le parc.** Bâtiments, étages, plans, salles, photos, équipements, statuts.

**U9 — Suivre l'occupation.** Tableaux de bord, heures de pointe, taux d'occupation, exports.

**U10 — Gérer les comptes.** Suspension motivée, réactivation, retrait définitif par anonymisation.

### 2.3 Exigences fonctionnelles

- Recherche multicritère : date, plage, capacité, équipements, accessibilité PMR, bâtiment.
- Recommandation ordonnée avec explication du score.
- Réservation atomique, sans chevauchement possible.
- Réservations récurrentes, avec annulation d'une occurrence isolée.
- Participants, invitations, réponses.
- Code d'accès à usage unique par réservation, émis à l'approche du créneau.
- Validation de présence dans une fenêtre courte.
- Libération automatique en cas d'absence.
- Fermetures exceptionnelles (établissement, bâtiment, salle) et horaires d'ouverture.
- Notifications applicatives **et** courriels, sur gabarits modifiables.
- Journal d'audit de toute décision d'administration.
- Statistiques personnelles et globales, exportables.
- Assistant conversationnel outillé, avec citation de ses sources.

### 2.4 Exigences non fonctionnelles

| Exigence | Traduction technique retenue |
|---|---|
| **Intégrité** | contrainte `EXCLUDE USING gist` en base : aucun chevauchement n'est représentable |
| **Confidentialité** | portées de session distinctes, permissions granulaires, en-têtes de cache stricts |
| **Traçabilité** | journal d'audit, journal par tour d'assistant, journaux applicatifs en JSON |
| **Robustesse** | dégradations prévues et testées : sans modèle, sans vecteurs, sans relais de courriel |
| **Testabilité** | domaine pur sans dépendance, exigé à 100 % de couverture de branches |
| **Portabilité** | conteneurisation, migrations versionnées, aucune configuration codée en dur |
| **Accessibilité** | libellés visibles et lisibles par lecteur d'écran, conformité WCAG 2.5.3 sur les déclencheurs |

### 2.5 Contraintes

- **Budget nul.** L'hébergement devait tenir sur des paliers gratuits, ce qui a dicté plusieurs arbitrages décrits en section 13.
- **Un seul développeur.** D'où le choix d'outils à faible coût d'exploitation et d'une chaîne d'intégration continue qui remplace la relecture par un pair.
- **Pas de GPU en production.** L'assistant devait fonctionner sans modèle local, ce qui a imposé une architecture à plusieurs étages (section 8.2).

---

## 3. Conception fonctionnelle et maquettage

### 3.1 Maquettes Figma

L'ensemble des écrans a été maquetté sur **Figma** avant toute ligne de code. Vingt écrans y sont définis, répartis en trois familles :

**Public** — page de présentation, connexion, création de compte, mot de passe oublié, mentions légales.

**Utilisateur** — tableau de bord, catalogue des salles, fiche de salle, tunnel de réservation en quatre étapes, mes réservations, détail d'une réservation, validation de présence, notifications, profil, statistiques personnelles.

**Administration** — connexion dédiée, tableau de bord d'occupation, parc (bâtiments, étages, plans, salles), comptes et rôles, règles de réservation, arbitrage des conflits, support et FAQ, réglages de l'assistant, journal d'audit, rapports et exports.

Le maquettage a servi trois usages, et pas seulement l'esthétique.

Il a **figé le vocabulaire** avant l'implémentation — « créneau », « battement », « préavis », « repère », « plan d'étage » — ce qui a évité qu'un même objet porte trois noms entre l'interface, l'API et la base.

Il a **révélé des trous fonctionnels** que l'analyse écrite n'avait pas montrés : l'écran de validation de présence a fait apparaître le besoin d'une fenêtre bornée, et l'écran d'arbitrage celui d'une référence lisible pour chaque conflit (`#CONF-8492`).

Il a **fixé le système de design** décrit ci-dessous, ce qui a permis d'écrire les composants React une fois pour toutes plutôt que de styler chaque page.

### 3.2 Système de design

Le produit est en **thème sombre**, choix assumé pour un outil consulté plusieurs fois par jour dans des salles souvent peu éclairées.

Il repose sur des **jetons** — couleurs de fond, de surface, de contenu, d'accent, de statut — déclarés une fois et consommés par tous les composants. Un statut de salle (`disponible`, `maintenance`, `indisponible`) porte la même couleur partout, sans qu'aucun écran ne la redéfinisse.

Les composants récurrents ont été extraits : carte, section, badge de statut, barre d'occupation, sélecteur de créneau, modale de confirmation avec motif, zone de danger. Le dépôt en compte **152**, pour **52 écrans**.

### 3.3 Parcours de réservation

Le tunnel comporte quatre étapes, et cet ordre n'est pas anodin.

1. **Le besoin** — date, plage, effectif, équipements. Rien n'est encore montré.
2. **La salle** — uniquement celles qui sont libres *et* conformes aux règles, ordonnées par score de recommandation.
3. **Le créneau** — confirmation de l'horaire exact, avec le battement appliqué.
4. **La confirmation** — objet, participants, récapitulatif.

Montrer les salles avant d'avoir le besoin obligerait l'utilisateur à filtrer lui-même une liste dont la plupart des entrées lui sont inutiles. L'ordre choisi fait porter ce travail au système.

---

## 4. Architecture technique

### 4.1 Vue d'ensemble

```
Navigateur
    │
    │  HTTPS, même origine
    ▼
Front React (Vite, Tailwind)  ──────┐
    │                               │
    │  /api/v1/*                    │  /media/*
    ▼                               ▼
API FastAPI ──────────────► Fichiers statiques
    │        │        │
    │        │        └────► Assistant (agent, outils, RAG, garde-fous)
    │        │                        │
    │        │                        ├─► Ollama (poste local)
    │        │                        └─► API compatible OpenAI (en ligne)
    │        │
    │        └────► Ordonnanceur APScheduler
    │
    ▼
PostgreSQL 16 + pgvector
```

### 4.2 Découpage en couches du back-end

Le back-end est découpé en quatre couches, et la règle de dépendance est stricte : chacune ne connaît que la suivante.

**`app/api`** — routage, validation d'entrée, sérialisation de sortie, dépendances d'authentification. Aucune règle métier.

**`app/services`** — dix-sept services applicatifs. Ils orchestrent : lisent, appliquent les règles, écrivent, journalisent l'audit, programment les notifications.

**`app/domain`** — le cœur métier **pur**. Aucune importation de SQLAlchemy, de FastAPI ni de rien d'extérieur. Il calcule des créneaux libres, applique des règles, détecte des conflits, pondère des recommandations. C'est cette pureté qui permet d'en exiger **100 % de couverture de branches** sans monter de base de données.

**`app/models`** — la cartographie SQLAlchemy, et rien d'autre.

Le bénéfice de ce découpage s'est vérifié à l'usage : un défaut de recommandation se corrige dans le domaine, avec un test qui s'exécute en millisecondes, sans toucher au reste.

### 4.3 Choix techniques et arbitrages

| Choix | Alternative écartée | Raison |
|---|---|---|
| **PostgreSQL** | MySQL, SQLite | seul à offrir `EXCLUDE USING gist` sur intervalles — la garantie d'intégrité est native, pas applicative |
| **pgvector** | base vectorielle dédiée | une seule base à exploiter, à sauvegarder, à déployer |
| **FastAPI** | Django, Flask | validation par annotations, OpenAPI gratuit, asynchrone natif pour le flux de l'assistant |
| **SQLAlchemy 2 + psycopg3** | ORM Django | accès aux types PostgreSQL avancés (`tstzrange`, `vector`) |
| **Alembic** | création de schéma au démarrage | une migration se relit, se rejoue et se corrige ; un `create_all` ne se raconte pas |
| **React + Vite** | Next.js | pas de rendu serveur nécessaire ; un binaire statique se déploie partout |
| **Tailwind** | CSS modules | le système de design vit dans les jetons, pas dans des feuilles éparses |
| **Server-Sent Events** | WebSocket | le flux est unidirectionnel ; SSE traverse les proxys sans configuration |
| **Ollama en local** | API distante uniquement | développement hors ligne, sans coût ni fuite de données |

---

## 5. Modèle de données

### 5.1 Volumétrie du schéma

**46 tables**, **13 migrations** Alembic, de `0001_schema_initial` à `0013_gabarit_reactivation`.

### 5.2 Domaines fonctionnels

**Parc** — `buildings`, `floors`, `floor_plans`, `rooms`, `room_photos`, `equipments`, `room_equipments`, `room_placements`.

**Réservations** — `bookings`, `booking_participants`, `booking_series`, `booking_access_codes`, `access_requests`, `conflicts`.

**Règles** — `booking_rules`, `opening_hours`, `closures`.

**Comptes** — `users`, `user_preferences`, `admin_accounts`, `admin_permissions`, `permissions`, `admin_invitations`, `refresh_tokens`, `password_reset_tokens`.

**Support et notifications** — `faq_categories`, `faq_articles`, `faq_fragments`, `tickets`, `ticket_messages`, `response_templates`, `chatbot_intents`, `chatbot_intent_keywords`, `notifications`, `notification_templates`.

**Assistant** — `chat_conversations`, `chat_messages`, `chat_tours`.

**Traçabilité** — `audit_logs`.

### 5.3 La contrainte qui porte tout

```sql
EXCLUDE USING gist (
    room_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
) WHERE (status <> 'annulee')
```

Cette ligne est le cœur de l'intégrité du produit. Elle rend **impossible** l'enregistrement de deux réservations qui se chevauchent dans la même salle. Pas improbable : impossible, quelle que soit la concurrence, quel que soit le chemin d'écriture, y compris une insertion faite à la main en SQL.

Le choix de `'[)'` — borne de début incluse, borne de fin exclue — permet à une réservation de 9 h–10 h et à une autre de 10 h–11 h de coexister, ce qu'attend l'intuition.

La clause `WHERE` exclut les réservations annulées : une annulation doit libérer le créneau sans effacer la trace.

### 5.4 Recherche vectorielle

La table `faq_fragments` porte une colonne `vector(768)` indexée en **HNSW** avec l'opérateur `vector_cosine_ops`. La dimension est figée par la migration `0007` ; en changer impose une migration, jamais un simple redémarrage. Cette contrainte a eu une conséquence concrète au déploiement (section 13.7).

---

## 6. Réalisation — le back-end

### 6.1 Volumétrie

**128 routes** exposées, réparties en vingt-deux domaines. Dix-sept services applicatifs. Le schéma OpenAPI est généré et servi, ce qui permet d'inventorier l'API sans lire le code.

### 6.2 Authentification

**Jeton d'accès** JWT, quinze minutes. Court par choix : un jeton volé a une durée de nuisance bornée.

**Jeton de rafraîchissement** en cookie `httpOnly`, trente jours, chemin restreint à `/api/v1/auth`. Il **tourne à chaque usage** : le précédent est révoqué. Rejouer un jeton déjà tourné déclenche la **détection de rejeu**, qui révoque toute la famille de jetons — la session entière tombe. C'est le comportement attendu face à un vol.

**Deux portes distinctes.** `/auth/login` ouvre une session de portée « utilisateur » ; `/auth/admin/login` une session d'administration. Un compte administrateur connecté par la porte des utilisateurs n'obtient **aucun** privilège d'administration. Cette séparation a été vérifiée en production : les vingt-trois routes d'administration rendent `403` avec une session utilisateur, `200` avec une session d'administration.

**Connexion Google** par jeton d'identité vérifié contre les clés publiques de Google. Le code secret du client n'est pas utilisé — le navigateur rend un jeton, le serveur le valide. Un domaine de messagerie peut être exigé.

**Limitation de débit** : cinq connexions par minute, trois demandes de réinitialisation par heure.

### 6.3 Permissions

Sept permissions nommées : `rooms.manage`, `rules.configure`, `conflicts.arbitrate`, `support.handle`, `users.manage`, `data.export`, `system.configure`.

Elles sont attribuées individuellement. Le compte propriétaire les porte toutes ; les autres en portent un sous-ensemble, ce qui donne à l'écran des rôles quelque chose de réel à montrer.

### 6.4 Concurrence

La contrainte d'exclusion garantit l'intégrité, mais elle ne suffit pas à produire une **bonne erreur**.

Dix demandes simultanées sur le même créneau concluent toutes que la salle est libre, puis s'affrontent sur la contrainte. PostgreSQL arbitre, mais au-delà de deux ou trois concurrents il détecte un cycle d'attente et sacrifie une transaction :

```
psycopg.errors.DeadlockDetected
CONTEXT: while checking exclusion constraint on tuple (0,119) in relation "bookings"
```

Le service ne traduisait que le code `23P01` (violation d'exclusion) ; le `40P01` (interblocage) remontait tel quel, et l'utilisateur recevait une erreur technique là où il devait lire que le créneau venait d'être pris.

**Correction retenue** : un verrou consultatif par salle (`pg_advisory_xact_lock`), pris **avant la vérification** et non juste avant l'insertion — c'est la séquence entière lire-puis-écrire qui doit être indivisible. Le verrou est porté par la transaction, donc relâché au `COMMIT` comme au `ROLLBACK`. Avec un verrou unique par salle, aucun cycle d'attente n'est possible.

Le verrou est **par salle et non par créneau** : la contrainte parle de chevauchement, pas d'égalité. Une clé par créneau laisserait passer de front deux réservations qui se recouvrent partiellement.

### 6.5 Ordonnanceur

Trois tâches périodiques, portées par APScheduler dans le processus de l'API :

| Tâche | Période | Rôle |
|---|---|---|
| Libération, clôture et rappels | 5 min | libère les créneaux sans présence, clôt les réservations passées, envoie les rappels et vide la file de courriels |
| Rafraîchissement des agrégats | 15 min | recalcule la vue d'occupation |
| Purge des jetons expirés | quotidienne | supprime les jetons de session et de réinitialisation périmés |

### 6.6 Moteur de recommandation

C'est la première brique « Data » du projet. Il ordonne les salles compatibles selon un score composite, **explicable** : chaque composante est calculée séparément et exposée, de sorte que l'interface peut dire *pourquoi* une salle arrive en tête.

Les composantes retenues :

- **adéquation de capacité** — une salle de 90 places pour 4 personnes est un gâchis, une salle de 4 places pour 4 personnes est juste ;
- **équipements demandés** présents ;
- **proximité du bâtiment habituel** de la personne, renseigné à l'inscription ;
- **accessibilité** quand elle est requise ;
- **taux d'occupation** de la salle, pour répartir l'usage plutôt que saturer les mêmes salles.

Le calcul vit dans `app/domain/recommendation.py`, sans dépendance externe, et est couvert à 100 %.

### 6.7 Notifications et courriels

Deux canaux, un seul déclencheur. Chaque événement métier — confirmation, rappel, annulation, code d'accès, suspension, réactivation — produit une notification applicative **et** un courriel, tous deux rendus à partir d'un **gabarit stocké en base** et modifiable depuis l'administration.

Les gabarits sont posés par **migration** et non seulement par le jeu de démonstration. La raison est subtile et a coûté un défaut réel : la fonction de notification ignore en silence un code de gabarit absent. Une fonctionnalité livrée sans son gabarit n'aurait donc rien fait, sur une base déjà installée, sans la moindre erreur pour le signaler.

L'expédition est programmée en **tâche de fond de la requête** (`BackgroundTasks`), et non laissée à l'ordonnanceur. Sans cela, le message part au passage suivant — jusqu'à cinq minutes plus tard — et jamais si l'ordonnanceur est arrêté.

---

## 7. Réalisation — le front-end

### 7.1 Volumétrie

**52 écrans**, **152 composants**, **46 fichiers de test**, **474 tests**.

### 7.2 Organisation

```
src/
  api/          couche d'accès HTTP, un module par domaine
  components/   composants réutilisables, par famille
  pages/        écrans, par espace (public, user, admin)
  hooks/        état partagé, requêtes, formulaires
  utils/        dates, formats, calculs d'affichage
  router.jsx    routes et gardes
```

La **couche `api/`** est la seule à connaître l'existence du réseau. Aucun composant n'appelle `fetch` directement. Elle porte aussi les **adaptateurs**, qui traduisent les charges utiles de l'API — nommées en `snake_case` — vers les objets attendus par l'interface. Cette frontière a permis, à plusieurs reprises, d'ajouter un champ côté serveur sans toucher aux écrans.

### 7.3 Gardes de routage

Trois familles de routes : publiques, utilisateur authentifié, administration authentifiée. La racine `/` redirige selon l'état de session — tableau de bord si une session est ouverte, page de présentation sinon.

L'administration a sa propre page de connexion, `/admin/connexion`, cohérente avec la séparation des portes côté serveur.

### 7.4 Un piège de fuseau horaire

La répartition des réservations par tranche horaire lisait `Date.getHours()`, c'est-à-dire l'heure **du poste**, alors que les tranches 08–10, 10–12, 14–16 et 16–18 sont celles du campus.

L'intégration continue tourne en UTC : une réservation de 9 h y devenait 7 h, ne tombait dans aucune tranche, et la page annonçait qu'il n'y avait pas assez de réservations sur un jeu qui en contenait 608.

Ce n'était pas un test fragile : **un navigateur réglé sur un autre fuseau affichait la même page vide**. La correction lit l'heure dans le fuseau de l'établissement via `Intl.DateTimeFormat`, sans dépendance nouvelle.

---

## 8. L'assistant conversationnel

C'est la seconde brique « IA » du projet, et la plus élaborée.

### 8.1 Ce qu'il sait faire

Il répond en langage naturel, en s'appuyant sur des **outils** qui lisent la vraie base — jamais sur ce qu'un modèle croit savoir. Quatorze outils sont enregistrés, dont :

`rechercher_salles`, `recommander_salle`, `consulter_disponibilite`, `localiser_salle`, `lister_mes_reservations`, `creer_reservation`, `modifier_reservation`, `annuler_reservation`, `obtenir_code_acces`, `consulter_regles`, `rechercher_faq`, `creer_ticket`, `transferer_humain`.

Les outils d'**écriture** ne s'exécutent jamais directement : ils produisent un **brouillon**, conservé côté serveur sous un jeton à usage unique, que l'utilisateur doit confirmer. La sortie du modèle n'est jamais relue au moment de l'exécution — c'est le brouillon validé qui part au service métier.

### 8.2 Architecture à trois étages

L'assistant choisit son fournisseur d'inférence dans un ordre fixe :

**Étage A — Ollama**, sur le poste de développement. Gratuit, hors ligne, aucune donnée ne sort.

**Étage B — une API compatible OpenAI**, pour la démonstration en ligne. Il n'existe que parce qu'aucun hébergement gratuit ne fait tourner un modèle de sept milliards de paramètres.

**Étage C — le moteur déterministe.** Ce n'est pas une panne : c'est un moteur de repli qui reconnaît un ensemble d'intentions déclarées en base, appelle les mêmes outils, et répond sans aucun modèle.

Le passage d'un étage à l'autre est journalisé avec son **déclencheur**, ce qui permet au tableau de bord d'administration de distinguer un repli subi d'un repli choisi.

### 8.3 Un repli parfois choisi

Une mesure a modifié la conception. Sur cinq essais identiques de « donne-moi mes prochaines réservations », pour un compte qui en a cinq :

| Moteur | Appelle l'outil |
|---|---|
| qwen2.5:7b | 3 fois sur 5 |
| qwen2.5:14b | 0 fois sur 3 |
| déterministe | 2 fois sur 2, réponse juste |

Quand le modèle n'appelle rien, il écrit une phrase plausible — parfois « je n'ai pas trouvé » — devant un agenda plein. L'utilisateur ne peut pas distinguer cette réponse d'une vraie.

Un premier correctif a été essayé puis **abandonné** : exécuter la lecture avant que le modèle ne parle, et lui remettre le résultat. L'outil partait bien 5 fois sur 5, mais deux essais répondaient encore « je n'ai pas trouvé cette information » à côté de la carte qui listait les réservations. Le modèle contredisait la donnée qu'il avait sous les yeux.

Conclusion retenue : le défaut n'est pas le modèle, c'est de lui laisser ce choix. **Une question fermée dont la réponse est une liste n'a rien à gagner d'un modèle de langage et tout à perdre.** Elle part désormais au moteur déterministe, et le journal la distingue par son déclencheur `intention_certaine`.

Le déclenchement reste étroit : le pluriel possessif est exigé et les verbes d'écriture excluent, pour qu'« annuler ma réservation » garde son tour de confirmation.

### 8.4 Recherche documentaire hybride

La base de connaissances est découpée en fragments, vectorisés et stockés en base. La recherche additionne **deux** volets :

- le **vectoriel** retrouve « je n'arrive pas à entrer dans la salle » sous l'article « Code d'accès », sans partager un seul mot ; il rate en revanche un identifiant ou un nom propre, que l'embedding dilue ;
- le **lexical** trouve le mot exact et rien d'autre ; il ne sait pas qu'annuler et supprimer sont proches.

La fusion se fait par **rangs réciproques** (RRF) plutôt que par somme de scores : une similarité cosinus et un `ts_rank` ne vivent pas sur la même échelle, et les additionner reviendrait à comparer des degrés et des kilomètres.

Mesure de l'apport, sur le corpus réel :

| Question | Lexical seul | Avec vecteurs |
|---|---|---|
| « comment je préviens que je suis arrivé » | **aucun résultat** | *Valider ma présence sur place* |
| « ma réunion est annulée que faire » | *À quoi sert SmartRoom* | *Modifier l'horaire ou la salle* |

La première question ne partage aucun mot avec l'article qui y répond.

Sans modèle de vecteurs joignable, `vectoriser()` rend `None` et la recherche retombe sur son seul volet lexical. C'est un mode dégradé prévu, pas un échec.

### 8.5 Garde-fous

**Injection.** Les délimiteurs sont neutralisés et les motifs suspects comptés dans le journal du tour.

**Étayage.** La réponse est confrontée aux données réellement obtenues. Si elle avance ce qui n'y figure pas, une réserve est ajoutée. C'est ce garde-fou qui fait dire à l'assistant « je n'ai pas trouvé cette information » plutôt que d'inventer un chiffre — comportement observé et souhaité.

**Anonymisation.** Avant tout envoi à un fournisseur distant, adresses, noms et téléphones sont remplacés par des jetons stables le temps de la conversation. La table de correspondance ne quitte jamais le serveur, et les réponses sont retraduites à l'affichage.

Le fournisseur distant **refuse d'émettre** tant qu'aucune fonction d'anonymisation n'est branchée : un oubli de configuration ne doit pas se traduire par l'envoi de noms à un tiers.

**Adresses de fichiers.** Toute clé se terminant par `_url` est retirée de ce que le modèle relit, et n'existe que dans la carte que le front sait rendre. La règle vit dans le type de résultat d'outil, et non chez chaque outil : un outil peut oublier de signaler qu'il rend une adresse ; ce fichier ne peut pas oublier de la retirer.

### 8.6 Budget et journal

Chaque tour est borné : budget de contexte, nombre d'itérations, nombre d'outils, durée. Le journal du tour enregistre le mode, le modèle, les itérations, les outils appelés, les durées, le premier jeton, les injections suspectées et les troncatures. Un écran d'administration l'expose.

---

## 9. Sécurité et conformité

### 9.1 Secrets

Aucun secret n'est versionné. Le fichier `.env` est ignoré par git, et le modèle `.env.example` documente chaque variable sans en porter la valeur.

Un fichier `.env` avait été committé aux premiers temps du projet. Il a été **retiré de tout l'historique** par réécriture (`git filter-branch --index-filter`), suivie d'une expiration du reflog, d'un `gc --prune=now` et d'une poussée forcée. Les identifiants concernés ont été régénérés — la réécriture retire la trace, elle n'annule pas l'exposition.

### 9.2 Cloisonnement des données personnelles

Un défaut réel a été trouvé et corrigé, et il mérite d'être raconté.

La route `/stats/me` portait `Cache-Control: private, max-age=300`. La directive semblait suffisante : `private` interdit aux intermédiaires de conserver la réponse, seul le navigateur du destinataire la garde.

Mais **un cache navigateur est indexé par URL**, et `/stats/me` est la même URL pour tout le monde. Deux comptes ouverts successivement sur le même poste, à moins de cinq minutes d'intervalle, et le second lisait les chiffres du premier : nombre de réservations, heures réservées, annulations, salles fréquentées.

Constaté sur deux comptes affichant les mêmes dix réservations et les mêmes huit annulations, alors qu'en base l'un des deux n'en avait aucune.

`Vary: Authorization` isolerait les réponses, mais le jeton tourne à chaque rafraîchissement : le cache serait manqué à tous les coups. La route est donc passée à `private, no-store`, et l'export CSV personnel — qui portait les mêmes données ligne à ligne, sans aucun en-tête — également.

Les chiffres publics gardent leur cache : anonymes, identiques pour tous, rien n'y désigne personne. Un test le vérifie, sans quoi on supprimerait les deux d'un même geste.

### 9.3 Retrait d'un compte

La suspension empêche de réserver et se défait. Il manquait le geste définitif.

Effacer la ligne casserait le journal d'audit, les frises de réservation et les agrégats d'occupation, qui référencent tous ce compte. Ce que le règlement demande n'est pas la disparition de l'historique : c'est celle de **l'identité**.

Le retrait efface donc ce qui désigne la personne — adresse, nom, téléphone, promotion, service, badge, photo, mot de passe — et laisse ce qui décrit l'usage des salles. L'adresse devient `compte-retire-<12 caractères>@anonyme.invalid` : le domaine `.invalid` est réservé par la **RFC 2606**, aucune remise n'est possible, donc aucun envoi accidentel n'atteindra une boîte réelle.

Les réservations à venir sont annulées et les créneaux libérés — les laisser occuperait des salles au nom de quelqu'un qui n'existe plus. Les sessions ouvertes sont révoquées.

Trois refus précèdent toute écriture : un motif vide, un compte porteur de droits d'administration, et le compte de l'auteur de la demande.

### 9.4 Journal d'audit

Toute décision d'administration — création, modification, suppression, suspension, arbitrage — est enregistrée avec son auteur, sa cible, son action, son motif et son horodatage. L'écran d'audit permet de la relire et de l'exporter.

---

## 10. Stratégie de tests

### 10.1 Quatre niveaux, quatre intentions

| Niveau | Ce qu'il éprouve | Dépendances |
|---|---|---|
| **Domaine** | les règles, en isolation totale | aucune |
| **Services et API** | l'intégration réelle avec PostgreSQL | base de données |
| **Assistant** | la boucle d'agent, les outils, les garde-fous | base + fournisseur simulé |
| **Front** | les écrans et leur logique | MSW intercepte le réseau |
| **Bout en bout** | les parcours complets, dans un vrai navigateur | pile complète |

### 10.2 Chiffres

**1 576 tests automatisés** au total, tous verts au moment de la rédaction.

| Suite | Tests | Couverture | Fichiers |
|---|---|---|---|
| **Back-end** (domaine + services + API + assistant) | **1 102** | — | 46 |
| dont Domaine | — | **100 % des branches**, seuil imposé | — |
| dont Services et API | 545 | 87,59 % | — |
| dont Assistant | 159 | 84,71 % | — |
| **Front-end** | **474** | 90,25 % (mesurée en UTC) | 46 |
| **Bout en bout** | 3 parcours Playwright | — | 3 |

Les trois parcours de bout en bout couvrent le tunnel utilisateur complet, l'administration, et la page publique. Ce dernier a été rejoué **contre la production** : quatre tests verts en 13,4 s.

### 10.3 Ce que ces tests attrapent réellement

Trois exemples, tous vécus.

Un **test de contre-épreuve** a montré qu'un correctif ne servait à rien : sans lui, le test passait quand même. Le motif de recherche avait été replié sur plusieurs lignes par le formateur, et le remplacement n'avait rien changé. Sans contre-épreuve, le correctif aurait été committé comme vérifié.

Un test d'anonymisation a révélé qu'une exclusion écrite en rétrospection ne servait à rien : la correspondance commençait sur le mot exclu, et ce qui la précédait était un article.

Un test de couverture a montré qu'un module du domaine n'était éprouvé que depuis les tests de services, où le travail « Domaine » ne regarde pas. Le module apparaissait à 0 %. **Un module du domaine se prouve dans le domaine.**

### 10.4 Le principe de la contre-épreuve

Une règle a été appliquée systématiquement dans la seconde moitié du projet : **un test qui ne peut pas échouer ne prouve rien**. Chaque correctif d'importance est accompagné d'une vérification que le test échoue bien sans lui. Plusieurs commits en portent la trace explicite :

> « Sans le correctif, la trace porte deux cartes au lieu d'une. »
> « Vérifiés en retirant l'envoi, trois d'entre eux échouent. »
> « Contre-épreuve sans le relevé : zéro plan. »

---

## 11. Intégration continue

### 11.1 Composition de la chaîne

GitHub Actions, cinq travaux : Domaine, Services et API, Assistant, Front, Bout en bout. Chacun impose son seuil de couverture. La chaîne exécute également `ruff check`, `ruff format --check` et `alembic check` — ce dernier vérifiant que le schéma décrit par les modèles correspond aux migrations.

### 11.2 Trois causes d'échec, trouvées et corrigées

La chaîne a échoué durablement, et les causes étaient indépendantes.

**L'image PostgreSQL n'avait pas pgvector.** La migration `0007` crée l'extension `vector`, absente de `postgres:16-alpine`. `alembic upgrade head` s'arrêtait là, avant même d'atteindre les tests : le travail « Services et API » échouait depuis huit exécutions, sans rapport avec les commits qui les déclenchaient. Mesuré en exécutant `docker run --rm postgres:16-alpine` et en constatant l'absence de tout fichier d'extension `vector`. Les cinq autres extensions du schéma vivent dans `contrib` et sont partout ; celle-ci non.

**Une convention de nommage doublement appliquée.** La migration `0010` passait le nom complet à `create_check_constraint`, que la convention de nommage préfixait une seconde fois. La base portait `ck_booking_rules_ck_booking_rules_notice_non_vide` là où le modèle déclare `ck_booking_rules_notice_non_vide`, et `alembic check` s'arrêtait sur cet écart. Une migration `0011` corrective a été écrite plutôt que de réécrire `0010` : **une migration déjà appliquée partout se corrige par la suivante.**

**Un épinglage de dépendance mensonger.** `requirements.txt` épinglait `fastapi==0.118.0` alors que le code était développé et testé contre `0.141.1`. Sous la version épinglée, FastAPI ne résout plus certaines annotations et prend le modèle Pydantic et la dépendance de session pour des champs de corps : les appels répondent `422 « payload est obligatoire, session est obligatoire »`.

Tout passait en local, où l'environnement virtuel portait `0.141.1`, et nulle part ailleurs. Le `Dockerfile` installant depuis `requirements.txt`, la production aurait servi une API cassée. Établi en reconstruisant l'environnement de la chaîne : Linux, Python 3.12, `TZ=UTC`, base en collation C.

### 11.3 Deux pièges d'environnement

**Le bit exécutable.** `docker-entrypoint.sh` était stocké en `100644`. Le `Dockerfile` lui applique bien un `chmod +x`, mais le service monte le répertoire source sur `/app` : le montage recouvre le répertoire de l'image, et sous Linux le fichier reprend son mode git. Le conteneur refusait de démarrer sur `permission denied`. Invisible sous Windows, où Docker Desktop présente les fichiers partagés comme exécutables.

**Le limiteur de connexion.** `.env.example` porte la valeur de production, cinq par minute, et la chaîne le copie en `.env` — ce qui écrasait le plafond relevé de `docker-compose.yml`. La campagne de tests de bout en bout ouvre une session par test et tombait dessus. L'étape pose désormais la variable dans son environnement, qui l'emporte sur le fichier sans le modifier.

---

## 12. Exploitation en local

### 12.1 Ce qui tourne

```bash
docker compose up -d db courriel      # PostgreSQL + boîte de développement
cd smartroom-api
..\.venv\Scripts\python.exe -m alembic upgrade head
..\.venv\Scripts\python.exe -m scripts.seed
..\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

```bash
cd smartroom-front
npm run dev                            # http://localhost:5180
```

Ollama sert les modèles `qwen2.5:7b` (raisonnement) et `nomic-embed-text` (vecteurs), préchauffés au démarrage de l'API.

### 12.2 Le préchauffage, et pourquoi il existe

Ollama ne garde les poids en mémoire que le temps défini par `keep_alive`, puis les recharge depuis le disque. Mesuré sur le poste de développement : **79 secondes** pour le premier appel, **1,1 seconde** pour les suivants.

Le budget de premier jeton étant de six secondes, **toute première question d'une session partait au repli déterministe**, qui ne connaît qu'une poignée d'intentions : l'assistant répondait « je n'ai pas compris » à des questions que le modèle traite sans peine.

`ClientOllama.prechauffer` existait et se disait « appelé au démarrage de l'application » ; rien ne l'appelait. Il l'est désormais.

### 12.3 Le budget de premier jeton

Fixé à **six secondes**, et non à deux et demie comme au départ. Mesuré avec le prompt réel et le catalogue d'outils — 3 439 jetons d'invite : 3 455 ms au premier appel, 1 524 ms ensuite, l'invite étant mise en cache par Ollama. À 2 500 ms, chaque première question d'une session partait au repli. Le repli, lui, répond en 150 à 600 ms : attendre six secondes avant d'y renoncer reste supportable.

### 12.4 Jeu de démonstration

Le script de peuplement crée : **6 bâtiments, 15 salles, 5 utilisateurs, 5 comptes d'administration, 608 réservations** réparties sur six semaines, une fermeture globale, deux conflits en attente d'arbitrage, et **24 fragments** de base de connaissances vectorisés.

Il est **idempotent sur ce qui a été confié** : les photos de bâtiment, les repères de salle et les plans d'étage déposés par l'administration sont relevés avant la purge et reposés après. Un jeu de démonstration a le droit de refaire ses données, pas celui d'effacer ce qu'on lui a confié.

Cette précaution avait été écrite pour les photos, puis oubliée lorsque les plans d'étage sont arrivés. Ils vivent dans `floor_plans`, que la purge emportait en cascade avec les bâtiments : les fichiers survivaient sur le disque, mais la ligne qui disait à quel étage ils appartenaient disparaissait, et la fiche affichait « Aucun plan déposé pour cet étage » sur un étage qui en avait un. Constaté sur la base de développement : trois fichiers dans `media/plans`, des placements de salles journalisés à l'audit, et zéro ligne dans `floor_plans`.

La clé de relevé est le **code** du bâtiment et de l'étage, non leur identifiant : les codes portent une contrainte d'unicité et survivent d'un jeu à l'autre, contrairement aux identifiants, régénérés à chaque purge.

---

## 13. Déploiement en ligne

### 13.1 La cible retenue

| Composant | Service | Palier |
|---|---|---|
| Base de données | **Neon** (PostgreSQL 18 managé, pgvector) | gratuit |
| API | **Render** (image Docker) | gratuit |
| Front | **Vercel** (statique + réécritures) | gratuit |
| Supervision | **UptimeRobot** | gratuit |
| Modèle et vecteurs | **API Gemini** (façade compatible OpenAI) | gratuit |

Adresse publique : `https://smartroommanager.vercel.app`
API : `https://smartroom-api-ryya.onrender.com`

### 13.2 Le front devant l'API

Le fichier `vercel.json` réécrit `/api/*` et `/media/*` vers le service Render, et renvoie `index.html` pour tout le reste.

Les deux premières réécritures font que **le navigateur appelle l'API sur l'origine qui lui a servi la page** : la requête part en même origine, aucun préflight CORS n'est nécessaire, et le cookie de rafraîchissement — `SameSite=Lax` — reste attaché, ce qu'un appel direct vers `onrender.com` lui interdirait.

La dernière réécriture est indispensable au routage côté client : sans elle, un rechargement sur `/salles` ou `/admin/comptes` rendrait un 404.

Une distinction opérationnelle mérite d'être connue : Vercel donne à **chaque déploiement** une adresse propre, du type `smartroommanager-<hachage>-<équipe>.vercel.app`, en plus de l'alias stable. Seul l'alias est déclaré côté Google et côté CORS ; c'est donc lui, et lui seul, qu'il faut utiliser.

### 13.3 Le point d'entrée du conteneur

L'image applique les migrations au démarrage. `alembic upgrade head` est idempotent : sur une base déjà migrée, il ne fait rien et rend 0. Le lancer à chaque démarrage évite l'étape manuelle qu'on oublie.

Deux réserves sont assumées et documentées dans le script : deux conteneurs démarrant ensemble migrent en même temps — Alembic pose un verrou, le second attend puis ne trouve rien à faire — et une migration destructive appliquée automatiquement ne se relit pas.

### 13.4 La sonde de démarrage, et ce qu'elle a coûté

Le premier déploiement s'est arrêté sur « Base injoignable après 30 tentatives », sans rien dire de plus. Ce message laissait le choix entre un mot de passe faux, un hôte inconnu, un pare-feu et une base endormie : quatre pistes, aucune preuve. Le `2>/dev/null` de la boucle jetait le message de PostgreSQL, le seul qui tranche.

La sonde a été améliorée **quatre fois**, et chaque amélioration a permis d'avancer d'un pas :

1. **Écrire la raison du refus** au premier essai, au dixième et au dernier. Guillemets et retours à la ligne neutralisés, le journal restant du JSON.
2. **Distinguer deux sorties d'échec** : `1` pour une base pas encore prête, que l'on réessaie ; `2` pour une configuration refusée, sur laquelle on s'arrête. La sonde avait répété trente fois « Base pas encore prête » pour une variable `CORS_ORIGINS` mal écrite — soixante secondes perdues, et un message qui désignait le mauvais coupable.
3. **Élargir la troncature de 300 à 1 200 caractères.** Le journal montrait « connection to server at 2a05:… Network is unreachable » et s'arrêtait exactement avant la liste des adresses essayées — la seule information utile, puisqu'elle dit si la bascule IPv6 vers IPv4 a eu lieu.
4. **Joindre les variables de connexion au message.** Pydantic élide le milieu des chaînes trop longues (`input_value='postgresql+psycopg://neo...neon.tech:5432/neondb'`), et l'anomalie se cache justement dans ce qu'il coupe. Le mot de passe n'y figure pas : **seule sa longueur apparaît**, ce qui distingue un champ vide d'un champ rempli sans rien révéler.

Une correction de classement a accompagné la quatrième : `database_url` est une propriété calculée, et l'erreur ne surgissait qu'à sa lecture, après le contrôle de configuration. Le journal annonçait « base pas encore prête » pour une adresse mal formée qui ne guérira jamais en attendant.

### 13.5 La chaîne d'incidents de connexion

Chaque étape a été résolue par la mesure, jamais par la supposition.

**`CORS_ORIGINS` mal formé.** Le champ est une liste ; pydantic-settings attend donc du JSON, pas une URL nue.

**Adresse IPv6 injoignable.** Le palier gratuit de Render ne sort qu'en IPv4, et Neon publie les deux familles. La bascule avait bien lieu — c'est la troncature élargie qui l'a montré — et les trois adresses IPv4 répondaient.

**Mode TLS absent.** `libpq` applique `prefer` par défaut : il tente le chiffrement, puis se rabat en clair si la négociation échoue. Neon refuse alors la connexion, avec un message trompeur :

```
ERROR: password authentication failed for user 'neondb_owner'
ERROR: connection is insecure (try using `sslmode=require`)
```

La première ligne est le message générique de Neon devant une connexion non chiffrée. Elle désignait le mauvais coupable : on cherchait un mot de passe faux là où il manquait un mode de connexion.

Le mode est désormais **déduit de l'environnement** — `require` partout sauf en local, où la base tourne dans un conteneur voisin sans certificat et où l'exiger empêcherait tout démarrage. Une variable permet d'imposer `verify-full` là où l'autorité est connue, ou `disable` sur un réseau privé déjà chiffré. Aucune variable nouvelle n'est à renseigner : `ENVIRONMENT=production` suffit.

**`invalid port number`.** Un `POSTGRES_HOST` portant déjà son port produisait `...neon.tech:5432:5432/neondb`. Reproduit en local avant d'être corrigé.

### 13.6 Persistance des médias

Le disque de Render est **éphémère**. Un fichier déposé depuis l'administration en ligne y survit quelques heures, puis disparaît au redéploiement suivant — alors que sa ligne en base, elle, persiste. L'écran affiche alors une image cassée, sans rien pour le signaler.

Le journal l'a montré sans ambiguïté : après un dépôt, les six adresses `.webp` rendaient 404 là où les anciennes rendaient 200.

**Solution retenue** : les fichiers sont **versionnés**. Ils entrent dans l'image Docker et suivent le déploiement. La procédure est donc de déposer **en local, l'application locale étant branchée sur la base de production**, puis de commiter les fichiers apparus. La ligne part dans Neon, le fichier dans le dépôt, et le commit les réunit.

Le dépôt porte aujourd'hui les photos des quinze salles, les images des six bâtiments, les repères de localisation et les plans d'étage.

Les alternatives ont été évaluées et écartées : un disque persistant Render exige un plan payant ; un stockage objet externe — Cloudinary, Supabase, Backblaze — serait la bonne réponse pour une application réelle, mais impose de réécrire la couche de stockage.

### 13.7 L'assistant en ligne

C'est la partie qui a demandé le plus de travail de mise au point, et elle a révélé **cinq défauts** que le développement local ne pouvait pas montrer, puisqu'Ollama y sert seul.

**L'étage distant était configurable et inatteignable.** Le client refuse d'émettre sans anonymisation — une garde voulue — mais aucun des cinq points de construction du sélecteur ne lui en passait une. On pouvait donc le configurer entièrement sans qu'il serve jamais, le seul signe étant une ligne de journal.

**La cohérence des vecteurs.** Poste local et hébergement partagent la même base. Les fragments portent les coordonnées que leur a données un modèle donné ; si l'un vectorise avec Ollama et l'autre avec l'étage distant, la similarité reste calculable et compare deux espaces sans rapport. La recherche cesse de trouver, sans erreur pour l'expliquer. Un réglage épingle désormais ce rôle des deux côtés, et un script d'administration réindexe le corpus à chaque changement de modèle.

**La dimension des vecteurs.** Mesure sur `gemini-embedding-001` : 3 072 dimensions par défaut, 768 avec le paramètre explicite — et la colonne pgvector est figée à 768 par la migration `0007`. Sans ce paramètre, l'insertion échoue au lieu de dégrader. La troncature est sans conséquence ici : la recherche compare par cosinus, une mesure qui ignore la norme.

**Les appels d'outils simultanés fusionnaient.** L'index corrèle les morceaux d'un même appel d'un fragment à l'autre. La façade Gemini rend l'appel entier d'un coup et **omet cet index** : deux appels simultanés tombaient sous la même clé, noms et arguments concaténés, et `{"etat":"a_venir"}{}` ne se relit pas — l'assembleur écartait l'entrée. L'agent ne recevait aucun outil là où il en avait demandé deux. Ce n'est pas un cas de bord : le budget autorise huit outils par tour.

**Les arguments repartaient en objet.** La forme utile à la boucle d'agent est un dictionnaire, et Ollama l'accepte. Le protocole OpenAI transporte une **chaîne JSON** :

```
Value is not a string: {"question":"absence"}
```

Mesure directe : la même requête rend 200 avec une chaîne et 400 avec un objet. Le défaut ne se voyait qu'au **second** aller-retour, celui qui renvoie le résultat de l'outil au modèle. Le premier appel réussissait, l'outil s'exécutait, la carte s'affichait — puis le tour basculait au repli, et l'écran montrait les bons articles surmontés d'un « je n'ai pas compris la demande ».

**La signature de raisonnement.** Les modèles Gemini 3 joignent à chaque appel d'outil une `thought_signature` et exigent de la retrouver au tour suivant :

```
400 Function call is missing a thought_signature in functionCall parts.
```

Elle voyage dans `extra_content`, hors du protocole OpenAI, et se perdait à la traduction. Le client la retient désormais par identifiant d'appel et la rattache au départ.

Ces trois dernières corrections vivent dans le client distant, dont l'en-tête promet d'absorber les différences de protocole. Ollama et OpenAI ne sont pas affectés.

### 13.8 Deux défauts d'anonymisation

**Un nom de salle pris pour une personne.** L'assistant annonçait « Salle PERSONNE_2 » au milieu de sa liste. L'exclusion des noms de lieux ne portait que sur le premier mot de la paire : sur « Salle Conseil Alpha », le moteur écartait « Salle Conseil », repartait un mot plus loin, et masquait « Conseil Alpha ». La rétrospection ferme cette porte — elle avait été essayée puis retirée comme inutile, ce qu'elle était **seule**, mais pas en complément de l'anticipation.

**Les jetons n'étaient jamais retraduits.** La documentation promettait « les réponses sont retraduites à l'affichage » ; rien ne le faisait. La fonction de restitution existait et n'était appelée nulle part, et l'anonymiseur était reconstruit sans mémoire à chaque appel — la table de correspondance mourait avec lui. Tout nom masqué ressortait sous sa forme de jeton.

Le sélecteur porte désormais une **instance**, pour la durée du tour : assez pour retraduire, trop peu pour qu'un jeton survive d'une session à l'autre et redevienne un identifiant.

La retraduction attend le blanc suivant : le modèle diffuse « PERSON » puis « NE_1 », et traduire chaque morceau ne reconnaîtrait ni l'un ni l'autre. Un tampon retient le mot en cours et se vide en fin de flux, sans quoi chaque réponse s'arrêterait un mot trop tôt.

### 13.9 Le repli ne se rejoue plus par-dessus

Un dernier défaut, visible et gênant : le plan d'une salle apparaissait, puis disparaissait, remplacé par une liste de salles et « j'ai cherché une salle correspondant à votre besoin ». Deux réponses différentes à la même question, la seconde effaçant la première.

La bascule ne regardait pas si le tour avait déjà produit quelque chose. Quand le fournisseur lâchait **après** un appel d'outil réussi, le repli repartait de zéro et réécrivait tout.

Le repli sait répondre depuis une page blanche, pas corriger une réponse en cours. Le tour se clôt désormais sur une phrase qui le dit, et les éléments affichés restent. **Mieux vaut une réponse incomplète qu'une réponse qui se dédit.**

### 13.10 Supervision

Un moniteur UptimeRobot interroge `/health` toutes les cinq minutes. Le choix de cette route et non de `/health/ready` est délibéré : `/health` ne touche pas la base, et maintenir Neon éveillé jour et nuit consommerait son quota de calcul pour rien.

Deux incidents ont été traités.

Le **502 initial** portait `X-Render-Routing: no-deploy` à 18 h 31, soit exactement entre l'arrêt de 18 h 30 et le démarrage de 18 h 34 : la fenêtre de redéploiement. Réel mais bénin.

Le **405 permanent** était un vrai défaut : UptimeRobot interroge en `HEAD`, la méthode économique pour vérifier qu'un service répond sans en télécharger le corps, et la route ne déclarait que `GET`. Chaque vérification était comptée comme une panne sur un service parfaitement sain — l'incident durait depuis cinquante minutes, alors que les `GET` voisins répondaient 200 dans les mêmes secondes.

### 13.11 Le journal disait qu'il basculait, pas pourquoi

Le code `ia_fournisseur` couvre un quota épuisé, un modèle inconnu, une clé refusée et une panne réseau : quatre causes, quatre remèdes, et aucune trace pour choisir. Il a fallu reproduire un tour en local, en interceptant le client, pour lire ce que la ligne de journal taisait :

```
429 Quota exceeded for generate_content_free_tier_requests
    limit: 20, model: gemini-2.5-flash
```

**Vingt requêtes par jour**, et un tour en consomme au moins deux. Le détail part désormais au journal — il porte le refus du fournisseur, jamais la conversation. C'est la même correction que celle apportée à la sonde de base, et pour la même raison.

---

## 14. Journal des incidents et de leur résolution

Vue synthétique de ce que le projet a rencontré et corrigé.

| # | Symptôme observé | Cause réelle | Correction |
|---|---|---|---|
| 1 | CI en échec depuis 8 exécutions | image PostgreSQL sans pgvector | image `pgvector/pgvector:pg16` |
| 2 | `alembic check` en écart | nom de contrainte doublement préfixé | migration corrective `0011` |
| 3 | Page de statistiques vide en CI | heure lue dans le fuseau du poste | lecture via `Intl`, fuseau du campus |
| 4 | Couverture Domaine à 0 % | module testé depuis la mauvaise suite | test déplacé dans le domaine |
| 5 | 422 en production seulement | `fastapi` épinglé à une version obsolète | épinglage aligné sur la version testée |
| 6 | Conteneur refusant de démarrer | bit exécutable absent dans git | `update-index --chmod=+x` |
| 7 | Parcours e2e bloqué | limiteur à la valeur de production | variable posée dans l'étape |
| 8 | Erreur technique sur créneau pris | interblocage non traduit | verrou consultatif par salle |
| 9 | Courriel de suspension jamais reçu | expédition non programmée | `BackgroundTasks` sur la route |
| 10 | Plan d'étage perdu après un seed | table emportée en cascade | relevé et repose par code |
| 11 | Lien mort dans la réponse de l'assistant | adresse recopiée par le modèle | clés `_url` retirées de sa vue |
| 12 | « Aucun plan » sur une salle qui en a un | repère non affiché côté utilisateur | repère en secours, drapeau `floor_has_plan` |
| 13 | Statistiques identiques sur deux comptes | cache navigateur indexé par URL | `private, no-store` |
| 14 | Export PDF et Excel en erreur | formats proposés, non implémentés | retirés de l'offre |
| 15 | Compteur figé cinq minutes | `max-age` seul | `stale-while-revalidate` |
| 16 | Déploiement bloqué, cause muette | sonde trop discrète | quatre améliorations successives |
| 17 | Connexion Neon refusée | mode TLS absent du DSN | `sslmode` déduit de l'environnement |
| 18 | Images cassées après redéploiement | disque éphémère | fichiers versionnés |
| 19 | Supervision en panne permanente | `HEAD` non déclaré | route ouverte à `GET` et `HEAD` |
| 20 | Étage distant jamais utilisé | anonymiseur non branché | branché par défaut |
| 21 | Agent privé de ses outils | index d'appel absent | place neuve par appel |
| 22 | Tour interrompu au second appel | arguments envoyés en objet | sérialisés en texte |
| 23 | « Salle PERSONNE_2 » | exclusion incomplète | rétrospection ajoutée |
| 24 | Jetons visibles dans les réponses | restitution jamais appelée | anonymiseur porté par le tour |
| 25 | Carte affichée puis remplacée | repli rejoué par-dessus | tour clos sans rejeu |
| 26 | Tour interrompu sur Gemini 3 | `thought_signature` perdue | retenue et rattachée |
| 27 | Assistant dégradé après dix questions | quota quotidien du palier gratuit | modèle changé, quota documenté |

---

## 15. Écarts assumés entre local et production

| | Local | En ligne |
|---|---|---|
| Modèle de raisonnement | qwen2.5:7b via Ollama | Gemini via façade OpenAI |
| Modèle de vecteurs | Gemini (imposé des deux côtés) | Gemini |
| Base | PostgreSQL 16 en conteneur | Neon PostgreSQL 18 managé |
| Courriel | boîte de développement, rien ne sort | relais SMTP réel |
| Médias | disque de travail | image Docker, versionnés |
| Limiteur de connexion | 100/minute | 5/minute |
| Démarrage | immédiat | ~50 s après quinze minutes d'inactivité |

Quatre limites sont **structurelles au palier gratuit** et aucun correctif ne les supprime : le réveil à froid, le disque éphémère, le limiteur de connexion et le quota quotidien du modèle. Elles sont documentées plutôt que masquées.

La dégradation reste propre : quota épuisé, l'assistant retombe sur son moteur déterministe et continue de répondre aux intentions déclarées. **L'étage distant est un confort, pas une dépendance.**

---

## 16. Limites connues et perspectives

### 16.1 Ce qui n'est pas fait, et pourquoi

**Export PDF et Excel.** Les deux formats figuraient dans l'interface et la couche de données les refusait à chaque fois. L'administrateur choisissait ses colonnes, cliquait, et recevait une erreur. Le message était juste ; l'offre ne l'était pas. Ils ont été retirés — un bouton présent qui échoue à chaque clic est pire que pas de bouton. Une voie sans dépendance existe (vue imprimable et `window.print()`) et reste à arbitrer.

**Dénombrement par l'assistant.** « Combien de salles sont enregistrées » n'a pas d'outil dédié : le catalogue propose la recherche, la localisation, les réservations, les règles et la base de connaissances, pas le dénombrement. L'assistant le dit plutôt que d'inventer un chiffre, ce qui est le comportement voulu.

**Stockage objet.** La bonne réponse pour une application réelle, écartée faute de temps et parce qu'elle imposerait de réécrire la couche de stockage.

### 16.2 Perspectives

- Stockage objet externe pour les médias, supprimant la contrainte de versionnement.
- Disque persistant ou instance payante, supprimant le réveil à froid.
- Élargissement du catalogue d'outils de l'assistant (dénombrements, agrégats).
- Export imprimable des rapports, sans dépendance nouvelle.
- Notifications temps réel par WebSocket, en complément des courriels.
- Modèle de vecteurs auto-hébergé, supprimant la dépendance à un tiers.

---

## 17. Bilan

### 17.1 Ce que le projet démontre

**Une garantie d'intégrité portée par la base**, et non par du code applicatif : deux réservations chevauchantes ne sont pas improbables, elles sont impossibles.

**Une architecture en couches** dont la couche métier est pure, testable en isolation, et prouvée à 100 % de couverture de branches.

**Une chaîne de tests à cinq niveaux** — 1 576 tests automatisés, 1 102 côté back-end et 474 côté front — et une discipline de contre-épreuve : un test qui ne peut pas échouer ne prouve rien.

**Deux briques Data & IA réelles** : un moteur de recommandation explicable, et un assistant outillé, adossé à une recherche hybride vectorielle et lexicale, avec garde-fous d'injection, d'étayage et d'anonymisation.

**Un déploiement complet et gratuit**, mené de bout en bout, avec une supervision et une dégradation propre.

### 17.2 Ce que le projet m'a appris

**Mesurer avant d'affirmer.** Plusieurs diagnostics initiaux se sont révélés faux — le cache du navigateur accusé à tort, un écart de nombre de salles qui n'était qu'un filtre légitime, une IPv6 soupçonnée là où il manquait un mode TLS. À chaque fois, c'est la mesure qui a tranché, et souvent une mesure qu'il a fallu rendre possible avant de pouvoir la lire.

**Un journal qui dit qu'il a échoué sans dire pourquoi coûte des heures.** Le même défaut est apparu trois fois à trois endroits différents — la sonde de base, la bascule de l'assistant, la troncature des messages — et la correction a été la même : joindre la cause, sans jamais joindre le secret.

**Ce qui ne s'exécute que d'un côté n'est pas testé.** Cinq défauts vivaient dans le chemin distant de l'assistant. Aucun n'était visible en local, parce qu'Ollama y sert seul. Le déploiement n'est pas une formalité de fin de projet : c'est un environnement d'exécution à part entière, avec ses propres défauts.

**Une garde qui refuse par défaut doit être branchée par défaut.** L'anonymiseur illustre les deux faces : la garde était juste, et son absence de câblage rendait tout un étage inatteignable. Le défaut sûr est de masquer, pas de se taire.

---

## 18. Annexes

### 18.1 Adresses

| | |
|---|---|
| Page de présentation | `https://smartroommanager.vercel.app/presentation` |
| Connexion utilisateur | `https://smartroommanager.vercel.app/connexion` |
| Connexion administration | `https://smartroommanager.vercel.app/admin/connexion` |
| API | `https://smartroom-api-ryya.onrender.com` |
| Documentation OpenAPI | `https://smartroom-api-ryya.onrender.com/docs` |
| Dépôt | `https://github.com/DD542/SmartRoomManager` |

### 18.2 Comptes de démonstration

Mot de passe commun : `smartroom2026`.

| Compte | Rôle | Permissions |
|---|---|---|
| `d.menga@ece.fr` | Directeur IT, propriétaire | toutes |
| `s.boukehila@ece.fr` | Directeur de site | salles, support, conflits |
| `c.nkoulou@ece.fr` | Référente support | support, conflits |
| `jean.dupont@edu.ece.fr` | Utilisateur | — |
| `alice.leroy@edu.ece.fr` | Utilisateur | — |

Les comptes d'administration se connectent par `/admin/connexion`.

### 18.3 Commandes utiles

```bash
# Pile locale
docker compose up -d db courriel
cd smartroom-api && ..\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
cd smartroom-front && npm run dev

# Base
..\.venv\Scripts\python.exe -m alembic upgrade head
..\.venv\Scripts\python.exe -m scripts.seed
..\.venv\Scripts\python.exe -m scripts.reindexer_connaissances

# Qualité
..\.venv\Scripts\python.exe -m pytest
..\.venv\Scripts\python.exe -m ruff check app tests scripts
npm run test
npm run test:e2e

# Parcours public joué contre la production
E2E_BASE_URL=https://smartroommanager.vercel.app npx playwright test e2e/vitrine-animations.spec.js
```

### 18.4 Variables d'environnement de production

| Variable | Rôle |
|---|---|
| `ENVIRONMENT` | `production` — déduit notamment le mode TLS |
| `POSTGRES_*` | connexion à Neon, `POSTGRES_SSLMODE=require` |
| `JWT_SECRET` | signature des jetons d'accès |
| `CORS_ORIGINS` | liste **JSON** des origines autorisées |
| `REFRESH_COOKIE_SECURE` | `true` |
| `GOOGLE_CLIENT_ID` | identifiant public du client OAuth |
| `MAIL_ENABLED`, `SMTP_*`, `MAIL_FROM` | relais de courriel |
| `IA_DISTANT_URL`, `IA_DISTANT_CLE` | étage B de l'assistant |
| `IA_DISTANT_MODELE_RAISONNEMENT` | modèle de dialogue |
| `IA_DISTANT_MODELE_VECTEURS` | modèle d'embeddings |
| `IA_VECTEURS_TOUJOURS_DISTANTS` | cohérence du corpus vectorisé |

### 18.5 Migrations

| Révision | Objet |
|---|---|
| `0001_schema_initial` | schéma initial |
| `0002_min_advance` | délai minimal d'anticipation |
| `0003_auth_tokens` | jetons de session et de réinitialisation |
| `0004_photo_order` | ordre des photos, unicité différée |
| `0005_avatar` | photo de profil |
| `0006_visuels_parc` | images de bâtiment et repères de salle |
| `0007_rag_pgvector` | extension `vector` et table de fragments |
| `0008_conversations` | conversations, messages et journal des tours |
| `0009_notification_gabarit` | gabarit ayant produit une notification |
| `0010_consigne_regles` | consigne portée par la règle de réservation |
| `0011_nom_contrainte_consigne` | correction du nom de contrainte |
| `0012_gabarit_suspension` | gabarit de suspension de compte |
| `0013_gabarit_reactivation` | gabarit de réactivation de compte |

---

*Rapport rédigé au terme du projet. Toutes les mesures citées ont été relevées sur l'application réelle, en local ou en production.*

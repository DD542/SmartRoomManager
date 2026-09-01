# SmartRoom Manager

Réservation de salles pour un campus : trouver une salle qui convient, la
réserver, y entrer, et arbitrer les conflits quand deux personnes veulent le
même créneau.

Projet de troisième année du cycle ingénieur, ECE Paris.

---

## Ce que fait l'application

**Côté utilisateur.** Un tunnel en quatre étapes — besoin, salle, créneau,
confirmation — qui ne propose que des salles réellement libres et conformes aux
règles. Puis la vie de la réservation : la modifier, la partager, valider sa
présence sur place avec un code d'accès, signaler un retard, l'annuler.

**Côté administration.** Le parc (bâtiments, étages, salles, équipements,
plans), les règles de réservation par portée, les calendriers d'ouverture, les
comptes et leurs permissions, l'arbitrage des conflits, le support, et un
journal d'audit de chaque décision.

Quelques partis pris qui expliquent la forme du code :

- **Les codes d'accès ne sont jamais conservés en clair.** La base garde une
  empreinte bcrypt et un indice — `E-****`. Le code complet n'existe qu'à
  l'instant de son émission, dans le courriel qui le porte.
- **Le chevauchement est refusé par la base**, pas par du code applicatif : une
  contrainte `EXCLUDE USING gist` sur l'intervalle. Deux requêtes simultanées ne
  peuvent pas réserver la même salle au même moment.
- **Toute écriture demande une confirmation explicite** dans un tour dédié ;
  aucune n'est déclenchée par la sortie d'un modèle.
- **L'identité vient du serveur**, jamais du client : aucune route n'accepte un
  `owner_id` en paramètre.

---

## Démarrer

### Avec Docker

```bash
cp .env.example .env
docker compose up
```

L'application répond alors sur `http://localhost:5180`, l'API sur
`http://localhost:8000`, et sa documentation sur `http://localhost:8000/docs`.

Les services : PostgreSQL avec `pgvector`, l'API, le front, un relais de
courrier local, et Ollama pour l'assistant. Les courriels partis en
développement se lisent sur `http://localhost:8025` — rien ne sort de la
machine tant que `MAIL_ENABLED` vaut `false`.

### Sans Docker

PostgreSQL 16 avec l'extension `pgvector` doit tourner par ailleurs.

```bash
# API
python -m venv .venv
.venv/Scripts/python -m pip install -r smartroom-api/requirements.txt
cd smartroom-api && alembic upgrade head
python -m scripts.seed                     # jeu de démonstration
python -m uvicorn app.main:app --port 8000

# Front, dans un autre terminal
cd smartroom-front && npm install && npm run dev
```

### Comptes de démonstration

Le script de peuplement crée des comptes utilisateur et cinq comptes
d'administration aux périmètres différents, tous avec le mot de passe
`smartroom2026`. Il les affiche à la fin de son exécution.

L'administration se rejoint par `/admin/connexion` — une session distincte de
celle de l'espace utilisateur, avec son propre jeton.

---

## Ce que contient le dépôt

```
smartroom-api/       FastAPI, SQLAlchemy, Alembic — 11 migrations
  app/domain/        les règles, sans base de données ni HTTP
  app/services/      ce que fait l'application
  app/api/v1/        les routes et leurs schémas
  scripts/           peuplement, et maintenance ponctuelle
  tests/             1022 tests

smartroom-front/     React, Vite, Tailwind
  src/pages/         un dossier par espace : public, booking, catalog, admin…
  src/components/    l'interface, découpée par domaine
  src/api/           le seul endroit qui connaît le transport
  e2e/               parcours complets, Playwright
                     439 tests unitaires

deploy/              Caddy, sauvegarde et restauration
docker-compose.yml   développement
docker-compose.prod.yml
```

---

## Tests

```bash
# API
cd smartroom-api && ../.venv/Scripts/python -m pytest

# Front
cd smartroom-front && npm test
npm run test:e2e
```

Les tests d'intégration exigent une base PostgreSQL : ils exercent les
contraintes d'exclusion, les index partiels et les requêtes de disponibilité,
qu'aucun double ne reproduit fidèlement.

Plusieurs vérifications portent sur la **source** plutôt que sur le rendu —
cibles tactiles, coupure des textes longs, permissions des grilles. Elles
existent parce que jsdom ne fait pas de mise en page : le défaut ne se lit qu'à
l'écran, et une classe manquante ne manque à personne tant que personne ne
regarde.

---

## Configuration

Tout passe par des variables d'environnement, décrites dans
[`.env.example`](.env.example). Celles marquées « à remplacer » font échouer le
démarrage en production plutôt que de laisser tourner un secret d'usine.

Les principales : la base de données, `JWT_SECRET`, le relais de courrier
(`MAIL_ENABLED`, `SMTP_*`), la connexion Google (`GOOGLE_CLIENT_ID`), et
`ORGANISATION_DOMAINS`, qui distingue les comptes de l'établissement des
adresses extérieures.

`.env` n'est pas suivi par git, et ne doit pas l'être.

---

## Licence

MIT — voir [LICENSE](LICENSE).

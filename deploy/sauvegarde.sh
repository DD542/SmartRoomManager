#!/bin/sh
# =============================================================================
# Sauvegarde de la base.
#
#   ./deploy/sauvegarde.sh                    dépôt dans ./sauvegardes
#   RETENTION_JOURS=30 ./deploy/sauvegarde.sh conserver un mois
#
# Format `custom` de pg_dump et non SQL brut : il est compressé, et surtout il
# se restaure sélectivement — une table seule, sans rejouer le reste. Un fichier
# SQL de plusieurs centaines de mégaoctets ne laisse pas ce choix.
#
# À planifier, par exemple chaque nuit :
#   0 3 * * * cd /opt/smartroom && ./deploy/sauvegarde.sh >> /var/log/smartroom-sauvegarde.log 2>&1
# =============================================================================

set -eu

COMPOSE="${COMPOSE:-docker compose -f docker-compose.prod.yml}"
DESTINATION="${DESTINATION:-./sauvegardes}"
RETENTION_JOURS="${RETENTION_JOURS:-14}"

horodatage=$(date +%Y%m%d-%H%M%S)
fichier="smartroom-${horodatage}.dump"

mkdir -p "$DESTINATION"

echo "Sauvegarde vers ${DESTINATION}/${fichier}"

# `--clean` et `--if-exists` : l'archive sait se restaurer sur une base déjà
# peuplée, ce qui est le cas courant d'une restauration d'urgence.
$COMPOSE exec -T db pg_dump \
    --username "${POSTGRES_USER:-smartroom}" \
    --dbname "${POSTGRES_DB:-smartroom}" \
    --format=custom \
    --clean \
    --if-exists \
    --file "/sauvegardes/${fichier}"

# La somme de contrôle accompagne l'archive : une sauvegarde silencieusement
# corrompue est pire qu'une sauvegarde absente, parce qu'on croit l'avoir.
if command -v sha256sum >/dev/null 2>&1; then
    ( cd "$DESTINATION" && sha256sum "$fichier" > "${fichier}.sha256" )
fi

taille=$(du -h "${DESTINATION}/${fichier}" 2>/dev/null | cut -f1 || echo "?")
echo "Terminé : ${fichier} (${taille})"

# Purge des archives trop anciennes. Elle vient après la sauvegarde du jour :
# purger d'abord laisserait, en cas d'échec, moins d'archives qu'avant.
if [ "$RETENTION_JOURS" -gt 0 ]; then
    supprimees=$(find "$DESTINATION" -name 'smartroom-*.dump*' -mtime "+${RETENTION_JOURS}" -print -delete | wc -l)
    echo "Archives purgées au-delà de ${RETENTION_JOURS} jours : ${supprimees}"
fi

# Un décompte nul signale une chaîne rompue : le fichier n'a pas été écrit.
restantes=$(find "$DESTINATION" -name 'smartroom-*.dump' | wc -l)
if [ "$restantes" -eq 0 ]; then
    echo "ERREUR : aucune archive présente après la sauvegarde." >&2
    exit 1
fi

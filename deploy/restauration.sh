#!/bin/sh
# =============================================================================
# Restauration de la base.
#
#   ./deploy/restauration.sh sauvegardes/smartroom-20260824-030000.dump
#
# Opération destructive : elle remplace le contenu actuel. Le script le dit et
# demande confirmation, parce qu'une restauration se lance rarement à froid —
# le plus souvent dans l'urgence, où la relecture est la première victime.
#
# Une sauvegarde jamais restaurée n'est pas une sauvegarde. Éprouvez cette
# procédure sur un environnement de recette avant d'en avoir besoin.
# =============================================================================

set -eu

COMPOSE="${COMPOSE:-docker compose -f docker-compose.prod.yml}"
archive="${1:-}"

if [ -z "$archive" ]; then
    echo "Usage : $0 <archive.dump>" >&2
    exit 64
fi
if [ ! -f "$archive" ]; then
    echo "Archive introuvable : $archive" >&2
    exit 66
fi

# Contrôle d'intégrité avant toute écriture : restaurer une archive corrompue
# détruirait la base sans la remplacer.
if [ -f "${archive}.sha256" ] && command -v sha256sum >/dev/null 2>&1; then
    echo "Vérification de la somme de contrôle."
    ( cd "$(dirname "$archive")" && sha256sum --check "$(basename "$archive").sha256" )
fi

nom=$(basename "$archive")

echo
echo "ATTENTION : le contenu actuel de la base sera remplacé par ${nom}."
echo "Les données écrites depuis cette sauvegarde seront perdues."
printf 'Taper « restaurer » pour confirmer : '
read -r reponse
if [ "$reponse" != "restaurer" ]; then
    echo "Abandon."
    exit 1
fi

# L'API est arrêtée pendant l'opération : une écriture concurrente pendant une
# restauration produirait un état que ni l'archive ni l'application ne décrivent.
echo "Arrêt de l'API."
$COMPOSE stop api

echo "Restauration en cours."
# `--single-transaction` : tout ou rien. Une restauration interrompue à mi-course
# laisserait un schéma partiel, plus difficile à diagnostiquer qu'un échec net.
$COMPOSE exec -T db pg_restore \
    --username "${POSTGRES_USER:-smartroom}" \
    --dbname "${POSTGRES_DB:-smartroom}" \
    --clean \
    --if-exists \
    --single-transaction \
    "/sauvegardes/${nom}"

echo "Redémarrage de l'API."
# Le point d'entrée rejoue `alembic upgrade head` : si l'archive précède une
# migration, le schéma est remis à niveau au démarrage.
$COMPOSE start api

echo "Restauration terminée. Vérifiez la sonde de disponibilité :"
echo "  curl -sf https://\${PUBLIC_DOMAIN}/health/ready"

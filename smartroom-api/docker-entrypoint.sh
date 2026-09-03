#!/bin/sh
# =============================================================================
# Point d'entrée du conteneur d'API.
#
# Une seule responsabilité avant de passer la main : amener le schéma à jour.
#
# `alembic upgrade head` est idempotent — sur une base déjà migrée, il ne fait
# rien et rend 0. Le lancer à chaque démarrage évite l'étape manuelle qu'on
# oublie, et le rend rejouable sans précaution.
#
# Deux réserves assumées, à connaître avant de déployer plusieurs instances :
#
#   - Deux conteneurs démarrant ensemble migrent en même temps. Alembic pose un
#     verrou sur sa table de version, donc le second attend puis ne trouve rien
#     à faire ; le cas est sûr, mais il allonge le démarrage.
#   - Une migration destructive appliquée automatiquement ne se relit pas. Pour
#     ce projet — neuf phases, un déploiement — le compromis penche du bon côté.
#     Sur un système en service, la migration mérite une étape séparée.
# =============================================================================

set -eu

echo '{"level":"INFO","logger":"entrypoint","message":"Attente de la base de données."}'

# La base peut n'accepter les connexions qu'après le démarrage du conteneur :
# `depends_on: service_healthy` le couvre en compose, pas ailleurs.
# La sonde ecrit la raison du refus, et non le seul fait qu'il y en ait un.
# « Base injoignable » sans le message de PostgreSQL laisse le choix entre un
# mot de passe faux, un hote inconnu, un pare-feu et une base endormie : quatre
# pistes, aucune preuve. Le detail part sur la sortie d'erreur a chaque essai
# manque, jamais le mot de passe — il ne figure pas dans ces messages.
sonde() {
    python - <<'PYSONDE'
import sys
from sqlalchemy import create_engine, text
from app.core.config import get_settings

try:
    moteur = create_engine(get_settings().database_url, pool_pre_ping=True)
    with moteur.connect() as connexion:
        connexion.execute(text("SELECT 1"))
except Exception as erreur:
    # `str(erreur)` porte le message du serveur, pas la chaine de connexion.
    # Guillemets et retours a la ligne neutralises : la raison est reinjectee
    # dans un journal JSON, qu ils casseraient.
    detail = " ".join(str(erreur).split())[:300].replace('"', "'")
    print(detail, file=sys.stderr)
    sys.exit(1)
PYSONDE
}

tentative=0
until raison=$(sonde 2>&1 >/dev/null); do
    tentative=$((tentative + 1))
    if [ "$tentative" -ge 30 ]; then
        echo "{\"level\":\"ERROR\",\"logger\":\"entrypoint\",\"message\":\"Base injoignable apres 30 tentatives.\",\"raison\":\"${raison}\"}" >&2
        exit 1
    fi
    if [ "$tentative" = "1" ] || [ "$tentative" = "10" ]; then
        echo "{\"level\":\"INFO\",\"logger\":\"entrypoint\",\"message\":\"Base pas encore prete.\",\"tentative\":${tentative},\"raison\":\"${raison}\"}"
    fi
    sleep 2
done

echo '{"level":"INFO","logger":"entrypoint","message":"Application des migrations."}'
alembic upgrade head

echo '{"level":"INFO","logger":"entrypoint","message":"Schéma à jour, démarrage du service."}'

# `exec` : le processus applicatif remplace le shell et reçoit donc SIGTERM
# directement. Sans lui, l'arrêt attendrait le délai de grâce puis tuerait le
# conteneur, coupant les requêtes en vol.
exec "$@"

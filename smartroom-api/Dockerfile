# =============================================================================
# Image de l'API — deux étapes.
#
# La première compile les dépendances dans un environnement virtuel ; la
# seconde ne reçoit que cet environnement. La chaîne de compilation — gcc, les
# en-têtes de développement — ne survit pas au changement d'étape : elle pèse
# une centaine de mégaoctets et constitue autant d'outils offerts à qui
# obtiendrait un accès au conteneur.
# =============================================================================

FROM python:3.12-slim AS constructeur

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# `psycopg[binary]` est fourni précompilé ; `build-essential` reste nécessaire
# pour les dépendances qui n'ont pas de roue pour cette plateforme.
RUN apt-get update \
    && apt-get install --no-install-recommends -y build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Les dépendances avant le code : une modification de source ne réinvalide pas
# la couche d'installation, et une reconstruction descend à quelques secondes.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt


# --------------------------------------------------------------------------- #

FROM python:3.12-slim AS final

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    # Le fuseau du conteneur : les journaux et les tâches planifiées le lisent.
    TZ=Europe/Paris

# `curl` sert aux sondes de l'orchestrateur. C'est le seul outil ajouté :
# chaque paquet installé est une surface de plus.
RUN apt-get update \
    && apt-get install --no-install-recommends -y curl tzdata \
    && rm -rf /var/lib/apt/lists/*

# L'utilisateur est créé avant la copie : les fichiers lui appartiennent dès
# l'écriture, sans `chown -R` sur une couche entière.
RUN groupadd --gid 1000 smartroom \
    && useradd --uid 1000 --gid 1000 --create-home smartroom

WORKDIR /app

COPY --from=constructeur /opt/venv /opt/venv
COPY --chown=smartroom:smartroom . .

# Le répertoire des téléversements est monté en volume en production ; il est
# créé ici pour que l'application démarre même sans montage.
RUN mkdir -p /app/media && chown smartroom:smartroom /app/media \
    && chmod +x /app/docker-entrypoint.sh

USER smartroom

EXPOSE 8000

# La sonde de l'image interroge la vivacité et non la disponibilité : Docker
# redémarre le conteneur quand elle échoue, et une base momentanément absente
# ne doit pas provoquer ce redémarrage.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
    CMD curl --fail --silent http://127.0.0.1:8000/health || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

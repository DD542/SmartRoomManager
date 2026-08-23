# Image de l'API — multi-étapes pour ne pas embarquer la chaîne de compilation.
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Les dépendances sont installées avant le code : une modification de source ne
# réinvalide pas la couche d'installation.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Utilisateur non privilégié : le conteneur ne tourne pas en root.
RUN useradd --create-home --uid 1000 smartroom && chown -R smartroom:smartroom /app
USER smartroom

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

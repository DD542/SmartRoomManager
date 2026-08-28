"""Cycle de vie de l'application.

Ce test tient en trois lignes et n'aurait jamais dû manquer : le décorateur
`@asynccontextmanager` avait glissé d'une fonction à l'autre en ajoutant le
préchauffage des modèles, et `lifespan` n'était plus un gestionnaire de
contexte. L'API refusait alors de démarrer — « Application startup failed » —
alors que les 942 tests passaient, aucun n'ouvrant le cycle de vie.
"""

from __future__ import annotations

import pytest

from app.main import _prechauffer, app, lifespan

pytestmark = pytest.mark.integration


@pytest.mark.asyncio
async def test_le_cycle_de_vie_s_ouvre_et_se_ferme():
    async with lifespan(app):
        pass


@pytest.mark.asyncio
async def test_le_prechauffage_n_empeche_jamais_le_demarrage(monkeypatch):
    """Ollama absent est un état normal : l'assistant retombe sur son moteur
    déterministe, et le démarrage n'en sait rien."""

    async def echouer(self):
        raise RuntimeError("Ollama injoignable")

    monkeypatch.setattr(
        "app.ai.providers.selection.SelecteurModeles.prechauffer", echouer
    )
    await _prechauffer()

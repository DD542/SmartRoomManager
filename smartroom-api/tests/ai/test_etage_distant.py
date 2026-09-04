"""L'étage B est-il réellement atteignable, et le corpus reste-t-il cohérent ?

Deux défauts distincts, tous deux silencieux, tous deux corrigés ici.

Le premier : `ClientDistant` refuse d'émettre sans anonymisation — c'est une
garde voulue — mais aucun des cinq points de construction du sélecteur ne lui
en passait une. L'étage B était donc configurable et inatteignable, et le seul
signe était une ligne de journal.

Le second : le poste local et l'hébergement partagent la même base. Si l'un
vectorise avec Ollama et l'autre avec l'étage B, les questions tombent dans un
espace différent de celui des fragments. La similarité reste calculable, et ne
veut plus rien dire — la recherche ne trouve simplement plus.
"""

from __future__ import annotations

import pytest

from app.ai.providers.base import (
    FournisseurIndisponible,
    LLMProvider,
    Mesures,
    RoleModele,
)
from app.ai.providers.selection import SelecteurModeles
from app.ai.reglages import ReglagesIA

#: `tests/conftest.py` pose `IA_FORCER_REPLI=true` pour toute la suite, afin
#: qu'aucun test n'appelle un modèle par megarde. Ces tests-ci n'en appellent
#: aucun : ils eprouvent le **choix** du fournisseur, en amont de tout envoi.
#: La garde est donc levee ici, et nulle part ailleurs.
DISTANT = {
    "forcer_repli": False,
    "distant_url": "https://exemple.test/v1",
    "distant_cle": "cle-de-test",
    "distant_modele_vecteurs": "modele-distant",
}


class FauxOllama(LLMProvider):
    """Répond toujours présent, pour que l'ordre habituel le choisisse."""

    nom = "ollama"

    async def disponible(self) -> bool:
        return True

    async def discuter(self, *args, **kwargs):  # pragma: no cover - non sollicité
        raise NotImplementedError

    async def vectoriser(self, textes, *, modele):  # pragma: no cover
        return [[0.0] * 768 for _ in textes]

    async def mesures(self) -> Mesures:  # pragma: no cover
        raise NotImplementedError


def selecteur(**reglages) -> SelecteurModeles:
    return SelecteurModeles(ReglagesIA(ollama_url="", **reglages))


class TestAnonymisation:
    @pytest.mark.asyncio
    async def test_l_etage_distant_est_joignable_sans_rien_lui_passer(self):
        """Contre-épreuve du défaut : sans anonymiseur par défaut, ce test
        échoue sur « Aucun fournisseur d'inférence disponible »."""
        fournisseur, modele = await selecteur(**DISTANT).pour(RoleModele.VECTEURS)

        assert fournisseur.nom == "distant"
        assert modele == "modele-distant"

    @pytest.mark.asyncio
    async def test_les_messages_sortants_sont_masques(self):
        """L'anonymiseur branché doit masquer, pas seulement exister."""
        from app.ai.guardrails.anonymisation import anonymiser
        from app.ai.providers.base import Message, RoleMessage

        sortants = anonymiser(
            [Message(role=RoleMessage.UTILISATEUR, contenu="ecris a jean@ece.fr")]
        )

        assert "jean@ece.fr" not in sortants[0].contenu


class TestCoherenceDesVecteurs:
    @pytest.mark.asyncio
    async def test_les_vecteurs_partent_au_distant_malgre_ollama(self):
        """Le corpus indexé impose son modèle, quel que soit l'étage joignable."""
        choix = SelecteurModeles(ReglagesIA(vecteurs_toujours_distants=True, **DISTANT))
        choix._local = FauxOllama()  # noqa: SLF001 - on éprouve la priorité

        fournisseur, _ = await choix.pour(RoleModele.VECTEURS)

        assert fournisseur.nom == "distant"

    @pytest.mark.asyncio
    async def test_le_raisonnement_garde_l_ordre_habituel(self):
        """Contre-épreuve : le réglage ne vise que les vecteurs.

        Sans elle, on pourrait detourner tout le trafic vers l'etage B sans
        que rien ne le signale — et payer pour ce qu'Ollama fait gratuitement.
        """
        choix = SelecteurModeles(ReglagesIA(vecteurs_toujours_distants=True, **DISTANT))
        choix._local = FauxOllama()  # noqa: SLF001

        fournisseur, _ = await choix.pour(RoleModele.RAISONNEMENT)

        assert fournisseur.nom == "ollama"

    @pytest.mark.asyncio
    async def test_l_etage_b_muet_ne_fait_pas_chercher_de_travers(self):
        """Mieux vaut le seul volet lexical qu'une comparaison sans sens."""
        # Etage B explicitement absent : sans cela, le `.env` du poste le
        # configure et le test ne mesure plus rien.
        choix = SelecteurModeles(
            ReglagesIA(
                forcer_repli=False,
                vecteurs_toujours_distants=True,
                distant_url="",
                distant_cle="",
            )
        )
        choix._local = FauxOllama()  # noqa: SLF001

        with pytest.raises(FournisseurIndisponible):
            await choix.pour(RoleModele.VECTEURS)

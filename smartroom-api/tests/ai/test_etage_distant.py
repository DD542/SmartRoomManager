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

import json

import httpx
import pytest

from app.ai.providers import agreger
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


class TestAppelsSansIndex:
    """Certaines façades rendent l'appel entier, sans champ `index`.

    Mesuré sur la façade OpenAI de Gemini : un appel complet dans un seul
    fragment, `index` absent. Le code correlait les morceaux par cet index et
    repliait les absents sur zéro — deux appels simultanés s'y fondaient, noms
    et arguments concaténés, et l'agent recevait un outil inexistant.
    """

    @staticmethod
    def _client(gestionnaire):
        from app.ai.providers.distant import ClientDistant

        # La garde d'anonymisation a son propre test dans test_fournisseurs ;
        # ici on eprouve la recomposition des appels, rien d'autre.
        client = ClientDistant(
            base_url="http://distant.invalide", cle="k", exiger_anonymisation=False
        )
        client._client = httpx.AsyncClient(  # noqa: SLF001 - transport simulé
            base_url="http://distant.invalide",
            transport=httpx.MockTransport(gestionnaire),
            headers={"Authorization": "Bearer k"},
        )
        return client

    @pytest.mark.asyncio
    async def test_deux_appels_sans_index_restent_distincts(self):
        from app.ai.providers.base import Message, RoleMessage

        def sans_index(nom: str, arguments: str) -> dict:
            return {
                "type": "function",
                "id": nom,
                "function": {"name": nom, "arguments": arguments},
            }

        corps = (
            'data: {"choices":[{"delta":{"tool_calls":['
            + json.dumps(sans_index("lister_mes_reservations", '{"etat":"a_venir"}'))
            + ","
            + json.dumps(sans_index("consulter_regles", "{}"))
            + "]}}]}\r\n\r\ndata: [DONE]\r\n\r\n"
        )

        client = self._client(
            lambda requete: httpx.Response(200, content=corps.encode())
        )
        reponse = await agreger(
            client.discuter(
                [Message(role=RoleMessage.UTILISATEUR, contenu="x")], modele="m"
            )
        )
        await client.fermer()

        noms = sorted(appel.nom for appel in reponse.appels)
        assert noms == ["consulter_regles", "lister_mes_reservations"]
        assert reponse.appels[0].arguments == {"etat": "a_venir"}


class TestArgumentsRenvoyes:
    """Le second aller-retour renvoie l'appel au modèle. En quelle forme ?

    `AppelOutil.arguments` est un dictionnaire — la forme utile à la boucle
    d'agent — et Ollama l'accepte. Le protocole OpenAI transporte une chaîne :

        Value is not a string: {"question":"absence"}

    Mesuré sur la façade Gemini. L'erreur ne survient qu'au second appel, et le
    tour bascule au repli avec « ia_fournisseur » pour seul indice : à l'écran,
    la bonne carte, puis « je n'ai pas compris la demande » sous elle.
    """

    @pytest.mark.asyncio
    async def test_les_arguments_repartent_en_texte(self):
        from app.ai.providers.base import AppelOutil, Message, RoleMessage
        from app.ai.providers.distant import ClientDistant

        vus: dict = {}

        def repondre(requete: httpx.Request) -> httpx.Response:
            vus.update(json.loads(requete.content))
            return httpx.Response(200, content=b"data: [DONE]\r\n\r\n")

        client = ClientDistant(
            base_url="http://distant.invalide", cle="k", exiger_anonymisation=False
        )
        client._client = httpx.AsyncClient(  # noqa: SLF001 - transport simulé
            base_url="http://distant.invalide",
            transport=httpx.MockTransport(repondre),
        )
        await agreger(
            client.discuter(
                [
                    Message(
                        role=RoleMessage.ASSISTANT,
                        contenu="",
                        appels=(
                            AppelOutil(
                                nom="rechercher_faq",
                                arguments={"question": "absence"},
                                identifiant="a1",
                            ),
                        ),
                    )
                ],
                modele="m",
            )
        )
        await client.fermer()

        envoye = vus["messages"][0]["tool_calls"][0]["function"]["arguments"]
        assert isinstance(envoye, str), "le protocole OpenAI refuse un objet ici"
        assert json.loads(envoye) == {"question": "absence"}

    @pytest.mark.asyncio
    async def test_un_message_sans_appel_est_laisse_intact(self):
        """Contre-épreuve : ne pas fabriquer une clé là où il n'y en avait pas."""
        from app.ai.providers.base import Message, RoleMessage
        from app.ai.providers.distant import ClientDistant

        client = ClientDistant(
            base_url="http://x.invalide", cle="k", exiger_anonymisation=False
        )
        charge = client._preparer(  # noqa: SLF001 - la traduction est le sujet
            [Message(role=RoleMessage.UTILISATEUR, contenu="bonjour")]
        )

        assert "tool_calls" not in charge[0]


class TestRetraduction:
    """Ce qui est masqué à l'aller doit revenir au retour.

    La docstring de l'anonymiseur promettait « les réponses sont retraduites à
    l'affichage » ; rien ne le faisait. `restituer()` existait et n'était appelé
    nulle part, et `anonymiser()` fabriquait un anonymiseur sans mémoire à
    chaque appel — la table de correspondance mourait avec lui.

    Le modèle diffuse le jeton en plusieurs morceaux : « PERSON », puis
    « NE_1 ». Retraduire chaque morceau ne reconnaîtrait ni l'un ni l'autre,
    d'où l'attente du blanc suivant.
    """

    @staticmethod
    def _flux(*morceaux: str) -> bytes:
        corps = "".join(
            'data: {"choices":[{"delta":{"content":%s}}]}\r\n\r\n' % json.dumps(m)
            for m in morceaux
        )
        return (corps + "data: [DONE]\r\n\r\n").encode()

    async def _repondre(self, anonymiseur, *morceaux: str) -> str:
        from app.ai.providers.base import Message, RoleMessage
        from app.ai.providers.distant import ClientDistant

        client = ClientDistant(
            base_url="http://x.invalide", cle="k", anonymiseur=anonymiseur
        )
        client._client = httpx.AsyncClient(  # noqa: SLF001 - transport simulé
            base_url="http://x.invalide",
            transport=httpx.MockTransport(
                lambda requete: httpx.Response(200, content=self._flux(*morceaux))
            ),
        )
        reponse = await agreger(
            client.discuter(
                [Message(role=RoleMessage.UTILISATEUR, contenu="x")], modele="m"
            )
        )
        await client.fermer()
        return reponse.texte

    @pytest.mark.asyncio
    async def test_un_jeton_coupe_en_deux_est_retraduit(self):
        from app.ai.guardrails.anonymisation import Anonymiseur

        anonymiseur = Anonymiseur()
        anonymiseur.masquer("reserve pour Marie Laurent")

        rendu = await self._repondre(
            anonymiseur, "La ", "reunion ", "de ", "PERSON", "NE_1", " est ", "posee."
        )

        assert rendu == "La reunion de Marie Laurent est posee."

    @pytest.mark.asyncio
    async def test_le_dernier_mot_n_est_pas_perdu(self):
        """Contre-épreuve : le tampon doit être vidé en fin de flux.

        Le dernier mot n'est suivi d'aucun blanc ; sans vidange, chaque réponse
        s'arrêterait un mot trop tôt — une perte silencieuse.
        """
        from app.ai.guardrails.anonymisation import Anonymiseur

        rendu = await self._repondre(Anonymiseur(), "deux ", "mots")

        assert rendu == "deux mots"


class TestSignatureDeRaisonnement:
    """Gemini 3 exige de retrouver sa signature au tour suivant.

        400 Function call is missing a thought_signature in functionCall parts.
            This is required for tools to work correctly.

    Elle voyage dans `extra_content`, hors du protocole OpenAI, et se perdait
    donc à la traduction. Le premier appel passait, l'outil s'exécutait, et le
    second échouait : à l'écran, la carte apparaissait puis la réponse
    s'arrêtait.
    """

    SIGNATURE = {"google": {"thought_signature": "El4KXAERTTIP"}}

    @staticmethod
    def _client(gestionnaire):
        from app.ai.providers.distant import ClientDistant

        client = ClientDistant(
            base_url="http://x.invalide", cle="k", exiger_anonymisation=False
        )
        client._client = httpx.AsyncClient(  # noqa: SLF001 - transport simulé
            base_url="http://x.invalide", transport=httpx.MockTransport(gestionnaire)
        )
        return client

    @pytest.mark.asyncio
    async def test_elle_repart_avec_l_appel_qu_elle_accompagnait(self):
        from app.ai.providers.base import AppelOutil, Message, RoleMessage

        flux = (
            'data: {"choices":[{"delta":{"tool_calls":[{"id":"call_1",'
            '"type":"function","extra_content":'
            + json.dumps(self.SIGNATURE)
            + ',"function":{"name":"localiser_salle","arguments":"{}"}}]}}]}'
            "\r\n\r\ndata: [DONE]\r\n\r\n"
        )
        vus: list[dict] = []

        def repondre(requete: httpx.Request) -> httpx.Response:
            vus.append(json.loads(requete.content))
            return httpx.Response(200, content=flux.encode())

        client = self._client(repondre)
        await agreger(
            client.discuter(
                [Message(role=RoleMessage.UTILISATEUR, contenu="ou est Hopper")],
                modele="m",
            )
        )
        # Second tour : l'appel repart, accompagné de sa signature.
        await agreger(
            client.discuter(
                [
                    Message(
                        role=RoleMessage.ASSISTANT,
                        contenu="",
                        appels=(
                            AppelOutil(
                                nom="localiser_salle",
                                arguments={},
                                identifiant="call_1",
                            ),
                        ),
                    )
                ],
                modele="m",
            )
        )
        await client.fermer()

        renvoye = vus[1]["messages"][0]["tool_calls"][0]
        assert renvoye["extra_content"] == self.SIGNATURE

    @pytest.mark.asyncio
    async def test_rien_n_est_fabrique_quand_rien_n_a_ete_recu(self):
        """Contre-épreuve : Ollama, OpenAI et Gemini 2 n'en envoient aucune.

        Ajouter une clé vide ferait échouer les fournisseurs qui ne la
        connaissent pas.
        """
        from app.ai.providers.base import AppelOutil, Message, RoleMessage

        client = self._client(lambda r: httpx.Response(200, content=b""))
        charge = client._preparer(  # noqa: SLF001 - la traduction est le sujet
            [
                Message(
                    role=RoleMessage.ASSISTANT,
                    contenu="",
                    appels=(AppelOutil(nom="x", arguments={}, identifiant="inconnu"),),
                )
            ]
        )

        assert "extra_content" not in charge[0]["tool_calls"][0]

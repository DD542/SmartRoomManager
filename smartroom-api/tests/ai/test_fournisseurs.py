"""Les clients d'inférence, éprouvés contre un serveur simulé.

`httpx.MockTransport` rend ces tests sans réseau ni modèle : ce qui est vérifié
ici, c'est l'analyse du flux et la traduction des pannes — précisément là où
les défauts du lot 1 se cachaient, et qu'aucun test de boucle n'aurait vus.

Trois d'entre eux rejouent un défaut constaté en conditions réelles :

  * les schémas d'outils envoyés **sans leur enveloppe** étaient ignorés par
    Ollama sans la moindre erreur ;
  * un délai d'attente était journalisé comme une panne réseau ;
  * les trames SSE terminées par `\\r\\n\\r\\n` n'étaient jamais découpées.
"""

from __future__ import annotations

import json

import httpx
import pytest

from app.ai.providers import Message, RoleMessage, agreger
from app.ai.providers.base import DelaiDepasse, ErreurFournisseur
from app.ai.providers.distant import ClientDistant
from app.ai.providers.ollama import ClientOllama
from app.ai.providers.selection import SelecteurModeles

OUTIL = {
    "name": "rechercher_salles",
    "description": "Cherche des salles.",
    "parameters": {
        "type": "object",
        "properties": {"capacite_min": {"type": "integer"}},
    },
}


def ndjson(*evenements: dict) -> bytes:
    return "".join(
        json.dumps(item, ensure_ascii=False) + "\n" for item in evenements
    ).encode()


def client_ollama(gestionnaire) -> ClientOllama:
    client = ClientOllama(base_url="http://ollama.invalide")
    client._client = httpx.AsyncClient(  # noqa: SLF001 - injection du transport simulé
        base_url="http://ollama.invalide", transport=httpx.MockTransport(gestionnaire)
    )
    return client


class TestOllama:
    @pytest.mark.asyncio
    async def test_le_texte_arrive_par_morceaux(self):
        def repondre(requete: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                content=ndjson(
                    {"message": {"role": "assistant", "content": "Bon"}, "done": False},
                    {
                        "message": {"role": "assistant", "content": "jour."},
                        "done": False,
                    },
                    {
                        "message": {"role": "assistant", "content": ""},
                        "done": True,
                        "done_reason": "stop",
                        "prompt_eval_count": 12,
                        "eval_count": 3,
                    },
                ),
            )

        client = client_ollama(repondre)
        reponse = await agreger(
            client.discuter(
                [Message(role=RoleMessage.UTILISATEUR, contenu="salut")], modele="m"
            )
        )

        assert reponse.texte == "Bonjour."
        assert reponse.mesures.jetons_invite == 12
        assert reponse.mesures.premier_jeton_ms is not None
        await client.fermer()

    @pytest.mark.asyncio
    async def test_les_schemas_d_outils_partent_dans_leur_enveloppe(self):
        """Le défaut du lot 1 : envoyés à plat, Ollama les ignore **sans
        erreur**, la réponse revient en texte et aucun outil n'est appelé."""
        vus: dict = {}

        def repondre(requete: httpx.Request) -> httpx.Response:
            vus.update(json.loads(requete.content))
            return httpx.Response(200, content=ndjson({"message": {}, "done": True}))

        client = client_ollama(repondre)
        await agreger(
            client.discuter(
                [Message(role=RoleMessage.UTILISATEUR, contenu="une salle")],
                modele="m",
                outils=[OUTIL],
            )
        )

        assert vus["tools"] == [{"type": "function", "function": OUTIL}]
        await client.fermer()

    @pytest.mark.asyncio
    async def test_un_appel_d_outil_est_traduit(self):
        def repondre(requete: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                content=ndjson(
                    {
                        "message": {
                            "role": "assistant",
                            "content": "",
                            "tool_calls": [
                                {
                                    "id": "call_1",
                                    "function": {
                                        "name": "rechercher_salles",
                                        "arguments": {"capacite_min": 4},
                                    },
                                }
                            ],
                        },
                        "done": True,
                    }
                ),
            )

        client = client_ollama(repondre)
        reponse = await agreger(
            client.discuter(
                [Message(role=RoleMessage.UTILISATEUR, contenu="x")], modele="m"
            )
        )

        assert [(appel.nom, appel.arguments) for appel in reponse.appels] == [
            ("rechercher_salles", {"capacite_min": 4})
        ]
        await client.fermer()

    @pytest.mark.asyncio
    async def test_des_arguments_en_chaine_sont_acceptes(self):
        """Selon les modèles, `arguments` arrive en objet ou en chaîne JSON."""

        def repondre(requete: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                content=ndjson(
                    {
                        "message": {
                            "tool_calls": [
                                {
                                    "function": {
                                        "name": "rechercher_salles",
                                        "arguments": '{"capacite_min": 6}',
                                    }
                                }
                            ]
                        },
                        "done": True,
                    }
                ),
            )

        client = client_ollama(repondre)
        reponse = await agreger(
            client.discuter(
                [Message(role=RoleMessage.UTILISATEUR, contenu="x")], modele="m"
            )
        )

        assert reponse.appels[0].arguments == {"capacite_min": 6}
        await client.fermer()

    @pytest.mark.asyncio
    async def test_un_appel_illisible_est_ignore_plutot_que_devine(self):
        def repondre(requete: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                content=ndjson(
                    {
                        "message": {
                            "tool_calls": [
                                {
                                    "function": {
                                        "name": "rechercher_salles",
                                        "arguments": "{pas du json",
                                    }
                                }
                            ]
                        },
                        "done": True,
                    }
                ),
            )

        client = client_ollama(repondre)
        reponse = await agreger(
            client.discuter(
                [Message(role=RoleMessage.UTILISATEUR, contenu="x")], modele="m"
            )
        )

        assert reponse.appels == ()
        await client.fermer()

    @pytest.mark.asyncio
    async def test_une_ligne_illisible_n_interrompt_pas_le_flux(self):
        def repondre(requete: httpx.Request) -> httpx.Response:
            corps = b'{"message": {"content": "A"}, "done": false}\n{ceci n\'est pas du json\n'
            corps += ndjson({"message": {"content": "B"}, "done": True})
            return httpx.Response(200, content=corps)

        client = client_ollama(repondre)
        reponse = await agreger(
            client.discuter(
                [Message(role=RoleMessage.UTILISATEUR, contenu="x")], modele="m"
            )
        )

        assert reponse.texte == "AB"
        await client.fermer()

    @pytest.mark.asyncio
    async def test_un_delai_est_nomme_delai_et_non_panne(self):
        """Le tableau de bord doit pouvoir compter les deux séparément."""

        def repondre(requete: httpx.Request) -> httpx.Response:
            raise httpx.ReadTimeout("trop lent", request=requete)

        client = client_ollama(repondre)
        with pytest.raises(DelaiDepasse) as souci:
            async for _ in client.discuter(
                [Message(role=RoleMessage.UTILISATEUR, contenu="x")], modele="m"
            ):
                pass

        assert souci.value.code == "ia_delai"
        await client.fermer()

    @pytest.mark.asyncio
    async def test_un_refus_du_serveur_est_une_erreur_de_fournisseur(self):
        def repondre(requete: httpx.Request) -> httpx.Response:
            return httpx.Response(404, json={"error": "model not found"})

        client = client_ollama(repondre)
        with pytest.raises(ErreurFournisseur):
            async for _ in client.discuter(
                [Message(role=RoleMessage.UTILISATEUR, contenu="x")], modele="absent"
            ):
                pass
        await client.fermer()

    @pytest.mark.asyncio
    async def test_un_ollama_absent_rend_indisponible_sans_lever(self):
        def repondre(requete: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("injoignable", request=requete)

        client = client_ollama(repondre)
        assert await client.disponible() is False
        assert await client.modeles() == []
        await client.fermer()

    @pytest.mark.asyncio
    async def test_la_vectorisation_refuse_un_decompte_incoherent(self):
        """Un décalage indexerait des fragments sous le vecteur d'un autre."""

        def repondre(requete: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"embeddings": [[0.1, 0.2]]})

        client = client_ollama(repondre)
        with pytest.raises(ErreurFournisseur):
            await client.vectoriser(["un", "deux"], modele="v")
        await client.fermer()

    @pytest.mark.asyncio
    async def test_le_prechauffage_signale_son_echec_sans_lever(self):
        def repondre(requete: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("injoignable", request=requete)

        client = client_ollama(repondre)
        assert await client.prechauffer("qwen2.5:7b") is False
        await client.fermer()


class TestPrechauffage:
    """Le chargement des poids au démarrage.

    Ollama garde les modèles `keep_alive`, puis les relit depuis le disque —
    79 secondes mesurées au premier appel, contre un budget de premier jeton de
    six. Sans préchauffage, toute première question part au repli déterministe
    et l'assistant répond « je n'ai pas compris » à ce que le modèle traite
    sans peine. `ClientOllama.prechauffer` existait ; rien ne l'appelait.
    """

    def _selecteur(self, gestionnaire, **reglages):
        from app.ai.reglages import ReglagesIA

        selecteur = SelecteurModeles(
            ReglagesIA(
                ollama_url="http://ollama.invalide",
                modele_raisonnement="qwen2.5:7b",
                modele_vecteurs="nomic-embed-text",
                # La suite pose `IA_FORCER_REPLI` pour couper toute inférence :
                # ces tests-ci éprouvent justement le chargement des modèles,
                # et disent donc explicitement la configuration qu'ils veulent.
                **{"forcer_repli": False, **reglages},
            )
        )
        selecteur._local = client_ollama(gestionnaire)  # noqa: SLF001
        return selecteur

    @pytest.mark.asyncio
    async def test_les_deux_modeles_utiles_sont_charges(self):
        appels: list[str] = []

        def repondre(requete: httpx.Request) -> httpx.Response:
            if requete.url.path == "/api/tags":
                return httpx.Response(200, json={"models": []})
            appels.append(json.loads(requete.content)["model"])
            return httpx.Response(200, json={"done": True})

        selecteur = self._selecteur(repondre)
        charges = await selecteur.prechauffer()

        assert charges == ["qwen2.5:7b", "nomic-embed-text"]
        # Le modèle rapide n'en est pas : trois modèles en mémoire saturent un
        # poste ordinaire, et la mesure ne montre aucun gain.
        assert appels == ["qwen2.5:7b", "nomic-embed-text"]

    @pytest.mark.asyncio
    async def test_un_ollama_absent_ne_leve_pas(self):
        def repondre(requete: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("injoignable", request=requete)

        assert await self._selecteur(repondre).prechauffer() == []

    @pytest.mark.asyncio
    async def test_le_repli_force_ne_charge_rien(self):
        def repondre(requete: httpx.Request) -> httpx.Response:
            raise AssertionError("aucun appel attendu sous repli forcé")

        selecteur = self._selecteur(repondre, forcer_repli=True)
        assert await selecteur.prechauffer() == []


class TestDistant:
    def client(self, gestionnaire, **kw) -> ClientDistant:
        client = ClientDistant(
            base_url="https://distant.invalide/v1",
            cle="clef",
            exiger_anonymisation=False,
            **kw,
        )
        client._client = httpx.AsyncClient(  # noqa: SLF001
            base_url="https://distant.invalide/v1",
            transport=httpx.MockTransport(gestionnaire),
        )
        return client

    @pytest.mark.asyncio
    async def test_le_flux_sse_est_decoupe(self):
        def repondre(requete: httpx.Request) -> httpx.Response:
            corps = (
                'data: {"choices":[{"delta":{"content":"Bon"}}]}\r\n\r\n'
                'data: {"choices":[{"delta":{"content":"jour"}}]}\r\n\r\n'
                "data: [DONE]\r\n\r\n"
            )
            return httpx.Response(200, content=corps.encode())

        client = self.client(repondre)
        reponse = await agreger(
            client.discuter(
                [Message(role=RoleMessage.UTILISATEUR, contenu="x")], modele="m"
            )
        )

        assert reponse.texte == "Bonjour"
        await client.fermer()

    @pytest.mark.asyncio
    async def test_les_appels_arrivent_par_morceaux_indexes(self):
        def repondre(requete: httpx.Request) -> httpx.Response:
            corps = (
                'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1",'
                '"function":{"name":"rechercher_","arguments":"{\\"cap"}}]}}]}\r\n\r\n'
                'data: {"choices":[{"delta":{"tool_calls":[{"index":0,'
                '"function":{"name":"salles","arguments":"acite_min\\": 4}"}}]}}]}\r\n\r\n'
                "data: [DONE]\r\n\r\n"
            )
            return httpx.Response(200, content=corps.encode())

        client = self.client(repondre)
        reponse = await agreger(
            client.discuter(
                [Message(role=RoleMessage.UTILISATEUR, contenu="x")], modele="m"
            )
        )

        assert reponse.appels[0].nom == "rechercher_salles"
        assert reponse.appels[0].arguments == {"capacite_min": 4}
        await client.fermer()

    @pytest.mark.asyncio
    async def test_l_anonymiseur_s_applique_avant_l_envoi(self):
        vus: dict = {}

        def repondre(requete: httpx.Request) -> httpx.Response:
            vus.update(json.loads(requete.content))
            return httpx.Response(200, content=b"data: [DONE]\r\n\r\n")

        from app.ai.guardrails import Anonymiseur

        client = self.client(repondre, anonymiseur=Anonymiseur())
        await agreger(
            client.discuter(
                [
                    Message(
                        role=RoleMessage.UTILISATEUR,
                        contenu="écris à jean.dupont@ece.fr",
                    )
                ],
                modele="m",
            )
        )

        assert "jean.dupont@ece.fr" not in json.dumps(vus)
        await client.fermer()

    @pytest.mark.asyncio
    async def test_sans_anonymiseur_l_envoi_est_refuse(self):
        def repondre(requete: httpx.Request) -> httpx.Response:  # pragma: no cover
            raise AssertionError("aucune requête ne doit partir")

        client = ClientDistant(
            base_url="https://distant.invalide/v1",
            cle="clef",
            exiger_anonymisation=True,
        )
        client._client = httpx.AsyncClient(  # noqa: SLF001
            base_url="https://distant.invalide/v1",
            transport=httpx.MockTransport(repondre),
        )

        with pytest.raises(ErreurFournisseur) as souci:
            async for _ in client.discuter(
                [Message(role=RoleMessage.UTILISATEUR, contenu="x")], modele="m"
            ):
                pass

        assert souci.value.code == "ia_anonymisation_absente"
        await client.fermer()

    @pytest.mark.asyncio
    async def test_la_vectorisation_distante_respecte_l_ordre(self):
        def repondre(requete: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "data": [
                        {"index": 1, "embedding": [0.2]},
                        {"index": 0, "embedding": [0.1]},
                    ]
                },
            )

        client = self.client(repondre)
        vecteurs = await client.vectoriser(["premier", "second"], modele="v")

        assert vecteurs == [[0.1], [0.2]]
        await client.fermer()

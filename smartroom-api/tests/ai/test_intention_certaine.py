"""Une question fermée sur son propre agenda ne passe pas par le modèle.

Mesure qui a motivé ce chemin, cinq essais identiques de « donne moi mes
prochaines réservations » sur un agenda qui en contient cinq :

  * `qwen2.5:7b` appelle `lister_mes_reservations` trois fois sur cinq. Les
    deux autres fois il écrit une phrase plausible — parfois « je n'ai pas
    trouvé » — devant un agenda plein. L'utilisateur ne peut pas distinguer
    les deux réponses ;
  * `qwen2.5:14b`, pourtant deux fois plus gros, ne l'appelle jamais ;
  * le résultat de l'outil placé d'office dans son contexte n'y change rien :
    il continue d'écrire « je n'ai pas trouvé cette information » à côté de la
    carte qui liste les réservations.

Le défaut n'est pas le modèle, c'est de lui laisser ce choix. Une question
fermée dont la réponse est une liste n'a rien à gagner d'un modèle de langage,
et tout à perdre : le moteur déterministe répond juste à chaque fois.

Ce n'est donc pas un repli subi. Le journal le distingue par son déclencheur,
`intention_certaine`, pour que A-13 ne le compte pas comme une panne.
"""

from __future__ import annotations

import pytest

from app.ai.agent.boucle import Agent, intention_certaine
from app.ai.agent.evenements import TypeEvenement

pytestmark = pytest.mark.integration


async def jouer(agent: Agent, message: str) -> list:
    return [evenement async for evenement in agent.repondre(message)]


def fin(trace) -> dict:
    return next(e.donnees for e in trace if e.type is TypeEvenement.FIN)


def texte(trace) -> str:
    return "".join(e.donnees["texte"] for e in trace if e.type is TypeEvenement.TEXTE)


class TestFrontiere:
    """Ce que le verdict attrape, et surtout ce qu'il laisse passer."""

    @pytest.mark.parametrize(
        "message",
        [
            "donne moi mes prochaines reservations",
            "mes réservations",
            "quelles sont mes prochaines réunions ?",
            "mon planning de la semaine",
            "mes créneaux passés",
        ],
    )
    def test_une_demande_sur_son_propre_agenda(self, message):
        assert intention_certaine(message) is True

    @pytest.mark.parametrize(
        "message",
        [
            # Écritures : elles gardent leur tour de confirmation. Les capturer
            # ici supprimerait la garantie que rien ne s'écrit sans un « oui ».
            "annuler ma réservation de demain",
            "annule mes réservations de demain",
            "modifier mes réservations",
            # Questions ouvertes : le modèle sait les traiter, et lui, seul.
            "trouve une salle pour 4 personnes",
            "où se trouve la salle Hopper ?",
            "comment annuler une réservation ?",
            "quelles sont les règles de réservation ?",
        ],
    )
    def test_ce_qui_reste_au_modele(self, message):
        assert intention_certaine(message) is False


class TestRoutage:
    @pytest.mark.asyncio
    async def test_le_modele_n_est_pas_sollicite(
        self, session, principal, selecteur, faux_modele, magasin, intentions
    ):
        """Le modèle est disponible, et pourtant il ne parle pas.

        C'est le cœur du changement : avant, ce chemin dépendait de sa bonne
        volonté. `tours_consommes` à zéro le prouve — aucun jeton n'a été
        demandé, et la réponse ne peut donc pas varier d'un essai à l'autre.
        """
        agent = Agent(session, principal, selecteur=selecteur, magasin=magasin)

        trace = await jouer(agent, "donne moi mes prochaines réservations")

        assert faux_modele.tours_consommes == 0
        journal = fin(trace)
        assert journal["mode"] == "repli"
        assert journal["declencheur_repli"] == "intention_certaine"

    @pytest.mark.asyncio
    async def test_la_reponse_ne_reste_pas_vide(
        self, session, principal, selecteur, magasin, intentions
    ):
        """Une phrase, toujours. Un tour muet vaut une panne à l'écran."""
        agent = Agent(session, principal, selecteur=selecteur, magasin=magasin)

        trace = await jouer(agent, "mes réservations")

        assert texte(trace).strip()

    @pytest.mark.asyncio
    async def test_une_question_ouverte_garde_le_modele(
        self, session, principal, selecteur, faux_modele, magasin
    ):
        """Contre-épreuve : sans elle, un verdict trop large priverait
        l'assistant de son modèle sans que rien ne le signale."""
        from tests.ai.test_boucle import TourSimule

        faux_modele.programmer(TourSimule(texte="Voici ce que je peux dire."))
        agent = Agent(session, principal, selecteur=selecteur, magasin=magasin)

        trace = await jouer(agent, "où se trouve la salle Hopper ?")

        assert faux_modele.tours_consommes == 1
        assert fin(trace)["mode"] == "modele"

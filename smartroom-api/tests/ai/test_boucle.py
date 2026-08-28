"""La boucle d'agent, jouée sur une partition écrite d'avance.

Le fournisseur simulé rend ces scénarios reproductibles : c'est le seul moyen
d'éprouver un enchaînement d'outils, une bascule ou une confirmation sans
dépendre de l'humeur d'un modèle ni de la présence d'Ollama.

Une convention à connaître pour lire ces tests : **le routage consomme un tour
de la partition** dès que le rapprochement lexical hésite entre deux domaines.
C'est le comportement réel — il coûte un appel au petit modèle — et la
partition doit le prévoir, comme en production.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import func, select

from app.ai.agent import Agent
from app.ai.agent.evenements import TypeEvenement
from app.ai.providers import AppelOutil, TourSimule
from app.ai.providers.base import DelaiDepasse, SortieInexploitable
from app.api.deps import Principal
from app.models import Booking
from tests.services.conftest import creneau

pytestmark = pytest.mark.integration


async def jouer(agent: Agent, message: str, **kw) -> list:
    return [evenement async for evenement in agent.repondre(message, **kw)]


def types(trace) -> list[str]:
    return [evenement.type.value for evenement in trace]


def texte(trace) -> str:
    return "".join(
        evenement.donnees["texte"]
        for evenement in trace
        if evenement.type is TypeEvenement.TEXTE
    )


def fin(trace) -> dict:
    return next(e.donnees for e in trace if e.type is TypeEvenement.FIN)


def iso(moment: datetime) -> str:
    return moment.astimezone(UTC).isoformat().replace("+00:00", "Z")


class TestTourNominal:
    @pytest.mark.asyncio
    async def test_un_outil_de_lecture_puis_une_reponse(
        self, session, principal, selecteur, faux_modele, magasin, salle
    ):
        faux_modele.programmer(
            TourSimule(appels=(AppelOutil(nom="rechercher_salles", arguments={"capacite_min": 2}),)),
            TourSimule(texte="Deux salles conviennent."),
        )
        agent = Agent(session, principal, selecteur=selecteur, magasin=magasin)

        trace = await jouer(agent, "une salle pour 2 personnes")

        assert "outil" in types(trace)
        assert "carte" in types(trace)
        assert texte(trace) == "Deux salles conviennent."
        assert fin(trace)["outils"] == ["rechercher_salles"]
        assert fin(trace)["repli"] is False

    @pytest.mark.asyncio
    async def test_deux_outils_independants_sont_executes_ensemble(
        self, session, principal, selecteur, faux_modele, magasin, salle
    ):
        faux_modele.programmer(
            TourSimule(texte="parc, reservation"),  # réponse du routage
            TourSimule(
                appels=(
                    AppelOutil(nom="consulter_regles", arguments={}),
                    AppelOutil(nom="localiser_salle", arguments={"salle_nom": salle.name}),
                )
            ),
            TourSimule(texte="Voici les deux."),
        )
        agent = Agent(session, principal, selecteur=selecteur, magasin=magasin)

        trace = await jouer(agent, "les règles et où est cette salle")

        assert fin(trace)["outils"] == ["consulter_regles", "localiser_salle"]
        assert types(trace).count("carte") == 2

    @pytest.mark.asyncio
    async def test_un_appel_repete_a_l_identique_n_est_execute_qu_une_fois(
        self, session, principal, selecteur, faux_modele, magasin, salle
    ):
        faux_modele.programmer(
            TourSimule(
                appels=(
                    AppelOutil(nom="rechercher_salles", arguments={"capacite_min": 2}),
                    AppelOutil(nom="rechercher_salles", arguments={"capacite_min": 2}),
                )
            ),
            TourSimule(texte="Voilà."),
        )
        agent = Agent(session, principal, selecteur=selecteur, magasin=magasin)

        trace = await jouer(agent, "une salle pour 2 personnes")

        assert fin(trace)["outils"] == ["rechercher_salles"]

    @pytest.mark.asyncio
    async def test_un_outil_inexistant_est_signale_au_modele_sans_casser_le_tour(
        self, session, principal, selecteur, faux_modele, magasin
    ):
        faux_modele.programmer(
            TourSimule(texte="assistance"),  # routage
            TourSimule(appels=(AppelOutil(nom="supprimer_tout", arguments={}),)),
            TourSimule(texte="Je ne peux pas faire cela."),
        )
        agent = Agent(session, principal, selecteur=selecteur, magasin=magasin)

        trace = await jouer(agent, "supprime tout")

        assert texte(trace) == "Je ne peux pas faire cela."
        # Le refus est reparti au modèle : le message d'outil le contient.
        dernier = faux_modele.recus[-1]
        assert any("n'existe pas" in message.contenu for message in dernier.messages)

    @pytest.mark.asyncio
    async def test_le_plafond_d_iterations_arrete_proprement(
        self, session, principal, selecteur, faux_modele, magasin, salle
    ):
        """Un modèle qui boucle doit être arrêté, et l'utilisateur prévenu."""
        faux_modele.programmer(
            *[
                TourSimule(
                    appels=(
                        AppelOutil(nom="rechercher_salles", arguments={"capacite_min": index + 1}),
                    )
                )
                for index in range(6)
            ]
        )
        agent = Agent(session, principal, selecteur=selecteur, magasin=magasin)

        trace = await jouer(agent, "une salle pour 2 personnes")

        assert fin(trace)["iterations"] == 5
        assert "n'ai pas abouti" in texte(trace)


class TestEcritureEnDeuxTours:
    @pytest.fixture
    def demande(self, salle, jour_ouvre):
        fenetre = creneau(jour_ouvre, 9)
        return {
            "salle_id": str(salle.id),
            "debut": iso(fenetre.start),
            "fin": iso(fenetre.end),
            "objet": "Point d'équipe",
            "effectif": 2,
        }

    @pytest.mark.asyncio
    async def test_la_proposition_n_ecrit_rien(
        self, session, principal, selecteur, faux_modele, magasin, demande
    ):
        faux_modele.programmer(
            # « réserve cette salle » touche deux domaines : le routage
            # interroge donc le modèle, et consomme un tour.
            TourSimule(texte="reservation"),
            TourSimule(appels=(AppelOutil(nom="creer_reservation", arguments=demande),)),
        )
        agent = Agent(session, principal, selecteur=selecteur, magasin=magasin)

        trace = await jouer(agent, "réserve cette salle")

        assert "confirmation" in types(trace)
        ecrites = session.scalar(
            select(func.count()).select_from(Booking).where(Booking.title == "Point d'équipe")
        )
        assert ecrites == 0

    @pytest.mark.asyncio
    async def test_la_confirmation_execute_le_brouillon_du_serveur(
        self, session, principal, selecteur, faux_modele, magasin, demande
    ):
        faux_modele.programmer(
            # « réserve cette salle » touche deux domaines : le routage
            # interroge donc le modèle, et consomme un tour.
            TourSimule(texte="reservation"),
            TourSimule(appels=(AppelOutil(nom="creer_reservation", arguments=demande),)),
        )
        agent = Agent(session, principal, selecteur=selecteur, magasin=magasin)
        trace = await jouer(agent, "réserve cette salle")
        jeton = next(
            e.donnees["jeton"] for e in trace if e.type is TypeEvenement.CONFIRMATION
        )

        suite = [e async for e in agent.confirmer(jeton)]

        assert "carte" in [e.type.value for e in suite]
        ligne = session.scalars(
            select(Booking).where(Booking.title == "Point d'équipe")
        ).one()
        assert ligne.owner_id == principal.user.id

    @pytest.mark.asyncio
    async def test_un_jeton_ne_sert_qu_une_fois(
        self, session, principal, selecteur, faux_modele, magasin, demande
    ):
        faux_modele.programmer(
            # « réserve cette salle » touche deux domaines : le routage
            # interroge donc le modèle, et consomme un tour.
            TourSimule(texte="reservation"),
            TourSimule(appels=(AppelOutil(nom="creer_reservation", arguments=demande),)),
        )
        agent = Agent(session, principal, selecteur=selecteur, magasin=magasin)
        trace = await jouer(agent, "réserve cette salle")
        jeton = next(e.donnees["jeton"] for e in trace if e.type is TypeEvenement.CONFIRMATION)

        [e async for e in agent.confirmer(jeton)]
        rejeu = [e async for e in agent.confirmer(jeton)]

        assert rejeu[0].type is TypeEvenement.ERREUR
        assert rejeu[0].donnees["code"] == "confirmation_expiree"

    @pytest.mark.asyncio
    async def test_un_jeton_ne_vaut_rien_pour_un_autre_compte(
        self, session, principal, selecteur, faux_modele, magasin, demande, creer_compte
    ):
        """Le jeton est opaque, mais sa validité est vérifiée côté serveur."""
        faux_modele.programmer(
            # « réserve cette salle » touche deux domaines : le routage
            # interroge donc le modèle, et consomme un tour.
            TourSimule(texte="reservation"),
            TourSimule(appels=(AppelOutil(nom="creer_reservation", arguments=demande),)),
        )
        agent = Agent(session, principal, selecteur=selecteur, magasin=magasin)
        trace = await jouer(agent, "réserve cette salle")
        jeton = next(e.donnees["jeton"] for e in trace if e.type is TypeEvenement.CONFIRMATION)

        voleur = Agent(
            session,
            Principal(user=creer_compte("Voleur"), scope="user"),
            selecteur=selecteur,
            magasin=magasin,
        )
        trace_volee = [e async for e in voleur.confirmer(jeton)]

        assert trace_volee[0].type is TypeEvenement.ERREUR
        ecrites = session.scalar(
            select(func.count()).select_from(Booking).where(Booking.title == "Point d'équipe")
        )
        assert ecrites == 0

    @pytest.mark.asyncio
    async def test_un_jeton_inconnu_est_refuse(self, session, principal, selecteur, magasin):
        agent = Agent(session, principal, selecteur=selecteur, magasin=magasin)
        trace = [e async for e in agent.confirmer("jeton-invente-par-un-tiers")]
        assert trace[0].donnees["code"] == "confirmation_expiree"


class TestBascule:
    @pytest.mark.parametrize(
        "panne",
        [
            SortieInexploitable("sortie illisible"),
            DelaiDepasse("premier jeton trop lent"),
        ],
        ids=["sortie_inexploitable", "delai_depasse"],
    )
    @pytest.mark.asyncio
    async def test_une_panne_du_modele_bascule_sur_le_deterministe(
        self, session, principal, selecteur, faux_modele, magasin, intentions, panne
    ):
        faux_modele.programmer(TourSimule(erreur=panne))
        agent = Agent(session, principal, selecteur=selecteur, magasin=magasin)

        trace = await jouer(agent, "je veux annuler ma réservation")

        assert fin(trace)["repli"] is True
        assert fin(trace)["declencheur_repli"] == panne.code
        assert texte(trace)

    @pytest.mark.asyncio
    async def test_la_bascule_n_annonce_pas_deux_debuts(
        self, session, principal, selecteur, faux_modele, magasin, intentions
    ):
        """Deux ouvertures de tour afficheraient deux bulles vides à l'écran."""
        faux_modele.programmer(TourSimule(erreur=SortieInexploitable("illisible")))
        agent = Agent(session, principal, selecteur=selecteur, magasin=magasin)

        trace = await jouer(agent, "je veux annuler ma réservation")

        assert types(trace).count("debut") == 1

    @pytest.mark.asyncio
    async def test_sans_fournisseur_le_tour_part_directement_au_repli(
        self, session, principal, selecteur_muet, magasin, intentions
    ):
        agent = Agent(session, principal, selecteur=selecteur_muet, magasin=magasin)

        trace = await jouer(agent, "je veux annuler ma réservation")

        assert fin(trace)["mode"] == "repli"
        assert fin(trace)["declencheur_repli"] == "ia_indisponible"


class TestJournal:
    @pytest.mark.asyncio
    async def test_le_journal_porte_ce_qu_il_faut_au_tableau_de_bord(
        self, session, principal, selecteur, faux_modele, magasin, salle
    ):
        faux_modele.programmer(
            TourSimule(appels=(AppelOutil(nom="rechercher_salles", arguments={"capacite_min": 2}),)),
            TourSimule(texte="Voilà."),
        )
        agent = Agent(session, principal, selecteur=selecteur, magasin=magasin)

        journal = fin(await jouer(agent, "une salle pour 2 personnes"))

        assert set(journal) >= {
            "mode",
            "repli",
            "iterations",
            "outils",
            "duree_ms",
            "modele",
            "premier_jeton_ms",
            "jetons_invite",
            "jetons_reponse",
            "contexte",
            "injection_suspectee",
            "etaye",
        }

    @pytest.mark.asyncio
    async def test_le_journal_ne_contient_pas_le_message(
        self, session, principal, selecteur, faux_modele, magasin, intentions
    ):
        """Un journal d'exploitation n'a pas à porter le contenu des échanges."""
        faux_modele.programmer(TourSimule(erreur=SortieInexploitable("x")))
        agent = Agent(session, principal, selecteur=selecteur, magasin=magasin)

        journal = fin(await jouer(agent, "annuler ma réservation secrète du mardi"))

        assert "secrète" not in str(journal)

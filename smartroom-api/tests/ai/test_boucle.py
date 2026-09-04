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


class TestPromesseNonTenue:
    """« Je recherche une salle… veuillez patienter un instant », puis rien.

    Le modèle annonce l'acte au lieu de le faire, et le tour s'achève sur une
    promesse que personne ne tient — l'utilisateur attend une carte qui ne
    viendra jamais. Le prompt l'interdit déjà ; un modèle de 7 milliards de
    paramètres y retombe, surtout sur une question de suivi.
    """

    @pytest.mark.asyncio
    async def test_une_annonce_sans_acte_est_relancee_une_fois(
        self, session, principal, selecteur, faux_modele, magasin, salle
    ):
        faux_modele.programmer(
            TourSimule(texte="Je recherche une salle. Veuillez patienter un instant."),
            TourSimule(
                appels=(
                    AppelOutil(nom="rechercher_salles", arguments={"capacite_min": 2}),
                )
            ),
            TourSimule(texte="Deux salles conviennent."),
        )
        agent = Agent(session, principal, selecteur=selecteur, magasin=magasin)

        trace = await jouer(agent, "une salle pour 2 personnes")

        assert fin(trace)["outils"] == ["rechercher_salles"]
        # La promesse est déjà partie à l'écran : on ne la reprend pas, on la
        # tient. Le texte final porte donc les deux.
        assert "Deux salles conviennent." in texte(trace)
        assert fin(trace)["relances"] == 1

    @pytest.mark.asyncio
    async def test_une_reponse_franche_n_est_pas_relancee(
        self, session, principal, selecteur, faux_modele, magasin
    ):
        faux_modele.programmer(TourSimule(texte="Je ne peux pas faire cela."))
        agent = Agent(session, principal, selecteur=selecteur, magasin=magasin)

        trace = await jouer(agent, "bonjour")

        assert faux_modele.tours_consommes == 1
        assert fin(trace)["relances"] == 0

    @pytest.mark.asyncio
    async def test_la_relance_n_a_lieu_qu_une_fois(
        self, session, principal, selecteur, faux_modele, magasin
    ):
        """Un modèle qui s'entête ne doit pas boucler : deux annonces de suite
        s'arrêtent là où la première aurait dû aboutir."""
        faux_modele.programmer(
            TourSimule(texte="Je vais vérifier."),
            TourSimule(texte="Un instant."),
            TourSimule(texte="Toujours rien."),
        )
        agent = Agent(session, principal, selecteur=selecteur, magasin=magasin)

        trace = await jouer(agent, "une salle pour 2 personnes")

        assert faux_modele.tours_consommes == 2
        assert fin(trace)["relances"] == 1


class TestTourNominal:
    @pytest.mark.asyncio
    async def test_un_outil_de_lecture_puis_une_reponse(
        self, session, principal, selecteur, faux_modele, magasin, salle
    ):
        faux_modele.programmer(
            TourSimule(
                appels=(
                    AppelOutil(nom="rechercher_salles", arguments={"capacite_min": 2}),
                )
            ),
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
                    AppelOutil(
                        nom="localiser_salle", arguments={"salle_nom": salle.name}
                    ),
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
                        AppelOutil(
                            nom="rechercher_salles",
                            arguments={"capacite_min": index + 1},
                        ),
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
            TourSimule(
                appels=(AppelOutil(nom="creer_reservation", arguments=demande),)
            ),
        )
        agent = Agent(session, principal, selecteur=selecteur, magasin=magasin)

        trace = await jouer(agent, "réserve cette salle")

        assert "confirmation" in types(trace)
        ecrites = session.scalar(
            select(func.count())
            .select_from(Booking)
            .where(Booking.title == "Point d'équipe")
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
            TourSimule(
                appels=(AppelOutil(nom="creer_reservation", arguments=demande),)
            ),
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
            TourSimule(
                appels=(AppelOutil(nom="creer_reservation", arguments=demande),)
            ),
        )
        agent = Agent(session, principal, selecteur=selecteur, magasin=magasin)
        trace = await jouer(agent, "réserve cette salle")
        jeton = next(
            e.donnees["jeton"] for e in trace if e.type is TypeEvenement.CONFIRMATION
        )

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
            TourSimule(
                appels=(AppelOutil(nom="creer_reservation", arguments=demande),)
            ),
        )
        agent = Agent(session, principal, selecteur=selecteur, magasin=magasin)
        trace = await jouer(agent, "réserve cette salle")
        jeton = next(
            e.donnees["jeton"] for e in trace if e.type is TypeEvenement.CONFIRMATION
        )

        voleur = Agent(
            session,
            Principal(user=creer_compte("Voleur"), scope="user"),
            selecteur=selecteur,
            magasin=magasin,
        )
        trace_volee = [e async for e in voleur.confirmer(jeton)]

        assert trace_volee[0].type is TypeEvenement.ERREUR
        ecrites = session.scalar(
            select(func.count())
            .select_from(Booking)
            .where(Booking.title == "Point d'équipe")
        )
        assert ecrites == 0

    @pytest.mark.asyncio
    async def test_un_jeton_inconnu_est_refuse(
        self, session, principal, selecteur, magasin
    ):
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


class TestBasculeApresAffichage:
    """Ce qui est affiche reste affiche.

    Constate en ligne, quota du fournisseur epuise en cours de tour : la carte
    du plan apparaissait, puis disparaissait au profit d'une liste de salles et
    d'un « j'ai cherche une salle correspondant a votre besoin ». Deux reponses
    differentes a la meme question, la seconde effacant la premiere.

    Le repli sait repondre depuis une page blanche, pas corriger une reponse en
    cours. Mieux vaut une reponse incomplete qu'une reponse qui se dedit.
    """

    @pytest.mark.asyncio
    async def test_le_repli_ne_rejoue_pas_par_dessus_une_carte(
        self, session, principal, selecteur, faux_modele, magasin, salle, intentions
    ):
        faux_modele.programmer(
            TourSimule(
                appels=(
                    AppelOutil(nom="rechercher_salles", arguments={"capacite_min": 2}),
                )
            ),
            TourSimule(erreur=DelaiDepasse("plus de quota")),
        )
        agent = Agent(session, principal, selecteur=selecteur, magasin=magasin)

        trace = await jouer(agent, "une salle pour 2 personnes")

        assert types(trace).count("carte") == 1, (
            "la seconde carte contredirait la premiere"
        )
        assert "j'ai cherché une salle" not in texte(trace).lower()
        assert fin(trace)["repli"] is True

    @pytest.mark.asyncio
    async def test_la_page_blanche_garde_le_repli_complet(
        self, session, principal, selecteur, faux_modele, magasin, intentions
    ):
        """Contre-epreuve : rien n'etant affiche, le repli doit repondre.

        Sans elle, on supprimerait la bascule pour de bon, et une panne du
        fournisseur laisserait l'utilisateur devant une reponse vide.
        """
        faux_modele.programmer(TourSimule(erreur=DelaiDepasse("plus de quota")))
        agent = Agent(session, principal, selecteur=selecteur, magasin=magasin)

        trace = await jouer(agent, "je veux annuler ma réservation")

        assert texte(trace)
        assert fin(trace)["repli"] is True


class TestJournal:
    @pytest.mark.asyncio
    async def test_le_journal_porte_ce_qu_il_faut_au_tableau_de_bord(
        self, session, principal, selecteur, faux_modele, magasin, salle
    ):
        faux_modele.programmer(
            TourSimule(
                appels=(
                    AppelOutil(nom="rechercher_salles", arguments={"capacite_min": 2}),
                )
            ),
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

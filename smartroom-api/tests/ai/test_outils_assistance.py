"""Assistance, résolution d'entités, lecture des dates, entretien de l'index.

Ces chemins sont moins spectaculaires que la boucle, et c'est justement pour
cela qu'ils méritent des tests : ce sont eux qu'on oublie de vérifier à la
main, et ce sont eux qui décident si l'assistant sait ouvrir un ticket ou
comprendre « la salle Curie ».
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
import pytest_asyncio
from sqlalchemy import func, select

from app.ai.providers import FournisseurSimule, SelecteurModeles
from app.ai.rag import Vectoriseur, desindexer_article, indexer_article, rattraper, reindexer_tout
from app.ai.rag.indexation import etat_index
from app.ai.reglages import ReglagesIA
from app.ai.tools import ArgumentsInvalides, ToolContext, obtenir
from app.ai.tools.base import Statut
from app.ai.tools.resolution import Ambiguite, resoudre_batiment, resoudre_salle
from app.ai.tools.temps import lire_instant
from app.models import FaqFragment, Ticket

pytestmark = pytest.mark.integration


@pytest.fixture
def vectoriseur_simule() -> Vectoriseur:
    choix = SelecteurModeles(ReglagesIA())
    choix.imposer(FournisseurSimule([], dimension=768))
    return Vectoriseur(choix)


class TestLectureDesDates:
    def test_le_suffixe_z_est_accepte(self):
        assert lire_instant("2026-09-03T14:00:00Z").hour == 14

    def test_un_decalage_explicite_est_ramene_en_utc(self):
        assert lire_instant("2026-09-03T16:00:00+02:00").hour == 14

    def test_une_date_sans_fuseau_est_lue_en_utc(self):
        """Supposer le fuseau local décalerait toutes les réservations d'été."""
        assert lire_instant("2026-09-03T14:00:00").tzinfo is UTC

    def test_une_date_relative_est_refusee_et_non_devinee(self):
        """La résoudre ici reviendrait à décider à la place de l'utilisateur."""
        with pytest.raises(ValueError, match="Date illisible"):
            lire_instant("demain")


class TestResolution:
    def test_un_batiment_se_resout_par_son_code_ou_son_nom(self, session, batiment):
        assert resoudre_batiment(session, batiment.code) == batiment.id
        assert resoudre_batiment(session, batiment.name) == batiment.id

    def test_aucun_batiment_demande_rend_rien(self, session):
        assert resoudre_batiment(session, None) is None

    def test_un_batiment_inconnu_leve_avec_la_liste(self, session, batiment):
        with pytest.raises(Ambiguite) as souci:
            resoudre_batiment(session, "Tour Montparnasse")
        assert batiment.name in souci.value.message()

    def test_une_salle_se_resout_malgre_les_accents_et_la_casse(self, session, creer_salle):
        salle = creer_salle("Salle Ampère")
        assert resoudre_salle(session, nom="salle ampere").id == salle.id

    def test_un_nom_ambigu_leve_avec_les_candidates(self, session, creer_salle):
        creer_salle("Salle Curie")
        creer_salle("Salle Cauchy")
        with pytest.raises(Ambiguite) as souci:
            resoudre_salle(session, nom="Salle")
        assert "Curie" in souci.value.message()

    def test_un_mot_distinctif_suffit(self, session, creer_salle):
        """« la salle Curie » et « Curie » doivent aboutir au même endroit."""
        salle = creer_salle("Salle Curie")
        assert resoudre_salle(session, nom="la salle Curie").id == salle.id

    def test_une_salle_inexistante_leve_sans_candidat(self, session):
        with pytest.raises(Ambiguite) as souci:
            resoudre_salle(session, nom="Salle Inexistante")
        assert souci.value.candidats == ()


class TestAssistance:
    @pytest.mark.asyncio
    async def test_ouvrir_un_ticket_demande_confirmation(self, session, contexte):
        resultat = await obtenir("creer_ticket").execute(
            {
                "sujet": "Vidéoprojecteur en panne",
                "categorie": "materiel",
                "message": "L'appareil ne s'allume plus depuis ce matin.",
            },
            contexte,
        )

        assert resultat.statut is Statut.CONFIRMATION
        assert session.scalar(select(func.count()).select_from(Ticket)) == 0

    @pytest.mark.asyncio
    async def test_le_ticket_confirme_est_cree_pour_le_demandeur(self, session, principal):
        proposition = await obtenir("creer_ticket").execute(
            {
                "sujet": "Vidéoprojecteur en panne",
                "categorie": "materiel",
                "message": "L'appareil ne s'allume plus depuis ce matin.",
            },
            ToolContext(session=session, principal=principal),
        )
        execution = await obtenir("creer_ticket").execute(
            proposition.brouillon.model_dump(mode="json"),
            ToolContext(session=session, principal=principal, confirmed=True),
        )

        assert execution.statut is Statut.OK
        ticket = session.scalars(select(Ticket)).one()
        assert ticket.requester_id == principal.user.id

    @pytest.mark.asyncio
    async def test_une_categorie_inventee_est_refusee(self, contexte):
        with pytest.raises(ArgumentsInvalides):
            await obtenir("creer_ticket").execute(
                {"sujet": "Souci", "categorie": "cosmique", "message": "Description du souci."},
                contexte,
            )

    @pytest.mark.asyncio
    async def test_le_transfert_humain_n_exige_pas_de_confirmation(self, session, contexte):
        """Demander « confirmez-vous vouloir un humain ? » à qui vient de le
        demander serait une friction absurde."""
        resultat = await obtenir("transferer_humain").execute(
            {"resume": "L'utilisateur ne trouve pas son code et s'impatiente."}, contexte
        )

        assert resultat.statut is Statut.OK
        assert session.scalar(select(func.count()).select_from(Ticket)) == 1

    @pytest.mark.asyncio
    async def test_la_recherche_documentaire_cite_ses_sources(
        self, session, contexte, creer_article, vectoriseur_simule
    ):
        article = creer_article(
            titre="Annuler une réservation",
            corps="Vous pouvez annuler jusqu'à une heure avant le début du créneau.",
        )
        await indexer_article(session, article, vectoriseur=vectoriseur_simule)
        session.flush()

        resultat = await obtenir("rechercher_faq").execute(
            {"question": "annuler une reservation"}, contexte
        )

        assert resultat.statut is Statut.OK
        assert article.title in resultat.sources

    @pytest.mark.asyncio
    async def test_sans_article_l_outil_propose_le_ticket(self, contexte):
        resultat = await obtenir("rechercher_faq").execute(
            {"question": "hydraulique portuaire"}, contexte
        )

        assert resultat.statut is Statut.VIDE
        assert "ticket" in resultat.message


class TestModificationEtAnnulation:
    @pytest_asyncio.fixture
    async def reservation(self, session, principal, salle, jour_ouvre):
        from tests.services.conftest import creneau

        from app.services import booking_service

        ligne, _ = booking_service.create_booking(
            session,
            room_id=salle.id,
            owner_id=principal.user.id,
            slot=creneau(jour_ouvre, 9),
            title="À modifier",
            attendees=2,
        )
        session.flush()
        return ligne

    @pytest.mark.asyncio
    async def test_modifier_sans_rien_changer_est_refuse(self, contexte, reservation):
        with pytest.raises(ArgumentsInvalides):
            await obtenir("modifier_reservation").execute(
                {"reservation_id": str(reservation.id)}, contexte
            )

    @pytest.mark.asyncio
    async def test_un_creneau_partiel_est_refuse(self, contexte, reservation):
        """`debut` et `fin` se donnent ensemble : la moitié d'un créneau ne dit
        rien."""
        with pytest.raises(ArgumentsInvalides):
            await obtenir("modifier_reservation").execute(
                {"reservation_id": str(reservation.id), "debut": "2026-09-03T14:00:00Z"},
                contexte,
            )

    @pytest.mark.asyncio
    async def test_la_modification_confirmee_est_appliquee(
        self, session, principal, reservation
    ):
        proposition = await obtenir("modifier_reservation").execute(
            {"reservation_id": str(reservation.id), "objet": "Titre corrigé"},
            ToolContext(session=session, principal=principal),
        )
        await obtenir("modifier_reservation").execute(
            proposition.brouillon.model_dump(mode="json"),
            ToolContext(session=session, principal=principal, confirmed=True),
        )

        session.refresh(reservation)
        assert reservation.title == "Titre corrigé"

    @pytest.mark.asyncio
    async def test_l_annulation_confirmee_conserve_le_motif(
        self, session, principal, reservation
    ):
        proposition = await obtenir("annuler_reservation").execute(
            {"reservation_id": str(reservation.id), "motif": "Réunion reportée"},
            ToolContext(session=session, principal=principal),
        )
        await obtenir("annuler_reservation").execute(
            proposition.brouillon.model_dump(mode="json"),
            ToolContext(session=session, principal=principal, confirmed=True),
        )

        session.refresh(reservation)
        assert reservation.cancel_reason == "Réunion reportée"

    @pytest.mark.asyncio
    async def test_un_motif_trop_court_est_refuse(self, contexte, reservation):
        with pytest.raises(ArgumentsInvalides):
            await obtenir("annuler_reservation").execute(
                {"reservation_id": str(reservation.id), "motif": "x"}, contexte
            )

    @pytest.mark.asyncio
    async def test_lister_distingue_les_etats(self, contexte, reservation):
        a_venir = await obtenir("lister_mes_reservations").execute({"etat": "a_venir"}, contexte)
        annulees = await obtenir("lister_mes_reservations").execute({"etat": "annulees"}, contexte)

        assert a_venir.statut is Statut.OK
        assert annulees.statut is Statut.VIDE


class TestEntretienDeLIndex:
    @pytest.mark.asyncio
    async def test_desindexer_retire_les_fragments(
        self, session, creer_article, vectoriseur_simule
    ):
        article = creer_article(titre="Éphémère", corps="Un contenu appelé à disparaître.")
        await indexer_article(session, article, vectoriseur=vectoriseur_simule)

        await desindexer_article(session, article.id)
        session.flush()

        assert session.scalar(
            select(func.count()).select_from(FaqFragment).where(
                FaqFragment.article_id == article.id
            )
        ) == 0

    @pytest.mark.asyncio
    async def test_le_rattrapage_vectorise_ce_qui_attendait(
        self, session, creer_article, vectoriseur_simule
    ):
        """Un article publié pendant une absence du modèle ne doit pas rester
        définitivement invisible à la recherche sémantique."""
        sourd = Vectoriseur(SelecteurModeles(ReglagesIA(forcer_repli=True)))
        article = creer_article(titre="Écrit sans modèle", corps="Le contenu attend son vecteur.")
        await indexer_article(session, article, vectoriseur=sourd)
        session.flush()

        rapport = await rattraper(session, vectoriseur=vectoriseur_simule)
        session.flush()

        assert rapport.fragments_vectorises >= 1
        etat = etat_index(session)
        assert etat["vectorises"] == etat["fragments"]

    @pytest.mark.asyncio
    async def test_le_rattrapage_sans_modele_ne_fait_rien(self, session):
        sourd = Vectoriseur(SelecteurModeles(ReglagesIA(forcer_repli=True)))
        rapport = await rattraper(session, vectoriseur=sourd)
        assert rapport.sans_vecteurs is True

    @pytest.mark.asyncio
    async def test_reindexer_tout_parcourt_le_corpus(
        self, session, creer_article, vectoriseur_simule
    ):
        creer_article(titre="Premier", corps="Un premier contenu de test suffisamment long.")
        creer_article(titre="Second", corps="Un second contenu de test suffisamment long.")
        session.flush()

        rapport = await reindexer_tout(session, vectoriseur=vectoriseur_simule)

        assert rapport.articles >= 2
        assert rapport.fragments_vectorises >= 2

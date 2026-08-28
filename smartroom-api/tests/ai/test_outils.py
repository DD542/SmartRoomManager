"""Les treize outils, éprouvés sans modèle.

Un outil est une façade : ce qu'il faut vérifier, c'est qu'il refuse ce qui
doit l'être — arguments malformés, ressource d'autrui, écriture sans
confirmation — et qu'il transmet fidèlement ce que le service lui rend. La
qualité des réponses du modèle, elle, n'est pas de son ressort.

Les tests de cloisonnement portent sur la seule garantie qui compte : un
utilisateur ne peut atteindre les données d'un autre, quoi qu'il demande.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.ai.tools import ArgumentsInvalides, ToolContext, obtenir, verifier_coherence
from app.ai.tools.base import Statut
from app.api.deps import Principal
from app.db.enums import BookingStatus
from app.services import booking_service
from tests.services.conftest import creneau

pytestmark = pytest.mark.integration


def iso(moment: datetime) -> str:
    return moment.astimezone(UTC).isoformat().replace("+00:00", "Z")


class TestCatalogue:
    def test_le_catalogue_ne_porte_aucune_anomalie(self):
        assert verifier_coherence() == []

    def test_aucun_schema_n_expose_l_identite(self):
        """La garantie structurelle du cloisonnement.

        Si un schéma exposait `user_id`, une sortie de modèle pourrait désigner
        un tiers, et toutes les vérifications d'exécution reposeraient sur la
        bonne foi du modèle.
        """
        from app.ai.tools import OUTILS

        interdits = {"user_id", "utilisateur_id", "owner_id", "email", "proprietaire"}
        for outil in OUTILS:
            champs = set(outil.SCHEMA["parameters"].get("properties", {}))
            assert not (champs & interdits), outil.nom

    def test_les_ecritures_sont_exactement_celles_attendues(self):
        from app.ai.tools import ecritures

        assert ecritures() == {
            "creer_reservation",
            "modifier_reservation",
            "annuler_reservation",
            "creer_ticket",
        }


class TestValidation:
    @pytest.mark.asyncio
    async def test_un_identifiant_malforme_est_refuse_avant_le_service(self, contexte):
        with pytest.raises(ArgumentsInvalides) as souci:
            await obtenir("consulter_disponibilite").execute(
                {"salle_id": "pas-un-uuid", "debut": iso(datetime.now(UTC)),
                 "fin": iso(datetime.now(UTC) + timedelta(hours=1))},
                contexte,
            )
        assert "salle_id" in souci.value.texte_pour_modele()

    @pytest.mark.asyncio
    async def test_un_creneau_inverse_est_refuse(self, contexte, salle):
        debut = datetime.now(UTC) + timedelta(days=1)
        with pytest.raises(ArgumentsInvalides):
            await obtenir("consulter_disponibilite").execute(
                {"salle_id": str(salle.id), "debut": iso(debut),
                 "fin": iso(debut - timedelta(hours=1))},
                contexte,
            )

    @pytest.mark.asyncio
    async def test_un_champ_inconnu_est_refuse(self, contexte):
        """`extra="forbid"` : un argument inventé ne passe pas en silence."""
        with pytest.raises(ArgumentsInvalides):
            await obtenir("rechercher_salles").execute(
                {"capacite_min": 4, "salle_secrete": True}, contexte
            )

    @pytest.mark.asyncio
    async def test_le_message_de_refus_guide_la_reprise(self, contexte):
        with pytest.raises(ArgumentsInvalides) as souci:
            await obtenir("annuler_reservation").execute({"motif": "x"}, contexte)

        message = souci.value.texte_pour_modele()
        assert "reservation_id" in message
        assert "N'inventez aucune valeur" in message


class TestLecture:
    @pytest.mark.asyncio
    async def test_rechercher_salles_rend_le_parc(self, contexte, salle):
        resultat = await obtenir("rechercher_salles").execute({"capacite_min": 1}, contexte)
        assert resultat.statut is Statut.OK
        assert resultat.carte.value == "salles"

    @pytest.mark.asyncio
    async def test_un_batiment_inconnu_rend_la_liste_plutot_qu_une_erreur(self, contexte, salle):
        resultat = await obtenir("rechercher_salles").execute(
            {"batiment": "Tour Montparnasse"}, contexte
        )
        assert resultat.statut is Statut.VIDE
        assert "correspond" in resultat.message

    @pytest.mark.asyncio
    async def test_localiser_par_nom(self, contexte, salle):
        resultat = await obtenir("localiser_salle").execute({"salle_nom": salle.name}, contexte)
        assert resultat.statut is Statut.OK
        assert resultat.data["salle"]["nom"] == salle.name

    @pytest.mark.asyncio
    async def test_localiser_exige_un_nom_ou_un_identifiant(self, contexte):
        with pytest.raises(ArgumentsInvalides):
            await obtenir("localiser_salle").execute({}, contexte)

    @pytest.mark.asyncio
    async def test_consulter_regles_rend_les_valeurs_de_la_base(self, contexte, salle):
        resultat = await obtenir("consulter_regles").execute(
            {"salle_id": str(salle.id)}, contexte
        )
        assert resultat.statut is Statut.OK
        assert resultat.data["regles"]["duree_min_minutes"] > 0


class TestCloisonnement:
    """Un utilisateur ne peut atteindre les données d'un autre. Jamais."""

    @pytest.fixture
    def reservation_d_autrui(self, session, salle, creer_compte, jour_ouvre):
        autre = creer_compte("Autre")
        reservation, _ = booking_service.create_booking(
            session,
            room_id=salle.id,
            owner_id=autre.id,
            slot=creneau(jour_ouvre, 10),
            title="Réunion d'un tiers",
            attendees=2,
        )
        session.flush()
        return reservation

    @pytest.mark.asyncio
    async def test_lister_ne_rend_que_les_siennes(self, contexte, reservation_d_autrui):
        resultat = await obtenir("lister_mes_reservations").execute({"etat": "toutes"}, contexte)
        rendus = [item["reservation_id"] for item in (resultat.data or {}).get("reservations", [])]
        assert str(reservation_d_autrui.id) not in rendus

    @pytest.mark.asyncio
    async def test_annuler_la_reservation_d_un_tiers_est_introuvable(
        self, contexte, reservation_d_autrui
    ):
        """« Introuvable » et non « interdit » : le second confirmerait qu'elle existe."""
        resultat = await obtenir("annuler_reservation").execute(
            {"reservation_id": str(reservation_d_autrui.id), "motif": "tentative"}, contexte
        )
        assert resultat.statut is Statut.VIDE
        assert "introuvable" in resultat.message.lower()

    @pytest.mark.asyncio
    async def test_le_code_d_acces_d_un_tiers_est_introuvable(
        self, contexte, reservation_d_autrui
    ):
        resultat = await obtenir("obtenir_code_acces").execute(
            {"reservation_id": str(reservation_d_autrui.id)}, contexte
        )
        assert resultat.statut is Statut.VIDE

    @pytest.mark.asyncio
    async def test_modifier_la_reservation_d_un_tiers_est_introuvable(
        self, contexte, reservation_d_autrui
    ):
        resultat = await obtenir("modifier_reservation").execute(
            {"reservation_id": str(reservation_d_autrui.id), "objet": "détourné"}, contexte
        )
        assert resultat.statut is Statut.VIDE


class TestEcritures:
    @pytest.mark.asyncio
    async def test_creer_ne_touche_a_rien_sans_confirmation(
        self, session, contexte, salle, jour_ouvre
    ):
        fenetre = creneau(jour_ouvre, 9)
        resultat = await obtenir("creer_reservation").execute(
            {
                "salle_id": str(salle.id),
                "debut": iso(fenetre.start),
                "fin": iso(fenetre.end),
                "objet": "Essai sans confirmation",
            },
            contexte,
        )

        assert resultat.statut is Statut.CONFIRMATION
        assert resultat.brouillon is not None
        from sqlalchemy import func, select

        from app.models import Booking

        ecrites = session.scalar(
            select(func.count()).select_from(Booking).where(Booking.title == "Essai sans confirmation")
        )
        assert ecrites == 0

    @pytest.mark.asyncio
    async def test_le_brouillon_confirme_ecrit_pour_le_demandeur(
        self, session, principal, salle, jour_ouvre
    ):
        fenetre = creneau(jour_ouvre, 11)
        proposition = await obtenir("creer_reservation").execute(
            {
                "salle_id": str(salle.id),
                "debut": iso(fenetre.start),
                "fin": iso(fenetre.end),
                "objet": "Essai confirmé",
            },
            ToolContext(session=session, principal=principal),
        )

        execution = await obtenir("creer_reservation").execute(
            proposition.brouillon.model_dump(mode="json"),
            ToolContext(session=session, principal=principal, confirmed=True),
        )

        assert execution.statut is Statut.OK
        from app.models import Booking

        ligne = session.get(Booking, uuid.UUID(execution.data["reservation_id"]))
        assert ligne.owner_id == principal.user.id
        assert ligne.status is not BookingStatus.ANNULEE

    @pytest.mark.asyncio
    async def test_une_regle_metier_refuse_avant_la_confirmation(
        self, contexte, salle, jour_ouvre
    ):
        """Faire valider une réservation que les règles refuseront serait une
        question posée pour rien."""
        fenetre = creneau(jour_ouvre, 9)
        resultat = await obtenir("creer_reservation").execute(
            {
                "salle_id": str(salle.id),
                "debut": iso(fenetre.start),
                "fin": iso(fenetre.end),
                "effectif": salle.capacity + 50,
            },
            contexte,
        )
        assert resultat.statut is Statut.REFUS

    @pytest.mark.asyncio
    async def test_creer_accepte_un_nom_de_salle(
        self, contexte, salle, jour_ouvre
    ):
        """Le modèle ne porte pas les UUID de tête : le nom doit suffire."""
        fenetre = creneau(jour_ouvre, 14)
        resultat = await obtenir("creer_reservation").execute(
            {"salle_nom": salle.name, "debut": iso(fenetre.start), "fin": iso(fenetre.end)},
            contexte,
        )
        assert resultat.statut is Statut.CONFIRMATION


class TestCodeAcces:
    @pytest.mark.asyncio
    async def test_le_code_complet_n_est_jamais_relu(
        self, session, principal, creer_salle, jour_ouvre
    ):
        """La base ne garde qu'une empreinte : l'outil rend l'indice, et le dit."""
        # `badge_required` n'est pas un paramètre de la fabrique : il se pose
        # après coup, comme le ferait l'administration sur une salle existante.
        salle = creer_salle("Salle à badge")
        salle.badge_required = True
        session.flush()
        fenetre = creneau(jour_ouvre, 15)
        reservation, code = booking_service.create_booking(
            session,
            room_id=salle.id,
            owner_id=principal.user.id,
            slot=fenetre,
            title="Avec badge",
            attendees=1,
        )
        session.flush()
        assert code is not None

        resultat = await obtenir("obtenir_code_acces").execute(
            {"reservation_id": str(reservation.id)}, ToolContext(session=session, principal=principal)
        )

        assert resultat.data["code_complet_recuperable"] is False
        assert resultat.data["indice"] != code.clear
        assert code.clear not in str(resultat.data)

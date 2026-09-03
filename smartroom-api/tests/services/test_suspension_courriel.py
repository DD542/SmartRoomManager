"""Une suspension de compte doit se dire à la personne concernée.

Le motif était déjà exigé par le service — `set_status` refuse une chaîne vide
— et déjà journalisé dans l'audit. Il manquait au seul endroit où il sert
vraiment : chez l'utilisateur. Celui-ci découvrait la suspension en tentant de
réserver, sans savoir pourquoi ni à qui s'adresser.

Le gabarit `compte_suspendu` vient de la migration `0012`, et le schéma de test
est monté par `alembic upgrade head` : aucune fixture n'a donc à le créer. Ce
test le vérifie au passage, car un gabarit absent ne lève rien — `notify`
journalise et rend `None`, l'action ayant eu lieu.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.api.deps import USERS_MANAGE
from app.db.enums import UserStatus
from app.models import EmailTemplate, Notification, User
from app.services import mail_service
from tests.services.conftest import accorder, connecter

pytestmark = pytest.mark.integration

MOTIF = "Trois absences non signalées en deux semaines."


@pytest.fixture(autouse=True)
def expedies(monkeypatch) -> list[mail_service.Message]:
    """Le carnet de ce qui est parti.

    La file est un état de processus : elle est vidée aux deux bouts pour que
    deux tests ne se la passent pas.
    """
    mail_service.flush()
    partis: list[mail_service.Message] = []

    async def _noter(message: mail_service.Message) -> None:
        partis.append(message)

    monkeypatch.setattr(mail_service, "send", _noter)
    yield partis
    mail_service.flush()


def courriels(expedies: list[mail_service.Message]) -> list[mail_service.Message]:
    """Les courriels partis, plus ceux encore en file.

    Un appel HTTP expédie ; le COMMIT appartient alors à la route.
    """
    return [*expedies, *mail_service.pending()]


@pytest.fixture
def gestionnaire(client, session, administrateur) -> dict[str, str]:
    accorder(session, administrateur, USERS_MANAGE)
    return connecter(client, administrateur.user.email, admin=True)


def suspendre(client, entetes, compte: User, motif: str = MOTIF):
    return client.patch(
        f"/api/v1/admin/users/{compte.id}/status",
        headers=entetes,
        json={"status": "suspendu", "reason": motif},
    )


class TestGabarit:
    def test_le_gabarit_est_pose_par_la_migration(self, session):
        """Sans lui, la fonctionnalité ne ferait rien — et sans rien dire."""
        gabarit = session.scalars(
            select(EmailTemplate).where(EmailTemplate.code == "compte_suspendu")
        ).one()

        assert gabarit.is_enabled
        assert "{{motif}}" in gabarit.body


class TestSuspension:
    def test_la_suspension_prepare_un_courriel_au_compte(
        self, client, session, compte, gestionnaire, expedies
    ):
        reponse = suspendre(client, gestionnaire, compte)
        assert reponse.status_code == 200, reponse.text

        [message] = courriels(expedies)
        assert message.to == compte.email

    def test_le_courriel_porte_le_motif(
        self, client, session, compte, gestionnaire, expedies
    ):
        """C'est la raison d'être du message.

        Un « votre compte est suspendu » sans motif ne fait que déplacer la
        question vers le support.
        """
        suspendre(client, gestionnaire, compte)

        [message] = courriels(expedies)
        assert MOTIF in message.body

    def test_la_notification_applicative_porte_le_motif_aussi(
        self, client, session, compte, gestionnaire
    ):
        """Le compte suspendu ne peut plus se connecter : le courriel est sa
        seule voie. La notification reste pour le jour de la réactivation."""
        suspendre(client, gestionnaire, compte)

        notification = session.scalars(
            select(Notification).where(
                Notification.user_id == compte.id,
                Notification.template_code == "compte_suspendu",
            )
        ).one()

        assert MOTIF in notification.body

    def test_un_motif_vide_est_refuse_et_ne_fait_rien_partir(
        self, client, session, compte, gestionnaire, expedies
    ):
        """Le refus précède l'envoi : pas de courriel sans motif."""
        reponse = suspendre(client, gestionnaire, compte, motif="   ")

        assert reponse.status_code == 422
        assert courriels(expedies) == []
        assert session.get(User, compte.id).status is UserStatus.ACTIF

    def test_le_courriel_part_avec_la_reponse_et_non_plus_tard(
        self, client, session, compte, gestionnaire, expedies
    ):
        """La file d'envoi est un état du processus : rien ne la vide seul.

        Chaque route qui notifie doit programmer `mail_service.expedier` en
        tâche de fond après sa réponse. Celle-ci ne le faisait pas : le message
        restait en file et n'était expédié qu'au passage suivant de
        l'ordonnanceur — jusqu'à cinq minutes plus tard, et jamais du tout si
        l'ordonnanceur était arrêté. Un administrateur qui vérifiait aussitôt
        ne voyait rien arriver.

        L'assertion porte donc sur ce qui est **parti**, et sur une file vide.
        La regarder au travers de `pending()` laissait passer le défaut.
        """
        suspendre(client, gestionnaire, compte)

        assert mail_service.pending() == []
        assert len(expedies) == 1

    def test_deux_suspensions_de_suite_n_envoient_qu_un_message(
        self, client, session, compte, gestionnaire, expedies
    ):
        """Réappliquer un statut déjà porté n'apprend rien à personne.

        Un courriel de trop est un courriel de moins qu'on lit.
        """
        suspendre(client, gestionnaire, compte)
        expedies.clear()
        mail_service.flush()

        suspendre(client, gestionnaire, compte, motif="Toujours suspendu.")

        assert courriels(expedies) == []


MOTIF_LEVEE = "Situation régularisée, justificatif reçu."


def reactiver(client, entetes, compte: User, motif: str = MOTIF_LEVEE):
    return client.patch(
        f"/api/v1/admin/users/{compte.id}/status",
        headers=entetes,
        json={"status": "actif", "reason": motif},
    )


class TestReactivation:
    """La levée d'une suspension se dit aussi.

    Sans message, la personne continue de se croire bloquée jusqu'à ce qu'elle
    retente une réservation — si elle retente.
    """

    def test_le_gabarit_est_pose_par_la_migration(self, session):
        gabarit = session.scalars(
            select(EmailTemplate).where(EmailTemplate.code == "compte_reactive")
        ).one()

        assert gabarit.is_enabled
        assert "{{motif}}" in gabarit.body

    def test_la_reactivation_previent_le_compte_avec_son_motif(
        self, client, session, compte, gestionnaire, expedies
    ):
        suspendre(client, gestionnaire, compte)
        expedies.clear()
        mail_service.flush()

        reponse = reactiver(client, gestionnaire, compte)
        assert reponse.status_code == 200, reponse.text

        [message] = courriels(expedies)
        assert message.to == compte.email
        assert "réactivé" in message.subject
        assert MOTIF_LEVEE in message.body

    def test_le_message_de_reactivation_n_est_pas_celui_de_suspension(
        self, client, session, compte, gestionnaire, expedies
    ):
        """Poster l'annonce d'une suspension au moment de sa levée dirait
        exactement le contraire de ce qui vient de se produire."""
        suspendre(client, gestionnaire, compte)
        expedies.clear()
        mail_service.flush()

        reactiver(client, gestionnaire, compte)

        [message] = courriels(expedies)
        assert "suspendu" not in message.subject.lower()

    def test_reactiver_un_compte_deja_actif_n_envoie_rien(
        self, client, session, compte, gestionnaire, expedies
    ):
        """Le compte est actif à la création : rien n'a change."""
        assert session.get(User, compte.id).status is UserStatus.ACTIF

        reponse = reactiver(client, gestionnaire, compte)

        assert reponse.status_code == 200, reponse.text
        assert courriels(expedies) == []

"""L'onglet « Aide » du fil de notifications était vide par construction.

Sa catégorie se déduit, côté front, du `ticket_id` porté par la notification.
`notify()` accepte ce paramètre depuis l'origine — mais aucun appelant ne le
passait : les trois seuls étaient les réservations, les comptes et
l'ordonnanceur. Le support ne notifiait rien, et l'onglet ne pouvait donc
jamais afficher quoi que ce soit.

Pour l'utilisateur : il ouvrait une demande, le support répondait, et rien ne
le lui disait. Il fallait rouvrir la demande au hasard pour le découvrir.

Deux moments notifient, et deux seulement : la réponse du support, parce
qu'elle appelle une lecture, et la résolution, parce qu'elle clôt l'attente.
Les notes internes et la création de la demande, non.

Les gabarits viennent de la migration `0014` ; le schéma de test est monté par
`alembic upgrade head`, aucune fixture n'a donc à les créer. Ce fichier le
vérifie au passage : `notify` ignore en silence un code absent, et la
fonctionnalité n'aurait rien fait sans lever la moindre erreur.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.db.enums import TicketStatus
from app.models import EmailTemplate, Notification, Ticket
from app.services import support_service

pytestmark = pytest.mark.integration


@pytest.fixture
def demande(session, compte) -> Ticket:
    return support_service.create_ticket(
        session,
        requester_id=compte.id,
        subject="Badge refusé à l'entrée",
        category="acces",
        body="Mon badge ne déverrouille plus la porte du laboratoire.",
    )


def notifications_aide(session, ticket: Ticket) -> list[Notification]:
    """Celles que l'onglet « Aide » retiendrait : rattachées à un ticket."""
    return list(
        session.scalars(select(Notification).where(Notification.ticket_id == ticket.id))
    )


class TestGabarits:
    def test_les_gabarits_sont_poses_par_la_migration(self, session):
        codes = set(
            session.scalars(
                select(EmailTemplate.code).where(
                    EmailTemplate.code.in_(["ticket_reponse", "ticket_resolu"])
                )
            )
        )
        assert codes == {"ticket_reponse", "ticket_resolu"}

    def test_le_gabarit_de_reponse_porte_le_lien_et_la_reference(self, session):
        gabarit = session.scalars(
            select(EmailTemplate).where(EmailTemplate.code == "ticket_reponse")
        ).one()

        assert gabarit.is_enabled
        assert "{{reference}}" in gabarit.subject
        # Sans le lien, le lecteur doit retrouver sa demande dans une liste.
        assert "{{lien}}" in gabarit.body


class TestReponseDuSupport:
    def test_une_reponse_remplit_l_onglet_aide(self, session, compte, demande):
        """Sans le correctif, aucune notification ne porte de `ticket_id`."""
        assert notifications_aide(session, demande) == []

        support_service.add_message(
            session,
            demande.id,
            body="Votre badge a été réactivé, retentez et dites-nous.",
            author_user_id=None,
            from_support=True,
        )

        [notification] = notifications_aide(session, demande)
        assert notification.user_id == compte.id
        assert notification.template_code == "ticket_reponse"
        assert demande.reference in notification.title

    def test_le_corps_porte_un_extrait_et_le_lien(self, session, demande):
        support_service.add_message(
            session,
            demande.id,
            body="Votre badge a été réactivé.",
            author_user_id=None,
            from_support=True,
        )

        [notification] = notifications_aide(session, demande)
        assert "badge a été réactivé" in notification.body
        assert f"ticket={demande.id}" in notification.body

    def test_une_note_interne_ne_notifie_pas(self, session, demande):
        """Elle n'est pas destinée au demandeur : l'avertir trahirait son objet."""
        support_service.add_message(
            session,
            demande.id,
            body="Vérifier auprès de la loge avant de répondre.",
            author_user_id=None,
            from_support=True,
            internal=True,
        )

        assert notifications_aide(session, demande) == []

    def test_un_message_du_demandeur_ne_le_notifie_pas(self, session, compte, demande):
        """On ne prévient pas quelqu'un de ce qu'il vient d'écrire."""
        support_service.add_message(
            session,
            demande.id,
            body="Toujours rien de mon côté.",
            author_user_id=compte.id,
            from_support=False,
        )

        assert notifications_aide(session, demande) == []


class TestResolution:
    def test_le_passage_a_resolu_notifie(self, session, demande):
        support_service.set_ticket_status(
            session, demande.id, status=TicketStatus.RESOLU
        )

        [notification] = notifications_aide(session, demande)
        assert notification.template_code == "ticket_resolu"
        assert demande.reference in notification.title

    def test_resolu_deux_fois_ne_notifie_qu_une_fois(self, session, demande):
        """Réappliquer un statut déjà porté n'apprend rien au demandeur."""
        support_service.set_ticket_status(
            session, demande.id, status=TicketStatus.RESOLU
        )
        support_service.set_ticket_status(
            session, demande.id, status=TicketStatus.RESOLU
        )

        assert len(notifications_aide(session, demande)) == 1

    def test_les_autres_statuts_ne_notifient_pas(self, session, demande):
        support_service.set_ticket_status(
            session, demande.id, status=TicketStatus.EN_COURS
        )

        assert notifications_aide(session, demande) == []

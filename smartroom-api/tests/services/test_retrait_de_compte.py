"""Retirer un compte, sans effacer l'histoire du parc.

Effacer la ligne casserait le journal d'audit, les frises de réservation et les
agrégats d'occupation, qui référencent tous ce compte. Ce que le règlement
demande n'est pas la disparition de l'historique : c'est celle de l'identité.
On efface donc ce qui désigne la personne, et on laisse ce qui décrit l'usage
des salles.

Trois refus précèdent toute écriture, et chacun a son test : un motif vide, un
compte porteur de droits d'administration, et le compte de l'auteur de la
demande.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.api.deps import USERS_MANAGE
from app.db.enums import BookingStatus, UserStatus
from app.models import AuditLog, Booking, User
from app.services import users_service
from tests.services.conftest import accorder, connecter, creneau

pytestmark = pytest.mark.integration

MOTIF = "Départ de l'établissement, demande du service scolarité."


@pytest.fixture
def gestionnaire(client, session, administrateur) -> dict[str, str]:
    accorder(session, administrateur, USERS_MANAGE)
    return connecter(client, administrateur.user.email, admin=True)


def retirer(client, entetes, compte: User, motif: str = MOTIF):
    return client.request(
        "DELETE",
        f"/api/v1/admin/users/{compte.id}",
        headers=entetes,
        json={"reason": motif},
    )


class TestIdentiteEffacee:
    def test_le_compte_ne_designe_plus_personne(
        self, client, session, compte, gestionnaire
    ):
        avant = compte.email

        assert retirer(client, gestionnaire, compte).status_code == 204

        session.expire_all()
        retire = session.get(User, compte.id)
        assert retire.email != avant
        assert retire.email.endswith("@anonyme.invalid")
        assert retire.first_name == "Compte"
        assert retire.deleted_at is not None
        assert retire.status is UserStatus.SUSPENDU

    def test_l_adresse_ne_peut_atteindre_personne(
        self, client, session, compte, gestionnaire
    ):
        """`.invalid` est réservé par la RFC 2606.

        Aucune remise n'est possible : un envoi accidentel vers un compte
        retiré ne touchera jamais une boîte réelle.
        """
        retirer(client, gestionnaire, compte)

        session.expire_all()
        assert session.get(User, compte.id).email.endswith(".invalid")

    def test_le_mot_de_passe_ne_rouvre_plus_rien(
        self, client, session, compte, gestionnaire
    ):
        """Le laisser en place permettrait de reprendre la session d'un compte
        retiré, son adresse d'origine étant connue de qui l'a côtoyé."""
        empreinte = compte.password_hash

        retirer(client, gestionnaire, compte)

        session.expire_all()
        assert session.get(User, compte.id).password_hash != empreinte


class TestHistoireConservee:
    def test_les_reservations_a_venir_liberent_leur_creneau(
        self, client, session, compte, salle, jour_ouvre, gestionnaire
    ):
        """Les laisser occuperait des salles au nom de quelqu'un qui n'existe
        plus."""
        from app.services import booking_service

        reservation, _ = booking_service.create_booking(
            session,
            room_id=salle.id,
            owner_id=compte.id,
            slot=creneau(jour_ouvre, 10),
            attendees=2,
        )
        session.flush()

        retirer(client, gestionnaire, compte)

        session.expire_all()
        assert session.get(Booking, reservation.id).status is BookingStatus.ANNULEE

    def test_l_audit_garde_l_adresse_d_origine(
        self, client, session, compte, gestionnaire
    ):
        """Sans elle, la trace ne dit plus de quel compte il s'agissait — et
        une décision sans sujet ne se relit pas."""
        avant = compte.email

        retirer(client, gestionnaire, compte)

        entree = session.scalars(
            select(AuditLog)
            .where(AuditLog.target_type == "user", AuditLog.target_id == compte.id)
            .order_by(AuditLog.created_at.desc())
        ).first()
        assert entree.target_label == avant
        assert entree.diff_after["reason"] == MOTIF


class TestRefus:
    def test_un_motif_vide_est_refuse(self, client, session, compte, gestionnaire):
        reponse = retirer(client, gestionnaire, compte, motif="  ")

        assert reponse.status_code == 422
        session.expire_all()
        assert session.get(User, compte.id).deleted_at is None

    def test_un_administrateur_n_est_pas_retire_par_cette_route(
        self, client, session, administrateur, gestionnaire
    ):
        """Retirer ses droits est une décision distincte, avec son écran et sa
        trace. Les confondre ferait disparaître un administrateur par un geste
        prévu pour un compte ordinaire."""
        autre = administrateur.user

        reponse = retirer(client, gestionnaire, autre)

        # 422 comme le motif vide : `RuleViolationError` decrit une regle
        # enfreinte, et le projet lui reserve ce code partout ailleurs.
        assert reponse.status_code == 422
        session.expire_all()
        assert session.get(User, autre.id).deleted_at is None

    def test_on_ne_se_retire_pas_soi_meme(self, session, administrateur):
        """Contrôlé au service : l'écran ne propose pas le geste, mais la route
        ne peut pas s'en remettre à l'écran."""
        from app.core.errors import RuleViolationError

        with pytest.raises(RuleViolationError):
            users_service.anonymiser(
                session,
                administrateur.user.id,
                reason=MOTIF,
                par_admin_id=administrateur.user.id,
            )

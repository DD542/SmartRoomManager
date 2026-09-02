"""Le code d'accès ne doit pas rester dans la base.

Le courriel le porte : c'est ainsi que l'organisateur le reçoit, une fois. La
notification applicative, elle, est **écrite en base** et s'affiche
indéfiniment — elle gardait donc en clair le secret que tout le reste protège :

* `booking_access_codes` n'en conserve qu'une empreinte bcrypt et un indice ;
* la fiche de réservation affiche « E-**** » ;
* la page Mentions légales affirme que le code complet n'existe qu'à l'instant
  de son émission ;
* le cahier des charges dit « codes d'accès jamais affichés en dehors de la
  fenêtre autorisée ».

Le masquage se fait sur la **valeur**, avant le rendu du gabarit, et non par
une expression régulière passée sur le texte rendu : un gabarit modifié par
l'administration pourrait présenter le code autrement, et une expression
régulière écrite pour la forme d'aujourd'hui le laisserait passer demain.
"""

from __future__ import annotations

import re

import pytest
from sqlalchemy import select

from app.models import EmailTemplate, Notification
from app.services import mail_service

pytestmark = pytest.mark.integration

#: La forme d'un code émis : une lettre, un tiret, quatre chiffres.
#:
#: Les frontières de mot ne sont pas décoratives : sans elles, l'expression
#: reconnaît « e-4507 » au milieu de l'identifiant d'une réservation
#: (`bf4dfa12-f0ee-4507-a4e6-…`) et signale une fuite là où il n'y a qu'une URL.
CODE_EN_CLAIR = re.compile(r"\b[A-Za-z]-\d{4}\b")


@pytest.fixture(autouse=True)
def gabarits(session):
    """Les deux gabarits que ces tests exercent, l'un portant le code."""
    saut = chr(10) * 2
    modeles = {
        "reservation_confirmation": (
            "Votre réservation {{ salle }} est confirmée",
            f"Bonjour {{{{ prenom }}}},{saut}"
            "Votre réservation pour la salle {{ salle }} ({{ batiment }}) est "
            f"confirmée pour le {{{{ date }}}} sur le créneau {{{{ creneau }}}}.{saut}"
            f"Votre code d'accès temporaire est : {{{{ code_acces }}}}{saut}"
            "Pour gérer votre réservation : {{ lien_reservation }}",
        ),
        "reservation_annulation": (
            "Votre réservation {{ salle }} est annulée",
            f"Bonjour {{{{ prenom }}}},{saut}"
            "Votre réservation pour la salle {{ salle }} ({{ batiment }}) du "
            "{{ date }} est annulée.",
        ),
    }
    for code, (objet, corps) in modeles.items():
        if mail_service.get_template(session, code) is None:
            session.add(
                EmailTemplate(
                    code=code,
                    name=code,
                    trigger_label="test",
                    subject=objet,
                    body=corps,
                    is_enabled=True,
                )
            )
    session.flush()


class TestMasquage:
    def test_un_code_devient_son_indice(self):
        assert mail_service.masquer_secret("E-9101") == "E-****"

    def test_une_valeur_de_forme_inattendue_disparait_entierement(self):
        # Mieux vaut perdre un renseignement que le divulguer : si la forme
        # change, le masque ne doit pas laisser filtrer ce qu'il ne reconnaît
        # pas.
        assert "1234" not in mail_service.masquer_secret("jeton-brut-1234")

    def test_le_vide_reste_vide(self):
        assert mail_service.masquer_secret(None) == ""


class TestNotification:
    def test_la_notification_ne_porte_que_l_indice(self, session, compte):
        gabarit = mail_service.get_template(session, "reservation_confirmation")
        assert gabarit is not None, "le gabarit de confirmation doit exister"

        mail_service.notify(
            session,
            user=compte,
            code="reservation_confirmation",
            variables={
                "salle": "Salle Curie",
                "batiment": "Eiffel 2 — 1er étage",
                "date": "mardi 1 septembre 2026",
                "creneau": "15:21 - 16:21",
                "lien_reservation": "http://exemple.test/app/reservations/1",
                "code_acces": "E-9101",
            },
        )
        session.flush()

        stockee = session.scalars(
            select(Notification).where(Notification.user_id == compte.id)
        ).all()[-1]

        assert "9101" not in stockee.body, "le code complet est reste en base"
        assert "E-****" in stockee.body, (
            "l'indice doit rester : il aide a reconnaitre le code"
        )
        assert not CODE_EN_CLAIR.search(stockee.body)
        assert not CODE_EN_CLAIR.search(stockee.title)

    def test_le_courriel_le_porte_toujours(self, session, compte, monkeypatch):
        """L'organisateur doit bien le recevoir quelque part.

        Masquer partout reviendrait a ne jamais lui donner son code.
        """
        envoyes = []
        monkeypatch.setattr(
            mail_service, "_deposer", lambda message: envoyes.append(message)
        )

        mail_service.notify(
            session,
            user=compte,
            code="reservation_confirmation",
            variables={
                "salle": "Salle Curie",
                "batiment": "Eiffel 2 — 1er étage",
                "date": "mardi 1 septembre 2026",
                "creneau": "15:21 - 16:21",
                "lien_reservation": "http://exemple.test/app/reservations/1",
                "code_acces": "E-9101",
            },
        )

        assert envoyes, "aucun courriel prepare"
        assert "E-9101" in envoyes[-1].body

    def test_une_notification_sans_code_est_inchangee(self, session, compte):
        # Le masquage ne doit pas mordre sur ce qui n'est pas un secret.
        mail_service.notify(
            session,
            user=compte,
            code="reservation_annulation",
            variables={
                "salle": "Salle Curie",
                "batiment": "Eiffel 2 — 1er étage",
                "date": "mardi 1 septembre 2026",
                "creneau": "15:21 - 16:21",
                "lien_reservation": "http://exemple.test/app/reservations/1",
            },
        )
        session.flush()

        stockee = session.scalars(
            select(Notification).where(Notification.user_id == compte.id)
        ).all()[-1]
        assert "Salle Curie" in stockee.body


class TestParcoursComplet:
    def test_une_reservation_reelle_ne_laisse_pas_son_code(
        self, session, compte, creer_salle, jour_ouvre
    ):
        """Le cas qui a été constaté : une confirmation, et le code en base."""
        from app.services import booking_service
        from tests.services.conftest import creneau

        salle = creer_salle("A badge")
        salle.badge_required = True
        session.flush()

        reservation, code = booking_service.create_booking(
            session,
            room_id=salle.id,
            owner_id=compte.id,
            slot=creneau(jour_ouvre, 9),
            title="Reunion",
            attendees=2,
        )
        session.flush()
        assert code is not None

        notifications = session.scalars(
            select(Notification).where(Notification.booking_id == reservation.id)
        ).all()
        assert notifications, "la confirmation doit produire une notification"
        for item in notifications:
            assert code.clear not in item.body
            assert not CODE_EN_CLAIR.search(item.body)

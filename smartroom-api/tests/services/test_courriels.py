"""Courriels déclenchés par les réservations.

Trois gabarits vivaient en base, actifs, chacun portant la description de son
propre déclencheur — « Déclenché lors de la création d'une réservation ». Un
seul était appelé par du code. Les deux autres n'ont jamais rien envoyé, et
rien ne le signalait : ni erreur, ni journal, ni écran. L'administration les
montrait activés, et l'écran d'annulation proposait de prévenir les
participants.

Ce qui suit vérifie qu'un courriel part, et qu'il ne dit que ce qu'on sait : le
rappel annonçait à chaque destinataire le code d'accès de la fiche de
démonstration.
"""

from __future__ import annotations

import logging
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.models import BookingAccessCode, EmailTemplate, EmailTemplateVariable, Notification
from app.services import booking_service, mail_service
from app.tasks import scheduler
from tests.services.conftest import charge, connecter, creneau

GABARITS = {
    "reservation_confirmation": (
        "Votre réservation {{salle}} est confirmée",
        "Bonjour {{prenom}},\n\nSalle {{salle}} ({{batiment}}) le {{date}} "
        "sur le créneau {{creneau}}.\n\nCode : {{code_acces}}\n\n{{lien_reservation}}",
    ),
    "reservation_annulation": (
        "Votre réservation {{salle}} du {{date}} est annulée",
        "Bonjour {{prenom}},\n\nVotre réservation {{salle}} du {{date}} "
        "({{creneau}}) a été annulée.",
    ),
    "reservation_rappel": (
        "Votre réservation {{salle}} commence bientôt",
        "Bonjour {{prenom}},\n\nRéunion en salle {{salle}} à {{creneau}}.\n\n"
        "Code d'accès : {{code_acces}}",
    ),
}

#: Les valeurs d'exemple du jeu réel. Elles comptent : c'est en les injectant
#: dans les envois que « A-4821 » se retrouvait dans le courriel de chacun.
EXEMPLES = {
    # Volontairement méconnaissable : le parc de test nomme ses salles
    # « Salle Vinci a3f9c2 », qui contiendrait « Salle Vinci ».
    "salle": "SALLE-EXEMPLE",
    "batiment": "Bâtiment A — 2e étage",
    "date": "jeudi 26 mars 2026",
    "creneau": "14:00 - 15:30",
    "code_acces": "A-4821",
    "lien_reservation": "https://smartroom.ece.fr/app/reservations/1",
}


@pytest.fixture
def gabarits(session) -> None:
    for code, exemple in EXEMPLES.items():
        connu = session.scalars(
            select(EmailTemplateVariable).where(EmailTemplateVariable.code == code)
        ).one_or_none()
        if connu is None:
            session.add(EmailTemplateVariable(code=code, label=code, sample_value=exemple))

    for code, (objet, corps) in GABARITS.items():
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


@pytest.fixture(autouse=True)
def expedies(monkeypatch) -> list[mail_service.Message]:
    """Ce qui est parti, et rien de plus.

    Les routes expédient en tâche de fond après la réponse, et `TestClient` les
    exécute : lire la file après un appel HTTP la trouverait déjà vide. Le
    transport est donc remplacé par un carnet.

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

    Un appel HTTP expédie ; un appel direct au service laisse en attente, le
    COMMIT appartenant alors au test.
    """
    return [*expedies, *mail_service.pending()]


def reserver(client, entetes, salle, slot):
    return client.post(
        "/api/v1/bookings",
        headers=entetes,
        json={"room_id": str(salle.id), "slot": charge(slot), "attendees": 4},
    )


class TestConfirmation:
    def test_la_creation_prepare_un_courriel(
        self, client, compte, salle, jour_ouvre, gabarits, expedies
    ):
        """Aucune ligne de code n'appelait ce gabarit : rien ne partait, jamais."""
        entetes = connecter(client, compte.email)

        reponse = reserver(client, entetes, salle, creneau(jour_ouvre, 10))
        assert reponse.status_code == 201, reponse.text

        [message] = courriels(expedies)
        assert message.to == compte.email
        assert salle.name in message.subject

    def test_le_courriel_porte_le_code_en_clair(
        self, client, compte, salle, jour_ouvre, gabarits, expedies
    ):
        """Le clair n'existe qu'à l'émission, et l'écran ne le montre qu'une fois.

        Le courriel est le seul endroit où l'utilisateur pourra le relire.
        """
        entetes = connecter(client, compte.email)
        reponse = reserver(client, entetes, salle, creneau(jour_ouvre, 15))

        clair = reponse.json()["access_code"]["code"]
        [message] = courriels(expedies)
        assert clair in message.body
        assert compte.first_name in message.body
        assert "https://" in message.body or "http://" in message.body

    def test_aucune_valeur_d_exemple_ne_s_invite(
        self, client, compte, salle, jour_ouvre, gabarits, expedies
    ):
        """`notify` amorçait les variables avec les exemples du référentiel."""
        entetes = connecter(client, compte.email)
        reserver(client, entetes, salle, creneau(jour_ouvre, 16))

        [message] = courriels(expedies)
        for exemple in EXEMPLES.values():
            assert exemple not in message.body

    def test_la_notification_porte_son_gabarit(
        self, client, session, compte, salle, jour_ouvre, gabarits
    ):
        """L'écran des notifications doit savoir d'où vient ce qu'il affiche."""
        entetes = connecter(client, compte.email)
        reponse = reserver(client, entetes, salle, creneau(jour_ouvre, 11))

        notification = session.scalars(
            select(Notification).where(
                Notification.booking_id == reponse.json()["booking"]["id"]
            )
        ).one()
        assert notification.template_code == "reservation_confirmation"
        assert notification.user_id == compte.id


class TestAnnulation:
    def test_l_annulation_prepare_un_courriel(
        self, client, compte, salle, jour_ouvre, gabarits, expedies
    ):
        entetes = connecter(client, compte.email)
        creee = reserver(client, entetes, salle, creneau(jour_ouvre, 14)).json()
        # La confirmation est déjà partie : seule l'annulation nous intéresse.
        expedies.clear()

        reponse = client.post(
            f"/api/v1/bookings/{creee['booking']['id']}/cancel",
            headers=entetes,
            json={"reason": "Réunion reportée"},
        )
        assert reponse.status_code == 200, reponse.text

        [message] = courriels(expedies)
        assert message.to == compte.email
        assert "annulée" in message.subject

    def test_un_blocage_ne_previent_personne(
        self, session, salle, administrateur, jour_ouvre, gabarits, expedies
    ):
        """Un blocage n'a pas d'organisateur : il n'y a personne à prévenir."""
        blocage = booking_service.create_blocking(
            session,
            room_id=salle.id,
            slot=creneau(jour_ouvre, 8),
            reason="Travaux",
            created_by_admin_id=administrateur.user_id,
        )
        booking_service.cancel_booking(session, blocage.id, reason="Travaux annulés")

        assert courriels(expedies) == []


class TestRappel:
    def test_le_rappel_n_invente_ni_code_ni_creneau(
        self, session, compte, salle, jour_ouvre, gabarits, expedies
    ):
        """Le gabarit demande `creneau` et `code_acces` ; le traitement envoyait
        `titre`, `debut` et `minutes`. Les trois trous étaient comblés par la
        fiche de démonstration — plausibles, et faux."""
        reservation, code = booking_service.create_booking(
            session,
            room_id=salle.id,
            owner_id=compte.id,
            slot=creneau(jour_ouvre, 9),
            title="Point projet",
            attendees=2,
        )
        session.flush()
        expedies.clear()
        mail_service.flush()

        scheduler.send_reminders(
            session, now=reservation.time_range.lower - timedelta(minutes=10)
        )

        [message] = courriels(expedies)
        assert "A-4821" not in message.body
        assert "14:00 - 15:30" not in message.body
        # Le clair n'existe plus : l'indice est tout ce que le système sait
        # encore dire, et c'est ce qu'affiche déjà l'écran de la réservation.
        indice = session.scalars(
            select(BookingAccessCode).where(
                BookingAccessCode.booking_id == reservation.id
            )
        ).one().code_hint
        assert indice in message.body
        assert code.clear not in message.body

    def test_la_confirmation_ne_supprime_pas_le_rappel(
        self, session, compte, salle, jour_ouvre, gabarits
    ):
        """La garde cherchait n'importe quelle notification de la réservation.

        Depuis que la création écrit la sienne, une réservation posée dans la
        fenêtre de rappel aurait supprimé son propre rappel.
        """
        reservation, _ = booking_service.create_booking(
            session,
            room_id=salle.id,
            owner_id=compte.id,
            slot=creneau(jour_ouvre, 13),
            attendees=2,
        )
        session.flush()

        envoyes = scheduler.send_reminders(
            session, now=reservation.time_range.lower - timedelta(minutes=10)
        )
        assert envoyes == 1


class TestTransport:
    @pytest.mark.asyncio
    async def test_le_journal_ne_porte_pas_le_code(self, monkeypatch):
        """MAIL_ENABLED=false trace l'envoi — sans le corps, qui porte le code.

        Un gestionnaire posé à la main plutôt que `caplog` : l'application
        reconfigure la racine au démarrage, et le journal du test dépendrait de
        l'ordre des imports.
        """
        # Le carnet de la fixture remplace `send` : ici, c'est le vrai transport
        # qu'on observe.
        monkeypatch.undo()

        lignes: list[str] = []

        class Carnet(logging.Handler):
            def emit(self, record: logging.LogRecord) -> None:
                lignes.append(record.getMessage())

        journal = logging.getLogger("app.services.mail_service")
        carnet = Carnet()
        journal.addHandler(carnet)
        journal.setLevel(logging.INFO)
        try:
            await mail_service.send(
                mail_service.Message(
                    to="d.menga@ece.fr", subject="Confirmée", body="Code : E-7412"
                )
            )
        finally:
            journal.removeHandler(carnet)

        trace = "\n".join(lignes)
        assert "d.menga@ece.fr" in trace
        assert "E-7412" not in trace

    def test_la_file_se_vide_en_une_fois(self):
        """`flush` lisait puis vidait : un dépôt entre les deux se perdait."""
        mail_service._en_attente.append(
            mail_service.Message(to="a@ece.fr", subject="x", body="y")
        )

        assert len(mail_service.flush()) == 1
        assert mail_service.pending() == []

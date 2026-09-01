"""Le code d'accès tel qu'il est émis, et le retard tel qu'on le déclare.

Le code émis a la forme `E-3716` : une lettre tirée du bâtiment, un tiret,
quatre chiffres. C'est cette chaîne-là qui est hachée, tiret compris — la base
ne garde rien d'autre. Un appelant qui retire le tiret avant d'envoyer présente
donc `E3716`, que l'empreinte ne reconnaît pas : « Code d'accès incorrect »
pour un code parfaitement valable, ce que l'écran de validation faisait.

La déclaration de retard accepte désormais une durée annoncée, facultative.
Elle ne décale aucune règle — elle est écrite au journal, pour qui regarde.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.core.errors import RuleViolationError
from app.models import BookingEvent
from app.services import booking_service
from tests.services.conftest import connecter

pytestmark = pytest.mark.integration


@pytest.fixture
def salle_a_badge(session, creer_salle):
    salle = creer_salle("Salle à badge")
    salle.badge_required = True
    session.flush()
    return salle


@pytest.fixture
def en_cours(session, compte, salle_a_badge):
    """Une réservation commencée il y a deux minutes : la fenêtre est ouverte."""
    from app.domain.types import TimeSlot

    debut = datetime.now(UTC).replace(second=0, microsecond=0) - timedelta(minutes=2)
    reservation, code = booking_service.create_booking(
        session,
        room_id=salle_a_badge.id,
        owner_id=compte.id,
        slot=TimeSlot(start=debut, end=debut + timedelta(hours=1)),
        title="Point projet",
        attendees=2,
        ignore_rules=True,
    )
    session.flush()
    assert code is not None, "la salle exige un badge : un code doit être émis"
    return reservation, code


def journal(session, reservation_id):
    return session.scalars(
        select(BookingEvent)
        .where(BookingEvent.booking_id == reservation_id)
        .order_by(BookingEvent.occurred_at)
    ).all()


class TestFormatDuCode:
    def test_le_code_est_emis_avec_son_tiret(self, en_cours):
        # Tout ce qui suit en dépend : l'empreinte porte sur cette chaîne exacte.
        _, code = en_cours

        assert code.clear[1] == "-"
        assert len(code.clear) == 6

    def test_le_code_emis_ouvre_la_porte(self, session, en_cours):
        reservation, code = en_cours

        valide = booking_service.check_in(session, reservation.id, code=code.clear)

        assert valide.checked_in_at is not None

    def test_le_meme_code_sans_tiret_est_refuse(self, session, en_cours):
        """Le défaut vu à l'écran : le front retirait le tiret avant d'envoyer.

        Le refus est correct — c'est bien une autre chaîne. Ce test existe pour
        que personne ne « répare » la vérification en normalisant des deux
        côtés : ce serait accepter une saisie que le serveur n'a jamais émise,
        et élargir en silence ce qui ouvre une porte.
        """
        reservation, code = en_cours

        with pytest.raises(RuleViolationError) as refus:
            booking_service.check_in(
                session, reservation.id, code=code.clear.replace("-", "")
            )

        assert refus.value.code == "code_invalide"


class TestRetardDeclare:
    def test_sans_duree_la_presence_est_validee(self, session, en_cours):
        reservation, _ = en_cours

        marquee = booking_service.mark_late(session, reservation.id)

        assert marquee.checked_in_at is not None

    def test_la_duree_annoncee_est_journalisee(self, session, en_cours):
        """La durée n'est qu'une annonce : elle ne décale aucune règle.

        Elle sert à qui regarde — l'occupant suivant, l'administration — et n'a
        donc de valeur que si elle est écrite quelque part. La garder en
        mémoire vive reviendrait à ne pas la demander.
        """
        reservation, _ = en_cours

        booking_service.mark_late(session, reservation.id, delai_min=15)
        session.flush()

        assert "15" in journal(session, reservation.id)[-1].label

    def test_sans_duree_le_journal_n_en_invente_pas(self, session, en_cours):
        reservation, _ = en_cours

        booking_service.mark_late(session, reservation.id)
        session.flush()

        libelle = journal(session, reservation.id)[-1].label
        assert "minute" not in libelle.lower()

    def test_une_duree_plus_longue_que_le_creneau_est_refusee(self, session, en_cours):
        # Un retard qui dépasse la réunion n'est pas un retard.
        reservation, _ = en_cours

        with pytest.raises(RuleViolationError):
            booking_service.mark_late(session, reservation.id, delai_min=600)

    def test_une_duree_negative_est_refusee(self, session, en_cours):
        reservation, _ = en_cours

        with pytest.raises(RuleViolationError):
            booking_service.mark_late(session, reservation.id, delai_min=-5)


class TestRoute:
    def test_accepte_une_duree(self, client, session, compte, en_cours):
        reservation, _ = en_cours
        session.commit()
        entetes = connecter(client, compte.email)

        reponse = client.post(
            f"/api/v1/bookings/{reservation.id}/late",
            headers=entetes,
            json={"delay_min": 10},
        )

        assert reponse.status_code == 200, reponse.text
        assert reponse.json()["checked_in_at"] is not None

    def test_s_en_passe(self, client, session, compte, en_cours):
        # Le corps reste facultatif : « je suis en retard » sans plus de détail
        # doit rester le geste le plus simple de l'écran.
        reservation, _ = en_cours
        session.commit()
        entetes = connecter(client, compte.email)

        reponse = client.post(f"/api/v1/bookings/{reservation.id}/late", headers=entetes)

        assert reponse.status_code == 200, reponse.text

    def test_refuse_une_duree_hors_bornes(self, client, session, compte, en_cours):
        reservation, _ = en_cours
        session.commit()
        entetes = connecter(client, compte.email)

        reponse = client.post(
            f"/api/v1/bookings/{reservation.id}/late",
            headers=entetes,
            json={"delay_min": 900},
        )

        assert reponse.status_code == 422


class TestAnnulerApresValidation:
    """Annuler une réservation dont la présence est validée.

    La base l'interdit — `ck_bookings_cancelled_not_checked_in` — mais le
    service ne le voyait pas venir : la violation remontait en `IntegrityError`
    au `flush`, donc en **500**. Un utilisateur qui valide sa présence puis
    change d'avis produit exactement ce geste ; il doit lire une phrase, pas un
    plantage.
    """

    def test_le_service_refuse_avant_la_base(self, session, en_cours):
        reservation, code = en_cours
        booking_service.check_in(session, reservation.id, code=code.clear)
        session.flush()

        with pytest.raises(RuleViolationError) as refus:
            booking_service.cancel_booking(
                session, reservation.id, reason="Finalement non", actor_id=reservation.owner_id
            )

        assert refus.value.code == "deja_validee"

    def test_la_route_repond_422_et_non_500(self, client, session, compte, en_cours):
        reservation, code = en_cours
        booking_service.check_in(session, reservation.id, code=code.clear)
        session.commit()
        entetes = connecter(client, compte.email)

        reponse = client.post(
            f"/api/v1/bookings/{reservation.id}/cancel",
            headers=entetes,
            json={"reason": "Finalement non"},
        )

        assert reponse.status_code == 422, reponse.text
        assert reponse.json()["error"]["code"] == "deja_validee"

    def test_une_reservation_non_validee_s_annule_toujours(self, session, en_cours):
        # La contrepartie : le refus ne doit pas déborder sur le cas normal.
        reservation, _ = en_cours

        annulee = booking_service.cancel_booking(
            session, reservation.id, reason="Changement de programme",
            actor_id=reservation.owner_id,
        )

        assert annulee.cancelled_at is not None

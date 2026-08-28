"""Réémission d'un code d'accès.

Le code en clair n'existe qu'à l'instant de son émission : la base n'en garde
qu'une empreinte et un indice masqué. Aucune route ne peut donc relire un code
déjà émis, et l'écran ne doit pas le promettre. La seule réponse à « j'ai perdu
mon code » est d'en émettre un neuf, en révoquant l'ancien.

Ce que ces tests verrouillent : le propriétaire seul peut le faire, un seul
code reste actif, un créneau terminé ou annulé n'en produit plus, et une salle
sans badge n'en a pas.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from app.core.errors import NotFoundError, RuleViolationError
from app.db.enums import BookingStatus
from app.models import BookingAccessCode
from app.services import booking_service
from tests.services.conftest import connecter, creneau

pytestmark = pytest.mark.integration


@pytest.fixture
def salle_a_badge(session, creer_salle):
    salle = creer_salle("Salle à badge")
    salle.badge_required = True
    session.flush()
    return salle


@pytest.fixture
def reservation(session, compte, salle_a_badge, jour_ouvre):
    ligne, code = booking_service.create_booking(
        session,
        room_id=salle_a_badge.id,
        owner_id=compte.id,
        slot=creneau(jour_ouvre, 9),
        title="Réunion à badge",
        attendees=2,
    )
    session.flush()
    assert code is not None, "la salle exige un badge : un code doit être émis"
    return ligne


class TestReemission:
    def test_un_code_neuf_remplace_l_ancien(self, session, compte, reservation):
        ancien = session.scalars(
            select(BookingAccessCode).where(BookingAccessCode.booking_id == reservation.id)
        ).one()

        nouveau = booking_service.reissue_access_code(
            session, reservation.id, owner_id=compte.id
        )
        session.flush()

        actifs = session.scalars(
            select(BookingAccessCode).where(
                BookingAccessCode.booking_id == reservation.id,
                BookingAccessCode.revoked_at.is_(None),
            )
        ).all()
        assert len(actifs) == 1, "deux codes valables pour une porte, c'est un de trop"
        assert actifs[0].code_hash != ancien.code_hash
        assert nouveau.clear
        assert nouveau.hint.endswith("****")

    def test_l_ancien_est_revoque_et_conserve(self, session, compte, reservation):
        """Révoqué et non supprimé : le journal doit pouvoir dire ce qui a servi."""
        booking_service.reissue_access_code(session, reservation.id, owner_id=compte.id)
        session.flush()

        codes = session.scalars(
            select(BookingAccessCode).where(BookingAccessCode.booking_id == reservation.id)
        ).all()
        assert len(codes) == 2
        assert sum(1 for item in codes if item.revoked_at is not None) == 1

    def test_le_clair_n_est_jamais_stocke(self, session, compte, reservation):
        code = booking_service.reissue_access_code(
            session, reservation.id, owner_id=compte.id
        )
        session.flush()

        ligne = session.scalars(
            select(BookingAccessCode).where(
                BookingAccessCode.booking_id == reservation.id,
                BookingAccessCode.revoked_at.is_(None),
            )
        ).one()
        assert code.clear not in ligne.code_hash
        assert code.clear not in ligne.code_hint

    def test_la_reservation_d_un_tiers_est_introuvable(
        self, session, creer_compte, reservation
    ):
        autre = creer_compte("Autre")
        with pytest.raises(NotFoundError):
            booking_service.reissue_access_code(
                session, reservation.id, owner_id=autre.id
            )

    def test_une_reservation_annulee_n_emet_plus(self, session, compte, reservation):
        booking_service.cancel_booking(
            session, reservation.id, reason="Reportée", actor_id=compte.id
        )
        session.flush()

        with pytest.raises(RuleViolationError, match="annulée"):
            booking_service.reissue_access_code(
                session, reservation.id, owner_id=compte.id
            )

    def test_une_salle_sans_badge_n_a_pas_de_code(
        self, session, compte, creer_salle, jour_ouvre
    ):
        salle = creer_salle("Salle sans badge")
        # La fabrique pose `badge_required` à vrai : ce test a besoin du contraire.
        salle.badge_required = False
        session.flush()
        ligne, code = booking_service.create_booking(
            session,
            room_id=salle.id,
            owner_id=compte.id,
            slot=creneau(jour_ouvre, 14),
            title="Sans badge",
            attendees=2,
        )
        session.flush()
        assert code is None

        with pytest.raises(RuleViolationError, match="code d'accès"):
            booking_service.reissue_access_code(session, ligne.id, owner_id=compte.id)


class TestParHttp:
    def test_le_proprietaire_obtient_un_code_neuf(self, client, compte, reservation):
        entetes = connecter(client, compte.email)

        reponse = client.post(
            f"/api/v1/bookings/{reservation.id}/access-code", headers=entetes
        )

        assert reponse.status_code == 200
        charge = reponse.json()
        assert charge["code"]
        assert charge["hint"].endswith("****")
        # Le clair et l'indice ne se confondent pas : l'un sert une fois, l'autre
        # reste affichable.
        assert charge["code"] != charge["hint"]

    def test_le_detail_dit_que_la_salle_exige_un_badge(self, client, compte, reservation):
        entetes = connecter(client, compte.email)

        charge = client.get(
            f"/api/v1/bookings/{reservation.id}", headers=entetes
        ).json()

        assert charge["room_badge_required"] is True

    def test_sans_code_actif_la_salle_reste_a_badge(
        self, session, client, compte, reservation
    ):
        """Le badge est une propriété de la porte, pas de l'indice affiché.

        L'écran le déduisait de la présence de l'indice : une réservation dont
        le code venait d'être révoqué se voyait donc annoncer « aucun code,
        cette réservation n'est plus active » — faux, et sans recours.
        """
        code = session.scalars(
            select(BookingAccessCode).where(
                BookingAccessCode.booking_id == reservation.id,
                BookingAccessCode.revoked_at.is_(None),
            )
        ).one()
        code.revoked_at = datetime.now(UTC)
        session.flush()
        entetes = connecter(client, compte.email)

        charge = client.get(
            f"/api/v1/bookings/{reservation.id}", headers=entetes
        ).json()

        assert charge["access_code_hint"] is None
        assert charge["room_badge_required"] is True

    def test_le_detail_dit_si_l_etage_porte_un_plan(self, client, compte, reservation):
        """Sans cette réponse, l'écran demandait le plan à tout hasard : un 404
        par étage sans plan, rouge dans la console, lu comme une panne."""
        entetes = connecter(client, compte.email)

        charge = client.get(
            f"/api/v1/bookings/{reservation.id}", headers=entetes
        ).json()

        assert charge["floor_has_plan"] is False

    def test_un_tiers_recoit_introuvable(self, client, creer_compte, reservation):
        autre = creer_compte("Autre")
        entetes = connecter(client, autre.email)

        reponse = client.post(
            f"/api/v1/bookings/{reservation.id}/access-code", headers=entetes
        )

        assert reponse.status_code == 404

    def test_sans_session_la_route_refuse(self, client, reservation):
        reponse = client.post(f"/api/v1/bookings/{reservation.id}/access-code")
        assert reponse.status_code == 401

    def test_une_reservation_inexistante_est_introuvable(self, client, compte):
        entetes = connecter(client, compte.email)
        reponse = client.post(
            f"/api/v1/bookings/{uuid.uuid4()}/access-code", headers=entetes
        )
        assert reponse.status_code == 404

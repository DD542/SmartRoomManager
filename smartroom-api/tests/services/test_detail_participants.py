"""Le détail d'une réservation porte ses participants.

Il ne les portait pas, et deux écrans en dépendaient :

* la fiche affichait « Participants (0) » quel que soit le nombre réel — un
  chiffre faux, que rien ne signalait ;
* l'écran de modification appelait `.filter()` dessus et **plantait** :
  « Cannot read properties of undefined (reading 'filter') ». La page entière
  était remplacée par une trace d'erreur.

Une route dédiée existe — `GET /bookings/{id}/participants` — mais aucun des
deux écrans ne l'appelait : tous deux lisaient un champ que la charge ne
portait pas, et JavaScript ne dit rien d'un champ absent.

Les participants rejoignent donc `events` dans le schéma de détail, pour la
même raison que la frise y figure : ils n'ont rien à faire dans une liste de
cent réservations, et tout à faire dans le détail de celle qu'on regarde.
"""

from __future__ import annotations

import pytest

from tests.services.conftest import connecter, creneau

pytestmark = pytest.mark.integration


@pytest.fixture
def reservation(session, compte, salle, jour_ouvre):
    from app.services import booking_service

    ligne, _ = booking_service.create_booking(
        session,
        room_id=salle.id,
        owner_id=compte.id,
        slot=creneau(jour_ouvre, 10),
        title="Comité de suivi",
        attendees=3,
        participants=[
            ("marie@edu.ece.fr", "Marie Laurent"),
            ("jean@edu.ece.fr", "Jean Dupont"),
        ],
    )
    session.flush()
    return ligne


class TestDetail:
    def test_le_detail_rend_les_participants(
        self, client, session, compte, reservation
    ):
        session.commit()
        entetes = connecter(client, compte.email)

        reponse = client.get(f"/api/v1/bookings/{reservation.id}", headers=entetes)

        assert reponse.status_code == 200, reponse.text
        corps = reponse.json()
        assert "participants" in corps, (
            "le champ manque : l'ecran de modification plante"
        )
        adresses = {item["email"] for item in corps["participants"]}
        assert {"marie@edu.ece.fr", "jean@edu.ece.fr"} <= adresses

    def test_l_organisateur_est_distingue(self, client, session, compte, reservation):
        """L'écran de modification sépare les deux : il ne propose de retirer
        que les invités, jamais l'organisateur."""
        session.commit()
        entetes = connecter(client, compte.email)

        corps = client.get(f"/api/v1/bookings/{reservation.id}", headers=entetes).json()

        organisateurs = [p for p in corps["participants"] if p["is_organizer"]]
        assert len(organisateurs) == 1
        assert organisateurs[0]["email"] == compte.email

    def test_la_liste_n_en_porte_pas(self, client, session, compte, reservation):
        """Cent réservations affichées ne doivent pas tirer cent listes
        d'invités dont aucune n'est lue. C'est l'argument qui vaut déjà pour la
        frise."""
        session.commit()
        entetes = connecter(client, compte.email)

        corps = client.get("/api/v1/bookings", headers=entetes).json()

        assert corps["items"], "aucune reservation rendue"
        assert "participants" not in corps["items"][0]

    def test_une_reservation_sans_invite_rend_une_liste(
        self, client, session, compte, salle, jour_ouvre
    ):
        # Jamais `null` : l'appelant doit pouvoir parcourir sans se garder.
        from app.services import booking_service

        seule, _ = booking_service.create_booking(
            session,
            room_id=salle.id,
            owner_id=compte.id,
            slot=creneau(jour_ouvre, 15),
            title="Seul",
            attendees=1,
        )
        session.commit()
        entetes = connecter(client, compte.email)

        corps = client.get(f"/api/v1/bookings/{seule.id}", headers=entetes).json()

        assert isinstance(corps["participants"], list)

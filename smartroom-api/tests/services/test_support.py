"""Support, notifications, gabarits, statistiques, audit et tâches planifiées."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.dialects.postgresql import Range

from app.api.deps import DATA_EXPORT, SUPPORT_HANDLE, SYSTEM_CONFIGURE
from app.core.errors import RuleViolationError
from app.db.enums import (
    ArticleStatus,
    BookingStatus,
    NotificationChannel,
)
from app.models import (
    Booking,
    ChatbotIntent,
    ChatbotIntentKeyword,
    EmailTemplate,
    EmailTemplateVariable,
    FaqArticle,
    FaqCategory,
    Notification,
)
from app.services import mail_service, stats_service
from app.tasks import scheduler
from tests.services.conftest import accorder, connecter, creneau
from tests.services.test_api_v1 import poser


@pytest.fixture
def categorie(session, marque) -> FaqCategory:
    categorie = FaqCategory(code=f"aide_{marque}", label="Aide générale", sort_order=1)
    session.add(categorie)
    session.flush()
    return categorie


@pytest.fixture
def article(session, categorie, marque) -> FaqArticle:
    article = FaqArticle(
        category_id=categorie.id,
        slug=f"comment-reserver-{marque}",
        title="Comment réserver une salle",
        excerpt="Les trois étapes d'une réservation.",
        body="Choisissez un créneau, une salle, puis validez.",
        status=ArticleStatus.PUBLIE,
        published_at=datetime.now(UTC),
    )
    session.add(article)
    session.flush()
    return article


@pytest.fixture
def intention(session, marque) -> ChatbotIntent:
    intention = ChatbotIntent(
        code=f"reserver_{marque}",
        label="Réserver une salle",
        answer="Rendez-vous dans « Réserver », choisissez un créneau puis une salle.",
        quick_replies=["Voir les salles"],
        escalates_to_ticket=False,
        is_active=True,
    )
    session.add(intention)
    session.flush()
    for mot in ("reserver", "salle", "creneau"):
        session.add(ChatbotIntentKeyword(intent_id=intention.id, keyword=mot))
    session.flush()
    return intention


@pytest.fixture
def gabarit(session, marque) -> EmailTemplate:
    session.add(
        EmailTemplateVariable(
            code=f"salle_{marque[:3]}", label="Salle", sample_value="Salle Vinci"
        )
    )
    gabarit = EmailTemplate(
        code=f"reservation_creee_{marque}",
        name="Réservation confirmée",
        trigger_label="À la création d'une réservation",
        subject="Votre réservation de {{ titre }}",
        body="Bonjour {{ prenom }}, votre réservation « {{ titre }} » est confirmée.",
        is_enabled=True,
    )
    session.add(gabarit)
    session.flush()
    return gabarit


class TestTickets:
    def test_ouverture_avec_message_initial(self, client, compte, salle):
        entetes = connecter(client, compte.email)
        reponse = client.post(
            "/api/v1/tickets",
            headers=entetes,
            json={
                "subject": "Vidéoprojecteur en panne",
                "category": "materiel",
                "body": "L'appareil ne s'allume plus depuis ce matin.",
                "room_id": str(salle.id),
            },
        )
        assert reponse.status_code == 201, reponse.text
        corps = reponse.json()
        assert corps["reference"].startswith("#")
        assert corps["status"] == "ouvert"
        assert corps["message_count"] == 1

    def test_le_ticket_d_autrui_est_invisible(
        self, client, compte, creer_compte, salle
    ):
        entetes = connecter(client, compte.email)
        ticket = client.post(
            "/api/v1/tickets",
            headers=entetes,
            json={"subject": "Sujet", "category": "autre", "body": "Description"},
        ).json()

        intrus = creer_compte("Sam")
        autres = connecter(client, intrus.email)
        assert (
            client.get(f"/api/v1/tickets/{ticket['id']}", headers=autres).status_code
            == 404
        )

    def test_la_note_interne_ne_sort_pas_vers_le_demandeur(
        self, client, session, administrateur, compte
    ):
        entetes = connecter(client, compte.email)
        ticket = client.post(
            "/api/v1/tickets",
            headers=entetes,
            json={"subject": "Sujet", "category": "autre", "body": "Description"},
        ).json()

        accorder(session, administrateur, SUPPORT_HANDLE)
        admin = connecter(client, administrateur.user.email, admin=True)
        client.post(
            f"/api/v1/tickets/{ticket['id']}/messages",
            headers=admin,
            json={"body": "Note pour l'équipe", "is_internal": True},
        )

        vu_par_le_demandeur = client.get(
            f"/api/v1/tickets/{ticket['id']}", headers=entetes
        ).json()
        assert all(
            "Note pour l'équipe" not in item["body"]
            for item in vu_par_le_demandeur["messages"]
        )

        vu_par_le_support = client.get(
            f"/api/v1/tickets/{ticket['id']}", headers=admin
        ).json()
        assert any(item["is_internal"] for item in vu_par_le_support["messages"])

    def test_la_premiere_reponse_est_horodatee_une_fois(
        self, client, session, administrateur, compte
    ):
        entetes = connecter(client, compte.email)
        ticket = client.post(
            "/api/v1/tickets",
            headers=entetes,
            json={"subject": "Sujet", "category": "autre", "body": "Description"},
        ).json()

        accorder(session, administrateur, SUPPORT_HANDLE)
        admin = connecter(client, administrateur.user.email, admin=True)

        client.post(
            f"/api/v1/tickets/{ticket['id']}/messages",
            headers=admin,
            json={"body": "Nous regardons."},
        )
        premier = client.get(f"/api/v1/tickets/{ticket['id']}", headers=admin).json()
        assert premier["first_response_at"] is not None
        assert premier["status"] == "en_cours"

        client.post(
            f"/api/v1/tickets/{ticket['id']}/messages",
            headers=admin,
            json={"body": "Toujours en cours."},
        )
        second = client.get(f"/api/v1/tickets/{ticket['id']}", headers=admin).json()
        assert second["first_response_at"] == premier["first_response_at"]

    def test_resolution_horodatee(self, client, session, administrateur, compte):
        entetes = connecter(client, compte.email)
        ticket = client.post(
            "/api/v1/tickets",
            headers=entetes,
            json={"subject": "Sujet", "category": "autre", "body": "Description"},
        ).json()

        accorder(session, administrateur, SUPPORT_HANDLE)
        admin = connecter(client, administrateur.user.email, admin=True)

        corps = client.patch(
            f"/api/v1/admin/tickets/{ticket['id']}/status",
            headers=admin,
            json={"status": "resolu"},
        ).json()
        assert corps["resolved_at"] is not None


class TestBaseDeConnaissances:
    def test_seuls_les_articles_publies_remontent(
        self, client, session, compte, categorie, article, marque
    ):
        session.add(
            FaqArticle(
                category_id=categorie.id,
                slug=f"brouillon-{marque}",
                title="Brouillon",
                excerpt="Pas encore prêt.",
                body="…",
                status=ArticleStatus.BROUILLON,
            )
        )
        session.flush()

        entetes = connecter(client, compte.email)
        corps = client.get(
            "/api/v1/faq/articles", headers=entetes, params={"size": 50}
        ).json()
        titres = {item["title"] for item in corps["items"]}
        assert "Comment réserver une salle" in titres
        assert "Brouillon" not in titres

    def test_la_lecture_incremente_le_compteur(self, client, session, compte, article):
        entetes = connecter(client, compte.email)
        avant = article.view_count

        client.get(f"/api/v1/faq/articles/{article.slug}", headers=entetes)
        session.refresh(article)
        assert article.view_count == avant + 1

    def test_depublier_efface_la_date_de_publication(
        self, client, session, administrateur, categorie, marque
    ):
        """`ck_faq_articles_published` impose l'équivalence stricte : un article
        dépublié n'a pas de date de mise en ligne."""
        brouillon = FaqArticle(
            category_id=categorie.id,
            slug=f"nouveau-{marque}",
            title="Nouveau",
            excerpt="Extrait",
            body="Un corps assez long pour être publiable sans forcer la contrainte.",
            status=ArticleStatus.BROUILLON,
        )
        session.add(brouillon)
        session.flush()

        accorder(session, administrateur, SUPPORT_HANDLE)
        entetes = connecter(client, administrateur.user.email, admin=True)

        publie = client.patch(
            f"/api/v1/admin/faq/articles/{brouillon.id}/status",
            headers=entetes,
            json={"status": "publie"},
        ).json()
        assert publie["published_at"] is not None

        retire = client.patch(
            f"/api/v1/admin/faq/articles/{brouillon.id}/status",
            headers=entetes,
            json={"status": "brouillon"},
        ).json()
        assert retire["published_at"] is None

    def test_categories_avec_decompte(self, client, compte, categorie, article):
        entetes = connecter(client, compte.email)
        corps = client.get("/api/v1/faq/categories", headers=entetes).json()
        vise = next(item for item in corps if item["id"] == str(categorie.id))
        assert vise["article_count"] == 1


class TestChatbot:
    def test_intention_reconnue(self, client, compte, intention):
        entetes = connecter(client, compte.email)
        corps = client.post(
            "/api/v1/chatbot/messages",
            headers=entetes,
            json={"message": "comment reserver une salle"},
        ).json()

        assert corps["intent_code"] == intention.code
        assert corps["confidence"] > 0
        assert corps["escalates_to_ticket"] is False

    def test_le_chatbot_avoue_quand_il_ne_sait_pas(self, client, compte, intention):
        """Une réponse inventée ferait plus de dégâts qu'un renvoi au support."""
        entetes = connecter(client, compte.email)
        corps = client.post(
            "/api/v1/chatbot/messages",
            headers=entetes,
            json={"message": "quelle est la recette du cassoulet"},
        ).json()

        assert corps["intent_code"] is None
        assert corps["confidence"] == 0.0
        assert corps["escalates_to_ticket"] is True

    def test_intention_desactivee_ignoree(self, client, session, compte, intention):
        intention.is_active = False
        session.flush()

        entetes = connecter(client, compte.email)
        corps = client.post(
            "/api/v1/chatbot/messages",
            headers=entetes,
            json={"message": "reserver une salle"},
        ).json()
        assert corps["intent_code"] is None


class TestNotifications:
    def test_liste_et_compteur(self, client, session, compte):
        session.add_all(
            [
                Notification(
                    user_id=compte.id,
                    title=f"Notification {index}",
                    channel=NotificationChannel.IN_APP,
                )
                for index in range(3)
            ]
        )
        session.flush()
        entetes = connecter(client, compte.email)

        assert (
            client.get("/api/v1/notifications/unread-count", headers=entetes).json()
            == 3
        )
        corps = client.get("/api/v1/notifications", headers=entetes).json()
        assert corps["total"] == 3

    def test_marquer_tout_comme_lu(self, client, session, compte):
        session.add(
            Notification(
                user_id=compte.id, title="À lire", channel=NotificationChannel.IN_APP
            )
        )
        session.flush()
        entetes = connecter(client, compte.email)

        assert (
            client.post("/api/v1/notifications/read-all", headers=entetes).status_code
            == 204
        )
        assert (
            client.get("/api/v1/notifications/unread-count", headers=entetes).json()
            == 0
        )

    def test_la_notification_d_autrui_est_invisible(
        self, client, session, compte, creer_compte
    ):
        autre = creer_compte("Sam")
        notification = Notification(
            user_id=autre.id, title="Chez Sam", channel=NotificationChannel.IN_APP
        )
        session.add(notification)
        session.flush()

        entetes = connecter(client, compte.email)
        reponse = client.patch(
            f"/api/v1/notifications/{notification.id}",
            headers=entetes,
            json={"read": True},
        )
        assert reponse.status_code == 404


class TestGabarits:
    def test_rendu_avec_variables(self, session, compte, gabarit):
        message = mail_service.preview(
            session, gabarit.code, {"titre": "Revue de projet", "prenom": "Camille"}
        )
        assert "Revue de projet" in message.subject
        assert "Camille" in message.body

    def test_un_gabarit_invalide_est_refuse_avant_ecriture(
        self, client, session, administrateur, gabarit
    ):
        accorder(session, administrateur, SYSTEM_CONFIGURE)
        entetes = connecter(client, administrateur.user.email, admin=True)

        reponse = client.patch(
            f"/api/v1/admin/email-templates/{gabarit.id}",
            headers=entetes,
            json={"body": "Bonjour {{ prenom "},
        )
        assert reponse.status_code == 422
        assert reponse.json()["error"]["code"] == "gabarit_invalide"

        session.refresh(gabarit)
        assert "{{ prenom }}" in gabarit.body

    def test_le_bac_a_sable_bloque_l_introspection(self):
        """Un gabarit est saisi par un administrateur, pas du code de confiance."""
        with pytest.raises(RuleViolationError):
            mail_service.render("{{ ''.__class__.__mro__ }}", {})

    def test_gabarit_desactive_ne_bloque_rien(self, session, compte, gabarit):
        gabarit.is_enabled = False
        session.flush()

        resultat = mail_service.notify(
            session, user=compte, code=gabarit.code, variables={"titre": "Réunion"}
        )
        assert resultat is None

    def test_notification_persistee_et_courriel_en_attente(
        self, session, compte, gabarit
    ):
        mail_service.flush()
        notification = mail_service.notify(
            session, user=compte, code=gabarit.code, variables={"titre": "Réunion"}
        )
        assert notification is not None
        assert "Réunion" in notification.title

        messages = mail_service.flush()
        assert messages and messages[0].to == compte.email


class TestStatistiques:
    def test_mes_chiffres(self, client, session, compte, salle, jour_ouvre):
        poser(session, salle, compte, creneau(jour_ouvre, 10, 0, 120))
        entetes = connecter(client, compte.email)

        reponse = client.get("/api/v1/stats/me", headers=entetes)
        assert reponse.status_code == 200
        assert reponse.headers["cache-control"].startswith("private")

        corps = reponse.json()
        assert corps["active_bookings"] == 1
        assert corps["booked_hours"] == 2.0
        # Aucune réservation écoulée : le taux d'assiduité n'a pas de sens.
        assert corps["attendance_rate"] is None

    def test_export_csv(self, client, session, compte, salle, jour_ouvre):
        poser(session, salle, compte, creneau(jour_ouvre, 10))
        entetes = connecter(client, compte.email)

        reponse = client.get("/api/v1/stats/me/export", headers=entetes)
        assert reponse.status_code == 200
        assert reponse.text.startswith("Date;Début;Fin;Salle")
        assert salle.name in reponse.text

    def test_chiffres_publics_sans_session(self, client, salle):
        reponse = client.get("/api/v1/stats/public")
        assert reponse.status_code == 200
        assert reponse.json()["rooms"] >= 1
        assert reponse.headers["cache-control"].startswith("public")

    def test_vue_d_ensemble(
        self, client, session, administrateur, compte, salle, jour_ouvre
    ):
        poser(session, salle, compte, creneau(jour_ouvre, 10))
        accorder(session, administrateur, DATA_EXPORT)
        entetes = connecter(client, administrateur.user.email, admin=True)

        corps = client.get(
            "/api/v1/admin/stats/overview", headers=entetes, params={"days": 30}
        ).json()
        assert corps["bookings"] >= 1
        assert "occupancy_percent" in corps

    def test_granularite_inconnue_refusee(self, client, session, administrateur):
        accorder(session, administrateur, DATA_EXPORT)
        entetes = connecter(client, administrateur.user.email, admin=True)

        reponse = client.get(
            "/api/v1/admin/stats/occupancy",
            headers=entetes,
            params={"granularity": "siecle"},
        )
        assert reponse.status_code == 422

    def test_classement_des_salles(
        self, client, session, administrateur, compte, salle, jour_ouvre
    ):
        poser(session, salle, compte, creneau(jour_ouvre, 10))
        accorder(session, administrateur, DATA_EXPORT)
        entetes = connecter(client, administrateur.user.email, admin=True)

        corps = client.get("/api/v1/admin/stats/rooms", headers=entetes).json()
        assert any(item["room_id"] == str(salle.id) for item in corps)

    def test_export_sans_permission(self, client, session, administrateur):
        entetes = connecter(client, administrateur.user.email, admin=True)
        assert (
            client.get("/api/v1/admin/stats/overview", headers=entetes).status_code
            == 403
        )


class TestAudit:
    def test_le_journal_expose_avant_et_apres(
        self, client, session, administrateur, salle
    ):
        accorder(session, administrateur, SYSTEM_CONFIGURE, "rooms.manage")
        entetes = connecter(client, administrateur.user.email, admin=True)

        client.patch(
            f"/api/v1/rooms/{salle.id}", headers=entetes, json={"capacity": 42}
        )

        corps = client.get(
            "/api/v1/admin/audit-logs",
            headers=entetes,
            params={"target_type": "room", "size": 50},
        ).json()
        entree = next(
            item for item in corps["items"] if item["target_id"] == str(salle.id)
        )
        assert entree["diff_before"]["capacity"] == 12
        assert entree["diff_after"]["capacity"] == 42
        assert entree["session_id"]

    def test_signalement_exige_un_motif(self, client, session, administrateur, salle):
        accorder(session, administrateur, SYSTEM_CONFIGURE, "rooms.manage")
        entetes = connecter(client, administrateur.user.email, admin=True)
        client.patch(
            f"/api/v1/rooms/{salle.id}", headers=entetes, json={"capacity": 20}
        )

        entree = client.get(
            "/api/v1/admin/audit-logs", headers=entetes, params={"size": 1}
        ).json()["items"][0]

        sans_motif = client.post(
            f"/api/v1/admin/audit-logs/{entree['id']}/flag",
            headers=entetes,
            json={"flagged": True},
        )
        assert sans_motif.status_code == 422

        avec_motif = client.post(
            f"/api/v1/admin/audit-logs/{entree['id']}/flag",
            headers=entetes,
            json={"flagged": True, "reason": "À relire en comité"},
        )
        assert avec_motif.status_code == 200
        assert avec_motif.json()["flagged_at"] is not None

    def test_le_journal_est_reserve(self, client, session, administrateur):
        entetes = connecter(client, administrateur.user.email, admin=True)
        assert (
            client.get("/api/v1/admin/audit-logs", headers=entetes).status_code == 403
        )


class TestTachesPlanifiees:
    def test_liberation_et_cloture(self, session, compte, salle, maintenant):
        abandonnee = Booking(
            room_id=salle.id,
            owner_id=compte.id,
            title="Réunion fantôme",
            time_range=Range(
                maintenant - timedelta(minutes=30),
                maintenant + timedelta(minutes=90),
                bounds="[)",
            ),
            attendee_count=3,
            status=BookingStatus.CONFIRMEE,
        )
        session.add(abandonnee)
        session.flush()

        liberees, _ = scheduler.release_and_close(session)
        assert liberees >= 1
        session.refresh(abandonnee)
        assert abandonnee.status is BookingStatus.ANNULEE

    def test_le_rappel_ne_part_qu_une_fois(
        self, session, compte, salle, gabarit, maintenant
    ):
        """Sans garde, chaque passage renverrait le même rappel."""
        import app.tasks.scheduler as module

        module.GABARIT_RAPPEL = gabarit.code
        debut = maintenant + timedelta(minutes=15)
        session.add(
            Booking(
                room_id=salle.id,
                owner_id=compte.id,
                title="Imminente",
                time_range=Range(debut, debut + timedelta(hours=1), bounds="[)"),
                attendee_count=2,
                status=BookingStatus.CONFIRMEE,
            )
        )
        session.flush()

        premier = scheduler.send_reminders(session)
        second = scheduler.send_reminders(session)
        assert premier == 1
        assert second == 0

    def test_le_rafraichissement_de_la_vue_aboutit(self, session):
        stats_service.refresh_occupancy(session)
        assert stats_service.overview(session) is not None

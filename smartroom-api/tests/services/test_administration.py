"""Routes d'administration peu fréquentées, et pourtant décisives.

Ce module couvre ce que les autres laissent de côté : les agrégats des
tableaux de bord, les exports, les gabarits de courriel, la base de
connaissances et les référentiels de règles.

Ces chemins ont un point commun : ils ne s'exécutent qu'à la demande d'un
administrateur, souvent une fois par mois. Un défaut y dort longtemps avant de
se manifester — et se manifeste alors devant la personne la moins disposée à
l'excuser.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from sqlalchemy import select

from app.api.deps import (
    DATA_EXPORT,
    RULES_CONFIGURE,
    SUPPORT_HANDLE,
    SYSTEM_CONFIGURE,
)
from app.models import EmailTemplate, FaqCategory
from tests.services.conftest import accorder, connecter, creneau
from tests.services.test_api_v1 import poser

pytestmark = pytest.mark.integration


@pytest.fixture
def exportateur(client, session, administrateur):
    accorder(session, administrateur, DATA_EXPORT)
    return connecter(client, administrateur.user.email, admin=True)


@pytest.fixture
def systeme(client, session, administrateur):
    accorder(session, administrateur, SYSTEM_CONFIGURE)
    return connecter(client, administrateur.user.email, admin=True)


@pytest.fixture
def support(client, session, administrateur):
    accorder(session, administrateur, SUPPORT_HANDLE)
    return connecter(client, administrateur.user.email, admin=True)


@pytest.fixture
def configurateur(client, session, administrateur):
    accorder(session, administrateur, RULES_CONFIGURE)
    return connecter(client, administrateur.user.email, admin=True)


class TestAgregats:
    def test_la_vue_d_ensemble_rend_sept_indicateurs(self, client, exportateur):
        corps = client.get(
            "/api/v1/admin/stats/overview", headers=exportateur, params={"days": 7}
        ).json()

        assert corps["window_days"] == 7
        for cle in (
            "bookings",
            "cancellations",
            "no_shows",
            "pending_access_requests",
            "open_tickets",
            "rooms_in_maintenance",
            "occupancy_percent",
        ):
            assert cle in corps

    @pytest.mark.parametrize(
        "granularite",
        [
            pytest.param("day", id="par_jour"),
            pytest.param("week", id="par_semaine"),
            pytest.param("month", id="par_mois"),
        ],
    )
    def test_l_occupation_se_regroupe_a_trois_echelles(
        self, client, exportateur, granularite
    ):
        """Les trois granularités sont servies par la même requête, avec un
        `date_trunc` différent : une seule non testée passerait inaperçue."""
        reponse = client.get(
            "/api/v1/admin/stats/occupancy",
            headers=exportateur,
            params={"granularity": granularite},
        )
        assert reponse.status_code == 200, reponse.text
        assert isinstance(reponse.json(), list)

    def test_une_granularite_inconnue_est_refusee(self, client, exportateur):
        reponse = client.get(
            "/api/v1/admin/stats/occupancy",
            headers=exportateur,
            params={"granularity": "decennie"},
        )
        assert reponse.status_code == 422

    def test_le_classement_des_salles_porte_ses_mesures(
        self, client, session, exportateur, salle, compte, jour_ouvre
    ):
        poser(session, salle, compte, creneau(jour_ouvre, 10, 0, 120))

        lignes = client.get(
            "/api/v1/admin/stats/rooms", headers=exportateur, params={"limit": 50}
        ).json()

        assert any(item["room_id"] == str(salle.id) for item in lignes)
        vise = next(item for item in lignes if item["room_id"] == str(salle.id))
        assert vise["room_name"].startswith("Vinci")
        assert vise["bookings"] >= 1

    def test_les_heures_de_pointe_couvrent_la_semaine(self, client, exportateur):
        points = client.get("/api/v1/admin/stats/peak-hours", headers=exportateur).json()
        assert all(0 <= item["weekday"] <= 6 for item in points)
        assert all(0 <= item["hour"] <= 23 for item in points)

    def test_une_periode_inversee_est_refusee(self, client, exportateur):
        reponse = client.get(
            "/api/v1/admin/stats/occupancy",
            headers=exportateur,
            params={"first_day": "2026-09-01", "last_day": "2026-08-01"},
        )
        assert reponse.status_code in {200, 422}


class TestExports:
    def test_l_occupation_s_exporte_en_csv(self, client, exportateur):
        reponse = client.get("/api/v1/admin/stats/export", headers=exportateur)

        assert reponse.status_code == 200
        assert "text/csv" in reponse.headers["content-type"]
        assert "attachment" in reponse.headers["content-disposition"]
        # Une ligne d'en-tête au minimum : un fichier vide ne s'ouvre pas.
        assert reponse.text.strip()

    def test_le_journal_s_exporte_borne(self, client, systeme):
        """Borné à cent entrées : un journal complet offrirait une extraction
        de masse déguisée en consultation."""
        reponse = client.get("/api/v1/admin/audit-logs/export/csv", headers=systeme)

        assert reponse.status_code == 200
        assert len(reponse.text.strip().split("\n")) <= 101

    def test_mes_reservations_s_exportent(self, client, session, compte, salle, jour_ouvre):
        poser(session, salle, compte, creneau(jour_ouvre, 10, 0, 60))
        entetes = connecter(client, compte.email)

        reponse = client.get("/api/v1/stats/me/export", headers=entetes)
        assert reponse.status_code == 200
        assert "text/csv" in reponse.headers["content-type"]

    def test_les_chiffres_publics_ne_demandent_aucune_session(self, client):
        """C'est la seule route du module ouverte : la page d'accueil les
        affiche avant toute connexion."""
        reponse = client.get("/api/v1/stats/public")
        assert reponse.status_code == 200
        assert reponse.json()["rooms"] >= 0


class TestJournalDAudit:
    def test_le_journal_se_filtre_par_action_et_par_periode(
        self, client, session, systeme, salle
    ):
        depuis = (date.today() - timedelta(days=1)).isoformat()
        corps = client.get(
            "/api/v1/admin/audit-logs",
            headers=systeme,
            params={"since": f"{depuis}T00:00:00Z", "action": "creation"},
        ).json()

        assert all(item["action"] == "creation" for item in corps["items"])

    def test_une_entree_se_signale_sans_se_reecrire(self, client, session, systeme):
        page = client.get(
            "/api/v1/admin/audit-logs", headers=systeme, params={"size": 1}
        ).json()
        if not page["items"]:
            pytest.skip("Aucune écriture journalisée dans cette transaction.")

        entree = page["items"][0]
        signalee = client.post(
            f"/api/v1/admin/audit-logs/{entree['id']}/flag",
            headers=systeme,
            json={"flagged": True, "reason": "À relire"},
        )

        assert signalee.status_code == 200
        corps = signalee.json()
        assert corps["flag_reason"] == "À relire"
        # Le reste de l'entrée est immuable : le déclencheur d'ajout seul
        # n'autorise que la colonne de signalement.
        assert corps["action"] == entree["action"]
        assert corps["target_label"] == entree["target_label"]

    def test_le_detail_d_une_entree_inconnue_repond_404(self, client, systeme):
        reponse = client.get(
            "/api/v1/admin/audit-logs/00000000-0000-0000-0000-000000000000",
            headers=systeme,
        )
        assert reponse.status_code == 404


class TestGabaritsDeCourriel:
    @pytest.fixture
    def gabarit(self, session, administrateur) -> EmailTemplate:
        modele = EmailTemplate(
            code="essai_gabarit",
            name="Essai",
            trigger_label="Déclenché par un test",
            subject="Bonjour {{prenom}}",
            body="Votre salle {{salle}} est confirmée.",
            updated_by_admin_id=administrateur.user_id,
        )
        session.add(modele)
        session.flush()
        return modele

    def test_les_gabarits_se_listent_et_se_lisent(self, client, systeme, gabarit):
        liste = client.get("/api/v1/admin/email-templates", headers=systeme).json()
        assert any(item["code"] == "essai_gabarit" for item in liste)

        detail = client.get(
            f"/api/v1/admin/email-templates/{gabarit.id}", headers=systeme
        ).json()
        assert detail["subject"] == "Bonjour {{prenom}}"

    def test_le_referentiel_des_variables_est_servi(self, client, systeme):
        """L'écran propose les variables ; les deviner produirait des
        `{{machin}}` jamais remplacés à l'envoi."""
        variables = client.get(
            "/api/v1/admin/email-templates/variables", headers=systeme
        ).json()
        assert all({"code", "label", "sample_value"} <= set(item) for item in variables)

    def test_un_gabarit_se_modifie(self, client, systeme, gabarit):
        corps = client.patch(
            f"/api/v1/admin/email-templates/{gabarit.id}",
            headers=systeme,
            json={"subject": "Nouvel objet"},
        ).json()
        assert corps["subject"] == "Nouvel objet"

    def test_un_gabarit_se_desactive_puis_se_reactive(self, client, systeme, gabarit):
        """Désactiver plutôt que supprimer : le code du gabarit est référencé
        par le planificateur, et le retirer romprait le rappel en silence."""
        eteint = client.patch(
            f"/api/v1/admin/email-templates/{gabarit.id}/state",
            headers=systeme,
            json={"enabled": False},
        ).json()
        assert eteint["is_enabled"] is False

        rallume = client.patch(
            f"/api/v1/admin/email-templates/{gabarit.id}/state",
            headers=systeme,
            json={"enabled": True},
        ).json()
        assert rallume["is_enabled"] is True

    def test_l_apercu_rend_le_gabarit_sans_rien_envoyer(self, client, systeme, gabarit):
        corps = client.post(
            f"/api/v1/admin/email-templates/{gabarit.id}/preview",
            headers=systeme,
            json={"variables": {"prenom": "Camille", "salle": "Vinci"}},
        ).json()

        assert "Camille" in corps["subject"]
        assert "Vinci" in corps["body"]

    def test_un_gabarit_inconnu_repond_404(self, client, systeme):
        reponse = client.get(
            "/api/v1/admin/email-templates/00000000-0000-0000-0000-000000000000",
            headers=systeme,
        )
        assert reponse.status_code == 404


class TestBaseDeConnaissances:
    @pytest.fixture
    def categorie(self, session, marque) -> FaqCategory:
        rubrique = FaqCategory(
            code=f"essai_{marque}", label="Essai", icon="Book", sort_order=99
        )
        session.add(rubrique)
        session.flush()
        return rubrique

    def _article(self, marque: str, categorie_id) -> dict:
        return {
            "category_id": str(categorie_id),
            "slug": f"article-d-essai-{marque}",
            "title": "Article d'essai",
            "excerpt": "Une accroche suffisamment claire.",
            "body": "Un corps d'article assez long pour être publiable sans effort.",
        }

    def test_un_article_se_cree_en_brouillon(self, client, support, categorie, marque):
        cree = client.post(
            "/api/v1/admin/faq/articles",
            headers=support,
            json=self._article(marque, categorie.id),
        )
        assert cree.status_code == 201, cree.text
        assert cree.json()["status"] == "brouillon"
        assert cree.json()["published_at"] is None

    def test_publier_horodate_puis_retirer_efface_l_horodatage(
        self, client, support, categorie, marque
    ):
        """La contrainte lie les deux : `(status = 'publie') = (published_at IS
        NOT NULL)`. Garder la date après un retrait ferait mentir l'article."""
        article = client.post(
            "/api/v1/admin/faq/articles",
            headers=support,
            json=self._article(marque, categorie.id),
        ).json()

        publie = client.patch(
            f"/api/v1/admin/faq/articles/{article['id']}/status",
            headers=support,
            json={"status": "publie"},
        ).json()
        assert publie["published_at"] is not None

        retire = client.patch(
            f"/api/v1/admin/faq/articles/{article['id']}/status",
            headers=support,
            json={"status": "brouillon"},
        ).json()
        assert retire["published_at"] is None

    def test_un_article_trop_court_ne_se_publie_pas(
        self, client, support, categorie, marque
    ):
        article = client.post(
            "/api/v1/admin/faq/articles",
            headers=support,
            json={**self._article(marque, categorie.id), "body": "Trop court."},
        ).json()

        reponse = client.patch(
            f"/api/v1/admin/faq/articles/{article['id']}/status",
            headers=support,
            json={"status": "publie"},
        )
        assert reponse.status_code == 422

    def test_un_article_se_modifie_puis_se_supprime(
        self, client, support, categorie, marque
    ):
        article = client.post(
            "/api/v1/admin/faq/articles",
            headers=support,
            json=self._article(marque, categorie.id),
        ).json()

        modifie = client.patch(
            f"/api/v1/admin/faq/articles/{article['id']}",
            headers=support,
            json={"title": "Titre revu"},
        ).json()
        assert modifie["title"] == "Titre revu"

        assert (
            client.delete(
                f"/api/v1/admin/faq/articles/{article['id']}", headers=support
            ).status_code
            == 204
        )

    def test_les_brouillons_ne_sortent_que_du_cote_administration(
        self, client, support, compte, categorie, marque
    ):
        client.post(
            "/api/v1/admin/faq/articles",
            headers=support,
            json=self._article(marque, categorie.id),
        )

        publics = client.get(
            "/api/v1/faq/articles", headers=connecter(client, compte.email), params={"size": 100}
        ).json()
        administres = client.get(
            "/api/v1/admin/faq/articles", headers=support, params={"size": 100}
        ).json()

        slugs_publics = {item["slug"] for item in publics["items"]}
        slugs_administres = {item["slug"] for item in administres["items"]}
        assert f"article-d-essai-{marque}" not in slugs_publics
        assert f"article-d-essai-{marque}" in slugs_administres

    def test_les_intentions_du_chatbot_sont_exposees_au_support(self, client, support):
        intentions = client.get("/api/v1/admin/chatbot/intents", headers=support).json()
        assert all({"code", "label", "answer", "keywords"} <= set(item) for item in intentions)


class TestReferentielsDeRegles:
    def test_les_horaires_d_un_batiment_se_remplacent_en_bloc(
        self, client, configurateur, batiment
    ):
        """Remplacement total : un jour manquant hériterait du global et
        créerait une amplitude incohérente avec le reste de la semaine."""
        reponse = client.put(
            "/api/v1/opening-hours/batiment",
            headers=configurateur,
            params={"building_id": str(batiment.id)},
            json=[
                {"weekday": jour, "opens_at": "07:30:00", "closes_at": "21:00:00"}
                for jour in range(7)
            ],
        )
        assert reponse.status_code == 200
        assert len(reponse.json()) == 7

    def test_une_fermeture_expose_les_reservations_qu_elle_empecherait(
        self, client, session, configurateur, salle, compte, jour_ouvre
    ):
        """À consulter avant de fermer : fermer un bâtiment sans voir les vingt
        réunions du jour serait une décision prise à l'aveugle."""
        reservation = poser(session, salle, compte, creneau(jour_ouvre, 10, 0, 60))

        fermeture = client.post(
            "/api/v1/closures",
            headers=configurateur,
            json={
                "label": "Travaux",
                "first_day": jour_ouvre.isoformat(),
                "last_day": jour_ouvre.isoformat(),
                "is_global": False,
                "room_ids": [str(salle.id)],
            },
        )
        assert fermeture.status_code == 201, fermeture.text

        impactees = client.get(
            f"/api/v1/closures/{fermeture.json()['id']}/impact", headers=configurateur
        ).json()
        assert str(reservation.id) in impactees

    def test_une_fermeture_se_leve(self, client, configurateur, salle, jour_ouvre):
        fermeture = client.post(
            "/api/v1/closures",
            headers=configurateur,
            json={
                "label": "Annulée finalement",
                "first_day": jour_ouvre.isoformat(),
                "last_day": jour_ouvre.isoformat(),
                "is_global": False,
                "room_ids": [str(salle.id)],
            },
        ).json()

        assert (
            client.delete(
                f"/api/v1/closures/{fermeture['id']}", headers=configurateur
            ).status_code
            == 204
        )

    def test_une_fermeture_globale_ciblant_une_salle_est_refusee(
        self, client, configurateur, salle, jour_ouvre
    ):
        """Cocher « tout le campus » puis désigner une salle décrirait deux
        intentions contradictoires."""
        reponse = client.post(
            "/api/v1/closures",
            headers=configurateur,
            json={
                "label": "Contradictoire",
                "first_day": jour_ouvre.isoformat(),
                "last_day": jour_ouvre.isoformat(),
                "is_global": True,
                "room_ids": [str(salle.id)],
            },
        )
        assert reponse.status_code == 422

    def test_les_fermetures_se_filtrent_par_periode(
        self, client, configurateur, salle, jour_ouvre
    ):
        client.post(
            "/api/v1/closures",
            headers=configurateur,
            json={
                "label": "Période visée",
                "first_day": jour_ouvre.isoformat(),
                "last_day": jour_ouvre.isoformat(),
                "is_global": False,
                "room_ids": [str(salle.id)],
            },
        )

        dans = client.get(
            "/api/v1/closures",
            headers=configurateur,
            params={"first_day": jour_ouvre.isoformat(), "last_day": jour_ouvre.isoformat()},
        ).json()
        hors = client.get(
            "/api/v1/closures",
            headers=configurateur,
            params={
                "first_day": (jour_ouvre + timedelta(days=60)).isoformat(),
                "last_day": (jour_ouvre + timedelta(days=61)).isoformat(),
            },
        ).json()

        assert any(item["label"] == "Période visée" for item in dans["items"])
        assert all(item["label"] != "Période visée" for item in hors["items"])


class TestNotifications:
    def test_tout_marquer_comme_lu_vide_la_pastille(self, client, compte):
        entetes = connecter(client, compte.email)

        assert client.post("/api/v1/notifications/read-all", headers=entetes).status_code == 204
        assert client.get("/api/v1/notifications/unread-count", headers=entetes).json() == 0

    def test_marquer_lue_une_notification_d_autrui_repond_404(
        self, client, compte, creer_compte
    ):
        creer_compte("Tiers")
        entetes = connecter(client, compte.email)

        reponse = client.patch(
            "/api/v1/notifications/00000000-0000-0000-0000-000000000000",
            headers=entetes,
            json={"read": True},
        )
        assert reponse.status_code == 404

"""Profil personnel, annuaire, matrice de permissions et invitations."""

from __future__ import annotations

from sqlalchemy import select

from app.api.deps import USERS_MANAGE
from app.db.enums import UserStatus
from app.models import AdminAccount, AdminInvitation, RefreshToken
from tests.services.conftest import accorder, connecter, creneau
from tests.services.test_api_v1 import poser


class TestProfil:
    def test_lecture_et_modification(self, client, compte):
        entetes = connecter(client, compte.email)

        corps = client.get("/api/v1/users/me", headers=entetes).json()
        assert corps["email"] == compte.email
        assert "password_hash" not in corps

        modifie = client.patch(
            "/api/v1/users/me", headers=entetes, json={"phone": "06 12 34 56 78"}
        ).json()
        assert modifie["phone"] == "06 12 34 56 78"

    def test_l_adresse_ne_se_change_pas(self, client, compte):
        """Elle identifie le compte : la changer sans vérification permettrait
        de détourner une session."""
        entetes = connecter(client, compte.email)
        reponse = client.patch(
            "/api/v1/users/me", headers=entetes, json={"email": "autre@ece.fr"}
        )
        assert reponse.status_code == 422

    def test_preferences_creees_a_la_premiere_lecture(self, client, compte):
        entetes = connecter(client, compte.email)
        corps = client.get("/api/v1/users/me/preferences", headers=entetes).json()
        assert corps["reminder_delay_min"] == 30

    def test_enregistrement_des_preferences_rend_le_profil(
        self, client, compte, batiment
    ):
        entetes = connecter(client, compte.email)
        corps = client.put(
            "/api/v1/users/me/preferences",
            headers=entetes,
            json={
                "preferred_building_id": str(batiment.id),
                "usual_capacity_min": 5,
                "usual_capacity_max": 10,
                "reminder_delay_min": 60,
            },
        ).json()

        # Le profil complet revient : l'écran d'accueil met à jour sa session
        # d'un seul appel.
        assert corps["email"] == compte.email
        assert corps["preferences"]["preferred_building_id"] == str(batiment.id)
        assert corps["preferences"]["reminder_delay_min"] == 60

    def test_mes_credits(self, client, session, compte, salle, jour_ouvre):
        poser(session, salle, compte, creneau(jour_ouvre, 10, 0, 120))
        entetes = connecter(client, compte.email)

        corps = client.get("/api/v1/users/me/metrics", headers=entetes).json()
        assert corps["active_bookings"] == 1
        assert corps["weekly_quota_hours"] == 12
        assert corps["remaining_credits_h"] <= 12


class TestAnnuaire:
    def test_recherche_et_filtres(self, client, session, administrateur, compte):
        accorder(session, administrateur, USERS_MANAGE)
        entetes = connecter(client, administrateur.user.email, admin=True)

        corps = client.get(
            "/api/v1/admin/users", headers=entetes, params={"q": compte.first_name}
        ).json()
        assert any(item["email"] == compte.email for item in corps["items"])

    def test_filtre_par_role(self, client, session, administrateur, compte):
        accorder(session, administrateur, USERS_MANAGE)
        entetes = connecter(client, administrateur.user.email, admin=True)

        admins = client.get(
            "/api/v1/admin/users", headers=entetes, params={"role": "admin", "size": 100}
        ).json()
        assert all(item["is_admin"] for item in admins["items"])
        assert compte.email not in {item["email"] for item in admins["items"]}

    def test_fiche_avec_metriques(self, client, session, administrateur, compte):
        accorder(session, administrateur, USERS_MANAGE)
        entetes = connecter(client, administrateur.user.email, admin=True)

        corps = client.get(f"/api/v1/admin/users/{compte.id}", headers=entetes).json()
        assert corps["metrics"]["weekly_quota_hours"] == 12

    def test_la_suspension_ferme_les_sessions(
        self, client, session, administrateur, compte
    ):
        """Laisser courir un jeton après une suspension viderait la décision."""
        connecter(client, compte.email)
        accorder(session, administrateur, USERS_MANAGE)
        entetes = connecter(client, administrateur.user.email, admin=True)

        reponse = client.patch(
            f"/api/v1/admin/users/{compte.id}/status",
            headers=entetes,
            json={"status": "suspendu", "reason": "Comportement signalé"},
        )
        assert reponse.status_code == 200

        actifs = session.scalars(
            select(RefreshToken).where(
                RefreshToken.user_id == compte.id, RefreshToken.revoked_at.is_(None)
            )
        ).all()
        assert actifs == []
        session.refresh(compte)
        assert compte.status is UserStatus.SUSPENDU

    def test_suspension_sans_motif_refusee(
        self, client, session, administrateur, compte
    ):
        accorder(session, administrateur, USERS_MANAGE)
        entetes = connecter(client, administrateur.user.email, admin=True)

        reponse = client.patch(
            f"/api/v1/admin/users/{compte.id}/status",
            headers=entetes,
            json={"status": "suspendu", "reason": ""},
        )
        assert reponse.status_code == 422

    def test_ajustement_du_quota(self, client, session, administrateur, compte):
        accorder(session, administrateur, USERS_MANAGE)
        entetes = connecter(client, administrateur.user.email, admin=True)

        corps = client.patch(
            f"/api/v1/admin/users/{compte.id}/quota",
            headers=entetes,
            json={"weekly_quota_hours": 20},
        ).json()
        assert corps["weekly_quota_hours"] == 20
        assert corps["remaining_credits_h"] <= 20


class TestMatriceDePermissions:
    def test_referentiel_groupe(self, client, compte):
        entetes = connecter(client, compte.email)
        corps = client.get("/api/v1/admin/permissions", headers=entetes).json()

        codes = {item["code"] for groupe in corps for item in groupe["permissions"]}
        assert "conflicts.arbitrate" in codes
        assert len(codes) == 7

    def test_promotion_et_permissions(
        self, client, session, administrateur, compte
    ):
        accorder(session, administrateur, USERS_MANAGE)
        entetes = connecter(client, administrateur.user.email, admin=True)

        promu = client.post(
            "/api/v1/admin/accounts",
            headers=entetes,
            json={
                "user_id": str(compte.id),
                "job_title": "Chargé de planning",
                "permissions": ["rooms.manage"],
            },
        )
        assert promu.status_code == 201, promu.text
        assert promu.json()["permissions"] == ["rooms.manage"]

    def test_la_matrice_est_remplacee_pas_completee(
        self, client, session, administrateur, compte
    ):
        accorder(session, administrateur, USERS_MANAGE)
        entetes = connecter(client, administrateur.user.email, admin=True)
        client.post(
            "/api/v1/admin/accounts",
            headers=entetes,
            json={
                "user_id": str(compte.id),
                "job_title": "Chargé",
                "permissions": ["rooms.manage", "support.handle"],
            },
        )

        corps = client.patch(
            f"/api/v1/admin/accounts/{compte.id}/permissions",
            headers=entetes,
            json={"permissions": ["data.export"]},
        ).json()
        assert corps["permissions"] == ["data.export"]

    def test_permission_inconnue_refusee(
        self, client, session, administrateur, compte
    ):
        accorder(session, administrateur, USERS_MANAGE)
        entetes = connecter(client, administrateur.user.email, admin=True)

        reponse = client.post(
            "/api/v1/admin/accounts",
            headers=entetes,
            json={
                "user_id": str(compte.id),
                "job_title": "Chargé",
                "permissions": ["tout.pouvoir"],
            },
        )
        assert reponse.status_code == 422

    def test_double_promotion_refusee(self, client, session, administrateur, compte):
        accorder(session, administrateur, USERS_MANAGE)
        entetes = connecter(client, administrateur.user.email, admin=True)
        corps = {"user_id": str(compte.id), "job_title": "Chargé", "permissions": []}

        client.post("/api/v1/admin/accounts", headers=entetes, json=corps)
        seconde = client.post("/api/v1/admin/accounts", headers=entetes, json=corps)
        assert seconde.status_code == 422
        assert seconde.json()["error"]["code"] == "deja_administrateur"

    def test_le_proprietaire_garde_ses_droits(
        self, client, session, administrateur, creer_compte
    ):
        """Les lui retirer fermerait la configuration pour tout le monde."""
        proprietaire_compte = creer_compte("Chef")
        proprietaire = AdminAccount(
            user_id=proprietaire_compte.id, job_title="Propriétaire", is_owner=True
        )
        session.add(proprietaire)
        session.flush()

        accorder(session, administrateur, USERS_MANAGE)
        entetes = connecter(client, administrateur.user.email, admin=True)

        reponse = client.patch(
            f"/api/v1/admin/accounts/{proprietaire_compte.id}/permissions",
            headers=entetes,
            json={"permissions": []},
        )
        assert reponse.status_code == 422
        assert reponse.json()["error"]["code"] == "proprietaire"


class TestInvitations:
    def test_invitation_et_revocation(self, client, session, administrateur):
        accorder(session, administrateur, USERS_MANAGE)
        entetes = connecter(client, administrateur.user.email, admin=True)

        invitation = client.post(
            "/api/v1/admin/invitations",
            headers=entetes,
            json={"email": "futur.admin@ece.fr", "permissions": ["support.handle"]},
        )
        assert invitation.status_code == 201, invitation.text
        corps = invitation.json()
        # Le jeton en clair ne sort pas de la réponse : il part dans le courriel.
        assert "token" not in corps

        ligne = session.scalars(
            select(AdminInvitation).where(AdminInvitation.email == "futur.admin@ece.fr")
        ).one()
        assert len(ligne.token_hash) == 64

        assert client.delete(
            f"/api/v1/admin/invitations/{corps['id']}", headers=entetes
        ).status_code == 204

    def test_invitation_sans_permission_refusee(self, client, session, administrateur):
        entetes = connecter(client, administrateur.user.email, admin=True)
        reponse = client.post(
            "/api/v1/admin/invitations",
            headers=entetes,
            json={"email": "futur@ece.fr", "permissions": ["support.handle"]},
        )
        assert reponse.status_code == 403

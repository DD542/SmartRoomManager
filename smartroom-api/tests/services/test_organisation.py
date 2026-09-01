"""Appartenance d'une adresse à l'établissement.

La règle a d'abord été écrite sur un seul des deux schémas qui exposent les
comptes. L'écran de connexion recevait donc la réponse, l'annuaire de
l'administration ne la recevait pas — et l'étiquette « Hors organisation » ne
s'affichait nulle part.

Aucune erreur n'a été produite : un champ absent d'une réponse JSON est
simplement absent, et le front lisait `undefined`. C'est pourquoi ces tests
interrogent **les deux** schémas, et la route elle-même.
"""

from __future__ import annotations

import pytest

from app.api.v1.schemas.comptes import UserOut
from app.domain.organisation import est_externe
from app.schemas.comptes import UserRead


class TestRegle:
    def test_une_adresse_de_l_ecole_est_interne(self):
        assert est_externe("alice.leroy@edu.ece.fr") is False
        assert est_externe("marie.laurent@ece.fr") is False

    def test_une_adresse_personnelle_est_externe(self):
        assert est_externe("dylanmenga05@gmail.com") is True

    def test_la_casse_du_domaine_ne_change_rien(self):
        assert est_externe("Alice.Leroy@EDU.ECE.FR") is False

    def test_sans_liste_configuree_personne_n_est_externe(self, monkeypatch):
        """Mieux vaut ne rien signaler que signaler tout le monde : une
        étiquette portée par chaque ligne ne distingue plus rien."""
        from app.core.config import get_settings

        monkeypatch.setattr(get_settings(), "organisation_domains", "")

        assert est_externe("qui.que.ce.soit@gmail.com") is False


@pytest.fixture
def champs():
    from datetime import UTC, datetime
    import uuid

    return dict(
        id=uuid.uuid4(),
        first_name="Max",
        last_name="Float",
        phone=None,
        promotion=None,
        department=None,
        badge_number=None,
        status="actif",
        last_login_at=None,
    )


class TestLesDeuxSchemas:
    """L'annuaire et l'authentification servent deux schémas distincts.

    Les deux doivent porter la réponse : l'étiquette s'affiche dans l'écran
    des utilisateurs, qui lit le premier.
    """

    def test_le_schema_de_l_annuaire_la_porte(self, champs):
        interne = UserOut(email="alice.leroy@edu.ece.fr", **champs)
        externe = UserOut(email="max@gmail.com", **champs)

        assert interne.is_external is False
        assert externe.is_external is True

    def test_le_schema_de_l_authentification_aussi(self, champs):
        from datetime import UTC, datetime

        horodatage = {"created_at": datetime.now(UTC), "updated_at": datetime.now(UTC)}
        interne = UserRead(email="alice.leroy@edu.ece.fr", **champs, **horodatage)
        externe = UserRead(email="max@gmail.com", **champs, **horodatage)

        assert interne.is_external is False
        assert externe.is_external is True

    def test_le_champ_part_bien_dans_la_reponse(self, champs):
        # Le défaut ne se voyait qu'ici : la propriété existait sur l'objet,
        # mais `computed_field` manquait — elle ne sortait donc pas en JSON.
        assert "is_external" in UserOut(email="max@gmail.com", **champs).model_dump()


class TestRoute:
    def test_l_annuaire_rend_le_drapeau(self, client, session, administrateur, creer_compte):
        from app.api.deps import USERS_MANAGE
        from tests.services.conftest import accorder, connecter

        externe = creer_compte("Externe")
        externe.email = "intervenant@gmail.com"
        session.flush()

        accorder(session, administrateur, USERS_MANAGE)
        entetes = connecter(client, administrateur.user.email, admin=True)

        # L'annuaire de l'administration, celui que lit l'écran des
        # utilisateurs. Il rend `UserDetailOut`, qui hérite de `UserOut` :
        # la règle posée sur le parent le suit.
        reponse = client.get("/api/v1/admin/users", headers=entetes, params={"size": 100})
        assert reponse.status_code == 200, reponse.text

        lignes = {item["email"]: item for item in reponse.json()["items"]}
        assert lignes["intervenant@gmail.com"]["is_external"] is True

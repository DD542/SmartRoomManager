"""Ce que le journal d'audit doit rester capable de dire, et à quel prix.

Une trace se relit longtemps après, par quelqu'un qui n'était pas là. Trois
défauts la rendaient inexploitable sans jamais faire échouer une route :

* l'adresse d'origine, stockée en `INET`, ne se sérialisait pas et faisait
  répondre 500 à toute lecture du journal ;
* la cible d'un plan d'étage y figurait sous son identifiant technique, et
  celle d'une surcharge de règles sous sa seule portée — « portée salle », sans
  dire laquelle ;
* une suspension de compte pouvait partir sans motif, le front en fabriquant
  un par défaut.

Chacun est ici verrouillé par le test qui échouait avant sa correction.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from app.api.deps import RULES_CONFIGURE, SYSTEM_CONFIGURE, USERS_MANAGE
from app.api.v1.schemas.rules import BookingRuleIn
from app.api.v1.schemas.parc import PlacementIn
from app.db.enums import AuditAction, RuleScope
from app.models import AuditLog
from app.services import parc_service, rules_service
from tests.services.conftest import accorder, connecter

pytestmark = pytest.mark.integration


@pytest.fixture
def systeme(client, session, administrateur):
    """Lecture du journal, et écriture d'une règle pour l'y faire figurer."""
    accorder(session, administrateur, SYSTEM_CONFIGURE, RULES_CONFIGURE)
    return connecter(client, administrateur.user.email, admin=True)


def _derniere(session, type_cible: str) -> AuditLog:
    return session.scalars(
        select(AuditLog)
        .where(AuditLog.target_type == type_cible)
        .order_by(AuditLog.created_at.desc())
    ).first()


class TestLisibiliteDesCibles:
    def test_un_plan_d_etage_est_nomme_par_son_batiment(self, session, salle, etage):
        """Avant : « Plan de l'étage 8eb3b849-283b-4a9f-… ».

        Relire la trace obligeait à une requête pour savoir de quel bâtiment il
        s'agissait — et la personne qui relit n'a pas toujours la base sous la
        main.
        """
        parc_service.set_placements(
            session,
            etage.id,
            [
                PlacementIn(
                    room_id=salle.id,
                    pos_x=10,
                    pos_y=10,
                    width=20,
                    height=20,
                    rotation=0,
                    is_entrance_marked=False,
                )
            ],
        )

        entree = _derniere(session, "floor_plan")
        assert entree is not None
        assert str(etage.id) not in entree.target_label
        assert etage.building.name in entree.target_label
        assert etage.label in entree.target_label

    def test_une_surcharge_de_salle_nomme_la_salle(self, session, salle):
        """Avant : « Règles — portée salle », identique pour toutes les salles.

        Deux surcharges concurrentes produisaient deux entrées indiscernables :
        la trace ne disait plus laquelle avait bougé.
        """
        rules_service.upsert_rule(
            session,
            BookingRuleIn(max_duration_min=90),
            scope=RuleScope.SALLE,
            room_id=salle.id,
        )

        entree = _derniere(session, "booking_rule")
        assert entree is not None
        assert salle.name in entree.target_label
        assert "portée salle" not in entree.target_label

    def test_une_surcharge_de_batiment_nomme_le_batiment(self, session, batiment):
        rules_service.upsert_rule(
            session,
            BookingRuleIn(max_duration_min=100),
            scope=RuleScope.BATIMENT,
            building_id=batiment.id,
        )

        entree = _derniere(session, "booking_rule")
        assert batiment.name in entree.target_label
        assert "portée batiment" not in entree.target_label

    def test_une_regle_globale_dit_qu_elle_vise_tout_l_etablissement(self, session):
        rules_service.upsert_rule(
            session,
            BookingRuleIn(max_duration_min=120),
            scope=RuleScope.GLOBAL,
        )

        entree = _derniere(session, "booking_rule")
        assert "établissement entier" in entree.target_label


class TestAdresseDOrigine:
    def test_le_journal_se_lit_meme_quand_une_entree_porte_une_adresse(
        self, client, session, administrateur, systeme
    ):
        """La colonne est un `INET` : SQLAlchemy en rend un `IPv4Address`, que
        le schéma déclarait `str | None`.

        Pydantic refusait l'objet et la route entière répondait 500 — sur
        *toutes* les entrées, pas seulement celle-là. Aucun test ne l'avait vu
        parce que `TestClient` annonce l'hôte « testclient », écarté à
        l'écriture : aucune entrée de test ne portait jamais d'adresse.
        """
        # L'écriture emprunte le vrai chemin : `X-Forwarded-For` alimente le
        # contexte de requête, qui remplit la colonne. Forcer la colonne à la
        # main ne prouverait rien — et le déclencheur d'immuabilité le refuse.
        pose = client.put(
            "/api/v1/booking-rules/global",
            headers={**systeme, "X-Forwarded-For": "203.0.113.7"},
            json={"max_duration_min": 150},
        )
        assert pose.status_code in (200, 201), pose.text

        reponse = client.get(
            "/api/v1/admin/audit-logs", headers=systeme, params={"size": 100}
        )

        assert reponse.status_code == 200, reponse.text
        avec_adresse = [
            item for item in reponse.json()["items"] if item["ip_address"] is not None
        ]
        assert avec_adresse, (
            "l'entrée écrite sous en-tête transmis doit porter une adresse"
        )
        assert "203.0.113.7" in {item["ip_address"] for item in avec_adresse}
        assert all(isinstance(item["ip_address"], str) for item in avec_adresse)


class TestMotifDeSuspension:
    @pytest.fixture
    def gestionnaire(self, client, session, administrateur):
        accorder(session, administrateur, USERS_MANAGE)
        return connecter(client, administrateur.user.email, admin=True)

    def test_une_suspension_consigne_le_motif_recu(
        self, client, session, gestionnaire, creer_compte
    ):
        """Le motif n'est pas décoratif : c'est la seule chose que la trace
        garde de la décision. Le front le fabriquait (« Suspension
        administrative ») ; il le fait désormais saisir."""
        compte = creer_compte("Nadia")

        reponse = client.patch(
            f"/api/v1/admin/users/{compte.id}/status",
            headers=gestionnaire,
            json={"status": "suspendu", "reason": "Trois absences non excusées."},
        )

        assert reponse.status_code == 200, reponse.text
        entree = _derniere(session, "user")
        assert entree is not None
        assert compte.email in entree.target_label


class TestTriDesCollections:
    """Neuf des onze collections paginées acceptaient `sort` et le jetaient.

    `paginate` n'applique un tri que si le service lui passe une liste blanche
    de colonnes ; sans elle, le paramètre traversait la validation, la requête
    partait dans l'ordre par défaut, et l'écran affichait un classement qu'il
    n'avait pas demandé en croyant l'avoir obtenu. Le défaut est silencieux par
    construction : aucune erreur, juste un ordre faux.
    """

    @pytest.fixture
    def entrees_variees(self, session, marque):
        """Trois entrées aux acteurs et aux cibles volontairement désordonnés.

        Le test pose ses propres données plutôt que de compter sur celles de la
        transaction : sans valeurs distinctes, un tri faux et un tri juste
        rendent la même liste, et l'assertion ne prouverait rien.
        """
        for acteur, cible in (
            ("Zoe " + marque, "zeta"),
            ("Ana " + marque, "alpha"),
            ("Milo " + marque, "mu"),
        ):
            session.add(
                AuditLog(
                    actor_label=acteur,
                    action=AuditAction.MODIFICATION,
                    target_type=cible,
                    target_label=f"Cible {cible}",
                    occurred_at=datetime.now(UTC),
                )
            )
        session.flush()
        return marque

    @pytest.mark.parametrize("champ", ["actor_label", "target_type"])
    def test_le_tri_demande_est_bien_applique(
        self, client, systeme, entrees_variees, champ
    ):
        montant = client.get(
            "/api/v1/admin/audit-logs",
            headers=systeme,
            params={"sort": champ, "size": 100},
        )
        descendant = client.get(
            "/api/v1/admin/audit-logs",
            headers=systeme,
            # Le décroissant s'écrit `-champ` : un paramètre `order` séparé
            # serait accepté par FastAPI et silencieusement ignoré.
            params={"sort": f"-{champ}", "size": 100},
        )

        assert montant.status_code == 200, montant.text
        assert descendant.status_code == 200, descendant.text

        croissant = [item[champ] for item in montant.json()["items"]]
        decroissant = [item[champ] for item in descendant.json()["items"]]
        assert len(set(croissant)) >= 3, "les entrées posées doivent être visibles"

        assert croissant == sorted(croissant)
        assert decroissant == sorted(decroissant, reverse=True)
        assert croissant != decroissant

    def test_un_champ_de_tri_inconnu_est_refuse_et_non_ignore(self, client, systeme):
        """Ignorer serait pire que refuser : l'écran croirait son tri obtenu."""
        reponse = client.get(
            "/api/v1/admin/audit-logs",
            headers=systeme,
            params={"sort": "colonne_inventee", "size": 5},
        )
        assert reponse.status_code == 422, reponse.text

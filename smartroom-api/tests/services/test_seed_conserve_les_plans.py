"""Un plan d'étage déposé survit à `seed --reset`.

Le seed relevait déjà les photos de bâtiment et les plans de localisation de
salle, après les avoir perdus deux fois. Sa docstring le dit : « un jeu de
démonstration a le droit de refaire ses données ; il n'a pas celui d'effacer ce
qu'on lui a confié. »

Les plans d'étage sont arrivés plus tard et ont été oubliés. Ils vivent dans
`floor_plans`, que la purge emporte en cascade avec les bâtiments. Les fichiers
survivent sous `MEDIA_ROOT` — on les retrouve orphelins dans `media/plans` —
mais la ligne qui disait à quel étage ils appartenaient disparaît, et l'écran
d'une salle affiche « Aucun plan déposé pour cet étage » sur un étage qui en
avait un.

Constaté sur la base de développement : trois fichiers dans `media/plans`, des
placements de salles journalisés à l'audit les 29 et 31 août — on ne place une
salle que sur un plan existant — et zéro ligne dans `floor_plans`.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.db.enums import PlanDocumentKind
from app.models import Floor, FloorPlan
from scripts.seed import relever_plans, rendre_plans

pytestmark = pytest.mark.integration


@pytest.fixture
def plan(session, etage: Floor) -> FloorPlan:
    document = FloorPlan(
        floor_id=etage.id,
        kind=PlanDocumentKind.IMAGE,
        file_url="/media/plans/depose-par-l-administration.png",
        file_name="depose-par-l-administration.png",
        file_size_bytes=5778,
    )
    session.add(document)
    session.flush()
    return document


class TestReleve:
    def test_le_plan_est_releve_sous_le_code_de_son_etage(self, session, etage, plan):
        """La clé survit à la purge, l'identifiant non.

        Les bâtiments et les étages sont recréés à l'identique par le seed,
        avec de nouveaux UUID. Seuls les codes — porteurs d'une contrainte
        d'unicité — permettent de reconnaître l'étage d'après.
        """
        releve = relever_plans(session)

        cle = f"{etage.building.code}:{etage.code}"
        assert cle in releve
        assert releve[cle]["file_name"] == "depose-par-l-administration.png"
        assert releve[cle]["file_size_bytes"] == 5778


class TestRepose:
    def test_le_plan_revient_sur_l_etage_homonyme(self, session, etage, plan):
        """Le cycle complet : relever, purger, reposer."""
        releve = relever_plans(session)

        session.delete(plan)
        session.flush()
        assert session.scalars(select(FloorPlan)).all() == []

        rendus = rendre_plans(session, releve)

        assert rendus == 1
        [repose] = session.scalars(select(FloorPlan)).all()
        assert repose.floor_id == etage.id
        assert repose.file_url == "/media/plans/depose-par-l-administration.png"
        assert repose.kind is PlanDocumentKind.IMAGE

    def test_un_releve_vide_ne_fait_rien(self, session):
        """Le cas courant : une base neuve, sans rien à préserver."""
        assert rendre_plans(session, {}) == 0

    def test_un_etage_disparu_n_empeche_pas_les_autres(self, session, etage, plan):
        """Un relevé peut désigner un étage que le nouveau parc n'a plus.

        Sans cette tolérance, supprimer un étage entre deux seeds ferait
        échouer le peuplement entier — pour un plan devenu sans objet.
        """
        releve = relever_plans(session)
        releve["INEXISTANT:ZZ"] = dict(releve[f"{etage.building.code}:{etage.code}"])

        session.delete(plan)
        session.flush()

        assert rendre_plans(session, releve) == 1

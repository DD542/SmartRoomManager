"""Fixtures de la couche d'assistance.

Aucun test n'appelle un modèle. Un test dont le résultat dépend de la présence
d'Ollama sur la machine ne prouverait rien : il passerait ici et échouerait en
intégration continue, ou l'inverse. Le fournisseur simulé joue une partition
écrite d'avance, et c'est cette partition qui rend les scénarios reproductibles.

Le régime d'isolation est celui de `tests/services` : une transaction par test,
annulée à la fin. Les fixtures de ce dossier s'y ajoutent sans le modifier.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator

import pytest
from sqlalchemy.orm import Session

from app.ai.agent.brouillons import MagasinBrouillons
from app.ai.providers import FournisseurSimule, SelecteurModeles
from app.ai.reglages import ReglagesIA
from app.ai.tools import ToolContext
from app.api.deps import Principal
from app.models import (
    ChatbotIntent,
    ChatbotIntentKeyword,
    FaqArticle,
    FaqCategory,
    User,
)

# Les fixtures d'intégration — session transactionnelle, client HTTP, parc de
# démonstration — vivent avec les tests de services. Elles sont importées plutôt
# que dupliquées : les deux campagnes éprouvent ainsi le même schéma et le même
# régime d'isolation.
#
# Importées et non déclarées par `pytest_plugins` : pytest refuse cette
# directive ailleurs que dans le conftest racine, et l'y mettre rendrait ces
# fixtures visibles des tests de domaine, qui n'ont pas besoin de base.
from tests.services.conftest import (  # noqa: E402, F401
    administrateur,
    batiment,
    client,
    compte,
    creer_compte,
    creer_salle,
    engine,
    etage,
    jour_ouvre,
    maintenant,
    marque,
    salle,
    session,
    video,
)

pytestmark = pytest.mark.integration


@pytest.fixture
def faux_modele() -> FournisseurSimule:
    """Fournisseur sans partition : chaque test écrit la sienne."""
    return FournisseurSimule([])


@pytest.fixture
def selecteur(faux_modele: FournisseurSimule) -> SelecteurModeles:
    choix = SelecteurModeles(ReglagesIA())
    choix.imposer(faux_modele)
    return choix


@pytest.fixture
def selecteur_muet() -> SelecteurModeles:
    """Aucun fournisseur : c'est ainsi qu'on éprouve le repli déterministe."""
    return SelecteurModeles(ReglagesIA(forcer_repli=True))


@pytest.fixture
def magasin() -> MagasinBrouillons:
    """Magasin isolé : deux tests ne doivent pas partager leurs brouillons."""
    return MagasinBrouillons()


@pytest.fixture
def principal(compte: User) -> Principal:  # noqa: F811
    return Principal(user=compte, scope="user")


@pytest.fixture
def contexte(session: Session, principal: Principal) -> ToolContext:  # noqa: F811
    return ToolContext(session=session, principal=principal)


@pytest.fixture
def intentions(session: Session, marque: str) -> list[ChatbotIntent]:  # noqa: F811
    """Intentions minimales du moteur de repli, avec leurs mots-clés."""
    creees: list[ChatbotIntent] = []
    jeux = [
        (
            "annuler",
            "Annuler",
            "Vous pouvez annuler depuis le détail.",
            ["annuler", "annulation", "supprimer"],
        ),
        (
            "salle_libre",
            "Trouver une salle",
            "J'ai cherché une salle :",
            ["salle", "libre", "disponible"],
        ),
        (
            "mes_reservations",
            "Mes réservations",
            "Voici vos réservations :",
            ["mes reservations", "planning"],
        ),
        (
            "a_propos",
            "Découvrir l'application",
            "SmartRoom Manager gère la réservation des salles du campus.",
            ["a quoi sert", "application", "smartroom", "presentation"],
        ),
    ]
    for code, libelle, reponse, mots in jeux:
        intention = ChatbotIntent(
            code=code, label=libelle, answer=reponse, quick_replies=["Autre chose"]
        )
        session.add(intention)
        session.flush()
        for mot in mots:
            session.add(ChatbotIntentKeyword(intent_id=intention.id, keyword=mot))
        creees.append(intention)
    session.flush()
    return creees


@pytest.fixture
def categorie_faq(session: Session, marque: str) -> FaqCategory:  # noqa: F811
    categorie = FaqCategory(
        code=f"proc_{marque}", label="Procédures", icon="BookOpen", sort_order=1
    )
    session.add(categorie)
    session.flush()
    return categorie


@pytest.fixture
def creer_article(session: Session, categorie_faq: FaqCategory, marque: str):  # noqa: F811
    from datetime import UTC, datetime

    from app.db.enums import ArticleStatus

    def fabriquer(
        *,
        titre: str,
        corps: str,
        extrait: str = "Extrait de test.",
        publie: bool = True,
    ) -> FaqArticle:
        # `ck_faq_articles_publishable` refuse un article publié de moins de
        # quarante caractères : le complément garde les cas de test lisibles
        # sans les faire buter sur une contrainte qui n'est pas leur sujet.
        if publie and len(corps.strip()) < 40:
            corps = f"{corps} Cette procédure s'applique à toutes les salles du parc."
        # Le schéma impose un slug `^[a-z0-9]+(-[a-z0-9]+)*$` : les accents et
        # les apostrophes doivent disparaître, comme le fait le service.
        from app.services.parc_service import slugify

        article = FaqArticle(
            category_id=categorie_faq.id,
            slug=f"{slugify(titre)[:40]}-{marque}",
            title=titre,
            excerpt=extrait,
            body=corps,
            status=ArticleStatus.PUBLIE if publie else ArticleStatus.BROUILLON,
            published_at=datetime.now(UTC) if publie else None,
        )
        session.add(article)
        session.flush()
        return article

    return fabriquer


@pytest.fixture
def client_assistant(client, session: Session, selecteur: SelecteurModeles) -> Iterator:  # noqa: F811
    """Client HTTP dont le flux écrit dans la transaction du test.

    Sans cette substitution, l'endpoint ouvrirait sa propre session — c'est ce
    qu'il fait en production, à raison, le flux durant plus longtemps que la
    requête — et ses écritures survivraient au test.
    """
    from contextlib import contextmanager

    from app.api.v1 import chat as module_chat
    from app.main import app

    @contextmanager
    def session_du_test():
        yield session

    app.dependency_overrides[module_chat.fabrique_session] = lambda: session_du_test
    app.dependency_overrides[module_chat.obtenir_selecteur] = lambda: selecteur
    try:
        yield client
    finally:
        app.dependency_overrides.pop(module_chat.fabrique_session, None)
        app.dependency_overrides.pop(module_chat.obtenir_selecteur, None)


def evenements(reponse) -> list[dict]:
    """Décode un flux SSE rendu par `TestClient`."""
    import json

    trames: list[dict] = []
    for bloc in reponse.text.replace("\r\n", "\n").split("\n\n"):
        charge = "".join(
            ligne[5:].strip() for ligne in bloc.split("\n") if ligne.startswith("data:")
        )
        if charge:
            trames.append(json.loads(charge))
    return trames


def texte_de(trames: list[dict]) -> str:
    return "".join(item["texte"] for item in trames if item.get("type") == "texte")


def types_de(trames: list[dict]) -> list[str]:
    return [item.get("type") for item in trames]


def identifiant_inexistant() -> uuid.UUID:
    return uuid.UUID("00000000-0000-4000-8000-000000000000")

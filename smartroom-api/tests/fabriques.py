"""Fabriques de données. Aucun test ne recopie un dictionnaire.

Deux raisons, au-delà de la concision. La première : les contraintes de la base
sont nombreuses et précises — format du code de bâtiment, forme du `slug`,
plage des positions. Une fabrique les respecte une fois pour toutes, là où un
dictionnaire recopié les enfreint à la première variation.

La seconde : l'unicité. Chaque valeur unique porte une **marque** tirée au
démarrage du processus. Deux tests qui créent « une salle » n'entrent jamais en
collision, et l'exécution parallèle reste possible.

Les fabriques écrivent dans la session du test, injectée par la fixture
`session`. Elles utilisent `flush` et non `commit` : la transaction extérieure
doit rester annulable.
"""

from __future__ import annotations

import itertools
import random
import re
import string
import unicodedata
import uuid
from datetime import time

import factory
from factory.alchemy import SQLAlchemyModelFactory
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.db.enums import EquipmentCategory, RoomStatus, RuleScope
from app.models import (
    AdminAccount,
    Building,
    Equipment,
    Floor,
    OpeningHour,
    Room,
    RoomEquipment,
    User,
)

#: Mot de passe unique de tous les comptes fabriqués. Le hachage bcrypt est
#: coûteux : il est calculé une fois et réutilisé, sinon la suite passerait
#: l'essentiel de son temps à hacher.
MOT_DE_PASSE = "smartroom2026"
EMPREINTE = hash_password(MOT_DE_PASSE)

#: Marque du processus. Avec xdist, chaque worker a la sienne : deux workers qui
#: valident réellement leurs écritures — les tests de concurrence — ne peuvent
#: pas produire le même code de bâtiment.
MARQUE = uuid.uuid4().hex[:6]

_LETTRE = random.choice(string.ascii_uppercase)
_SUITE = itertools.count(random.randrange(100, 800))


def _slugifier(valeur: str) -> str:
    """Forme acceptée par `ck_rooms_slug_format` : minuscules, tirets, chiffres."""
    base = unicodedata.normalize("NFKD", valeur)
    base = base.encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", base).strip("-") or "salle"


def _code_batiment() -> str:
    """Quatre caractères au plus, conformément à `ck_buildings_code_format`."""
    return f"{_LETTRE}{next(_SUITE) % 1000:03d}"


class FabriqueBase(SQLAlchemyModelFactory):
    class Meta:
        abstract = True
        # `flush` et non `commit` : la transaction du test doit rester annulable.
        sqlalchemy_session_persistence = "flush"


class FabriqueBatiment(FabriqueBase):
    class Meta:
        model = Building

    code = factory.LazyFunction(_code_batiment)
    name = factory.Sequence(lambda n: f"Campus {MARQUE}-{n}")
    address = "1 rue de la Démonstration"
    sort_order = factory.Sequence(lambda n: n)


class FabriqueEtage(FabriqueBase):
    class Meta:
        model = Floor

    building = factory.SubFactory(FabriqueBatiment)
    code = factory.Sequence(lambda n: f"E{n % 100}")
    label = factory.LazyAttribute(lambda o: f"{o.level}e étage")
    level = 2


class FabriqueEquipement(FabriqueBase):
    class Meta:
        model = Equipment

    code = factory.Sequence(lambda n: f"materiel-{MARQUE}-{n}")
    label = "Vidéoprojecteur"
    category = EquipmentCategory.AUDIOVISUEL
    icon = "projector"
    is_filterable = True


class FabriqueSalle(FabriqueBase):
    class Meta:
        model = Room

    floor = factory.SubFactory(FabriqueEtage)
    name = factory.Sequence(lambda n: f"Salle {MARQUE}-{n}")
    slug = factory.LazyAttributeSequence(
        lambda o, n: f"{_slugifier(o.name)}-{uuid.uuid4().hex[:4]}-{n}"
    )
    capacity = 12
    area_m2 = "24.00"
    status = RoomStatus.DISPONIBLE
    is_accessible = True
    # Aligné sur le défaut du modèle. Une fabrique doit reproduire le
    # comportement de production, pas en inventer un plus commode : un `False`
    # ici supprimait l'émission du code d'accès pour toute la suite.
    badge_required = True


class FabriqueCompte(FabriqueBase):
    class Meta:
        model = User

    email = factory.Sequence(lambda n: f"compte-{MARQUE}-{n}@edu.ece.fr")
    password_hash = EMPREINTE
    first_name = "Camille"
    last_name = "Durand"
    promotion = "B3 Data & IA"
    department = "Ingénierie"


class FabriqueAdministrateur(FabriqueBase):
    class Meta:
        model = AdminAccount

    user = factory.SubFactory(FabriqueCompte, first_name="Léa")
    job_title = "Responsable planning"
    is_owner = False


FABRIQUES = (
    FabriqueBatiment,
    FabriqueEtage,
    FabriqueEquipement,
    FabriqueSalle,
    FabriqueCompte,
    FabriqueAdministrateur,
)


def brancher(session: Session) -> None:
    """Lie toutes les fabriques à la session du test en cours."""
    for fabrique in FABRIQUES:
        fabrique._meta.sqlalchemy_session = session


def debrancher() -> None:
    """Délie les fabriques : une session fermée réutilisée lèverait à retardement."""
    for fabrique in FABRIQUES:
        fabrique._meta.sqlalchemy_session = None


def poser_horaires(
    session: Session,
    salle: Room,
    *,
    ouvre: time = time(8, 0),
    ferme: time = time(20, 0),
    jours: tuple[int, ...] = (0, 1, 2, 3, 4, 5, 6),
) -> None:
    """Amplitude d'ouverture d'une salle, jour de semaine par jour de semaine.

    La portée est « salle » et non « globale » : la résolution retient la plus
    spécifique, et une amplitude globale posée par un test déborderait sur tous
    les autres si la transaction n'était pas annulée.
    """
    for jour in jours:
        session.add(
            OpeningHour(
                scope=RuleScope.SALLE,
                room_id=salle.id,
                weekday=jour,
                is_open=True,
                opens_at=ouvre,
                closes_at=ferme,
            )
        )
    session.flush()


def equiper(session: Session, salle: Room, *materiels: Equipment) -> None:
    for materiel in materiels:
        session.add(
            RoomEquipment(room_id=salle.id, equipment_id=materiel.id, quantity=1)
        )
    session.flush()

"""Temps de référence des tests.

Deux principes, et une conséquence.

Premier principe : le temps est **injecté**, jamais lu de l'horloge système.
Tous les services acceptent un paramètre `now`. Un test qui dépend de l'heure à
laquelle on le lance est un test qui échouera un jour, à 23 h 58.

Second principe : les instants sont construits en heure **locale** puis
normalisés, parce que c'est ce qu'un utilisateur vit. Écrire directement en UTC
donnerait des tests justes qui ne décrivent rien.

Conséquence : trois dates sont choisies pour ce qu'elles cassent.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from app.domain.types import TimeSlot

PARIS = ZoneInfo("Europe/Paris")

#: Mardi ordinaire : jour ouvré, sans changement d'heure ni fermeture.
JOUR_ORDINAIRE = date(2026, 8, 25)

#: Dernier dimanche de mars. 02:00 locale n'existe pas : la journée dure 23 h.
PASSAGE_ETE = date(2026, 3, 29)

#: Dernier dimanche d'octobre. 02:30 locale existe deux fois : la journée
#: dure 25 h, et un créneau de 02:00 à 03:00 y couvre deux heures réelles.
PASSAGE_HIVER = date(2026, 10, 25)


def local(heure: int, minute: int = 0, *, jour: date = JOUR_ORDINAIRE) -> datetime:
    """Instant en heure de Paris. C'est la forme que lit un utilisateur."""
    return datetime.combine(jour, time(heure, minute), tzinfo=PARIS)


def en_utc(heure: int, minute: int = 0, *, jour: date = JOUR_ORDINAIRE) -> datetime:
    """Instant en UTC, pour les assertions qui portent sur le stockage."""
    return datetime(jour.year, jour.month, jour.day, heure, minute, tzinfo=UTC)


def creneau(jour: date, heure: int, minute: int = 0, duree_min: int = 60) -> TimeSlot:
    """Créneau exprimé en heure locale, normalisé en UTC par `TimeSlot`.

    La durée est comptée en minutes réelles et non en heures de l'horloge : un
    créneau d'une heure lancé à 02:00 le jour du retour à l'heure d'hiver finit
    à 02:00, pas à 03:00.
    """
    depart = local(heure, minute, jour=jour)
    return TimeSlot(start=depart, end=depart + timedelta(minutes=duree_min))


def plage(debut: datetime, duree_min: int) -> TimeSlot:
    return TimeSlot(start=debut, end=debut + timedelta(minutes=duree_min))


def a_cheval_sur_minuit(jour: date = JOUR_ORDINAIRE, duree_min: int = 120) -> TimeSlot:
    """Créneau qui commence la veille à 23:00 et déborde sur le lendemain."""
    return creneau(jour - timedelta(days=1), 23, 0, duree_min)


def prochain(weekday: int, *, depuis: date | None = None) -> date:
    """Prochaine occurrence d'un jour de semaine, au plus tôt demain.

    « Au plus tôt demain » et non « aujourd'hui » : une règle d'anticipation
    minimale refuserait un créneau posé dans l'heure qui suit.
    """
    reference = (depuis or date.today()) + timedelta(days=1)
    while reference.weekday() != weekday:
        reference += timedelta(days=1)
    return reference


@dataclass(frozen=True, slots=True)
class Horloge:
    """Horloge figée, passée aux services par leur paramètre `now`.

    Figée et non décalée : deux appels au cours d'un même test doivent lire le
    même instant, sinon un test qui vérifie une borne à la minute près devient
    intermittent.
    """

    instant: datetime

    @classmethod
    def a(cls, heure: int, minute: int = 0, *, jour: date = JOUR_ORDINAIRE) -> "Horloge":
        return cls(instant=local(heure, minute, jour=jour))

    @classmethod
    def veille_de(cls, jour: date, heure: int = 9) -> "Horloge":
        return cls(instant=local(heure, jour=jour - timedelta(days=1)))

    def plus(self, **ecart: float) -> datetime:
        return self.instant + timedelta(**ecart)

    def moins(self, **ecart: float) -> datetime:
        return self.instant - timedelta(**ecart)

    def __call__(self) -> datetime:
        return self.instant


def charge_creneau(slot: TimeSlot) -> dict[str, str]:
    """Créneau au format attendu par les corps JSON de l'API."""
    return {"starts_at": slot.start.isoformat(), "ends_at": slot.end.isoformat()}

"""Journalisation structurée en JSON.

Une ligne par événement, un objet par ligne. Le format n'est pas un caprice :
un journal en texte libre se lit à l'œil et ne s'interroge pas. En JSON, une
requête lente se retrouve par `duration_ms > 500`, et une rafale de refus par
`status = 401`, sans écrire d'expression régulière.

**Ce qui n'y figure jamais.** Ni jeton, ni mot de passe, ni corps de requête.
Un journal est lu par plus de monde que la base, conservé plus longtemps, et
exporté vers des outils tiers : y déposer une donnée personnelle revient à la
publier. Les identifiants d'utilisateur y sont, eux, présents — ce sont des
UUID, ils permettent de suivre un incident sans nommer personne.
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import UTC, datetime
from typing import Any

#: Champs standards de `LogRecord`. Tout le reste vient d'un `extra` et rejoint
#: l'objet JSON : c'est ce qui rend le journal interrogeable sans convention
#: implicite sur le texte du message.
RESERVES = frozenset(
    {
        "args",
        "asctime",
        "created",
        "exc_info",
        "exc_text",
        "filename",
        "funcName",
        "levelname",
        "levelno",
        "lineno",
        "module",
        "msecs",
        "message",
        "msg",
        "name",
        "pathname",
        "process",
        "processName",
        "relativeCreated",
        "stack_info",
        "taskName",
        "thread",
        "threadName",
    }
)

#: Clés dont la valeur est remplacée avant écriture. La liste vaut pour les
#: `extra` que du code ajouterait par inadvertance : mieux vaut un masque
#: systématique qu'une relecture attentive.
SENSIBLES = frozenset(
    {
        "password",
        "mot_de_passe",
        "token",
        "jeton",
        "access_token",
        "refresh_token",
        "authorization",
        "cookie",
        "secret",
        "code",
        "code_hash",
        "password_hash",
    }
)

MASQUE = "***"


class FormateurJson(logging.Formatter):
    """Rend chaque enregistrement sous forme d'un objet JSON d'une seule ligne."""

    def format(self, record: logging.LogRecord) -> str:
        charge: dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        for cle, valeur in record.__dict__.items():
            if cle in RESERVES or cle.startswith("_"):
                continue
            charge[cle] = MASQUE if cle.lower() in SENSIBLES else _serialisable(valeur)

        if record.exc_info:
            # La trace est conservée : c'est elle qui permet de corriger. Elle
            # ne contient pas de donnée métier, seulement des noms de fonctions.
            charge["exception"] = self.formatException(record.exc_info)

        return json.dumps(charge, ensure_ascii=False, default=str)


def _serialisable(valeur: Any) -> Any:
    if isinstance(valeur, str | int | float | bool | type(None)):
        return valeur
    return str(valeur)


def configurer(*, niveau: str = "INFO", json_actif: bool = True) -> None:
    """Installe le format sur la racine, une fois pour toutes.

    En local, le texte lisible reste préférable : un développeur lit son
    terminal, il ne l'interroge pas. En production, JSON systématiquement.
    """
    racine = logging.getLogger()
    for ancien in list(racine.handlers):
        racine.removeHandler(ancien)

    sortie = logging.StreamHandler(sys.stdout)
    sortie.setFormatter(
        FormateurJson()
        if json_actif
        else logging.Formatter("%(levelname)-8s %(name)s — %(message)s")
    )
    racine.addHandler(sortie)
    racine.setLevel(niveau.upper())

    # Uvicorn installe ses propres gestionnaires : sans propagation vers la
    # racine, ses journaux d'accès échapperaient au format et deux syntaxes
    # cohabiteraient dans le même flux.
    for nom in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        journal = logging.getLogger(nom)
        journal.handlers.clear()
        journal.propagate = True

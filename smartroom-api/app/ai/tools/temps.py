"""Lecture des instants produits par le modèle.

Le contrat annoncé au modèle est strict : ISO 8601 en UTC, suffixe `Z`. Il ne
le respecte pas toujours — un modèle rend volontiers `2026-09-03T14:00:00` sans
fuseau, ou avec un décalage explicite.

Ce module accepte ces formes et les ramène en UTC, mais **n'invente jamais une
date**. Une valeur relative non résolue — « demain », « jeudi » — est refusée :
la résoudre ici reviendrait à décider à la place de l'utilisateur, alors que le
prompt système demande au modèle de poser la question.
"""

from __future__ import annotations

from datetime import UTC, datetime


def lire_instant(valeur: str | datetime) -> datetime:
    """Rend un `datetime` conscient du fuseau, en UTC.

    Une chaîne sans fuseau est lue comme de l'UTC : c'est ce que le schéma
    exige, et supposer un fuseau local décalerait silencieusement toutes les
    réservations de deux heures en été.
    """
    if isinstance(valeur, datetime):
        moment = valeur
    else:
        texte = valeur.strip()
        if texte.endswith(("z", "Z")):
            texte = texte[:-1] + "+00:00"
        try:
            moment = datetime.fromisoformat(texte)
        except ValueError as souci:
            raise ValueError(
                f"Date illisible : « {valeur} ». Attendu : ISO 8601 UTC, "
                "par exemple 2026-09-03T14:00:00Z."
            ) from souci

    if moment.tzinfo is None:
        return moment.replace(tzinfo=UTC)
    return moment.astimezone(UTC)

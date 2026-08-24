"""Limitation de débit.

Instanciée à part pour éviter un cycle : les routeurs importent le limiteur, et
`main` importe les routeurs. La clé est l'adresse du client, en tenant compte
d'un éventuel proxy — sans quoi tout le trafic derrière un reverse proxy
partagerait le même quota.
"""

from __future__ import annotations

from slowapi import Limiter
from starlette.requests import Request


def cle_client(request: Request) -> str:
    """Adresse du client. Seule la première valeur de `X-Forwarded-For` est crue :
    les suivantes sont ajoutées par les intermédiaires."""
    transmise = request.headers.get("X-Forwarded-For")
    if transmise:
        return transmise.split(",")[0].strip()
    return request.client.host if request.client else "inconnu"


#: Stockage en mémoire : suffisant pour un déploiement mono-processus, qui est
#: celui du projet. Un déploiement réparti exigerait Redis.
limiter = Limiter(key_func=cle_client, headers_enabled=True)

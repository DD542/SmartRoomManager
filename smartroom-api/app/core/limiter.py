"""Limitation de débit.

Instanciée à part pour éviter un cycle : les routeurs importent le limiteur, et
`main` importe les routeurs. La clé est l'adresse du client, en tenant compte
d'un éventuel proxy — sans quoi tout le trafic derrière un reverse proxy
partagerait le même quota.
"""

from __future__ import annotations

from slowapi import Limiter
from starlette.requests import Request

from app.core.config import get_settings


def cle_client(request: Request) -> str:
    """Adresse du client, telle que l'a vue le dernier relais de confiance.

    `X-Forwarded-For` se lit **par la droite**. Chaque relais ajoute à la fin
    l'adresse de qui lui a parlé ; tout ce qui précède a pu être écrit par le
    client lui-même. Croire la première valeur, comme avant, laissait un
    attaquant choisir sa clé de limitation : une adresse inventée par requête,
    et la limite de cinq essais par minute ne s'appliquait jamais.

    `PROXIES_DE_CONFIANCE` dit combien de relais se tiennent devant l'API (un
    sur l'hébergement de démonstration). Sans en-tête, ou sans relais déclaré,
    c'est l'adresse de la connexion qui compte.
    """
    relais = get_settings().proxies_de_confiance
    transmise = request.headers.get("X-Forwarded-For")
    if transmise and relais > 0:
        adresses = [a.strip() for a in transmise.split(",") if a.strip()]
        if adresses:
            return adresses[-min(relais, len(adresses))]
    return request.client.host if request.client else "inconnu"


#: Stockage en mémoire : suffisant pour un déploiement mono-processus, qui est
#: celui du projet. Un déploiement réparti exigerait Redis.
limiter = Limiter(key_func=cle_client, headers_enabled=True)

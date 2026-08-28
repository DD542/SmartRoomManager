"""Brouillons d'écriture en attente de confirmation.

Le point le plus important de toute la couche tient ici. Quand le modèle
propose une écriture, ce n'est pas sa sortie qu'on garde : c'est le **brouillon
validé par Pydantic**, rangé côté serveur sous un jeton opaque. Au tour
suivant, l'utilisateur renvoie ce jeton, et le serveur exécute ce qu'il a
lui-même conservé.

Conséquence : entre la proposition et l'exécution, plus rien ne dépend du
modèle. Une réponse ultérieure du modèle, même détournée, ne peut pas changer
la salle, le créneau ni le destinataire. C'est ce qui rend la phrase « aucune
écriture n'est déclenchée par une sortie de modèle » vraie et non déclarative.

Le magasin est en mémoire du processus, borné et périssable. Un brouillon
oublié disparaît au bout de `CONFIRMATION_TTL_S` : une confirmation donnée
vingt minutes plus tard porterait sur un créneau qui n'est peut-être plus
libre, et il vaut mieux la refaire que la rejouer.
"""

from __future__ import annotations

import secrets
import time
import uuid
from dataclasses import dataclass

from pydantic import BaseModel

from app.ai.reglages import get_reglages_ia


@dataclass(frozen=True, slots=True)
class Brouillon:
    outil: str
    arguments: dict
    utilisateur_id: uuid.UUID
    conversation_id: uuid.UUID | None
    expire_a: float

    def expire(self, *, maintenant: float | None = None) -> bool:
        return (maintenant or time.monotonic()) > self.expire_a


class MagasinBrouillons:
    """Brouillons en attente, indexés par jeton opaque."""

    def __init__(self, *, capacite: int = 512) -> None:
        self._entrees: dict[str, Brouillon] = {}
        self._capacite = capacite

    def deposer(
        self,
        *,
        outil: str,
        apercu: BaseModel,
        utilisateur_id: uuid.UUID,
        conversation_id: uuid.UUID | None = None,
    ) -> str:
        self._purger()

        jeton = secrets.token_urlsafe(18)
        self._entrees[jeton] = Brouillon(
            outil=outil,
            # Sérialisé plutôt que gardé en objet : c'est cette forme qui
            # repartira à l'outil, et la figer maintenant évite qu'une mutation
            # ultérieure du modèle Pydantic change ce qui sera exécuté.
            arguments=apercu.model_dump(mode="json"),
            utilisateur_id=utilisateur_id,
            conversation_id=conversation_id,
            expire_a=time.monotonic() + get_reglages_ia().confirmation_ttl_s,
        )
        return jeton

    def retirer(self, jeton: str, *, utilisateur_id: uuid.UUID) -> Brouillon | None:
        """Rend le brouillon **et le retire** : une confirmation ne se rejoue pas.

        Le propriétaire est vérifié ici : un jeton intercepté ne vaut rien pour
        un autre compte, et c'est le serveur qui le dit, pas le client.
        """
        brouillon = self._entrees.pop(jeton, None)
        if brouillon is None:
            return None
        if brouillon.utilisateur_id != utilisateur_id:
            return None
        if brouillon.expire():
            return None
        return brouillon

    def abandonner(self, jeton: str) -> None:
        self._entrees.pop(jeton, None)

    def _purger(self) -> None:
        maintenant = time.monotonic()
        for jeton in [cle for cle, valeur in self._entrees.items() if valeur.expire(maintenant=maintenant)]:
            self._entrees.pop(jeton, None)

        # Garde-fou de mémoire : au-delà de la capacité, les plus anciens
        # partent. Un magasin sans borne serait une fuite lente.
        if len(self._entrees) > self._capacite:
            surplus = len(self._entrees) - self._capacite
            for jeton in sorted(self._entrees, key=lambda cle: self._entrees[cle].expire_a)[:surplus]:
                self._entrees.pop(jeton, None)

    @property
    def taille(self) -> int:
        self._purger()
        return len(self._entrees)


MAGASIN = MagasinBrouillons()

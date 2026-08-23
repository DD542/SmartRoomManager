"""Mots de passe et jetons d'accès.

Deux espaces de session cohabitent : celui de l'utilisateur et celui de
l'administration. Un jeton porte lequel des deux il ouvre — `scope` — ce qui
interdit d'entrer dans l'administration avec un jeton obtenu sur l'espace
utilisateur, même pour un compte qui possède les deux.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

import jwt
from passlib.context import CryptContext

from app.core.config import get_settings

settings = get_settings()

#: bcrypt : lent par construction, c'est précisément ce qu'on attend d'un
#: algorithme de hachage de mot de passe.
CRYPT = CryptContext(schemes=["bcrypt"], deprecated="auto")

Scope = Literal["user", "admin"]


def hash_password(mot_de_passe: str) -> str:
    return CRYPT.hash(mot_de_passe)


def verify_password(mot_de_passe: str, empreinte: str) -> bool:
    """Vérifie sans jamais révéler laquelle des deux parties a échoué."""
    try:
        return CRYPT.verify(mot_de_passe, empreinte)
    except ValueError:
        # Empreinte illisible : traitée comme un refus, jamais comme une erreur
        # serveur, pour ne pas distinguer un compte corrompu d'un mot de passe faux.
        return False


def create_access_token(
    *, subject: uuid.UUID, scope: Scope, permissions: list[str] | None = None
) -> tuple[str, int]:
    """Émet un jeton signé et renvoie sa durée de validité en secondes."""
    duree = timedelta(minutes=settings.jwt_ttl_minutes)
    emis_le = datetime.now(UTC)

    charge: dict[str, Any] = {
        "sub": str(subject),
        "scope": scope,
        "iat": emis_le,
        "exp": emis_le + duree,
    }
    # Les permissions voyagent dans le jeton pour éviter une lecture de la
    # matrice à chaque requête ; leur révocation prend effet au jeton suivant,
    # compromis assumé pour une session de huit heures.
    if permissions is not None:
        charge["permissions"] = permissions

    jeton = jwt.encode(
        charge,
        settings.jwt_secret.get_secret_value(),
        algorithm=settings.jwt_algorithm,
    )
    return jeton, int(duree.total_seconds())


def decode_access_token(jeton: str) -> dict[str, Any]:
    """Décode et valide un jeton. Lève `jwt.PyJWTError` si quoi que ce soit cloche."""
    return jwt.decode(
        jeton,
        settings.jwt_secret.get_secret_value(),
        algorithms=[settings.jwt_algorithm],
    )

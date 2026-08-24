"""Mots de passe et jetons.

Trois familles de secrets, trois traitements différents :

  - le mot de passe est **haché avec bcrypt**, lent par construction, parce
    qu'un humain le choisit et qu'il est donc devinable ;
  - le jeton d'accès est **signé**, pas stocké : il se vérifie sans base ;
  - le rafraîchissement et la réinitialisation sont **opaques et hachés en
    SHA-256**. Ils sont tirés au sort sur 256 bits : un hachage lent n'y
    ajouterait rien, et le rafraîchissement est vérifié à chaque renouvellement.
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import get_settings

settings = get_settings()

CRYPT = CryptContext(schemes=["bcrypt"], deprecated="auto")

Scope = Literal["user", "admin"]

#: Longueur du tirage des jetons opaques, en octets.
ENTROPIE = 32


class TokenError(Exception):
    """Jeton illisible, expiré ou altéré. La couche API la traduit en 401."""


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


def now() -> datetime:
    return datetime.now(UTC)


# --------------------------------------------------------------------------- #
# Jeton d'accès
# --------------------------------------------------------------------------- #


def create_access_token(*, subject: uuid.UUID, scope: Scope) -> tuple[str, int]:
    """Émet un jeton signé et renvoie sa durée de validité en secondes.

    Les permissions n'y figurent pas : elles sont relues en base à chaque
    garde, pour qu'une révocation prenne effet immédiatement plutôt qu'au
    renouvellement suivant.
    """
    duree = timedelta(minutes=settings.access_ttl_minutes)
    emis_le = now()

    charge: dict[str, Any] = {
        "sub": str(subject),
        "scope": scope,
        "typ": "access",
        "iat": emis_le,
        "exp": emis_le + duree,
        "jti": secrets.token_hex(8),
    }
    jeton = jwt.encode(
        charge, settings.jwt_secret.get_secret_value(), algorithm=settings.jwt_algorithm
    )
    return jeton, int(duree.total_seconds())


def decode_access_token(jeton: str) -> dict[str, Any]:
    """Décode et valide un jeton d'accès. Lève `TokenError` si quoi que ce soit cloche."""
    try:
        charge = jwt.decode(
            jeton,
            settings.jwt_secret.get_secret_value(),
            algorithms=[settings.jwt_algorithm],
        )
    except JWTError as erreur:
        raise TokenError(str(erreur)) from erreur

    if charge.get("typ") != "access":
        # Un jeton d'un autre usage ne doit pas ouvrir une session, même signé
        # par la même clé.
        raise TokenError("Type de jeton inattendu.")
    return charge


# --------------------------------------------------------------------------- #
# Jetons opaques : rafraîchissement et réinitialisation
# --------------------------------------------------------------------------- #


def new_opaque_token() -> tuple[str, str]:
    """Tire un jeton et renvoie `(clair, empreinte)`.

    Le clair ne quitte jamais la fonction appelante : il part au client, la
    base ne garde que l'empreinte.
    """
    clair = secrets.token_urlsafe(ENTROPIE)
    return clair, fingerprint(clair)


def fingerprint(clair: str) -> str:
    """Empreinte SHA-256 en hexadécimal, comparable en temps constant."""
    return hashlib.sha256(clair.encode("utf-8")).hexdigest()


def matches(clair: str, empreinte: str) -> bool:
    return secrets.compare_digest(fingerprint(clair), empreinte)


def refresh_expiry() -> datetime:
    return now() + timedelta(days=settings.refresh_ttl_days)


def reset_expiry() -> datetime:
    return now() + timedelta(minutes=settings.reset_ttl_minutes)


# --------------------------------------------------------------------------- #
# Invitations de participants
# --------------------------------------------------------------------------- #


def create_invitation_token(
    *, booking_id: uuid.UUID, participant_id: uuid.UUID, expires_at: datetime
) -> str:
    """Jeton d'invitation, signé plutôt que stocké.

    Un participant extérieur n'a pas de compte : lui demander de se connecter
    pour répondre à une invitation serait absurde. Le jeton expire avec le
    créneau — répondre à une réunion passée n'a aucun sens — ce qui dispense
    d'une table de révocation.
    """
    charge: dict[str, Any] = {
        "sub": str(participant_id),
        "bkg": str(booking_id),
        "typ": "invitation",
        "iat": now(),
        "exp": expires_at,
    }
    return jwt.encode(
        charge, settings.jwt_secret.get_secret_value(), algorithm=settings.jwt_algorithm
    )


def decode_invitation_token(jeton: str) -> tuple[uuid.UUID, uuid.UUID]:
    """Renvoie `(booking_id, participant_id)`, ou lève `TokenError`."""
    try:
        charge = jwt.decode(
            jeton,
            settings.jwt_secret.get_secret_value(),
            algorithms=[settings.jwt_algorithm],
        )
    except JWTError as erreur:
        raise TokenError(str(erreur)) from erreur

    if charge.get("typ") != "invitation":
        raise TokenError("Type de jeton inattendu.")
    try:
        return uuid.UUID(charge["bkg"]), uuid.UUID(charge["sub"])
    except (KeyError, ValueError) as erreur:
        raise TokenError("Jeton d'invitation illisible.") from erreur

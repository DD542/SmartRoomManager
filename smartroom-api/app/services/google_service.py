"""Vérification d'un jeton d'identité Google.

Le navigateur obtient de Google un jeton d'identité — un JWT signé — et le
présente ici. Tout le travail consiste à ne le croire qu'après l'avoir vérifié,
car ce jeton arrive par le client : n'importe qui peut en poster un fabriqué.

Quatre contrôles, et aucun n'est facultatif :

  1. **La signature**, contre les clés publiques que Google publie. C'est elle
     qui distingue un jeton émis par Google d'un jeton écrit à la main.
  2. **L'émetteur** — `accounts.google.com`. Un jeton signé par un autre
     fournisseur ne vaut rien ici.
  3. **Le destinataire** (`aud`) — notre identifiant de client. Sans ce
     contrôle, un jeton émis pour *une autre application* ouvrirait une session
     chez nous : c'est la confusion de destinataire, la faute classique de
     l'authentification déléguée.
  4. **L'adresse vérifiée** (`email_verified`). Google laisse créer un compte
     avec une adresse non confirmée ; l'accepter reviendrait à laisser
     quelqu'un s'attribuer l'adresse d'un autre.

L'expiration est vérifiée par la bibliothèque, avec le reste de l'enveloppe.

Aucune dépendance nouvelle : `httpx` pour les clés, `python-jose` pour la
signature — les deux sont déjà là.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

import httpx
from jose import JWTError, jwt

from app.core.config import get_settings
from app.core.errors import AuthenticationError, RuleViolationError

#: Émetteurs acceptés. Google en publie deux formes, historiquement.
EMETTEURS = {"accounts.google.com", "https://accounts.google.com"}

#: Clés publiques de signature, au format JWKS.
URL_CLES = "https://www.googleapis.com/oauth2/v3/certs"

#: Durée de conservation des clés. Google les fait tourner ; les redemander à
#: chaque connexion ajouterait un aller-retour réseau à chaque ouverture de
#: session, et ne pas les rafraîchir du tout ferait échouer toutes les
#: connexions le jour de la rotation.
DUREE_CACHE = 3600

_cles: dict[str, Any] | None = None
_expire_a = 0.0


@dataclass(frozen=True, slots=True)
class IdentiteGoogle:
    """Ce que le jeton affirme, une fois qu'on peut le croire."""

    email: str
    prenom: str
    nom: str
    photo: str | None


def _obtenir_cles(*, forcer: bool = False) -> dict[str, Any]:
    """Clés publiques de Google, mises en cache une heure.

    `forcer` sert au second essai : une signature refusée peut simplement
    signifier que Google a tourné ses clés depuis notre dernière lecture.
    """
    global _cles, _expire_a

    if not forcer and _cles is not None and time.monotonic() < _expire_a:
        return _cles

    try:
        reponse = httpx.get(URL_CLES, timeout=5.0)
        reponse.raise_for_status()
    except httpx.HTTPError as erreur:
        raise AuthenticationError(
            "Impossible de joindre Google pour vérifier votre identité.",
            code="google_injoignable",
        ) from erreur

    _cles = reponse.json()
    _expire_a = time.monotonic() + DUREE_CACHE
    return _cles


def _domaines_autorises() -> set[str]:
    brut = get_settings().google_allowed_domains
    return {part.strip().lower() for part in brut.split(",") if part.strip()}


def verifier(jeton: str) -> IdentiteGoogle:
    """Vérifie un jeton d'identité et rend ce qu'il affirme.

    Lève `AuthenticationError` sur tout ce qui n'est pas vérifiable, et
    `RuleViolationError` quand le jeton est valable mais que le compte n'a pas
    sa place ici — un domaine hors de la liste autorisée. La distinction
    compte : le premier cas est un refus d'identité, le second une règle
    d'établissement, et ils n'appellent pas le même message.
    """
    client = get_settings().google_client_id
    if not client:
        raise RuleViolationError(
            "La connexion Google n'est pas configurée sur ce serveur.",
            code="google_non_configure",
        )

    def _decoder(cles: dict[str, Any]) -> dict[str, Any]:
        return jwt.decode(
            jeton,
            cles,
            algorithms=["RS256"],
            audience=client,
            options={"verify_at_hash": False},
        )

    try:
        charge = _decoder(_obtenir_cles())
    except JWTError:
        # Second essai avec des clés fraîches : Google les fait tourner, et une
        # signature refusée sur un cache d'une heure est le symptôme attendu.
        try:
            charge = _decoder(_obtenir_cles(forcer=True))
        except JWTError as erreur:
            raise AuthenticationError(
                "Jeton Google invalide ou expiré.", code="google_jeton_invalide"
            ) from erreur

    if charge.get("iss") not in EMETTEURS:
        raise AuthenticationError(
            "Jeton Google invalide ou expiré.", code="google_jeton_invalide"
        )

    if not charge.get("email_verified"):
        raise AuthenticationError(
            "Cette adresse Google n'est pas vérifiée.", code="google_adresse_non_verifiee"
        )

    email = (charge.get("email") or "").strip().lower()
    if not email:
        raise AuthenticationError(
            "Ce compte Google ne communique pas d'adresse.", code="google_sans_adresse"
        )

    autorises = _domaines_autorises()
    if autorises and email.split("@")[-1] not in autorises:
        raise RuleViolationError(
            "Ce domaine n'est pas autorisé à ouvrir une session.",
            code="google_domaine_refuse",
        )

    return IdentiteGoogle(
        email=email,
        # Un compte Google peut n'avoir aucun nom renseigné : la partie locale
        # de l'adresse vaut mieux qu'un champ vide, que la base refuserait.
        prenom=(charge.get("given_name") or email.split("@")[0]).strip()[:80],
        nom=(charge.get("family_name") or "—").strip()[:80],
        photo=charge.get("picture"),
    )

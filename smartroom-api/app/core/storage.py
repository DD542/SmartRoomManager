"""Stockage des fichiers téléversés : plans d'étage et photos de salles.

Un répertoire local servi en statique plutôt qu'un objet distant : le parc tient
dans quelques mégaoctets, l'application se déploie en un conteneur, et une
dépendance à un service de stockage sortirait de la liste arrêtée. Le module est
volontairement mince — nom de fichier, écriture, suppression — pour qu'un
remplacement par un client S3 ne touche que lui.

Le nom du fichier écrit ne reprend jamais celui reçu : un nom fourni par le
client peut contenir des séparateurs de chemin, et le concaténer ferait sortir
l'écriture du répertoire prévu.
"""

from __future__ import annotations

import re
import unicodedata
import uuid
from pathlib import Path

from app.core.config import get_settings
from app.core.errors import RuleViolationError

#: Ce que le navigateur sait afficher sans téléchargement, et rien d'autre :
#: accepter un type arbitraire reviendrait à héberger n'importe quel exécutable
#: sur le domaine de l'application.
TYPES_ACCEPTES: dict[str, str] = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "application/pdf": ".pdf",
}

#: Alignée sur la contrainte `ck_floor_plans_size` : refuser tôt évite d'écrire
#: un fichier que la base rejetterait ensuite.
TAILLE_MAX = 5 * 1024 * 1024


def racine() -> Path:
    chemin = Path(get_settings().media_root)
    chemin.mkdir(parents=True, exist_ok=True)
    return chemin


def _signature_conforme(extension: str, contenu: bytes) -> bool:
    """Les premiers octets correspondent-ils au type annoncé ?

    Le type déclaré vient du client : sans ce contrôle, une page HTML déclarée
    « image/png » était acceptée et servie depuis le domaine de l'application.
    """
    debut = contenu[:16]
    if extension == ".png":
        return debut.startswith(b"\x89PNG\r\n\x1a\n")
    if extension == ".jpg":
        return debut.startswith(b"\xff\xd8\xff")
    if extension == ".webp":
        return debut[:4] == b"RIFF" and debut[8:12] == b"WEBP"
    if extension == ".pdf":
        return debut.startswith(b"%PDF-")
    if extension == ".svg":
        texte = contenu[:1024].lstrip(b"\xef\xbb\xbf \t\r\n").lower()
        return texte.startswith(b"<") and b"<svg" in contenu[:4096].lower()
    return False


def verifier(
    content_type: str | None, taille: int, contenu: bytes | None = None
) -> str:
    """Valide le type, le poids et — si le contenu est fourni — sa signature.

    Rend l'extension à utiliser.
    """
    extension = TYPES_ACCEPTES.get((content_type or "").split(";")[0].strip().lower())
    if extension is None:
        raise RuleViolationError(
            "Format refusé : déposez une image (PNG, JPG, WebP, SVG) ou un PDF.",
            code="format_invalide",
        )
    if taille <= 0:
        raise RuleViolationError("Le fichier est vide.", code="fichier_vide")
    if taille > TAILLE_MAX:
        raise RuleViolationError(
            f"Fichier trop lourd : {TAILLE_MAX // (1024 * 1024)} Mo au maximum.",
            code="trop_lourd",
        )
    if contenu is not None and not _signature_conforme(extension, contenu):
        raise RuleViolationError(
            "Le fichier ne correspond pas au format annoncé.",
            code="format_invalide",
        )
    return extension


def enregistrer(dossier: str, contenu: bytes, extension: str) -> str:
    """Écrit le fichier et rend son URL publique.

    Le nom est tiré d'un UUID : deux dépôts successifs ne se recouvrent pas, ce
    qui évite qu'un plan remplacé reste affiché depuis le cache du navigateur.
    """
    cible = racine() / dossier
    cible.mkdir(parents=True, exist_ok=True)
    nom = f"{uuid.uuid4().hex}{extension}"
    (cible / nom).write_bytes(contenu)
    return f"{get_settings().media_url}/{dossier}/{nom}"


def supprimer(file_url: str) -> None:
    """Retire le fichier désigné par une URL rendue par `enregistrer`.

    Silencieux si le fichier a déjà disparu : la ligne en base fait foi, et
    échouer ici empêcherait de nettoyer un enregistrement orphelin. Une URL qui
    ne pointe pas dans le répertoire des médias est ignorée — elle désigne alors
    une ressource externe, dont la suppression ne nous appartient pas.
    """
    prefixe = f"{get_settings().media_url}/"
    if not file_url.startswith(prefixe):
        return

    chemin = (racine() / file_url[len(prefixe) :]).resolve()
    if not chemin.is_relative_to(racine().resolve()):
        return
    chemin.unlink(missing_ok=True)


def present(file_url: str | None) -> bool:
    """Vrai si l'URL désigne un fichier qui existe encore.

    Le disque d'un hébergeur gratuit est éphémère : un redéploiement efface les
    fichiers déposés, mais la base garde leurs adresses. Servies telles
    quelles, elles produisaient un 404 par écran et par visiteur. Une URL
    externe — photo d'un compte Google — est réputée présente : elle ne nous
    appartient pas.
    """
    if not file_url:
        return False
    prefixe = f"{get_settings().media_url}/"
    if not file_url.startswith(prefixe):
        return True
    chemin = (racine() / file_url[len(prefixe) :]).resolve()
    return chemin.is_relative_to(racine().resolve()) and chemin.is_file()


def nom_affiche(nom: str | None) -> str:
    """Nom d'origine, assaini pour l'affichage et pour la contrainte de longueur."""
    base = unicodedata.normalize("NFKD", nom or "document")
    base = base.encode("ascii", "ignore").decode() or "document"
    base = re.sub(r"[^A-Za-z0-9._ -]+", "_", Path(base).name).strip() or "document"
    return base[:160]

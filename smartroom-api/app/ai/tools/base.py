"""Socle des outils : contexte d'exécution, résultat, contrat commun.

Un outil est une façade mince. Il traduit des arguments produits par un modèle
en un appel de service existant, et le retour du service en une structure que
l'écran sait afficher. Il ne contient aucune règle métier : si l'un d'eux en
demandait une, c'est le service qui serait incomplet.

Deux invariants tiennent la sécurité de toute la couche :

  * **L'identité n'est jamais un argument.** Elle vit dans `ToolContext`, où le
    serveur l'a mise à partir du jeton. Aucun schéma exposé au modèle ne porte
    d'identifiant d'utilisateur, donc aucune sortie de modèle ne peut désigner
    un tiers.
  * **Une écriture ne s'exécute pas dans le tour qui la propose.** Les outils
    marqués `ecriture` rendent `ToolResult.needs_confirmation`. L'exécution
    appartient au tour suivant, déclenchée par l'utilisateur, à partir du
    brouillon validé conservé par le serveur.
"""

from __future__ import annotations

import enum
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, ValidationError
from sqlalchemy.orm import Session

from app.api.deps import Principal
from app.core.errors import DomainError


class Carte(str, enum.Enum):
    """Forme d'affichage attendue par l'écran U-23 pour ce résultat."""

    TEXTE = "texte"
    SALLES = "salles"
    CRENEAUX = "creneaux"
    RESERVATION = "reservation"
    RESERVATIONS = "reservations"
    CODE_ACCES = "code_acces"
    PLAN = "plan"
    REGLES = "regles"
    ARTICLE = "article"
    TICKET = "ticket"
    TRANSFERT = "transfert"
    CONFIRMATION = "confirmation"


class Domaine(str, enum.Enum):
    """Regroupement servant à réduire le catalogue exposé au modèle.

    Treize schémas coûtent environ 1 400 jetons d'invite à chaque tour. Le
    routage détermine un domaine et n'expose que les outils correspondants :
    moins de jetons, et surtout moins d'occasions pour le modèle de choisir un
    outil hors sujet.
    """

    PARC = "parc"
    RESERVATION = "reservation"
    ASSISTANCE = "assistance"


@dataclass(slots=True)
class ToolContext:
    """Ce que le serveur sait, et que le modèle n'a pas le droit de fournir."""

    session: Session
    principal: Principal
    #: Vrai au tour d'exécution, après validation humaine du brouillon.
    confirmed: bool = False
    #: Horloge de référence du tour. Injectée pour que les tests ne dépendent
    #: pas de l'heure réelle, et pour que tous les outils d'un même tour
    #: partagent le même instant.
    maintenant: datetime = field(default_factory=lambda: datetime.now(UTC))

    @property
    def utilisateur_id(self):
        return self.principal.user.id

    @property
    def est_admin(self) -> bool:
        return self.principal.scope == "admin"


class Statut(str, enum.Enum):
    OK = "ok"
    CONFIRMATION = "confirmation"
    REFUS = "refus"
    VIDE = "vide"


@dataclass(frozen=True, slots=True)
class ToolResult:
    """Retour d'un outil, prêt pour l'écran comme pour le modèle.

    `pour_modele` est ce que le modèle relit au tour suivant ; il est
    volontairement plus court que `data`, qui alimente l'affichage. Rendre au
    modèle l'intégralité d'une liste de salles coûterait des centaines de
    jetons pour une information qu'il ne fait que résumer.
    """

    statut: Statut
    message: str = ""
    data: Any = None
    carte: Carte = Carte.TEXTE
    #: Brouillon validé d'une écriture en attente. Le serveur le conserve ; il
    #: ne repasse jamais par le modèle.
    brouillon: BaseModel | None = None
    #: Sources citées, quand le résultat en porte (RAG).
    sources: tuple[str, ...] = ()

    @property
    def reussi(self) -> bool:
        return self.statut in (Statut.OK, Statut.VIDE)

    @classmethod
    def ok(
        cls, *, data: Any, carte: Carte = Carte.TEXTE, message: str = "", sources=()
    ) -> ToolResult:
        return cls(
            statut=Statut.OK,
            data=data,
            carte=carte,
            message=message,
            sources=tuple(sources),
        )

    @classmethod
    def vide(cls, message: str) -> ToolResult:
        """Aucun résultat, et c'est une réponse — pas une panne.

        Distinguée de `refus` pour que le modèle sache la différence entre
        « il n'y a rien » et « vous n'avez pas le droit ».
        """
        return cls(statut=Statut.VIDE, message=message)

    @classmethod
    def refus(cls, message: str) -> ToolResult:
        return cls(statut=Statut.REFUS, message=message)

    @classmethod
    def needs_confirmation(
        cls, *, message: str, preview: BaseModel, data: Any = None
    ) -> ToolResult:
        return cls(
            statut=Statut.CONFIRMATION,
            message=message,
            data=data if data is not None else preview.model_dump(mode="json"),
            carte=Carte.CONFIRMATION,
            brouillon=preview,
        )

    def pour_modele(self) -> dict[str, Any]:
        """Vue compacte, celle que le modèle relira.

        Les adresses de fichiers en sont retirées : elles servent à l'écran,
        jamais à la phrase.
        """
        charge: dict[str, Any] = {"statut": self.statut.value}
        if self.message:
            charge["message"] = self.message
        if self.data is not None:
            charge["donnees"] = _sans_adresses(self.data)
        if self.sources:
            charge["sources"] = list(self.sources)
        return charge


#: Suffixe des clés réservées à l'affichage. Leur valeur part dans la carte,
#: que le front sait rendre, et jamais dans ce que le modèle relit.
#:
#: Constaté sur « où se trouve la salle Vinci ? » : le modèle recevait
#: `plan_localisation_url` valant `/media/reperes/….jpg`, et le recopiait dans
#: sa phrase sous forme d'image Markdown — en lui inventant un hôte :
#:
#:     ![](http://media/reperes/bce1c0f355e743d4a4c440de8cfa6fcd.jpg)
#:
#: « media » y devient un nom de domaine. Le navigateur n'affiche qu'un lien
#: mort, à côté de la carte qui montrait déjà l'image, correctement.
#:
#: La règle est ici et non chez l'appelant : un outil peut oublier de signaler
#: qu'il rend une adresse, ce fichier ne peut pas oublier de la retirer.
SUFFIXE_ECRAN = "_url"


def _sans_adresses(valeur: Any) -> Any:
    """Recopie la donnée sans les clés d'affichage, à toute profondeur."""
    if isinstance(valeur, dict):
        return {
            cle: _sans_adresses(item)
            for cle, item in valeur.items()
            if not (isinstance(cle, str) and cle.endswith(SUFFIXE_ECRAN))
        }
    if isinstance(valeur, list):
        return [_sans_adresses(item) for item in valeur]
    return valeur


class Outil(ABC):
    """Contrat d'un outil.

    `SCHEMA` est la forme nue attendue par le catalogue — nom, description,
    `parameters`. Chaque fournisseur l'habille à sa façon : Ollama et les API
    compatibles OpenAI veulent l'enveloppe `{"type": "function", …}`, et un
    schéma envoyé sans elle est ignoré **sans erreur**.
    """

    SCHEMA: dict[str, Any]
    ARGUMENTS: type[BaseModel]
    DOMAINE: Domaine = Domaine.PARC
    #: Écriture : impose la confirmation, et interdit l'exécution par le repli
    #: déterministe sans validation humaine.
    ECRITURE: bool = False

    @property
    def nom(self) -> str:
        return self.SCHEMA["name"]

    @abstractmethod
    async def execute(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        """Exécute l'outil. Les arguments sont déjà validés par `valider`."""

    def valider(self, args: dict[str, Any]) -> BaseModel:
        """Valide les arguments produits par le modèle.

        Lève `ArgumentsInvalides` avec le détail des champs en faute : ce
        message repart au modèle pour une seconde tentative guidée. Une sortie
        approximative ne doit jamais atteindre la couche service.
        """
        try:
            return self.ARGUMENTS.model_validate(args)
        except ValidationError as souci:
            details = [
                {
                    "champ": ".".join(str(part) for part in erreur["loc"])
                    or "(racine)",
                    "probleme": erreur["msg"],
                }
                for erreur in souci.errors()
            ]
            raise ArgumentsInvalides(
                f"Arguments refusés pour {self.nom}.", fields=details
            ) from souci


class ArgumentsInvalides(DomainError):
    """Sortie de modèle malformée. Rattrapable par une nouvelle tentative."""

    code = "ia_arguments_invalides"
    http_status = 422

    def texte_pour_modele(self) -> str:
        details = "; ".join(
            f"{item['champ']} : {item['probleme']}" for item in self.fields
        )
        return (
            f"{self.message} Corrigez et rappelez l'outil. Détail : {details}. "
            "N'inventez aucune valeur : si une information manque, demandez-la."
        )

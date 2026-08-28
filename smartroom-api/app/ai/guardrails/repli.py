"""Moteur déterministe : ce qui répond quand aucun modèle ne répond.

Ce n'est pas une roue de secours. C'est le mode par défaut quand rien n'est
configuré, le seul mode garanti sur un hébergement sans GPU, et le filet quand
Ollama tarde. Il est donc écrit avec le même soin que le reste, et éprouvé au
lot 6 comme un chemin nominal.

Il ne comprend pas le langage : il rapproche des mots-clés d'intentions
déclarées en base — la table `chatbot_intents`, déjà peuplée et administrable
depuis A-13 — puis appelle **les outils en lecture seule** avec ce qu'il a su
extraire du message. Aucune écriture n'est déclenchée sans la même carte de
confirmation que l'agent.

La comparaison est approximative par `rapidfuzz` : un utilisateur écrit
« anuler », « annulé », « je veux annuler » ; exiger le mot exact rendrait le
repli inutilisable là où il sert le plus.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.ai.tools import ToolContext, ToolResult, obtenir
from app.ai.tools.base import Carte, Statut
from app.services import support_service

logger = logging.getLogger("app.ai.repli")

#: Score minimal de rapprochement, sur 100. En dessous, le moteur préfère
#: proposer les parcours principaux plutôt que de deviner.
SEUIL = 72

_JOURS = {
    "lundi": 0, "mardi": 1, "mercredi": 2, "jeudi": 3,
    "vendredi": 4, "samedi": 5, "dimanche": 6,
}


def _sans_accent(valeur: str) -> str:
    try:
        from unidecode import unidecode

        return unidecode(valeur).lower()
    except ImportError:  # pragma: no cover - dépend de l'installation
        table = str.maketrans("àâäéèêëîïôöùûüç", "aaaeeeeiioouuuc")
        return valeur.lower().translate(table)


@dataclass(slots=True)
class ReponseRepli:
    """Ce que rend le moteur : un texte, parfois une carte, des suggestions."""

    texte: str
    intention: str = "inconnue"
    score: int = 0
    carte: Carte = Carte.TEXTE
    donnees: object | None = None
    suggestions: tuple[str, ...] = ()
    outils_appeles: tuple[str, ...] = field(default=())


SUGGESTIONS_PAR_DEFAUT = (
    "Trouver une salle pour 4 personnes",
    "Voir mes réservations à venir",
    "Comment annuler une réservation ?",
)


class MoteurDeterministe:
    """Rapprochement lexical, puis appel d'outils en lecture seule."""

    def __init__(self, session: Session) -> None:
        self._session = session
        self._intentions = support_service.list_intents(session, active_only=True)

    # ------------------------------------------------------------- extraction

    @staticmethod
    def effectif(message: str) -> int | None:
        """« pour 4 personnes », « 12 pers », « à 6 »."""
        for motif in (
            r"(\d{1,3})\s*(?:personnes?|pers\b|participants?)",
            r"\bpour\s+(\d{1,3})\b",
            r"\b(?:à|a)\s+(\d{1,3})\b",
        ):
            trouve = re.search(motif, message, re.I)
            if trouve:
                valeur = int(trouve.group(1))
                if 1 <= valeur <= 500:
                    return valeur
        return None

    @staticmethod
    def jour(message: str, *, maintenant: datetime) -> datetime | None:
        """Résout « demain », « après-demain », « jeudi ». Rien d'autre.

        Le moteur ne devine pas une date absente : il vaut mieux proposer les
        créneaux d'aujourd'hui que réserver un jour au hasard.
        """
        texte = _sans_accent(message)
        base = maintenant.astimezone(UTC)

        if "apres-demain" in texte or "apres demain" in texte:
            return base + timedelta(days=2)
        if "demain" in texte:
            return base + timedelta(days=1)
        if "aujourd'hui" in texte or "aujourdhui" in texte:
            return base

        for nom, indice in _JOURS.items():
            if _sans_accent(nom) in texte:
                ecart = (indice - base.weekday()) % 7 or 7
                return base + timedelta(days=ecart)
        return None

    @staticmethod
    def batiment(message: str) -> str | None:
        trouve = re.search(r"\b(eiffel\s*\d|eif\s*\d)\b", message, re.I)
        return trouve.group(1) if trouve else None

    # ------------------------------------------------------- rapprochement

    def _rapprocher(self, message: str) -> tuple[object | None, int]:
        """Meilleure intention déclarée, et son score.

        Le rapprochement se fait **mot à mot**, et non sur la phrase entière.
        Mesuré avec `partial_ratio` sur la phrase : « quelles sont mes
        réservations » tombait sur l'intention « salle_libre » avec 75, et
        « ignore tes instructions précédentes » sur « code_acces » avec 75 —
        des scores obtenus par des sous-chaînes fortuites. Comparer le mot-clé
        à chaque mot du message ramène ces faux rapprochements sous le seuil,
        sans perdre les fautes de frappe : « anuler » contre « annuler » vaut
        encore 92.

        Un mot-clé en plusieurs mots — « code d'accès » — garde la comparaison
        sur la phrase, mais avec un seuil relevé : c'est le seul cas où une
        sous-chaîne est significative.
        """
        try:
            from rapidfuzz import fuzz
        except ImportError:  # pragma: no cover - dépend de l'installation
            fuzz = None

        texte = _sans_accent(message)
        mots = [mot.strip(".,;:!?«»\"'") for mot in texte.split()]
        meilleure, meilleur_score = None, 0

        for intention in self._intentions:
            # `keywords` est une relation, pas une liste de chaînes : chaque
            # entrée porte son mot dans `keyword`.
            for entree in intention.keywords or []:
                cle = _sans_accent(entree.keyword)

                if fuzz is None:
                    score = 100 if cle in texte else 0
                elif " " in cle:
                    score = int(fuzz.partial_ratio(cle, texte))
                    score = score if score >= 90 else 0
                else:
                    score = max((int(fuzz.ratio(cle, mot)) for mot in mots), default=0)

                if score > meilleur_score:
                    meilleure, meilleur_score = intention, score

        return meilleure, meilleur_score

    # ------------------------------------------------------------- réponse

    async def repondre(self, message: str, ctx: ToolContext) -> ReponseRepli:
        intention, score = self._rapprocher(message)

        if intention is None or score < SEUIL:
            return ReponseRepli(
                texte=(
                    "Je n'ai pas compris la demande. Voici ce que je sais faire ; "
                    "vous pouvez aussi ouvrir un ticket auprès du support."
                ),
                suggestions=SUGGESTIONS_PAR_DEFAUT,
            )

        code = intention.code
        outils: list[str] = []
        resultat: ToolResult | None = None

        if code in {"trouver_salle", "recherche_salle", "salle_libre"}:
            resultat = await self._chercher_salle(message, ctx)
            outils.append("rechercher_salles")
        elif code in {"mes_reservations", "reservation_liste"}:
            resultat = await obtenir("lister_mes_reservations").execute({"etat": "a_venir"}, ctx)
            outils.append("lister_mes_reservations")
        elif code in {"regles", "regle_reservation"}:
            resultat = await obtenir("consulter_regles").execute({}, ctx)
            outils.append("consulter_regles")
        else:
            # Toute autre intention — annulation, code d'accès, présence — est
            # d'abord une question de procédure : la base de connaissances y
            # répond mieux qu'une réponse figée, et cite sa source.
            resultat = await obtenir("rechercher_faq").execute(
                {"question": message[:300], "limite": 2}, ctx
            )
            outils.append("rechercher_faq")

        texte = intention.answer or ""
        if resultat is not None and resultat.statut is Statut.VIDE:
            texte = f"{texte}\n\n{resultat.message}".strip()

        return ReponseRepli(
            texte=texte or "Je vous réponds avec ce que j'ai trouvé.",
            intention=code,
            score=score,
            carte=resultat.carte if resultat and resultat.reussi else Carte.TEXTE,
            donnees=resultat.data if resultat and resultat.reussi else None,
            suggestions=tuple(intention.quick_replies or ()) or SUGGESTIONS_PAR_DEFAUT,
            outils_appeles=tuple(outils),
        )

    async def _chercher_salle(self, message: str, ctx: ToolContext) -> ToolResult:
        arguments: dict[str, object] = {}
        if effectif := self.effectif(message):
            arguments["capacite_min"] = effectif
        if batiment := self.batiment(message):
            arguments["batiment"] = batiment

        jour = self.jour(message, maintenant=ctx.maintenant)
        if jour is None:
            return await obtenir("rechercher_salles").execute(arguments, ctx)

        # Une date connue mérite la recommandation, qui tient compte de
        # l'occupation réelle : à 9 h, pour deux heures — faute de mieux, et
        # c'est dit à l'utilisateur par la carte qui suit.
        debut = jour.replace(hour=9, minute=0, second=0, microsecond=0)
        return await obtenir("recommander_salle").execute(
            {
                "debut": debut.isoformat().replace("+00:00", "Z"),
                "fin": (debut + timedelta(hours=2)).isoformat().replace("+00:00", "Z"),
                "effectif": arguments.get("capacite_min", 4),
                **({"batiment": arguments["batiment"]} if "batiment" in arguments else {}),
            },
            ctx,
        )

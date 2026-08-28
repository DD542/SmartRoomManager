"""Boucle d'agent : orchestration d'un tour de conversation.

Le déroulé suit le schéma du document d'architecture, et ses deux arêtes
importantes sont ici :

  * un outil d'écriture **termine le tour** sur une demande de confirmation ;
    le brouillon validé part au magasin, rien n'est écrit ;
  * une sortie inexploitable ou un délai dépassé **bascule sur le déterministe**
    au lieu d'être rattrapé par une interprétation approximative.

Le tour produit un flux d'`Evenement`. Rien n'est bufferisé sans raison : le
texte part au fur et à mesure, l'activité des outils aussi. Seule la réserve
d'étayage arrive après coup — la vérification demande la réponse entière, et
retenir la diffusion pour l'obtenir coûterait plus que ce qu'elle rapporte.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
import uuid
from collections.abc import AsyncIterator, Sequence
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.ai.agent import evenements as ev
from app.ai.agent.brouillons import MAGASIN, MagasinBrouillons
from app.ai.agent.contexte import ConstructeurContexte, Tour
from app.ai.agent.routage import router_domaines
from app.ai.guardrails import etayage, injection
from app.ai.guardrails.repli import MoteurDeterministe
from app.ai.prompts.chargeur import charger
from app.ai.providers.base import (
    AppelOutil,
    ErreurFournisseur,
    LLMProvider,
    Message,
    Mesures,
    RoleMessage,
    RoleModele,
    TypeFragment,
)
from app.ai.providers.selection import SelecteurModeles
from app.ai.reglages import get_reglages_ia
from app.ai.tools import ArgumentsInvalides, ToolContext, ToolResult, catalogue, obtenir
from app.ai.tools.base import Statut
from app.api.deps import Principal
from app.core.config import get_settings

logger = logging.getLogger("app.ai.agent")


class JournalTour:
    """Ce qu'on saura du tour une fois terminé. Alimente A-13."""

    def __init__(self) -> None:
        self.debut = time.perf_counter()
        self.mode = "modele"
        self.declencheur_repli: str | None = None
        self.iterations = 0
        #: Relances après une annonce d'acte non tenue. Chiffre utile à A-13 :
        #: s'il monte, c'est le prompt qu'il faut reprendre, pas la boucle.
        self.relances = 0
        self.outils: list[dict] = []
        self.mesures: Mesures | None = None
        self.contexte: dict | None = None
        self.injection: dict | None = None
        self.etayage: dict | None = None
        self.sources: list[str] = []

    def pour_journal(self) -> dict:
        return {
            "mode": self.mode,
            "repli": self.mode == "repli",
            "declencheur_repli": self.declencheur_repli,
            "iterations": self.iterations,
            "relances": self.relances,
            "outils": [item["outil"] for item in self.outils],
            "duree_ms": int((time.perf_counter() - self.debut) * 1000),
            "modele": self.mesures.modele if self.mesures else None,
            "premier_jeton_ms": self.mesures.premier_jeton_ms if self.mesures else None,
            "jetons_invite": self.mesures.jetons_invite if self.mesures else 0,
            "jetons_reponse": self.mesures.jetons_reponse if self.mesures else 0,
            "contexte": self.contexte,
            **(self.injection or {}),
            **(self.etayage or {}),
        }


class Agent:
    """Un tour de conversation, du message à la réponse."""

    def __init__(
        self,
        session: Session,
        principal: Principal,
        *,
        selecteur: SelecteurModeles | None = None,
        magasin: MagasinBrouillons | None = None,
    ) -> None:
        self._session = session
        self._principal = principal
        self._selecteur = selecteur or SelecteurModeles()
        self._magasin = magasin or MAGASIN
        self._reglages = get_reglages_ia()

    # ------------------------------------------------------------------ tour

    async def repondre(
        self,
        message: str,
        *,
        historique: Sequence[Tour] = (),
        resume: str = "",
        conversation_id: uuid.UUID | None = None,
        maintenant: datetime | None = None,
    ) -> AsyncIterator[ev.Evenement]:
        journal = JournalTour()
        maintenant = maintenant or datetime.now(UTC)

        inspection = injection.assainir(message, taille_max=self._reglages.taille_message)
        journal.injection = inspection.pour_journal()
        if inspection.suspect:
            # Journalisé, jamais bloqué à ce stade : c'est la structure du
            # prompt qui protège, et refuser ici punirait un utilisateur qui a
            # simplement écrit « ignore les règles » dans une phrase anodine.
            logger.warning("Message suspect", extra=journal.injection)

        if not inspection.texte:
            yield ev.erreur("message_vide", "Le message est vide.")
            yield ev.Evenement(type=ev.TypeEvenement.FIN, donnees=journal.pour_journal())
            return

        contexte_outils = ToolContext(
            session=self._session, principal=self._principal, maintenant=maintenant
        )

        try:
            fournisseur, modele = await self._selecteur.pour(RoleModele.RAISONNEMENT)
        except ErreurFournisseur as souci:
            async for evenement in self._repli(
                inspection.texte, contexte_outils, journal, declencheur=souci.code
            ):
                yield evenement
            return

        yield ev.Evenement(
            type=ev.TypeEvenement.DEBUT, donnees={"mode": "modele", "modele": modele}
        )

        try:
            async for evenement in self._tour_modele(
                inspection.texte,
                fournisseur=fournisseur,
                modele=modele,
                contexte_outils=contexte_outils,
                historique=historique,
                resume=resume,
                conversation_id=conversation_id,
                journal=journal,
                maintenant=maintenant,
            ):
                yield evenement
        except ErreurFournisseur as souci:
            logger.info("Bascule sur le repli", extra={"code": souci.code})
            # Le début a déjà été annoncé en mode « modèle » : le réannoncer
            # ferait afficher deux ouvertures de tour à l'écran. La bascule est
            # signalée par le seul champ `mode` de l'événement de fin.
            async for evenement in self._repli(
                inspection.texte,
                contexte_outils,
                journal,
                declencheur=souci.code,
                annoncer_debut=False,
            ):
                yield evenement
            return

        yield ev.Evenement(type=ev.TypeEvenement.FIN, donnees=journal.pour_journal())

    # ----------------------------------------------------------- tour modèle

    async def _tour_modele(
        self,
        message: str,
        *,
        fournisseur: LLMProvider,
        modele: str,
        contexte_outils: ToolContext,
        historique: Sequence[Tour],
        resume: str,
        conversation_id: uuid.UUID | None,
        journal: JournalTour,
        maintenant: datetime,
    ) -> AsyncIterator[ev.Evenement]:
        domaines = await router_domaines(message, self._selecteur)
        outils = catalogue(domaines)

        prompt = charger(self._reglages.prompt_systeme_version)
        constructeur = ConstructeurContexte(self._reglages)
        messages, mesures_contexte, _ = await constructeur.construire(
            systeme=prompt.avec_contexte(maintenant=maintenant, fuseau=get_settings().timezone),
            message_courant=message,
            historique=historique,
            resume_existant=resume,
        )
        journal.contexte = {
            "jetons": mesures_contexte.total,
            "tours": mesures_contexte.tours_retenus,
            "outils_exposes": len(outils),
        }

        preuves: list[str] = []
        reponse: list[str] = []
        debut_tour = time.perf_counter()

        relance_faite = False

        for iteration in range(1, self._reglages.max_iterations + 1):
            journal.iterations = iteration

            if (time.perf_counter() - debut_tour) * 1000 > self._reglages.budget_tour_ms:
                yield ev.texte(
                    "\n\nJe m'arrête là : la recherche prend trop de temps. "
                    "Reformulez, ou ouvrez un ticket."
                )
                break

            appels: list[AppelOutil] = []
            mesures = None

            async for fragment in fournisseur.discuter(
                messages,
                modele=modele,
                outils=outils,
                temperature=self._reglages.temperature,
                max_jetons=self._reglages.max_jetons_reponse,
            ):
                if fragment.type is TypeFragment.TEXTE:
                    reponse.append(fragment.texte)
                    yield ev.texte(fragment.texte)
                elif fragment.type is TypeFragment.OUTILS:
                    appels = list(fragment.appels)
                elif fragment.type is TypeFragment.FIN:
                    mesures = fragment.mesures

            journal.mesures = mesures

            if not appels:
                # « Je recherche une salle… veuillez patienter un instant »,
                # puis plus rien : le modèle annonce l'acte au lieu de le
                # faire, et le tour s'achève sur une promesse que personne ne
                # tient. Le texte est déjà parti à l'écran — on ne peut pas le
                # reprendre —, alors on tient la promesse à sa place, une fois.
                if relance_faite or not _annonce_sans_acte("".join(reponse)):
                    break
                relance_faite = True
                journal.relances += 1
                messages.append(Message(role=RoleMessage.ASSISTANT, contenu="".join(reponse)))
                messages.append(Message(role=RoleMessage.SYSTEME, contenu=RAPPEL_ACTE))
                continue

            if len(appels) > self._reglages.max_outils_par_tour:
                appels = appels[: self._reglages.max_outils_par_tour]

            # Un appel d'écriture termine le tour : il ne s'exécute pas, il se
            # propose. Les lectures qui l'accompagnent sont abandonnées — leur
            # résultat ne servirait qu'au tour suivant, qui les redemandera.
            ecriture = next((appel for appel in appels if _est_ecriture(appel.nom)), None)
            if ecriture is not None:
                async for evenement in self._proposer_ecriture(
                    ecriture, contexte_outils, conversation_id, journal
                ):
                    yield evenement
                return

            messages.append(
                Message(role=RoleMessage.ASSISTANT, contenu="".join(reponse), appels=tuple(appels))
            )
            reponse.clear()

            resultats = await self._executer(appels, contexte_outils, journal)

            for appel, resultat in resultats:
                yield ev.outil(
                    appel.nom,
                    etat="fini",
                    libelle=ev.LIBELLES.get(appel.nom, appel.nom),
                    duree_ms=next(
                        (item["duree_ms"] for item in journal.outils if item["appel"] == appel.identifiant),
                        None,
                    ),
                )
                if resultat.reussi and resultat.data is not None:
                    yield ev.carte(resultat.carte.value, resultat.data)
                if resultat.sources:
                    journal.sources.extend(resultat.sources)

                charge = resultat.pour_modele()
                preuves.append(str(charge))
                messages.append(
                    Message(
                        role=RoleMessage.OUTIL,
                        contenu=str(charge),
                        outil_nom=appel.nom,
                        outil_id=appel.identifiant,
                    )
                )
        else:
            yield ev.texte(
                "\n\nJe n'ai pas abouti après plusieurs recherches. "
                "Reformulez votre demande, ou je passe la main au support."
            )

        texte_final = "".join(reponse)
        if journal.sources:
            yield ev.Evenement(
                type=ev.TypeEvenement.SOURCES,
                donnees={"sources": list(dict.fromkeys(journal.sources))},
            )

        verdict = etayage.verifier(
            texte_final, "\n".join(preuves), outils_appeles=len(journal.outils)
        )
        journal.etayage = verdict.pour_journal()
        if (reserve := verdict.reserve) is not None:
            yield ev.Evenement(type=ev.TypeEvenement.RESERVE, donnees={"message": reserve})

    # -------------------------------------------------------------- outils

    async def _executer(
        self, appels: Sequence[AppelOutil], ctx: ToolContext, journal: JournalTour
    ) -> list[tuple[AppelOutil, ToolResult]]:
        """Exécute les appels, en parallèle quand ils sont indépendants.

        Les outils de ce catalogue sont tous en lecture à ce stade — l'écriture
        a quitté la boucle plus haut — et lisent la même session. La
        parallélisation porte donc sur l'attente, pas sur l'écriture : les
        coroutines s'entrelacent, la session reste utilisée par une seule à la
        fois puisque SQLAlchemy y est synchrone.
        """
        deja_vus: set[str] = set()
        taches = []
        retenus: list[AppelOutil] = []

        for appel in appels:
            signature = appel.signature()
            if signature in deja_vus:
                # Le même appel, deux fois dans un tour : le second n'apporterait
                # rien et coûterait une requête.
                continue
            deja_vus.add(signature)
            retenus.append(appel)
            taches.append(self._executer_un(appel, ctx, journal))

        return list(zip(retenus, await asyncio.gather(*taches), strict=True))

    async def _executer_un(
        self, appel: AppelOutil, ctx: ToolContext, journal: JournalTour
    ) -> ToolResult:
        depart = time.perf_counter()
        outil = obtenir(appel.nom)

        if outil is None:
            # Nom inventé par le modèle. Le lui dire vaut mieux que l'ignorer :
            # il rappellera le bon outil au tour suivant.
            journal.outils.append(
                {"outil": appel.nom, "appel": appel.identifiant, "statut": "inconnu", "duree_ms": 0}
            )
            return ToolResult.refus(
                f"L'outil « {appel.nom} » n'existe pas. Outils disponibles : "
                + ", ".join(item["name"] for item in catalogue())
            )

        try:
            resultat = await outil.execute(appel.arguments, ctx)
        except ArgumentsInvalides as souci:
            resultat = ToolResult.refus(souci.texte_pour_modele())
        except Exception as souci:  # noqa: BLE001 - un outil ne casse pas le tour
            logger.exception("Outil en échec", extra={"outil": appel.nom})
            resultat = ToolResult.refus(
                f"L'outil « {appel.nom} » a échoué : {type(souci).__name__}."
            )

        journal.outils.append(
            {
                "outil": appel.nom,
                "appel": appel.identifiant,
                "statut": resultat.statut.value,
                "duree_ms": int((time.perf_counter() - depart) * 1000),
            }
        )
        return resultat

    async def _proposer_ecriture(
        self,
        appel: AppelOutil,
        ctx: ToolContext,
        conversation_id: uuid.UUID | None,
        journal: JournalTour,
    ) -> AsyncIterator[ev.Evenement]:
        outil = obtenir(appel.nom)
        if outil is None:
            yield ev.erreur("outil_inconnu", f"L'outil « {appel.nom} » n'existe pas.")
            return

        yield ev.outil(appel.nom, etat="debut", libelle=ev.LIBELLES.get(appel.nom, appel.nom))

        try:
            resultat = await outil.execute(appel.arguments, ctx)
        except ArgumentsInvalides as souci:
            yield ev.erreur("arguments_invalides", souci.message)
            journal.outils.append({"outil": appel.nom, "appel": appel.identifiant,
                                   "statut": "arguments_invalides", "duree_ms": 0})
            return

        journal.outils.append(
            {"outil": appel.nom, "appel": appel.identifiant, "statut": resultat.statut.value,
             "duree_ms": 0}
        )

        if resultat.statut is Statut.CONFIRMATION and resultat.brouillon is not None:
            jeton = self._magasin.deposer(
                outil=appel.nom,
                apercu=resultat.brouillon,
                utilisateur_id=self._principal.user.id,
                conversation_id=conversation_id,
            )
            yield ev.confirmation(
                jeton=jeton,
                message=resultat.message,
                apercu=resultat.data,
                outil_nom=appel.nom,
            )
            return

        # Refus métier — créneau pris, quota, règle — ou résultat vide : c'est
        # une réponse, pas une confirmation.
        yield ev.texte(resultat.message)
        if resultat.data is not None:
            yield ev.carte(resultat.carte.value, resultat.data)

    # ------------------------------------------------------------ exécution

    async def confirmer(
        self, jeton: str, *, maintenant: datetime | None = None
    ) -> AsyncIterator[ev.Evenement]:
        """Exécute un brouillon validé. Ne relit jamais la sortie du modèle."""
        journal = JournalTour()
        journal.mode = "confirmation"
        maintenant = maintenant or datetime.now(UTC)

        brouillon = self._magasin.retirer(jeton, utilisateur_id=self._principal.user.id)
        if brouillon is None:
            yield ev.erreur(
                "confirmation_expiree",
                "Cette demande n'est plus valable. Reformulez-la, le créneau a pu changer.",
            )
            yield ev.Evenement(type=ev.TypeEvenement.FIN, donnees=journal.pour_journal())
            return

        outil = obtenir(brouillon.outil)
        if outil is None:
            yield ev.erreur("outil_inconnu", "L'action demandée n'existe plus.")
            yield ev.Evenement(type=ev.TypeEvenement.FIN, donnees=journal.pour_journal())
            return

        ctx = ToolContext(
            session=self._session,
            principal=self._principal,
            confirmed=True,
            maintenant=maintenant,
        )

        yield ev.outil(brouillon.outil, etat="debut", libelle=ev.LIBELLES.get(brouillon.outil, ""))
        resultat = await outil.execute(brouillon.arguments, ctx)
        journal.outils.append(
            {"outil": brouillon.outil, "appel": jeton[:8], "statut": resultat.statut.value,
             "duree_ms": int((time.perf_counter() - journal.debut) * 1000)}
        )

        yield ev.texte(resultat.message)
        if resultat.data is not None:
            yield ev.carte(resultat.carte.value, resultat.data)
        yield ev.Evenement(type=ev.TypeEvenement.FIN, donnees=journal.pour_journal())

    # ---------------------------------------------------------------- repli

    async def _repli(
        self,
        message: str,
        ctx: ToolContext,
        journal: JournalTour,
        *,
        declencheur: str,
        annoncer_debut: bool = True,
    ) -> AsyncIterator[ev.Evenement]:
        journal.mode = "repli"
        journal.declencheur_repli = declencheur

        if annoncer_debut:
            yield ev.Evenement(
                type=ev.TypeEvenement.DEBUT, donnees={"mode": "repli", "modele": None}
            )

        moteur = MoteurDeterministe(self._session)
        reponse = await moteur.repondre(message, ctx)
        journal.outils.extend(
            {"outil": nom, "appel": "repli", "statut": "ok", "duree_ms": 0}
            for nom in reponse.outils_appeles
        )

        yield ev.texte(reponse.texte)
        if reponse.donnees is not None:
            yield ev.carte(reponse.carte.value, reponse.donnees)
        if reponse.suggestions:
            yield ev.Evenement(
                type=ev.TypeEvenement.SUGGESTIONS,
                donnees={"suggestions": list(reponse.suggestions)},
            )

        journal.contexte = {"intention": reponse.intention, "score": reponse.score}
        yield ev.Evenement(type=ev.TypeEvenement.FIN, donnees=journal.pour_journal())


#: Ce que le modèle écrit quand il annonce au lieu d'agir. Le prompt le lui
#: interdit déjà — « tu fais, puis tu dis le résultat » — mais un modèle de 7
#: milliards de paramètres y retombe, surtout sur une question de suivi.
_ANNONCE = re.compile(
    r"(un instant|veuillez patienter|je vous (?:reviens|réponds) dans|"
    r"je (?:vais|vais vous|recherche|cherche|regarde|consulte|vérifie|verifie))\b",
    re.IGNORECASE,
)

RAPPEL_ACTE = (
    "Tu viens d'annoncer une recherche sans l'exécuter. Appelle maintenant "
    "l'outil correspondant, puis donne le résultat. N'annonce plus rien."
)


def _annonce_sans_acte(texte: str) -> bool:
    """Le tour s'est-il achevé sur une promesse ?

    Seul un tour sans aucun appel d'outil arrive ici : le texte est donc tout
    ce que l'utilisateur a reçu. S'il annonce une action, elle n'a pas eu lieu.
    """
    return bool(texte.strip()) and _ANNONCE.search(texte) is not None


def _est_ecriture(nom: str) -> bool:
    from app.ai.tools import ecritures

    return nom in ecritures()

"""Rendu des gabarits de courriel et remise au transport.

Les gabarits vivent en base : l'administration les modifie depuis l'écran A-16
sans redéploiement. Le rendu passe par Jinja2 en **bac à sable** — un gabarit
est du contenu saisi par un administrateur, pas du code de confiance : sans
sandbox, `{{ ''.__class__.__mro__ }}` ouvrirait l'interpréteur.

Un gabarit désactivé ne bloque rien : l'action métier a déjà eu lieu, et ne pas
prévenir vaut mieux que la faire échouer.
"""

from __future__ import annotations

import re

import logging
import threading
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import aiosmtplib
from jinja2 import TemplateError, meta
from jinja2.sandbox import SandboxedEnvironment
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import NotFoundError, RuleViolationError
from app.db.enums import NotificationChannel
from app.models import EmailTemplate, EmailTemplateVariable, Notification, User

logger = logging.getLogger(__name__)


def _config():
    """Configuration lue à l'appel, jamais figée à l'import.

    `settings = get_settings()` au niveau du module gelait la configuration au
    premier import : invalider le cache — ce que font les tests pour se
    brancher sur leur base — ne changeait plus rien ici. La suite de tests a
    ainsi déposé de vrais courriels dans la boîte de développement d'un poste
    où l'envoi était activé, et se mettait à dépendre d'un relais allumé.

    `get_settings` est mémoïsé : la relire à chaque appel ne coûte rien.
    """
    return get_settings()

#: `SandboxedEnvironment` bloque l'accès aux attributs internes. `autoescape`
#: reste désactivé : ces gabarits produisent du texte, pas du HTML, et
#: échapper transformerait « L'Atelier » en « L&#39;Atelier ».
JINJA = SandboxedEnvironment(autoescape=False, trim_blocks=True, lstrip_blocks=True)

FUSEAU = ZoneInfo(get_settings().timezone)

#: Port réservé au SMTP sur TLS implicite (SMTPS).
PORT_SMTPS = 465

_JOURS = ("lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche")
_MOIS = (
    "janvier", "février", "mars", "avril", "mai", "juin",
    "juillet", "août", "septembre", "octobre", "novembre", "décembre",
)


def date_et_creneau(debut: datetime, fin: datetime) -> dict[str, str]:
    """`date` et `creneau` en français, en heure locale.

    Ici et non chez l'appelant : deux gabarits déclenchés par deux traitements
    différents parlent de la même réservation, et « jeudi 26 mars 2026 » d'un
    côté contre « 2026-03-26T14:00:00+01:00 » de l'autre se lit comme deux
    systèmes distincts.
    """
    local_debut = debut.astimezone(FUSEAU)
    local_fin = fin.astimezone(FUSEAU)
    return {
        "date": (
            f"{_JOURS[local_debut.weekday()]} {local_debut.day} "
            f"{_MOIS[local_debut.month - 1]} {local_debut.year}"
        ),
        "creneau": f"{local_debut:%H:%M} - {local_fin:%H:%M}",
    }


@dataclass(frozen=True, slots=True)
class Message:
    """Un courriel prêt à partir, indépendant du transport."""

    to: str
    subject: str
    body: str


def render(template: str, variables: dict[str, Any]) -> str:
    """Rend un gabarit. Une variable absente devient une chaîne vide.

    Faire échouer un envoi parce qu'une variable manque priverait
    l'utilisateur d'une information au lieu de lui en donner une incomplète.
    """
    try:
        return JINJA.from_string(template).render(**variables)
    except TemplateError as erreur:
        raise RuleViolationError(
            f"Gabarit invalide : {erreur}", code="gabarit_invalide"
        ) from erreur


def get_template(session: Session, code: str) -> EmailTemplate | None:
    return session.scalars(
        select(EmailTemplate).where(EmailTemplate.code == code)
    ).one_or_none()


def known_variables(session: Session) -> list[EmailTemplateVariable]:
    return list(session.scalars(select(EmailTemplateVariable).order_by(EmailTemplateVariable.code)))


def preview(session: Session, code: str, variables: dict[str, Any] | None = None) -> Message:
    """Rend un gabarit avec les valeurs d'exemple, sans rien envoyer."""
    gabarit = get_template(session, code)
    if gabarit is None:
        raise NotFoundError("Gabarit introuvable.")

    valeurs = {item.code: item.sample_value for item in known_variables(session)}
    valeurs.update(variables or {})

    return Message(
        to=valeurs.get("destinataire", _config().mail_from),
        subject=render(gabarit.subject, valeurs),
        body=render(gabarit.body, valeurs),
    )


async def send(message: Message) -> None:
    """Remet un message au transport SMTP.

    Sans transport actif, le message est tracé : en développement, lire le
    journal vaut mieux qu'un envoi silencieusement perdu.
    """
    if not _config().mail_enabled:
        # Le destinataire et l'objet, jamais le corps : un courriel de
        # confirmation porte le code d'accès de la porte, et le journal n'est
        # pas un endroit où le déposer.
        logger.info(
            "Courriel non envoyé (MAIL_ENABLED=false) → %s : %s",
            message.to,
            message.subject,
        )
        return

    from email.message import EmailMessage

    courriel = EmailMessage()
    courriel["From"] = _config().mail_from
    courriel["To"] = message.to
    courriel["Subject"] = message.subject
    courriel.set_content(message.body)

    # Deux façons de chiffrer, et le port les départage. 465 est le port
    # réservé au SMTPS : la connexion est chiffrée dès le premier octet, et
    # y annoncer STARTTLS fait échouer la poignée de main. Partout ailleurs —
    # 587 en tête, celui que recommandent Gmail, Outlook et les services
    # d'envoi — c'est STARTTLS sur une connexion d'abord en clair.
    #
    # Sans cette distinction, toute configuration sur 465 échouait sans autre
    # explication qu'une erreur de poignée de main dans le journal.
    implicite = _config().smtp_use_tls and _config().smtp_port == PORT_SMTPS

    try:
        await aiosmtplib.send(
            courriel,
            hostname=_config().smtp_host,
            port=_config().smtp_port,
            username=_config().smtp_user,
            password=(
                _config().smtp_password.get_secret_value() if _config().smtp_password else None
            ),
            use_tls=implicite,
            start_tls=_config().smtp_use_tls and not implicite,
        )
    except (aiosmtplib.SMTPException, OSError):
        # Un serveur de courriel indisponible ne doit pas faire échouer une
        # réservation déjà écrite : l'incident est tracé, l'action tient.
        #
        # C'est aussi le seul endroit où un refus du relais se lit — adresse
        # d'expéditeur non autorisée, mot de passe d'application expiré. Le
        # message porte le destinataire ; l'exception porte le refus du serveur,
        # mot pour mot.
        logger.exception("Envoi SMTP impossible → %s", message.to)


#: Variables dont la valeur ne doit jamais atteindre la base.
#:
#: Le courriel les porte — c'est ainsi que l'organisateur reçoit son code, une
#: fois. La notification applicative, elle, est écrite en base et s'affiche
#: indéfiniment : elle gardait en clair le secret que tout le reste protège.
#: `booking_access_codes` n'en conserve qu'une empreinte, la fiche affiche
#: « E-**** », et les mentions légales affirment que le code complet n'existe
#: qu'à l'instant de son émission.
#:
#: La liste est ici, et non chez l'appelant : un appelant peut oublier de
#: signaler son secret, ce fichier ne peut pas oublier de le masquer.
VARIABLES_SECRETES = frozenset({"code_acces"})

#: Un code émis : une lettre, un tiret, quatre chiffres.
_FORME_DU_CODE = re.compile(r"^([A-Za-z])-\d{4}$")


def masquer_secret(valeur: Any) -> str:
    """Rend l'indice d'un secret, ou rien.

    Un code reconnu garde sa première lettre — « E-**** », comme la fiche de
    réservation — parce qu'elle aide à reconnaître le bon code parmi plusieurs
    sans rien révéler. Une valeur d'une autre forme disparaît entièrement :
    mieux vaut perdre un renseignement que le divulguer, et le jour où la forme
    du code changera, ce masque-là ne laissera rien passer.
    """
    if valeur in (None, ""):
        return ""

    trouve = _FORME_DU_CODE.match(str(valeur))
    return f"{trouve.group(1)}-****" if trouve else "****"


def notify(
    session: Session,
    *,
    user: User,
    code: str,
    variables: dict[str, Any],
    booking_id: Any = None,
    ticket_id: Any = None,
) -> Notification | None:
    """Rend le gabarit, persiste la notification applicative, prépare l'envoi.

    La notification est écrite dans la même transaction que l'action qui la
    déclenche : une réservation annulée ne doit pas laisser un « votre
    réservation est annulée » derrière elle, ni l'inverse.
    """
    gabarit = get_template(session, code)
    if gabarit is None or not gabarit.is_enabled:
        # Un gabarit absent ou désactivé ne bloque rien : l'action a eu lieu.
        logger.info("Gabarit « %s » absent ou désactivé, notification ignorée.", code)
        return None

    # Aucune valeur d'exemple ici. Les seeder « pour ne rien laisser vide »
    # remplissait les trous avec la fiche de démonstration : le rappel avant
    # réunion annonçait à chaque utilisateur le code d'accès « A-4821 » et le
    # créneau « 14:00 - 15:30 », plausibles et faux. Un champ sans valeur reste
    # vide — visible, donc corrigeable. Les exemples servent à `preview`, qui
    # n'envoie rien.
    valeurs = {"prenom": user.first_name, "nom": user.last_name, **variables}
    _alerter_variables_manquantes(code, gabarit, valeurs)

    titre = render(gabarit.subject, valeurs)
    corps = render(gabarit.body, valeurs)

    # Deux rendus, deux destinations. Le masquage porte sur la **valeur**,
    # avant le rendu : une expression régulière passée sur le texte rendu
    # dépendrait de la forme que le gabarit donne au code, et l'administration
    # peut réécrire ce gabarit.
    sans_secrets = {
        **valeurs,
        **{nom: masquer_secret(valeurs[nom]) for nom in VARIABLES_SECRETES & valeurs.keys()},
    }
    titre_stocke = render(gabarit.subject, sans_secrets)
    corps_stocke = render(gabarit.body, sans_secrets)

    notification = Notification(
        user_id=user.id,
        title=titre_stocke,
        body=corps_stocke,
        channel=NotificationChannel.IN_APP,
        # Le gabarit d'origine : c'est lui qui dit ce que la notification
        # propose de faire, et l'écran n'a pas à le deviner d'après son titre.
        template_code=code,
        booking_id=booking_id,
        ticket_id=ticket_id,
    )
    session.add(notification)
    session.flush()

    _deposer(Message(to=user.email, subject=titre, body=corps))
    return notification


def _alerter_variables_manquantes(
    code: str, gabarit: EmailTemplate, valeurs: dict[str, Any]
) -> None:
    """Journalise les variables que le gabarit attend et que l'appelant n'a pas.

    Un trou dans un courriel ne lève rien : il se lit chez le destinataire, des
    jours plus tard. Le signaler ici est le dernier moment où quelqu'un peut
    encore le voir.
    """
    attendues: set[str] = set()
    for source in (gabarit.subject, gabarit.body):
        try:
            attendues |= meta.find_undeclared_variables(JINJA.parse(source))
        except TemplateError:
            return
    manquantes = sorted(attendues - valeurs.keys())
    if manquantes:
        logger.warning(
            "Gabarit « %s » : variables sans valeur, rendues vides → %s",
            code,
            ", ".join(manquantes),
        )


#: Les envois sont différés hors de la transaction : expédier avant le COMMIT
#: annoncerait une réservation qu'un `ROLLBACK` ferait disparaître.
#:
#: La file est commune au processus, et les routes synchrones tournent dans un
#: pool de fils : le verrou garantit qu'une prise de file ne perde pas un
#: message déposé au même instant. Un message peut donc partir avec
#: l'expédition d'une autre requête — sans conséquence, chacun ayant son
#: propre destinataire.
_en_attente: list[Message] = []
_verrou = threading.Lock()


def pending() -> list[Message]:
    with _verrou:
        return list(_en_attente)


def flush() -> list[Message]:
    """Vide la file et rend les messages à expédier."""
    with _verrou:
        messages = list(_en_attente)
        del _en_attente[:]
    return messages


async def expedier() -> None:
    """Vide la file et remet chaque message au transport.

    Appelée après le COMMIT — en tâche de fond de la requête qui a écrit, et
    par l'ordonnanceur pour ce que produisent ses propres traitements. Sans
    cette seconde voie, une confirmation attendait le prochain passage de
    maintenance : cinq minutes par défaut, et rien du tout si l'ordonnanceur
    était arrêté.
    """
    for message in flush():
        await send(message)


def queue_password_reset(session: Session, compte: User, jeton: str) -> Message:
    """Prépare le lien de réinitialisation.

    Ce message ne passe pas par un gabarit modifiable : un administrateur ne
    doit pas pouvoir casser le seul chemin de récupération d'un compte.
    """
    lien = f"{_origine()}/mot-de-passe/reinitialiser?token={jeton}"
    message = Message(
        to=compte.email,
        subject="Réinitialisation de votre mot de passe SmartRoom",
        body=(
            f"Bonjour {compte.first_name},\n\n"
            "Vous avez demandé à réinitialiser votre mot de passe. "
            f"Ce lien est valable {_config().reset_ttl_minutes} minutes et ne "
            f"fonctionne qu'une fois :\n\n{lien}\n\n"
            "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : "
            "votre mot de passe reste inchangé."
        ),
    )
    _deposer(message)
    return message


def lien_reservation(booking_id: Any) -> str:
    """Adresse de la réservation dans l'écran de gestion.

    Le chemin est celui du routeur du front, `/app/reservations/:id` : un
    courriel qui invite à « gérer sa réservation » et dépose sur une page
    inexistante ne vaut pas mieux qu'un courriel sans lien.
    """
    return f"{_origine()}/app/reservations/{booking_id}"


def queue_invitation(
    *,
    email: str,
    nom: str,
    organisateur: str,
    titre: str,
    salle: str,
    debut,
    fin,
    jeton: str,
) -> Message:
    """Prépare l'invitation d'un participant.

    Comme la réinitialisation de mot de passe, ce message ne passe pas par un
    gabarit modifiable, et pour la même raison : il porte le seul lien qui
    permet de répondre. Un gabarit désactivé par inadvertance — cas prévu et
    silencieux — rendrait toutes les invitations muettes, et l'organisateur
    n'apprendrait qu'en réunion que personne n'a été prévenu.

    Aucune notification applicative n'est écrite : un invité n'a pas
    nécessairement de compte, et `notify` exige un utilisateur.
    """
    lien = f"{_origine()}/invitation/{jeton}"
    horaire = date_et_creneau(debut, fin)

    return _deposer(
        Message(
            to=email,
            subject=f"{organisateur} vous invite : {titre}",
            body=(
                f"Bonjour {nom},\n\n"
                f"{organisateur} vous invite à « {titre} ».\n\n"
                f"Salle {salle}\n"
                f"{horaire['date']}, {horaire['creneau']}\n\n"
                "Pour accepter ou décliner :\n"
                f"{lien}\n\n"
                "Ce lien vous est personnel et cesse de fonctionner à la fin de la "
                "réunion — répondre à une réunion passée n'aurait aucun sens."
            ),
        )
    )


def _deposer(message: Message) -> Message:
    """Dépose un message dans la file, sous verrou."""
    with _verrou:
        _en_attente.append(message)
    return message


def _origine() -> str:
    """Première origine autorisée : celle du front."""
    return _config().cors_origins[0] if _config().cors_origins else "http://localhost:5173"

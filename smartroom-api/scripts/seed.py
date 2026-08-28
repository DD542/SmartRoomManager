"""Jeu de démonstration de SmartRoom Manager.

Reprend les entités des maquettes : trois bâtiments, huit salles nommées, sept
équipements, une trentaine d'utilisateurs et environ deux cents réservations
réparties sur six semaines, afin que les statistiques d'occupation soient
réalistes dès la première exécution.

La fenêtre est ancrée sur la date du jour — trois semaines passées, trois à
venir — et non sur une date figée : un tableau de bord « sept derniers jours »
doit avoir des données quelle que soit la date d'exécution.

Deux cas de conflit et un jour de fermeture sont inclus volontairement.

Note importante : la contrainte `ex_bookings_no_overlap` rend deux réservations
qui se chevauchent physiquement impossibles. Un « cas de conflit » est donc une
*demande* portant sur un créneau déjà pris, en attente d'arbitrage — exactement
ce que traite l'écran A-04.

Usage :
    python -m scripts.seed            # peuple la base
    python -m scripts.seed --reset    # vide les données métier puis peuple
"""

from __future__ import annotations

import argparse
import random
import sys
import uuid
from collections import defaultdict
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from passlib.context import CryptContext
from sqlalchemy import delete, select, text
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.orm import Session

from app.core import storage
from app.core.config import get_settings
from app.db.enums import (
    AccessType,
    ArticleStatus,
    AuditAction,
    BookingEventType,
    BookingSource,
    BookingStatus,
    ClosureKind,
    EquipmentCategory,
    NotificationChannel,
    ParticipantResponse,
    RequestStatus,
    RoomStatus,
    RuleScope,
    TicketStatus,
    UserStatus,
)
from app.db.session import SessionLocal, engine
from app.services import booking_service
from app.models import (
    AccessRequest,
    AdminAccount,
    AdminPermission,
    Booking,
    BookingAccessCode,
    BookingEvent,
    BookingParticipant,
    BookingRule,
    Building,
    ChatbotIntent,
    ChatbotIntentKeyword,
    ClosureBuilding,
    ClosurePeriod,
    EmailTemplate,
    Equipment,
    FaqArticle,
    FaqCategory,
    Floor,
    Notification,
    OpeningHour,
    Permission,
    Room,
    RoomEquipment,
    RoomPhoto,
    RoomPlacement,
    Ticket,
    TicketMessage,
    TicketResponseTemplate,
    User,
    UserPreference,
)

PARIS = ZoneInfo("Europe/Paris")
ALEA = random.Random(20260326)

#: Mot de passe unique des comptes de démonstration. Haché par bcrypt comme en
#: production : la base ne contient aucun mot de passe en clair.
MOT_DE_PASSE_DEMO = "smartroom2026"
CRYPT = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=10)

AUJOURD_HUI = date.today()
DEBUT_FENETRE = AUJOURD_HUI - timedelta(days=21)
FIN_FENETRE = AUJOURD_HUI + timedelta(days=21)
#: Jour férié inséré volontairement pour démontrer le moteur de fermeture.
JOUR_FERME = AUJOURD_HUI + timedelta(days=10)


def horodate(jour: date, heure: time) -> datetime:
    """Assemble une date locale : les créneaux sont saisis en heure de Paris."""
    return datetime.combine(jour, heure, tzinfo=PARIS)


def creneau(jour: date, debut: time, minutes: int) -> Range[datetime]:
    depart = horodate(jour, debut)
    return Range(depart, depart + timedelta(minutes=minutes), bounds="[)")


# --------------------------------------------------------------------------- #
# Référentiels du parc, repris des maquettes
# --------------------------------------------------------------------------- #

BATIMENTS = [
    ("EIF1", "Eiffel 1", "12 rue Pasteur, 94270 Le Kremlin-Bicêtre", 1),
    ("EIF2", "Eiffel 2", "14 rue Pasteur, 94270 Le Kremlin-Bicêtre", 2),
    ("EIF3", "Eiffel 3", "37 quai de Grenelle, 75015 Paris", 3),
    ("EIF4", "Eiffel 4", "39 quai de Grenelle, 75015 Paris", 4),
    ("EIF5", "Eiffel 5", "10 rue Sextius Michel, 75015 Paris", 5),
    ("EIF6", "Eiffel 6", "12 rue Sextius Michel, 75015 Paris", 6),
]

ETAGES = {
    "EIF1": [("RDC", "Rez-de-chaussée", 0), ("1er", "1er étage", 1), ("2e", "2e étage", 2)],
    "EIF2": [("RDC", "Rez-de-chaussée", 0), ("1er", "1er étage", 1)],
    "EIF3": [("1er", "1er étage", 1), ("2e", "2e étage", 2), ("3e", "3e étage", 3)],
    "EIF4": [("RDC", "Rez-de-chaussée", 0), ("1er", "1er étage", 1)],
    "EIF5": [("SS", "Sous-sol", -1), ("RDC", "Rez-de-chaussée", 0)],
    "EIF6": [("RDC", "Rez-de-chaussée", 0), ("1er", "1er étage", 1), ("2e", "2e étage", 2)],
}

EQUIPEMENTS = [
    ("visio", "Visio-conférence", EquipmentCategory.AUDIOVISUEL, "Video", True),
    ("screen4k", "Écran 4K", EquipmentCategory.AUDIOVISUEL, "Monitor", True),
    ("projector", "Vidéoprojecteur", EquipmentCategory.AUDIOVISUEL, "Projector", True),
    ("mic", "Micro", EquipmentCategory.AUDIOVISUEL, "Mic", False),
    ("whiteboard", "Tableau blanc", EquipmentCategory.MOBILIER, "PenLine", True),
    ("sockets", "6 prises", EquipmentCategory.AMENAGEMENT, "Plug", False),
    ("aircon", "Climatisation", EquipmentCategory.AMENAGEMENT, "Snowflake", False),
]

#: Quinze salles pour six bâtiments : deux ou trois par adresse. Les noms sont
#: ceux de scientifiques — ils se retiennent mieux qu'un numéro, et c'est
#: l'usage dans un établissement.
#:
#: Le parc en comptait trente. Quinze suffisent à montrer ce qu'il faut : un
#: amphi, des laboratoires, un sous-sol, une salle en maintenance, une salle
#: archivée, et de quoi remplir chaque bâtiment.
#:
#: (nom, bâtiment, étage, capacité, surface, équipements, PMR, badge, statut)
SALLES = [
    # --- Eiffel 1 : petites salles de travail, un amphi au rez-de-chaussée ---
    ("Salle Vinci", "EIF1", "2e", 12, 28, ["visio", "screen4k", "whiteboard", "sockets"], False, True, RoomStatus.DISPONIBLE),
    ("Salle Hopper", "EIF1", "RDC", 6, 16, ["whiteboard", "sockets"], True, False, RoomStatus.DISPONIBLE),
    ("Amphi Eiffel", "EIF1", "RDC", 90, 180, ["projector", "mic", "aircon"], True, True, RoomStatus.DISPONIBLE),
    # --- Eiffel 2 : réunions d'équipe ---------------------------------------
    ("Salle Curie", "EIF2", "1er", 20, 46, ["visio", "projector", "mic", "aircon"], True, True, RoomStatus.DISPONIBLE),
    ("Salle Pascal", "EIF2", "1er", 25, 52, ["projector", "aircon"], False, False, RoomStatus.DISPONIBLE),
    ("Salle Fermat", "EIF2", "RDC", 10, 26, ["screen4k", "whiteboard"], True, True, RoomStatus.DISPONIBLE),
    # --- Eiffel 3 : direction et conseils -----------------------------------
    ("Salle Conseil Alpha", "EIF3", "3e", 12, 30, ["visio", "screen4k", "whiteboard", "aircon"], False, True, RoomStatus.DISPONIBLE),
    ("Salle Ampère", "EIF3", "2e", 30, 64, ["projector", "mic"], True, True, RoomStatus.MAINTENANCE),
    ("Salle Joule", "EIF3", "1er", 10, 25, ["screen4k", "sockets"], False, True, RoomStatus.DISPONIBLE),
    # --- Eiffel 4 : travaux pratiques ---------------------------------------
    ("Labo Pasteur", "EIF4", "1er", 24, 60, ["projector", "aircon", "sockets"], True, True, RoomStatus.DISPONIBLE),
    ("Labo Becquerel", "EIF4", "RDC", 18, 44, ["screen4k", "sockets"], False, True, RoomStatus.MAINTENANCE),
    # --- Eiffel 5 : espaces de projet, dont un sous-sol ----------------------
    ("Atelier Monge", "EIF5", "SS", 20, 70, ["projector", "sockets", "aircon"], False, True, RoomStatus.DISPONIBLE),
    ("Salle Galois", "EIF5", "RDC", 6, 16, ["screen4k"], False, False, RoomStatus.ARCHIVEE),
    # --- Eiffel 6 : enseignement --------------------------------------------
    ("Salle Descartes", "EIF6", "2e", 35, 78, ["projector", "mic", "aircon"], True, True, RoomStatus.DISPONIBLE),
    ("Salle Riemann", "EIF6", "RDC", 12, 30, ["visio", "screen4k"], True, True, RoomStatus.DISPONIBLE),
]

#: Salles tenant un rôle dans le jeu de démonstration.
#:
#: Les scénarios ci-dessous — conflits, tickets, fermetures — désignaient leurs
#: salles par un nom écrit en clair à chaque usage. Renommer une salle cassait
#: alors le seed loin de sa définition, avec un `KeyError` qui ne disait pas
#: laquelle. Les rôles sont nommés ici, une fois.
SALLE_DISPUTEE = "Salle Vinci"
SALLE_SECONDE = "Salle Curie"
SALLE_VALIDATION = "Salle Conseil Alpha"
SALLE_EN_TRAVAUX = "Salle Ampère"
SALLE_TICKET_ACCES = "Salle Vinci"
SALLE_TICKET_MATERIEL = "Salle Curie"
SALLE_TICKET_RESOLU = "Salle Fermat"

#: Bâtiment portant une surcharge de règles et une fermeture pour travaux.
#: Nommé ici pour la même raison que les salles ci-dessus : un code écrit en
#: clair dans les scénarios casse le seed dès qu'il change, loin de sa cause.
BATIMENT_SURCHARGE = "EIF5"

#: Cinq comptes utilisateurs. Le jeu en comptait trente-et-un : de quoi
#: remplir une page d'annuaire, mais rien de plus qu'une liste de noms.
UTILISATEURS_NOMMES = [
    ("Dylan", "Menga Wanda", "dylan.menga@edu.ece.fr", "B3 Data & IA", "Ingénierie", "20841"),
    ("Jean", "Dupont", "jean.dupont@edu.ece.fr", "B3 Data & IA", "Ingénierie", "20718"),
    ("Alice", "Leroy", "alice.leroy@edu.ece.fr", "B3 Cyber", "Ingénierie", "20903"),
    ("Marie", "Laurent", "marie.laurent@ece.fr", None, "Pédagogie", "10422"),
    ("Amadou", "Diallo", "a.diallo@ece.fr", None, "Pédagogie", "10318"),
]

#: Cinq comptes d'administration, aux périmètres volontairement différents :
#: une matrice de permissions où tout le monde a tout ne prouve rien, et
#: l'écran des rôles n'aurait rien à montrer.
ADMINISTRATEURS = [
    ("Dylan", "Menga", "d.menga@ece.fr", "Directeur IT", True, None),
    ("Samir", "Boukehila", "s.boukehila@ece.fr", "Directeur de site", False,
     ["rooms.manage", "support.handle", "conflicts.arbitrate"]),
    ("Claire", "Nkoulou", "c.nkoulou@ece.fr", "Référente support", False,
     ["support.handle", "conflicts.arbitrate"]),
    ("Ana", "Ferreira", "a.ferreira@ece.fr", "Responsable du parc", False,
     ["rooms.manage", "rules.configure"]),
    ("Tarek", "Haddad", "t.haddad@ece.fr", "Contrôle de gestion", False,
     ["data.export"]),
]

OBJETS_REUNION = [
    "Revue de sprint", "Atelier data", "Point projet", "Comité de suivi", "Entretien RH",
    "Réunion pédagogique", "Soutenance blanche", "Atelier UX", "Rétrospective",
    "Point équipe", "Cours de rattrapage", "Session de travail", "Préparation examen",
]

#: Teintes des visuels générés, dans la palette de l'application.
_ENCRE = "#101623"
_SURFACE = "#1A2231"
_LIGNE = "#2C3850"
_ACCENT = "#5B9BFF"
_TEXTE = "#B4C0D4"


def _ecrire_svg(dossier: str, nom: str, svg: str) -> str:
    """Écrit un visuel sous `MEDIA_ROOT` et rend son adresse publique.

    Le format est SVG faute de bibliothèque d'imagerie : le projet n'en a pas,
    et en ajouter une pour peupler une démonstration serait payer cher un
    décor. Le SVG porte du texte lisible, ce qu'un PNG composé à la main ne
    permettrait pas.

    Les routes de dépôt refusent le SVG, et ce n'est pas une contradiction :
    elles reçoivent des fichiers *téléversés*, dont l'origine n'est pas
    contrôlée, là où ceux-ci sont composés par le seed lui-même.
    """
    cible = storage.racine() / dossier
    cible.mkdir(parents=True, exist_ok=True)
    (cible / nom).write_text(svg, encoding="utf-8")
    return f"{get_settings().media_url}/{dossier}/{nom}"


def visuel_batiment(code: str, nom: str) -> str:
    """Façade stylisée : des étages, des fenêtres, et le nom en clair."""
    fenetres = "".join(
        f'<rect x="{90 + colonne * 60}" y="{110 + ligne * 55}" width="38" height="34" rx="3" '
        f'fill="{_ACCENT}" fill-opacity="{0.15 + 0.1 * ((colonne + ligne) % 3)}"/>'
        for ligne in range(4)
        for colonne in range(7)
    )
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400" width="640" height="400">'
        f'<rect width="640" height="400" fill="{_ENCRE}"/>'
        f'<rect x="70" y="80" width="500" height="260" rx="8" fill="{_SURFACE}" '
        f'stroke="{_LIGNE}" stroke-width="2"/>'
        f"{fenetres}"
        f'<rect x="290" y="290" width="60" height="50" rx="4" fill="{_ACCENT}" fill-opacity="0.4"/>'
        f'<text x="320" y="60" fill="{_TEXTE}" font-family="system-ui,sans-serif" '
        f'font-size="26" text-anchor="middle">{nom}</text>'
        f'<text x="320" y="375" fill="{_ACCENT}" font-family="monospace" '
        f'font-size="15" text-anchor="middle">{code}</text>'
        "</svg>"
    )
    return _ecrire_svg("batiments", f"{code.lower()}.svg", svg)


def visuel_plan(salle: str, batiment: str, etage: str, place: int) -> str:
    """Plan d'étage portant le repère de la salle.

    C'est l'image que l'utilisateur consulte pour trouver son chemin : la salle
    y est encadrée et nommée, les voisines restent grises.
    """
    cases = []
    for index in range(6):
        colonne, ligne = index % 3, index // 3
        x, y = 70 + colonne * 170, 110 + ligne * 120
        marquee = index == place % 6
        cases.append(
            f'<rect x="{x}" y="{y}" width="150" height="100" rx="6" '
            f'fill="{_ACCENT if marquee else _SURFACE}" '
            f'fill-opacity="{0.35 if marquee else 1}" '
            f'stroke="{_ACCENT if marquee else _LIGNE}" stroke-width="{3 if marquee else 1}"/>'
        )
        if marquee:
            cases.append(
                f'<text x="{x + 75}" y="{y + 56}" fill="{_TEXTE}" '
                f'font-family="system-ui,sans-serif" font-size="15" text-anchor="middle">'
                f"{salle}</text>"
            )
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400" width="640" height="400">'
        f'<rect width="640" height="400" fill="{_ENCRE}"/>'
        f'<text x="320" y="60" fill="{_TEXTE}" font-family="system-ui,sans-serif" '
        f'font-size="20" text-anchor="middle">{batiment} — {etage}</text>'
        + "".join(cases)
        + f'<text x="320" y="375" fill="{_ACCENT}" font-family="monospace" font-size="13" '
        f'text-anchor="middle">Vous cherchez : {salle}</text>'
        "</svg>"
    )
    return _ecrire_svg("reperes", f"{_ardoise(salle)}.svg", svg)


def _ardoise(salle: str) -> str:
    """Nom de fichier du repère composé par le seed, pour une salle donnée.

    Extrait de `visuel_plan` parce que `relever_visuels` a besoin de la même
    règle : reconnaître un visuel du seed demande de savoir comment il le
    nomme, et deux copies de cette règle finiraient par diverger.
    """
    return salle.lower().replace(" ", "-").replace("é", "e").replace("è", "e")


def visuel(nom_salle: str, index: int) -> str:
    """Photo de la salle. Data URI : aucun fichier, aucun appel réseau."""
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400">'
        f'<rect width="640" height="400" fill="{_SURFACE}"/>'
        f'<rect x="120" y="150" width="400" height="110" rx="10" fill="none" '
        f'stroke="{_ACCENT}" stroke-opacity="0.35" stroke-width="3"/>'
        f'<text x="320" y="330" fill="{_TEXTE}" font-family="monospace" '
        f'font-size="22" text-anchor="middle">{nom_salle} - vue {index}</text>'
        "</svg>"
    )
    from urllib.parse import quote

    return f"data:image/svg+xml;utf8,{quote(svg)}"


# --------------------------------------------------------------------------- #
# Peuplement
# --------------------------------------------------------------------------- #


def relever_visuels(session: Session) -> dict[str, str]:
    """Note les visuels **déposés par l'administration** avant de vider.

    Le seed compose ses propres façades et ses propres plans, en SVG, sous des
    noms fixes : `eif1.svg`, `salle-hopper.svg`. Tout le reste — un `.webp`, un
    `.jpg`, un nom en empreinte — vient d'un téléversement, c'est-à-dire du
    travail de quelqu'un.

    Écrit après avoir perdu deux fois les photos du parc. Les fichiers, eux,
    survivaient sous `MEDIA_ROOT` ; mais les lignes qui les désignaient
    partaient avec le reste, et plus rien ne disait quelle image allait à quel
    bâtiment. Un jeu de démonstration a le droit de refaire ses données ; il n'a
    pas celui d'effacer ce qu'on lui a confié.

    La clé est le code du bâtiment ou le nom de la salle : ce sont eux qui
    survivent d'un jeu à l'autre, pas les identifiants.
    """
    releve: dict[str, str] = {}

    for batiment in session.scalars(select(Building)):
        if _est_depose(batiment.image_url, f"{batiment.code.lower()}.svg"):
            releve[f"batiment:{batiment.code}"] = batiment.image_url

    for salle in session.scalars(select(Room)):
        if _est_depose(salle.location_plan_url, f"{_ardoise(salle.name)}.svg"):
            releve[f"salle:{salle.name}"] = salle.location_plan_url

    return releve


def _est_depose(url: str | None, nom_du_seed: str) -> bool:
    """Vrai si l'adresse ne désigne pas un visuel composé par le seed."""
    return bool(url) and not url.endswith(nom_du_seed)


def rendre_visuels(session: Session, releve: dict[str, str]) -> int:
    """Repose les visuels relevés sur les bâtiments et salles homonymes."""
    if not releve:
        return 0

    rendus = 0
    for batiment in session.scalars(select(Building)):
        url = releve.get(f"batiment:{batiment.code}")
        if url:
            batiment.image_url = url
            rendus += 1

    for salle in session.scalars(select(Room)):
        url = releve.get(f"salle:{salle.name}")
        if url:
            salle.location_plan_url = url
            rendus += 1

    session.flush()
    return rendus


def vider(session: Session) -> None:
    """Vide les données métier, en conservant les référentiels de structure.

    Le journal d'audit est protégé par un trigger qui interdit toute suppression :
    il est suspendu le temps de la purge, opération de maintenance assumée, puis
    rétabli. Aucun chemin applicatif ne dispose de ce droit.
    """
    from app.models import AuditLog

    session.execute(text("ALTER TABLE audit_logs DISABLE TRIGGER trg_audit_logs_append_only"))
    session.execute(delete(AuditLog))
    session.execute(text("ALTER TABLE audit_logs ENABLE TRIGGER trg_audit_logs_append_only"))

    for modele in (
        Notification, TicketMessage, Ticket, TicketResponseTemplate,
        ChatbotIntentKeyword, ChatbotIntent, FaqArticle, FaqCategory,
        AccessRequest, BookingAccessCode, BookingEvent, BookingParticipant, Booking,
        ClosureBuilding, ClosurePeriod, RoomEquipment, RoomPhoto, RoomPlacement, Room,
        Floor, Building, Equipment, AdminPermission, AdminAccount, UserPreference, User,
        EmailTemplate,
    ):
        session.execute(delete(modele))
    # Les règles et horaires de portée bâtiment ou salle disparaissent avec leur
    # cible ; la règle globale et les horaires globaux sont structurels.
    session.execute(delete(BookingRule).where(BookingRule.scope != RuleScope.GLOBAL))
    session.execute(delete(OpeningHour).where(OpeningHour.scope != RuleScope.GLOBAL))
    session.commit()


def creer_parc(session: Session) -> tuple[dict[str, Building], dict[str, Room], dict[str, Equipment]]:
    batiments: dict[str, Building] = {}
    for code, nom, adresse, ordre in BATIMENTS:
        batiment = Building(
            code=code,
            name=nom,
            address=adresse,
            sort_order=ordre,
            image_url=visuel_batiment(code, nom),
        )
        session.add(batiment)
        batiments[code] = batiment

    session.flush()

    etages: dict[tuple[str, str], Floor] = {}
    for code_batiment, liste in ETAGES.items():
        for code_etage, libelle, niveau in liste:
            etage = Floor(
                building_id=batiments[code_batiment].id,
                code=code_etage,
                label=libelle,
                level=niveau,
            )
            session.add(etage)
            etages[(code_batiment, code_etage)] = etage

    equipements: dict[str, Equipment] = {}
    for code, libelle, categorie, icone, filtrable in EQUIPEMENTS:
        equipement = Equipment(
            code=code, label=libelle, category=categorie, icon=icone, is_filterable=filtrable
        )
        session.add(equipement)
        equipements[code] = equipement

    session.flush()

    # Le plan de localisation nomme le bâtiment et l'étage en clair : « EIF3 »
    # et « 2e » ne disent rien à qui cherche son chemin.
    BATIMENTS_PAR_CODE = {code: nom for code, nom, _, _ in BATIMENTS}
    LIBELLES_ETAGE = {
        (code_batiment, code_etage): libelle
        for code_batiment, liste in ETAGES.items()
        for code_etage, libelle, _ in liste
    }

    salles: dict[str, Room] = {}
    #: Nombre de salles déjà placées sur chaque étage, pour ne pas les empiler.
    occupation_etage: dict[tuple[str, str], int] = {}
    for index, (nom, bat, etg, capacite, surface, codes, pmr, badge, statut) in enumerate(SALLES):
        salle = Room(
            floor_id=etages[(bat, etg)].id,
            name=nom,
            slug=nom.lower().replace(" ", "-").replace("è", "e").replace("é", "e"),
            capacity=capacite,
            area_m2=Decimal(surface),
            status=statut,
            is_accessible=pmr,
            badge_required=badge,
            description=f"{nom} — {capacite} places, {surface} m².",
            location_plan_url=visuel_plan(
                nom, BATIMENTS_PAR_CODE[bat], LIBELLES_ETAGE[(bat, etg)], index
            ),
        )
        session.add(salle)
        session.flush()
        salles[nom] = salle

        for code in codes:
            session.add(RoomEquipment(room_id=salle.id, equipment_id=equipements[code].id))
        for position in range(3):
            session.add(
                RoomPhoto(
                    room_id=salle.id,
                    file_url=visuel(nom, position + 1),
                    alt_text=f"{nom}, vue {position + 1}",
                    position=position,
                )
            )
        # Placement sur le plan de *son* étage, et non sur un index global.
        # Les coordonnées sont des pourcentages : calculées sur le rang de la
        # salle dans tout le parc, elles sortaient du plan dès la neuvième —
        # une contrainte de base l'a signalé, ce qu'aucun écran n'aurait fait.
        rang = occupation_etage.get((bat, etg), 0)
        occupation_etage[(bat, etg)] = rang + 1
        colonne, ligne = rang % 2, rang // 2
        session.add(
            RoomPlacement(
                room_id=salle.id,
                pos_x=Decimal(8 + colonne * 48),
                pos_y=Decimal(8 + ligne * 24),
                width=Decimal(36),
                height=Decimal(18),
                rotation=0,
                is_entrance_marked=(rang == 0),
            )
        )

    session.commit()
    return batiments, salles, equipements


def creer_comptes(
    session: Session, batiments: dict[str, Building]
) -> tuple[list[User], dict[str, AdminAccount]]:
    empreinte = CRYPT.hash(MOT_DE_PASSE_DEMO)
    utilisateurs: list[User] = []

    for prenom, nom, email, promotion, departement, badge in UTILISATEURS_NOMMES:
        utilisateur = User(
            email=email,
            password_hash=empreinte,
            first_name=prenom,
            last_name=nom,
            phone="06 12 34 56 78",
            promotion=promotion,
            department=departement,
            badge_number=badge,
        )
        session.add(utilisateur)
        utilisateurs.append(utilisateur)

    # Le dernier compte est suspendu : la zone de danger de l'écran des
    # utilisateurs n'aurait rien à montrer si tous étaient actifs.
    utilisateurs[-1].status = UserStatus.SUSPENDU

    session.flush()

    for utilisateur in utilisateurs:
        session.add(
            UserPreference(
                user_id=utilisateur.id,
                preferred_building_id=ALEA.choice(list(batiments.values())).id,
                usual_capacity_min=5,
                usual_capacity_max=10,
                reminder_delay_min=ALEA.choice([15, 30, 60]),
                weekly_quota_hours=12,
            )
        )

    permissions = {p.code: p for p in session.scalars(select(Permission)).all()}
    administrateurs: dict[str, AdminAccount] = {}

    for prenom, nom, email, fonction, proprietaire, codes in ADMINISTRATEURS:
        personne = User(
            email=email,
            password_hash=empreinte,
            first_name=prenom,
            last_name=nom,
            department="Direction",
        )
        session.add(personne)
        session.flush()

        compte = AdminAccount(user_id=personne.id, job_title=fonction, is_owner=proprietaire)
        session.add(compte)
        session.flush()

        # Le propriétaire détient tout : la matrice reçoit les sept permissions,
        # que l'API refusera ensuite de lui retirer.
        accordees = list(permissions) if proprietaire else (codes or [])
        for code in accordees:
            session.add(
                AdminPermission(admin_user_id=compte.user_id, permission_id=permissions[code].id)
            )
        administrateurs[email] = compte

    session.commit()
    return utilisateurs, administrateurs


def creer_regles(
    session: Session,
    batiments: dict[str, Building],
    salles: dict[str, Room],
    administrateurs: dict[str, AdminAccount],
) -> None:
    """Surcharges de portée bâtiment et salle, plus les fermetures."""
    session.add(
        BookingRule(
            scope=RuleScope.BATIMENT,
            building_id=batiments[BATIMENT_SURCHARGE].id,
            max_duration_min=180,
            weekly_quota_hours=8,
            buffer_min=30,
        )
    )
    session.add(
        BookingRule(
            scope=RuleScope.SALLE,
            room_id=salles[SALLE_EN_TRAVAUX].id,
            min_duration_min=60,
            max_duration_min=240,
            validation_capacity_threshold=25,
        )
    )
    # L'annexe n'ouvre pas le samedi : surcharge de portée bâtiment.
    for jour in range(7):
        session.add(
            OpeningHour(
                scope=RuleScope.BATIMENT,
                building_id=batiments[BATIMENT_SURCHARGE].id,
                weekday=jour,
                is_open=jour in (1, 2, 3, 4, 5),
                opens_at=time(8, 30),
                closes_at=time(18, 30),
            )
        )

    proprietaire = administrateurs["d.menga@ece.fr"]

    ferie = ClosurePeriod(
        label="Jour férié — pont de l'Ascension",
        date_span=Range(JOUR_FERME, JOUR_FERME + timedelta(days=1), bounds="[)"),
        kind=ClosureKind.FERMETURE,
        is_global=True,
        created_by_admin_id=proprietaire.user_id,
    )
    session.add(ferie)

    maintenance = ClosurePeriod(
        label="Maintenance électrique — Annexe",
        date_span=Range(
            AUJOURD_HUI + timedelta(days=17), AUJOURD_HUI + timedelta(days=19), bounds="[)"
        ),
        kind=ClosureKind.EXCEPTION,
        is_global=False,
        created_by_admin_id=proprietaire.user_id,
    )
    session.add(maintenance)
    session.flush()
    session.add(ClosureBuilding(closure_id=maintenance.id, building_id=batiments[BATIMENT_SURCHARGE].id))

    session.commit()


def _popularite(salle: Room) -> float:
    """Probabilité qu'un créneau donné de cette salle soit réservé.

    Elle valait 0,16 pour toutes, si bien que l'écran « salles les plus
    demandées » classait du bruit : trente salles se tenaient en dix pour cent,
    et le graphique montrait six barres identiques. Un classement qui ne
    distingue rien n'apprend rien.

    Les poids ne sont pas arbitraires, ils décrivent un usage : les petites
    salles de travail sont prises toute la journée par des binômes et des
    revues, les amphithéâtres servent quelques fois par semaine pour des
    événements. La visio-conférence ajoute une demande propre, la salle
    devenant le seul endroit où tenir une réunion à distance.
    """
    if salle.capacity <= 10:
        base = 0.26
    elif salle.capacity <= 20:
        base = 0.18
    elif salle.capacity <= 35:
        base = 0.11
    else:
        base = 0.05

    equipements = {item.equipment.code for item in salle.room_equipments}
    if "visio" in equipements:
        base += 0.06
    if "screen4k" in equipements or "projector" in equipements:
        base += 0.03

    return min(base, 0.34)


def _accorder_quota(session: Session, reservations: list[Booking], maintenant: datetime) -> None:
    """Aligne le quota de l'établissement sur ce que le jeu vient de créer.

    Le défaut de la colonne est de dix réservations actives par personne. Or ce
    jeu répartit six cents créneaux sur cinq comptes : chacun en porte une
    soixantaine à venir. Aucun compte de démonstration ne pouvait donc réserver
    quoi que ce soit — ni par le tunnel, ni par l'assistant — et le refus était
    exact, c'est la donnée qui contredisait la règle.

    Deux façons de recoller : diluer les réservations, au prix de tableaux de
    bord vides, ou accorder la règle au volume. La seconde est retenue, et le
    calcul est fait ici plutôt qu'écrit en dur : si le volume du jeu change, la
    règle suit sans que personne ait à y penser.

    La marge de vingt laisse la place aux réservations créées pendant une
    démonstration. Le plafond dur de cent vient de la contrainte
    `ck_booking_rules_active_bookings` : si le jeu devenait assez dense pour le
    heurter, la règle ne pourrait plus suivre le volume, et l'écart est alors
    signalé plutôt que rogné en silence.
    """
    a_venir: dict[uuid.UUID, int] = defaultdict(int)
    for reservation in reservations:
        if reservation.status is not BookingStatus.ANNULEE and reservation.time_range.upper > maintenant:
            a_venir[reservation.owner_id] += 1

    charge_max = max(a_venir.values(), default=0)
    voulu = max(10, charge_max + 20)
    plafond = min(100, voulu)
    if voulu > 100:
        print(
            f"Attention : un compte porte {charge_max} réservations à venir, et le "
            "quota ne peut pas dépasser 100. Diluez le jeu sur davantage de comptes.",
            file=sys.stderr,
        )

    regle = session.scalars(
        select(BookingRule).where(BookingRule.scope == RuleScope.GLOBAL)
    ).one_or_none()
    if regle is not None:
        regle.max_active_bookings = plafond
    session.flush()


def creer_reservations(
    session: Session, salles: dict[str, Room], utilisateurs: list[User]
) -> list[Booking]:
    """Environ deux cents réservations réparties sur six semaines.

    Les créneaux sont posés séquentiellement par salle et par jour, avec un
    battement d'au moins quinze minutes : la contrainte anti-chevauchement n'est
    jamais sollicitée en échec, elle protège les écritures concurrentes.
    """
    reservables = [s for s in salles.values() if s.status is RoomStatus.DISPONIBLE]
    reservations: list[Booking] = []
    maintenant = datetime.now(PARIS)
    demande = {salle.id: _popularite(salle) for salle in reservables}

    jour = DEBUT_FENETRE
    while jour <= FIN_FENETRE:
        # Ni week-end ni jour de fermeture.
        if jour.weekday() >= 5 or jour == JOUR_FERME:
            jour += timedelta(days=1)
            continue

        for salle in reservables:
            heure = 8
            while heure < 19:
                if ALEA.random() < demande[salle.id]:
                    duree = ALEA.choice([60, 60, 90, 120])
                    debut = time(heure, ALEA.choice([0, 30]))
                    fin_prevue = debut.hour * 60 + debut.minute + duree
                    if fin_prevue > 19 * 60:
                        break

                    proprietaire = ALEA.choice(utilisateurs)
                    plage = creneau(jour, debut, duree)
                    passee = plage.upper < maintenant

                    reservation = Booking(
                        room_id=salle.id,
                        owner_id=proprietaire.id,
                        title=ALEA.choice(OBJETS_REUNION),
                        time_range=plage,
                        attendee_count=ALEA.randint(2, min(salle.capacity, 12)),
                        status=BookingStatus.TERMINEE if passee else BookingStatus.CONFIRMEE,
                        source=BookingSource.UTILISATEUR,
                        # Présence validée dans 85 % des créneaux passés : le
                        # taux de no-show du tableau de bord n'est ni 0 ni 100 %.
                        checked_in_at=(
                            plage.lower + timedelta(minutes=3)
                            if passee and ALEA.random() < 0.85
                            else None
                        ),
                    )
                    session.add(reservation)
                    reservations.append(reservation)

                    heure = (fin_prevue + 30) // 60 + 1
                else:
                    heure += 1
        jour += timedelta(days=1)

    session.flush()

    _accorder_quota(session, reservations, maintenant)

    # Quelques annulations motivées, pour que les statistiques d'annulation ne
    # soient pas vides.
    for reservation in ALEA.sample(reservations, k=max(4, len(reservations) // 25)):
        reservation.status = BookingStatus.ANNULEE
        reservation.cancelled_at = maintenant
        reservation.cancel_reason = ALEA.choice(
            ["Réunion reportée", "Effectif modifié", "Salle inadaptée"]
        )
        reservation.checked_in_at = None

    # Frise et code d'accès sur les réservations à venir.
    for reservation in reservations:
        session.add(
            BookingEvent(
                booking_id=reservation.id,
                event_type=BookingEventType.CREATION,
                label="Réservation créée",
                actor_user_id=reservation.owner_id,
                occurred_at=reservation.time_range.lower - timedelta(days=2),
            )
        )
        if reservation.status is BookingStatus.CONFIRMEE and reservation.time_range.lower > maintenant:
            session.add(
                BookingParticipant(
                    booking_id=reservation.id,
                    user_id=reservation.owner_id,
                    email=session.get(User, reservation.owner_id).email,
                    display_name="Organisateur",
                    is_organizer=True,
                    response=ParticipantResponse.ACCEPTE,
                    responded_at=maintenant,
                )
            )
            # Par le service et non à la main : lui seul sait qu'une salle
            # sans badge n'a pas de code, et que l'indice porte l'initiale du
            # bâtiment. Le semis posait « A-**** » sur toutes les salles, y
            # compris celles où aucun code n'a de sens.
            booking_service.issue_access_code(session, reservation, now=maintenant)

    session.commit()
    return reservations


def creer_conflits(
    session: Session,
    salles: dict[str, Room],
    utilisateurs: list[User],
    administrateurs: dict[str, AdminAccount],
) -> None:
    """Deux cas de conflit démontrables immédiatement.

    La contrainte EXCLUDE interdisant deux réservations qui se recouvrent, un
    conflit se matérialise par une *demande* portant sur un créneau déjà pris.
    """
    vinci, curie = salles[SALLE_DISPUTEE], salles[SALLE_SECONDE]
    demain = AUJOURD_HUI + timedelta(days=1)
    while demain.weekday() >= 5:
        demain += timedelta(days=1)

    titulaire, contestataire = utilisateurs[0], utilisateurs[1]

    # Cas 1 — recouvrement total : le créneau 14:00-15:30 est déjà réservé.
    plage_vinci = creneau(demain, time(14, 0), 90)
    existante = session.scalars(
        select(Booking).where(
            Booking.room_id == vinci.id,
            Booking.time_range.op("&&")(plage_vinci),
            Booking.status != BookingStatus.ANNULEE,
        )
    ).first()
    if existante is None:
        existante = Booking(
            room_id=vinci.id,
            owner_id=titulaire.id,
            title="Revue de sprint",
            time_range=plage_vinci,
            attendee_count=8,
            status=BookingStatus.CONFIRMEE,
        )
        session.add(existante)
        session.flush()
        # Ces deux réservations-ci sont posées à la main, hors du semis
        # général : sans cet appel, elles arrivaient à l'écran en salle à
        # badge et sans le moindre code.
        booking_service.issue_access_code(session, existante)

    session.add(
        AccessRequest(
            reference="#CONF-8492",
            requester_id=contestataire.id,
            room_id=vinci.id,
            booking_id=existante.id,
            requested_range=plage_vinci,
            access_type=AccessType.CONFLIT_RESERVATION,
            reason="Créneau déjà réservé : deux demandes concurrentes sur la salle Vinci.",
            status=RequestStatus.OUVERT,
        )
    )

    # Cas 2 — battement insuffisant : une réunion finit à 13:55, la demande
    # commence à 14:00, soit 5 minutes au lieu des 15 exigées. Le chevauchement
    # est nul, la contrainte EXCLUDE ne s'applique pas : seul le moteur de
    # règles détecte ce conflit.
    plage_precedente = Range(
        horodate(demain, time(12, 30)), horodate(demain, time(13, 55)), bounds="[)"
    )
    if not session.scalars(
        select(Booking).where(
            Booking.room_id == curie.id,
            Booking.time_range.op("&&")(plage_precedente),
            Booking.status != BookingStatus.ANNULEE,
        )
    ).first():
        entretien = Booking(
            room_id=curie.id,
            owner_id=titulaire.id,
            title="Entretien RH",
            time_range=plage_precedente,
            attendee_count=4,
            status=BookingStatus.CONFIRMEE,
        )
        session.add(entretien)
        session.flush()
        booking_service.issue_access_code(session, entretien)

    session.add(
        AccessRequest(
            reference="#CONF-8493",
            requester_id=contestataire.id,
            room_id=curie.id,
            requested_range=creneau(demain, time(14, 0), 60),
            access_type=AccessType.CONFLIT_RESERVATION,
            reason="Battement insuffisant : 5 minutes au lieu des 15 exigées.",
            status=RequestStatus.OUVERT,
        )
    )

    # Une demande d'accès hors horaires, déjà tranchée, pour peupler l'historique.
    session.add(
        AccessRequest(
            reference="#ACC-2201",
            requester_id=utilisateurs[4].id,
            room_id=salles[SALLE_VALIDATION].id,
            requested_range=creneau(AUJOURD_HUI - timedelta(days=4), time(7, 0), 60),
            access_type=AccessType.HORS_HORAIRE,
            reason="Comité exceptionnel avant l'ouverture.",
            status=RequestStatus.ACCORDE,
            decided_by_admin_id=administrateurs["s.boukehila@ece.fr"].user_id,
            decision_comment="Accordé à titre exceptionnel, accès badge fourni.",
            decided_at=datetime.now(PARIS) - timedelta(days=3),
        )
    )

    session.commit()


def creer_support(
    session: Session,
    salles: dict[str, Room],
    utilisateurs: list[User],
    administrateurs: dict[str, AdminAccount],
) -> None:
    categories = {}
    for code, libelle, icone, ordre in [
        # Ajoutée après coup : les vingt-deux articles décrivaient comment
        # faire, aucun ne disait ce qu'est l'outil. « À quoi sert cette
        # application ? » est pourtant la première question qu'on lui pose, et
        # l'assistant répondait « je n'ai pas compris ».
        ("decouvrir", "Découvrir SmartRoom Manager", "Sparkles", 0),
        ("reserver", "Réserver une salle", "CalendarPlus", 1),
        ("acces", "Codes d'accès", "KeyRound", 2),
        ("annulation", "Annulation et modification", "CalendarX2", 3),
        ("equipements", "Équipements et salles", "Monitor", 4),
        ("compte", "Compte et notifications", "UserRound", 5),
    ]:
        categorie = FaqCategory(code=code, label=libelle, icon=icone, sort_order=ordre)
        session.add(categorie)
        categories[code] = categorie
    session.flush()

    # Repris de la maquette : vingt-deux articles couvrant le parcours réel.
    # Sept ont été réécrits — ils décrivaient une pondération, un délai
    # d'annulation et un changement de mot de passe que le code n'applique pas,
    # et un centre d'aide qui se trompe sur son propre produit vaut moins que
    # pas de centre d'aide.
    articles = [
        ("decouvrir", "a-quoi-sert-smartroom-manager",
         "À quoi sert SmartRoom Manager ?",
         "Réserver une salle du campus, en connaître les règles, et y entrer.",
         "SmartRoom Manager gère la réservation des salles du campus, de la recherche "
         "jusqu’à l’entrée dans la salle. Vous décrivez votre besoin — date, créneau, "
         "effectif, équipements — et l’application propose les salles compatibles, "
         "classées par un score qui tient compte de leur capacité, de leur matériel et "
         "de leur occupation réelle. Une fois le créneau confirmé, elle émet le code "
         "d’accès de la porte et envoie la confirmation. Elle applique aussi les règles "
         "du campus : durée minimale et maximale, préavis, battement entre deux "
         "réunions, horizon de réservation et nombre de réservations actives. "
         "L’administration y suit l’occupation du parc, arbitre les conflits de créneau "
         "et tient à jour les salles, leurs équipements et leurs plans.",
         ArticleStatus.PUBLIE),
        ("decouvrir", "que-puis-je-demander-a-l-assistant",
         "Que puis-je demander à l’assistant ?",
         "Trouver une salle, lire vos réservations, connaître une règle, ouvrir un ticket.",
         "L’assistant cherche une salle pour un effectif et un créneau donnés, liste vos "
         "réservations à venir, rappelle une règle de réservation, situe une salle dans "
         "le bâtiment et cite les articles de cette base de connaissances. Il peut "
         "préparer une réservation ou une annulation, mais ne l’exécute jamais seul : "
         "toute écriture vous est présentée pour confirmation, dans un tour dédié. "
         "S’il ne sait pas répondre, il ouvre un ticket auprès du support plutôt que "
         "d’inventer.",
         ArticleStatus.PUBLIE),
        ("decouvrir", "qui-peut-utiliser-l-application",
         "Qui peut utiliser l’application ?",
         "Étudiants et personnel, avec des droits différents.",
         "Tout compte du campus peut réserver, consulter le plan des bâtiments et suivre "
         "ses statistiques d’usage. Le personnel administratif dispose en plus d’un "
         "espace d’administration : parc de salles, équipements, règles d’ouverture, "
         "arbitrage des conflits et suivi du support. Les droits y sont attribués "
         "permission par permission, et non par un rôle unique.",
         ArticleStatus.PUBLIE),
        ("reserver", "reserver-une-salle-en-quatre-etapes",
         "Réserver une salle en quatre étapes",
         "Besoin, sélection, validation du créneau, confirmation.",
         "Décrivez d’abord votre besoin : date, créneau, effectif et équipements requis. "
         "Le système propose ensuite les salles compatibles, classées par pertinence. "
         "Choisissez-en une pour ouvrir son calendrier, sélectionnez le créneau puis "
         "confirmez : le code d’accès et l’e-mail de confirmation partent immédiatement.",
         ArticleStatus.PUBLIE),
        ("reserver", "sur-quels-criteres-une-salle-m-est-elle-recommandee",
         "Sur quels critères une salle m’est-elle recommandée ?",
         "Un score sur 100 pondère six critères, de la capacité à vos habitudes.",
         "Six critères sont pondérés sur 100 : l’ajustement de la capacité (30 points, un "
         "surdimensionnement est pénalisé), la présence des équipements demandés (25), "
         "votre bâtiment de préférence (15), l’étage (10), le taux d’occupation de la "
         "salle (12) et vos réservations passées (8). La justification affichée sous "
         "chaque proposition est construite à partir de ce calcul : elle change avec vos "
         "critères.",
         ArticleStatus.PUBLIE),
        ("reserver", "pourquoi-une-salle-apparait-elle-a-capacite-juste",
         "Pourquoi une salle apparaît-elle « à capacité juste » ?",
         "Elle accueille votre effectif, mais sans marge.",
         "Une salle dont la capacité correspond exactement à votre effectif reste "
         "proposée, mais signalée : aucune place supplémentaire n’est disponible si un "
         "participant s’ajoute. Les salles trop petites, elles, sont écartées de la "
         "sélection.",
         ArticleStatus.PUBLIE),
        ("reserver", "un-conflit-est-detecte-sur-mon-creneau-que-faire",
         "Un conflit est détecté sur mon créneau, que faire ?",
         "Décaler l’horaire, ou changer de salle sur le même créneau.",
         "Le moteur distingue trois cas : le créneau est déjà entièrement pris, il "
         "chevauche partiellement une autre réunion, ou il est trop proche de la "
         "précédente. L’écran de conflit propose des créneaux libres dans la même salle "
         "et des salles équivalentes sur le créneau initial, chacun noté en pourcentage "
         "de compatibilité.",
         ArticleStatus.PUBLIE),
        ("reserver", "pourquoi-dois-je-laisser-15-minutes-entre-deux-reunions",
         "Pourquoi dois-je laisser 15 minutes entre deux réunions ?",
         "C’est le battement exigé pour l’aération et la remise en état.",
         "Chaque salle impose un battement entre deux réservations. Une demande qui "
         "démarre moins de 15 minutes après la fin de la précédente est signalée comme "
         "conflit potentiel : elle reste possible, mais l’écran vous propose un créneau "
         "décalé.",
         ArticleStatus.PUBLIE),
        ("reserver", "reserver-plusieurs-occurrences-d-un-coup",
         "Réserver plusieurs occurrences d’un coup",
         "Activez la récurrence, puis vérifiez l’aperçu des dates générées.",
         "Activez « Réunion récurrente » à l’étape 1, choisissez une salle, puis "
         "configurez la règle : quotidienne, hebdomadaire ou mensuelle, avec une fin "
         "après N occurrences ou à une date. L’aperçu qualifie chaque date : les "
         "occurrences en conflit sont signalées et seront ignorées à la création, les "
         "autres sont réservées en une fois.",
         ArticleStatus.PUBLIE),
        ("reserver", "reserver-en-dehors-des-jours-d-ouverture-d-une-salle",
         "Réserver en dehors des jours d’ouverture d’une salle",
         "Une demande d’accès exceptionnel doit être validée par le gestionnaire de site.",
         "Certaines salles ne sont ouvertes que certains jours. Pour un créneau en "
         "dehors, une demande d’accès exceptionnel est nécessaire : motivez-la, indiquez "
         "l’effectif attendu et acceptez les consignes de sécurité. Le gestionnaire "
         "répond sous 24 h ouvrées.",
         ArticleStatus.PUBLIE),
        ("acces", "comment-obtenir-le-code-d-acces-de-ma-salle",
         "Comment obtenir le code d’accès de ma salle ?",
         "Émis à la confirmation, valable jusqu’à la fin du créneau.",
         "Le code est émis au moment où la réservation est confirmée et reste valable "
         "jusqu’à la fin du créneau. Il apparaît sur l’écran de confirmation, dans "
         "l’e-mail et dans le rappel. Ailleurs, il reste masqué sous la forme « A-**** » "
         "jusqu’à ce que vous cliquiez sur « Révéler » : le code en clair n’est stocké "
         "nulle part, seule son empreinte l’est.",
         ArticleStatus.PUBLIE),
        ("acces", "mon-code-d-acces-ne-fonctionne-pas",
         "Mon code d’accès ne fonctionne pas",
         "Vérifiez qu’il s’agit du code de cette réservation, puis ouvrez un ticket.",
         "Vérifiez d’abord que vous utilisez le code de la bonne réservation : chacune a "
         "le sien, et une réservation voisine dans la même salle en a un autre. Si le "
         "terminal refuse toujours un code valide, ouvrez une demande d’assistance en "
         "catégorie « Accès » : le terminal sera resynchronisé.",
         ArticleStatus.PUBLIE),
        ("acces", "quelles-salles-exigent-un-badge-en-plus-du-code",
         "Quelles salles exigent un badge en plus du code ?",
         "Les salles de conseil et les salles premium, signalées « Badge requis ».",
         "Certaines salles demandent un badge d’accès actif en plus du code numérique. La "
         "mention « Badge requis » apparaît sur la fiche de la salle, sur le détail de la "
         "réservation et dans l’e-mail de confirmation. Le numéro de badge figure dans "
         "votre profil.",
         ArticleStatus.PUBLIE),
        ("acces", "valider-ma-presence-sur-place",
         "Valider ma présence sur place",
         "La validation s’ouvre au début du créneau et dure dix minutes.",
         "Sur place, saisissez le code affiché sur l’écran de la salle : une lettre, un "
         "tiret et quatre chiffres. La fenêtre de validation s’ouvre au début du créneau "
         "et se ferme au bout de dix minutes — ce délai est configurable par salle. Passé "
         "ce délai sans validation, le créneau est libéré et la salle redevient "
         "réservable. Le bouton « Je suis en retard » vaut validation de présence et "
         "empêche cette libération.",
         ArticleStatus.PUBLIE),
        ("annulation", "jusqu-a-quand-puis-je-annuler-une-reservation",
         "Jusqu’à quand puis-je annuler une réservation ?",
         "Jusqu’à une heure avant le début, avec un motif obligatoire.",
         "Une réservation s’annule jusqu’à une heure avant son début — ce délai est "
         "configurable par salle. Le motif est obligatoire : il alimente les statistiques "
         "d’occupation. Les participants sont prévenus par e-mail et le créneau est "
         "libéré immédiatement.",
         ArticleStatus.PUBLIE),
        ("annulation", "modifier-l-horaire-ou-la-salle-d-une-reservation",
         "Modifier l’horaire ou la salle d’une réservation",
         "Date, créneau, titre et effectif. Changer de salle passe par une annulation.",
         "Depuis le détail de la réservation, « Modifier » permet de changer la date, le "
         "créneau, le titre et l'effectif. Le nouveau créneau est revérifié : s'il entre "
         "en conflit, la modification est refusée avec le motif. Changer de salle n'est "
         "pas une modification : annulez et réservez la nouvelle, sans quoi deux salles "
         "porteraient la même réunion le temps de l'opération. Le code d'accès, lui, ne "
         "change pas.",
         ArticleStatus.PUBLIE),
        ("annulation", "annuler-une-seule-occurrence-d-une-serie",
         "Annuler une seule occurrence d’une série",
         "Chaque occurrence est une réservation indépendante.",
         "Les occurrences d’une réunion récurrente sont créées comme des réservations "
         "distinctes, rattachées à la même série. Annuler l’une d’elles depuis « Mes "
         "réservations » ne touche pas les autres dates.",
         ArticleStatus.PUBLIE),
        ("equipements", "filtrer-les-salles-par-equipement",
         "Filtrer les salles par équipement",
         "Visio, écran, tableau blanc, vidéoprojecteur, micro, prises, climatisation.",
         "Les équipements requis se sélectionnent à l’étape 1 du tunnel ou depuis le rail "
         "de filtres du catalogue. Une salle n’est proposée que si elle possède la "
         "totalité des équipements demandés : retirez-en un pour élargir les résultats.",
         ArticleStatus.PUBLIE),
        ("equipements", "trouver-une-salle-accessible-pmr",
         "Trouver une salle accessible PMR",
         "Un filtre dédié écarte les salles non accessibles.",
         "L’option « Salle accessible PMR » ne retient que les salles de plain-pied ou "
         "desservies par un ascenseur. Elle est disponible à l’étape 1 du tunnel et dans "
         "les filtres du catalogue, et reste active pendant toute la recherche.",
         ArticleStatus.PUBLIE),
        ("equipements", "signaler-un-equipement-defectueux",
         "Signaler un équipement défectueux",
         "Ouvrez un ticket en catégorie « Maintenance » ou « Équipement ».",
         "Depuis le centre d’aide, créez une demande en précisant la salle, l’équipement "
         "concerné et le créneau. Le service technique traite les demandes sous 24 h "
         "ouvrées ; l’avancement se suit dans « Mes demandes ».",
         ArticleStatus.PUBLIE),
        ("equipements", "pourquoi-une-salle-est-elle-indisponible",
         "Pourquoi une salle est-elle indisponible ?",
         "Elle est occupée sur le créneau, ou en maintenance.",
         "Une salle « Occupée » est réservée sur le créneau demandé : un autre horaire la "
         "rend à nouveau disponible. Une salle « En maintenance » est retirée de la "
         "réservation le temps de l’intervention, et n’apparaît pas dans les "
         "recommandations.",
         ArticleStatus.PUBLIE),
        ("compte", "modifier-mon-delai-de-rappel",
         "Modifier mon délai de rappel",
         "15, 30 ou 60 minutes avant le début de la réunion.",
         "Dans Profil et paramètres, section Notifications, choisissez le délai souhaité. "
         "Il s’applique à toutes vos réservations, y compris celles déjà créées.",
         ArticleStatus.PUBLIE),
        ("compte", "quelles-notifications-vais-je-recevoir",
         "Quelles notifications vais-je recevoir ?",
         "Confirmation, rappel avant la réunion, conflits et réponses du support.",
         "Deux réglages indépendants : l’e-mail de confirmation à chaque réservation, et "
         "les alertes dans l’application pour les conflits, les validations et les "
         "réponses du support. Le rappel avant réunion suit le délai choisi dans votre "
         "profil.",
         ArticleStatus.PUBLIE),
        ("compte", "a-quoi-servent-mes-statistiques",
         "À quoi servent mes statistiques ?",
         "Heures réservées, répartition par salle, créneaux préférés, taux de présence.",
         "L’écran Mes statistiques agrège vos réservations sur le mois, le trimestre ou "
         "l’année : heures réservées, annulations, répartition par salle et créneaux les "
         "plus utilisés. Le taux de présence compte les réunions passées pour lesquelles "
         "vous avez validé votre arrivée.",
         ArticleStatus.BROUILLON),
        ("compte", "changer-mon-mot-de-passe",
         "Changer mon mot de passe",
         "Depuis Profil et paramètres ; toutes les sessions sont refermées.",
         "Le mot de passe se change depuis Profil et paramètres. L’actuel est demandé, et "
         "toutes vos sessions ouvertes sont refermées : un mot de passe changé après une "
         "compromission ne laisse aucun accès derrière lui. En cas d’oubli, utilisez « "
         "Mot de passe oublié » sur l’écran de connexion : un lien valable trente minutes "
         "est envoyé sur votre adresse institutionnelle.",
         ArticleStatus.PUBLIE),
    ]
    for code_categorie, slug, titre, accroche, corps, statut in articles:
        session.add(
            FaqArticle(
                category_id=categories[code_categorie].id,
                slug=slug,
                title=titre,
                excerpt=accroche,
                body=corps,
                status=statut,
                view_count=ALEA.randint(40, 320),
                published_at=datetime.now(PARIS) - timedelta(days=ALEA.randint(5, 60))
                if statut is ArticleStatus.PUBLIE
                else None,
            )
        )

    intentions = [
        ("salle_libre", "Trouver une salle libre",
         "J'ai cherché une salle correspondant à votre besoin :",
         ["Autre créneau", "Plus grande salle", "Parler à un humain"], True,
         ["salle", "libre", "disponible", "reserver"]),
        ("code_acces", "Code d'accès",
         "Le code d'accès est généré une heure avant le début de la réunion.",
         ["Voir mes réservations", "Mon code ne marche pas"], False,
         ["code", "acces", "badge", "porte"]),
        ("annuler", "Annuler une réservation",
         "Vous pouvez annuler depuis le détail de la réservation, tant que le créneau n'a pas commencé.",
         ["Voir mes réservations", "Modifier plutôt"], False,
         ["annuler", "annulation", "supprimer"]),
        # Ajoutée pour le moteur de repli : « quelles sont mes réservations »
        # est l'un des trois parcours principaux, et aucune intention ne le
        # couvrait — le robot répondait alors « je n'ai pas compris » à la
        # question la plus courante qu'on lui pose.
        ("mes_reservations", "Mes réservations",
         "Voici vos réservations à venir :",
         ["Annuler l'une d'elles", "Trouver une autre salle"], False,
         # « mes réservations » en un seul mot-clé, et non « reservation » seul :
         # ce dernier apparaît aussi dans « je veux annuler ma réservation », et
         # captait alors une demande d'annulation. Mesuré : 52 contre 92 pour
         # l'intention d'annulation, qui l'emporte comme il se doit.
         ["mes reservations", "planning", "agenda", "reunions"]),
        # Même raison : sans elle, une question sur les règles tombait sur la
        # base de connaissances, qui répond moins précisément que le service.
        ("regles", "Règles de réservation",
         "Voici les règles applicables :",
         ["Trouver une salle", "Parler à un humain"], False,
         ["regle", "regles", "duree", "quota", "horaires", "preavis"]),
        # Sans elle, « à quoi sert cette application » — première question de
        # toute démonstration — tombait sous le seuil de rapprochement et
        # recevait « je n'ai pas compris ». L'intention route vers la base de
        # connaissances, qui porte désormais la réponse et la cite.
        ("a_propos", "Découvrir l'application",
         "SmartRoom Manager gère la réservation des salles du campus, "
         "de la recherche jusqu'au code d'accès de la porte.",
         ["Trouver une salle", "Quelles sont les règles ?", "Voir mes réservations"], False,
         ["a quoi sert", "application", "smartroom", "presentation", "fonctionnalites"]),
    ]
    for code, libelle, reponse, suggestions, escalade, mots in intentions:
        intention = ChatbotIntent(
            code=code,
            label=libelle,
            answer=reponse,
            quick_replies=suggestions,
            escalates_to_ticket=escalade,
        )
        session.add(intention)
        session.flush()
        for mot in mots:
            session.add(ChatbotIntentKeyword(intent_id=intention.id, keyword=mot))

    # Reprises de la maquette. « Nouveau code généré » a été réécrite : aucune
    # route ne régénère un code d'accès, et laisser le support le promettre
    # l'engagerait sur une action qu'il ne peut pas mener.
    for code, categorie, libelle, corps in [
        ("rep-code", "acces", "Code d'accès resynchronisé",
         "Bonjour, je viens de forcer une mise à jour du terminal de la salle. "
         "Pouvez-vous réessayer avec le même code et me confirmer que l'accès fonctionne ?"),
        ("rep-retrouver-code", "acces", "Retrouver votre code d'accès",
         "Bonjour, le code de votre réservation figure sur sa fiche, dans l'espace "
         "« Mes réservations », ainsi que dans l'e-mail de confirmation. Chaque "
         "réservation a le sien : vérifiez qu'il s'agit bien de celui du créneau en cours."),
        ("rep-maintenance", "maintenance", "Intervention programmée",
         "Bonjour, votre signalement a été transmis au service technique. "
         "Une intervention est programmée sous 24 h ouvrées ; la salle reste "
         "réservable entre-temps."),
        ("rep-equipement", "equipement", "Équipement mobile disponible",
         "Bonjour, un équipement mobile équivalent est disponible à l'accueil du "
         "bâtiment sur simple demande, le temps du remplacement."),
        ("rep-cloture", "compte", "Clôture après résolution",
         "Bonjour, sans retour de votre part sous 48 h, nous clôturerons cette demande. "
         "Vous pouvez la rouvrir à tout moment depuis le centre d'aide."),
    ]:
        session.add(
            TicketResponseTemplate(code=code, category=categorie, label=libelle, body=corps)
        )

    support = administrateurs["c.nkoulou@ece.fr"]
    tickets = [
        ("#152", f"Climatisation défectueuse — {SALLE_TICKET_MATERIEL}", "equipements",
         TicketStatus.OUVERT,
         "La climatisation ne démarre plus, la salle est difficilement utilisable l'après-midi.",
         SALLE_TICKET_MATERIEL),
        ("#148", f"Code d'accès invalide — {SALLE_TICKET_ACCES}", "acces", TicketStatus.EN_COURS,
         "Le code est refusé par le terminal depuis ce matin.", SALLE_TICKET_ACCES),
        ("#131", "Demande d'ajout de projecteur", "equipements", TicketStatus.RESOLU,
         f"Serait-il possible d'ajouter un vidéoprojecteur en {SALLE_TICKET_RESOLU} ?",
         SALLE_TICKET_RESOLU),
    ]
    for reference, sujet, categorie, statut, message, nom_salle in tickets:
        ticket = Ticket(
            reference=reference,
            requester_id=utilisateurs[0].id,
            room_id=salles[nom_salle].id,
            subject=sujet,
            category=categorie,
            status=statut,
            assigned_admin_id=support.user_id,
            resolved_at=datetime.now(PARIS) - timedelta(days=2)
            if statut in (TicketStatus.RESOLU, TicketStatus.FERME)
            else None,
        )
        session.add(ticket)
        session.flush()
        session.add(
            TicketMessage(
                ticket_id=ticket.id,
                author_user_id=utilisateurs[0].id,
                body=message,
                sent_at=datetime.now(PARIS) - timedelta(days=3),
            )
        )
        if statut is not TicketStatus.OUVERT:
            session.add(
                TicketMessage(
                    ticket_id=ticket.id,
                    author_user_id=support.user_id,
                    is_from_support=True,
                    body="Bonjour, votre demande est prise en charge par le service technique.",
                    sent_at=datetime.now(PARIS) - timedelta(days=2),
                )
            )

    # Les codes sont ceux que le planificateur va chercher : « tpl-rappel »
    # aurait été ignoré en silence, et le rappel de trente minutes ne serait
    # jamais parti sans qu'aucune erreur ne le signale.
    for code, nom, declencheur, objet, corps in [
        ("reservation_confirmation", "Confirmation de réservation",
         "Déclenché lors de la création d'une réservation",
         "Votre réservation {{salle}} est confirmée",
         "Bonjour {{prenom}},\n\nVotre réservation pour la salle {{salle}} ({{batiment}}) est "
         "confirmée pour le {{date}} sur le créneau {{creneau}}.\n\n"
         "Votre code d'accès temporaire est : {{code_acces}}\n\n"
         "Pour gérer votre réservation : {{lien_reservation}}\n\nL'équipe Support."),
        ("reservation_rappel", "Rappel avant réunion",
         "Déclenché selon le délai de rappel choisi par l'utilisateur",
         "Votre réservation {{salle}} commence bientôt",
         "Bonjour {{prenom}},\n\nVotre réunion en salle {{salle}} commence à {{creneau}}. "
         "Pensez à valider votre présence sur place.\n\nCode d'accès : {{code_acces}}\n\n"
         "L'équipe Support."),
        ("reservation_annulation", "Annulation de réservation",
         "Déclenché lors de l'annulation d'une réservation",
         "Votre réservation {{salle}} du {{date}} est annulée",
         "Bonjour {{prenom}},\n\nVotre réservation en salle {{salle}} prévue le {{date}} "
         "({{creneau}}) a été annulée.\n\nL'équipe Support."),
    ]:
        session.add(
            EmailTemplate(
                code=code,
                name=nom,
                trigger_label=declencheur,
                subject=objet,
                body=corps,
                updated_by_admin_id=administrateurs["d.menga@ece.fr"].user_id,
            )
        )

    for index in range(6):
        session.add(
            Notification(
                user_id=utilisateurs[0].id,
                channel=NotificationChannel.IN_APP,
                title=ALEA.choice(
                    ["Réservation confirmée", "Rappel : réunion dans 30 minutes",
                     "Votre ticket a reçu une réponse", "Créneau libéré"]
                ),
                body="Consultez le détail depuis votre espace.",
                sent_at=datetime.now(PARIS) - timedelta(hours=index * 7),
                read_at=None if index < 3 else datetime.now(PARIS),
            )
        )

    session.commit()


def creer_audit(session: Session, administrateurs: dict[str, AdminAccount]) -> None:
    from app.models import AuditLog

    proprietaire = administrateurs["d.menga@ece.fr"]
    entrees = [
        (AuditAction.MODIFICATION, "Règles de réservation", "rules-global",
         {"Durée max": "3 h", "Quota hebdo": "10 h"},
         {"Durée max": "4 h", "Quota hebdo": "12 h"}),
        (AuditAction.MAINTENANCE, "Salle Ampère", "room",
         {"Statut": "Disponible"},
         {"Statut": "Maintenance", "Motif": "Remplacement de la climatisation"}),
        (AuditAction.PERMISSION, "C. Nkoulou", "admin_account",
         {"Permissions": "2"}, {"Permissions": "3"}),
        (AuditAction.CONNEXION, "Connexion administrateur", "session", None, None),
    ]
    for index, (action, cible, type_cible, avant, apres) in enumerate(entrees):
        session.add(
            AuditLog(
                actor_admin_id=proprietaire.user_id,
                actor_label="D. Menga",
                action=action,
                target_type=type_cible,
                target_id=uuid.uuid4(),
                target_label=cible,
                diff_before=avant,
                diff_after=apres,
                ip_address="192.168.1.42",
                user_agent="Mozilla/5.0 Chrome/122.0",
                session_id="sess_8f92a3b1c4",
                occurred_at=datetime.now(PARIS) - timedelta(hours=index * 5 + 1),
            )
        )
    session.commit()


def _indexer_base_de_connaissances() -> str:
    """Vectorise les articles fraîchement créés.

    Sans cette passe, une installation neuve aurait une base de connaissances
    lisible par le centre d'aide mais invisible pour l'assistant : la recherche
    hybride n'aurait aucun fragment à interroger, et le robot répondrait « je
    n'ai pas trouvé » à des questions dont la réponse est en base.

    Ollama absent, les fragments sont tout de même écrits, sans vecteur : la
    recherche lexicale les trouve, et `rattraper()` les vectorisera plus tard.
    Un jeu de démonstration ne doit pas dépendre d'un modèle pour se poser.
    """
    import asyncio

    from app.ai.rag import reindexer_tout

    with SessionLocal() as session:
        rapport = asyncio.run(reindexer_tout(session))
        session.commit()

    if rapport.sans_vecteurs:
        return (
            f"{rapport.fragments_ecrits} fragments indexés sans vecteur "
            "(modèle injoignable) : recherche lexicale seule."
        )
    return f"{rapport.fragments_vectorises} fragments vectorisés."


def main() -> int:
    analyseur = argparse.ArgumentParser(description="Peuple la base de démonstration.")
    analyseur.add_argument(
        "--reset", action="store_true", help="vide les données métier avant de peupler"
    )
    arguments = analyseur.parse_args()

    visuels: dict[str, str] = {}

    with SessionLocal() as session:
        if arguments.reset:
            # Relevé **avant** la purge : après, plus rien ne dit quelle image
            # appartenait à quel bâtiment.
            visuels = relever_visuels(session)
            vider(session)
        elif session.scalar(select(Building).limit(1)) is not None:
            print("La base contient déjà des données. Relancez avec --reset.", file=sys.stderr)
            return 1

        batiments, salles, _ = creer_parc(session)
        rendus = rendre_visuels(session, visuels)
        utilisateurs, administrateurs = creer_comptes(session, batiments)
        creer_regles(session, batiments, salles, administrateurs)
        reservations = creer_reservations(session, salles, utilisateurs)
        creer_conflits(session, salles, utilisateurs, administrateurs)
        creer_support(session, salles, utilisateurs, administrateurs)
        creer_audit(session, administrateurs)

        # La vue matérialisée est vide tant qu'elle n'a pas été rafraîchie.
        session.execute(select(1))
        session.commit()

    with engine.begin() as connexion:
        connexion.exec_driver_sql("SELECT refresh_room_occupancy(false)")

    fragments = _indexer_base_de_connaissances()

    print(
        f"Jeu de démonstration créé : {len(BATIMENTS)} bâtiments, {len(SALLES)} salles, "
        f"{len(utilisateurs)} utilisateurs, {len(reservations)} réservations "
        f"du {DEBUT_FENETRE} au {FIN_FENETRE}.\n"
        f"Fermeture globale le {JOUR_FERME}. Deux conflits en attente : #CONF-8492 et #CONF-8493.\n"
        f"Base de connaissances : {fragments}\n"
        + (f"Visuels déposés conservés : {rendus}.\n" if rendus else "")
        + f"Mot de passe de tous les comptes : {MOT_DE_PASSE_DEMO}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

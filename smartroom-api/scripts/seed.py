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
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from passlib.context import CryptContext
from sqlalchemy import delete, select, text
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.orm import Session

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
    ("A", "Campus Eiffel", "12 rue Pasteur, 94270 Le Kremlin-Bicêtre", 1),
    ("B", "Campus Newton", "37 quai de Grenelle, 75015 Paris", 2),
    ("C", "Annexe", "10 rue Sextius Michel, 75015 Paris", 3),
]

ETAGES = {
    "A": [("RDC", "Rez-de-chaussée", 0), ("1er", "1er étage", 1), ("2e", "2e étage", 2)],
    "B": [("1er", "1er étage", 1), ("2e", "2e étage", 2), ("3e", "3e étage", 3)],
    "C": [("RDC", "Rez-de-chaussée", 0)],
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

#: (nom, bâtiment, étage, capacité, surface, équipements, PMR, badge, statut)
SALLES = [
    ("Salle Vinci", "A", "2e", 12, 28, ["visio", "screen4k", "whiteboard", "sockets"], False, True, RoomStatus.DISPONIBLE),
    ("Salle Eiffel", "A", "RDC", 8, 22, ["screen4k", "whiteboard"], True, True, RoomStatus.DISPONIBLE),
    ("Salle Turing", "A", "1er", 8, 24, ["visio", "whiteboard"], False, True, RoomStatus.DISPONIBLE),
    ("Salle Lovelace", "A", "1er", 8, 20, ["screen4k", "sockets"], True, False, RoomStatus.DISPONIBLE),
    ("Salle Curie", "B", "3e", 20, 46, ["visio", "projector", "mic", "aircon"], True, True, RoomStatus.DISPONIBLE),
    ("Salle Ampère", "B", "1er", 30, 64, ["projector", "mic"], True, True, RoomStatus.MAINTENANCE),
    ("Salle Conseil Alpha", "B", "2e", 12, 30, ["visio", "screen4k", "whiteboard", "aircon"], False, True, RoomStatus.DISPONIBLE),
    ("Salle Pascal", "C", "RDC", 25, 52, ["projector", "aircon"], False, False, RoomStatus.DISPONIBLE),
]

#: Comptes nommés des maquettes, puis vingt-deux comptes générés.
UTILISATEURS_NOMMES = [
    ("Dylan", "Menga Wanda", "dylan.menga@edu.ece.fr", "B3 Data & IA", "Ingénierie", "20841"),
    ("Jean", "Dupont", "jean.dupont@edu.ece.fr", "B3 Data & IA", "Ingénierie", "20718"),
    ("Alice", "Leroy", "alice.leroy@edu.ece.fr", "B3 Cyber", "Ingénierie", "20903"),
    ("Marc", "Blanc", "marc.blanc@edu.ece.fr", "B3 Data & IA", "Ingénierie", "20655"),
    ("Marie", "Laurent", "marie.laurent@ece.fr", None, "Pédagogie", "10422"),
    ("Amadou", "Diallo", "a.diallo@ece.fr", None, "Pédagogie", "10318"),
    ("Nora", "Chaib", "nora.chaib@edu.ece.fr", "B3 Cyber", "Ingénierie", "20877"),
    ("Paul", "Vidal", "paul.vidal@edu.ece.fr", "B2 Généraliste", "Ingénierie", "21044"),
    ("Léa", "Fontaine", "lea.fontaine@edu.ece.fr", "B2 Généraliste", "Ingénierie", "21077"),
]

PRENOMS = ["Camille", "Hugo", "Inès", "Louis", "Sarah", "Yanis", "Chloé", "Adam", "Emma",
           "Noah", "Jade", "Rayan", "Manon", "Ethan", "Lina", "Nathan", "Sofia", "Théo",
           "Anaïs", "Malik", "Julie", "Karim"]
NOMS = ["Bernard", "Petit", "Roux", "Moreau", "Simon", "Michel", "Garcia", "David",
        "Bertrand", "Morel", "Girard", "Bonnet", "Dupuis", "Lambert", "Fournier",
        "Rousseau", "Vincent", "Muller", "Faure", "Andre", "Mercier", "Blanchard"]
PROMOTIONS = ["B1 Généraliste", "B2 Généraliste", "B3 Data & IA", "B3 Cyber", "B3 Énergie"]

ADMINISTRATEURS = [
    ("Dylan", "Menga", "d.menga@ece.fr", "Directeur IT", True, None),
    ("Samir", "Boukehila", "s.boukehila@ece.fr", "Directeur de site", False,
     ["rooms.manage", "support.handle", "conflicts.arbitrate"]),
    ("Claire", "Nkoulou", "c.nkoulou@ece.fr", "Référente support", False,
     ["support.handle", "conflicts.arbitrate"]),
]

OBJETS_REUNION = [
    "Revue de sprint", "Atelier data", "Point projet", "Comité de suivi", "Entretien RH",
    "Réunion pédagogique", "Soutenance blanche", "Atelier UX", "Rétrospective",
    "Point équipe", "Cours de rattrapage", "Session de travail", "Préparation examen",
]


def visuel(nom_salle: str, index: int) -> str:
    """Data URI SVG : aucun appel réseau, rendu identique hors ligne."""
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400">'
        '<rect width="640" height="400" fill="#1A2231"/>'
        '<rect x="120" y="150" width="400" height="110" rx="10" fill="none" '
        'stroke="#5B9BFF" stroke-opacity="0.35" stroke-width="3"/>'
        f'<text x="320" y="330" fill="#B4C0D4" font-family="monospace" '
        f'font-size="22" text-anchor="middle">{nom_salle} - vue {index}</text>'
        "</svg>"
    )
    from urllib.parse import quote

    return f"data:image/svg+xml;utf8,{quote(svg)}"


# --------------------------------------------------------------------------- #
# Peuplement
# --------------------------------------------------------------------------- #


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
        batiment = Building(code=code, name=nom, address=adresse, sort_order=ordre)
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

    salles: dict[str, Room] = {}
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
        # Placement sur le plan : grille de deux colonnes, sans recouvrement.
        colonne, ligne = index % 2, index // 2
        session.add(
            RoomPlacement(
                room_id=salle.id,
                pos_x=Decimal(8 + colonne * 48),
                pos_y=Decimal(8 + ligne * 24),
                width=Decimal(36),
                height=Decimal(18),
                rotation=0,
                is_entrance_marked=(index == 0),
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

    for index in range(22):
        prenom, nom = PRENOMS[index], NOMS[index]
        utilisateur = User(
            email=f"{prenom.lower()}.{nom.lower()}@edu.ece.fr".replace("ï", "i").replace("é", "e"),
            password_hash=empreinte,
            first_name=prenom,
            last_name=nom,
            promotion=ALEA.choice(PROMOTIONS),
            department="Ingénierie",
            badge_number=f"3{index:04d}",
            # Un compte suspendu pour démontrer la zone de danger de l'écran A-11.
            status=UserStatus.SUSPENDU if index == 3 else UserStatus.ACTIF,
        )
        session.add(utilisateur)
        utilisateurs.append(utilisateur)

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
            building_id=batiments["C"].id,
            max_duration_min=180,
            weekly_quota_hours=8,
            buffer_min=30,
        )
    )
    session.add(
        BookingRule(
            scope=RuleScope.SALLE,
            room_id=salles["Salle Ampère"].id,
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
                building_id=batiments["C"].id,
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
    session.add(ClosureBuilding(closure_id=maintenance.id, building_id=batiments["C"].id))

    session.commit()


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

    jour = DEBUT_FENETRE
    while jour <= FIN_FENETRE:
        # Ni week-end ni jour de fermeture.
        if jour.weekday() >= 5 or jour == JOUR_FERME:
            jour += timedelta(days=1)
            continue

        for salle in reservables:
            heure = 8
            while heure < 19:
                if ALEA.random() < 0.16:
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
            session.add(
                BookingAccessCode(
                    booking_id=reservation.id,
                    code_hash=CRYPT.hash(f"{ALEA.randint(1000, 9999)}"),
                    code_hint="A-****",
                    expires_at=reservation.time_range.upper,
                )
            )

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
    vinci, curie = salles["Salle Vinci"], salles["Salle Curie"]
    demain = AUJOURD_HUI + timedelta(days=1)
    while demain.weekday() >= 5:
        demain += timedelta(days=1)

    titulaire, contestataire = utilisateurs[0], utilisateurs[5]

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
        session.add(
            Booking(
                room_id=curie.id,
                owner_id=titulaire.id,
                title="Entretien RH",
                time_range=plage_precedente,
                attendee_count=4,
                status=BookingStatus.CONFIRMEE,
            )
        )
        session.flush()

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
            room_id=salles["Salle Conseil Alpha"].id,
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

    articles = [
        ("reserver", "reserver-une-salle-en-quatre-etapes", "Réserver une salle en quatre étapes",
         "Besoin, sélection, validation du créneau, confirmation.",
         "Indiquez votre besoin, choisissez une salle parmi les propositions, validez le "
         "créneau puis confirmez : la réservation est immédiate et le code d'accès arrive "
         "par e-mail.", ArticleStatus.PUBLIE),
        ("acces", "mon-code-d-acces-ne-fonctionne-pas", "Mon code d'accès ne fonctionne pas",
         "Le code est généré une heure avant le début de la réunion.",
         "Le code d'accès est généré une heure avant le début de la réunion et figure sur la "
         "fiche de votre réservation. S'il est refusé, ouvrez un ticket : le terminal peut "
         "nécessiter une resynchronisation.", ArticleStatus.PUBLIE),
        ("annulation", "annuler-une-reservation", "Annuler une réservation",
         "L'annulation est possible tant que le créneau n'a pas commencé.",
         "Vous pouvez annuler depuis le détail de la réservation tant que le créneau n'a pas "
         "commencé. Un motif est demandé et les participants sont prévenus automatiquement.",
         ArticleStatus.PUBLIE),
        ("equipements", "pourquoi-15-minutes-entre-deux-reunions", "Pourquoi 15 minutes entre deux réunions ?",
         "C'est le battement exigé pour l'aération et la remise en état.",
         "Un battement de quinze minutes sépare deux réunions dans une même salle : il permet "
         "l'aération, la remise en état du mobilier et évite les débordements en chaîne.",
         ArticleStatus.PUBLIE),
        ("compte", "regler-mes-notifications", "Régler mes notifications",
         "Délai de rappel et canaux se règlent depuis le profil.",
         "Le délai de rappel et les canaux de notification se règlent depuis votre profil, "
         "section Préférences. Le rappel par défaut est envoyé trente minutes avant le début.",
         ArticleStatus.BROUILLON),
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

    for code, categorie, libelle, corps in [
        ("rep-code", "acces", "Code d'accès resynchronisé",
         "Bonjour, je viens de forcer une mise à jour du terminal de la salle. "
         "Pouvez-vous réessayer avec le même code ?"),
        ("rep-maintenance", "equipements", "Intervention programmée",
         "Bonjour, votre signalement a été transmis au service technique. "
         "Une intervention est programmée sous 48 heures."),
    ]:
        session.add(
            TicketResponseTemplate(code=code, category=categorie, label=libelle, body=corps)
        )

    support = administrateurs["c.nkoulou@ece.fr"]
    tickets = [
        ("#152", "Climatisation défectueuse — Salle Curie", "equipements", TicketStatus.OUVERT,
         "La climatisation ne démarre plus, la salle est difficilement utilisable l'après-midi.",
         "Salle Curie"),
        ("#148", "Code d'accès invalide — Salle Vinci", "acces", TicketStatus.EN_COURS,
         "Le code est refusé par le terminal depuis ce matin.", "Salle Vinci"),
        ("#131", "Demande d'ajout de projecteur", "equipements", TicketStatus.RESOLU,
         "Serait-il possible d'ajouter un vidéoprojecteur en salle Eiffel ?", "Salle Eiffel"),
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

    for code, nom, declencheur, objet, corps in [
        ("tpl-confirmation", "Confirmation de réservation",
         "Déclenché lors de la création d'une réservation",
         "Votre réservation {{salle}} est confirmée",
         "Bonjour {{prenom}},\n\nVotre réservation pour la salle {{salle}} ({{batiment}}) est "
         "confirmée pour le {{date}} sur le créneau {{creneau}}.\n\n"
         "Votre code d'accès temporaire est : {{code_acces}}\n\n"
         "Pour gérer votre réservation : {{lien_reservation}}\n\nL'équipe Support."),
        ("tpl-rappel", "Rappel avant réunion",
         "Déclenché selon le délai de rappel choisi par l'utilisateur",
         "Votre réservation {{salle}} commence bientôt",
         "Bonjour {{prenom}},\n\nVotre réunion en salle {{salle}} commence à {{creneau}}. "
         "Pensez à valider votre présence sur place.\n\nCode d'accès : {{code_acces}}\n\n"
         "L'équipe Support."),
        ("tpl-annulation", "Annulation de réservation",
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


def main() -> int:
    analyseur = argparse.ArgumentParser(description="Peuple la base de démonstration.")
    analyseur.add_argument(
        "--reset", action="store_true", help="vide les données métier avant de peupler"
    )
    arguments = analyseur.parse_args()

    with SessionLocal() as session:
        if arguments.reset:
            vider(session)
        elif session.scalar(select(Building).limit(1)) is not None:
            print("La base contient déjà des données. Relancez avec --reset.", file=sys.stderr)
            return 1

        batiments, salles, _ = creer_parc(session)
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

    print(
        f"Jeu de démonstration créé : {len(BATIMENTS)} bâtiments, {len(SALLES)} salles, "
        f"{len(utilisateurs)} utilisateurs, {len(reservations)} réservations "
        f"du {DEBUT_FENETRE} au {FIN_FENETRE}.\n"
        f"Fermeture globale le {JOUR_FERME}. Deux conflits en attente : #CONF-8492 et #CONF-8493.\n"
        f"Mot de passe de tous les comptes : {MOT_DE_PASSE_DEMO}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

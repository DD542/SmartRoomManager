"""Orchestration du parc : bâtiments, étages, salles, équipements, plans.

Les routeurs valident et sérialisent ; toute la logique vit ici. Chaque écriture
sensible est photographiée avant et après, et consignée dans le journal d'audit
dans la même transaction — une modification annulée ne doit pas laisser de trace,
une modification validée doit toujours en laisser une.
"""

from __future__ import annotations

import re
import unicodedata
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Select, delete, func, select, text
from sqlalchemy.orm import Session, selectinload

from app.core import storage
from app.core.errors import NotFoundError, RuleViolationError
from app.core.pagination import PageParams, paginate
from app.db.enums import AuditAction, BookingStatus, PlanDocumentKind, RoomStatus
from app.models import (
    Booking,
    Building,
    Equipment,
    Floor,
    FloorPlan,
    Room,
    RoomEquipment,
    RoomPhoto,
    RoomPlacement,
)
from app.services import audit_service

#: Champs photographiés dans le journal d'audit. Le reste — horodatages,
#: identifiants techniques — n'apprend rien à qui relit une trace.
CHAMPS_SALLE = (
    "name",
    "slug",
    "capacity",
    "area_m2",
    "status",
    "is_accessible",
    "badge_required",
    "description",
    "floor_id",
)
CHAMPS_EQUIPEMENT = ("code", "label", "category", "icon", "description", "is_filterable")
CHAMPS_BATIMENT = ("code", "name", "address", "sort_order")
CHAMPS_PLAN = ("kind", "file_url", "file_name", "file_size_bytes")
CHAMPS_PHOTO = ("file_url", "alt_text", "position")

TRI_SALLES: dict[str, Any] = {
    "name": Room.name,
    "capacity": Room.capacity,
    "status": Room.status,
    "created_at": Room.created_at,
}
TRI_EQUIPEMENTS: dict[str, Any] = {
    "label": Equipment.label,
    "code": Equipment.code,
    "category": Equipment.category,
}


def slugify(valeur: str) -> str:
    """Identifiant lisible dérivé du nom, sans accent ni ponctuation."""
    plat = unicodedata.normalize("NFD", valeur.lower())
    sans_accent = "".join(c for c in plat if not unicodedata.combining(c))
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", sans_accent)).strip("-")


# --------------------------------------------------------------------------- #
# Bâtiments et étages
# --------------------------------------------------------------------------- #


def list_buildings(session: Session) -> list[tuple[Building, int, int]]:
    """Bâtiments avec leurs décomptes, agrégés en SQL.

    Compter les étages et les salles en Python imposerait de les charger : deux
    sous-requêtes corrélées coûtent moins et gardent la réponse constante.
    """
    etages = (
        select(func.count())
        .select_from(Floor)
        .where(Floor.building_id == Building.id)
        .scalar_subquery()
    )
    salles = (
        select(func.count())
        .select_from(Room)
        .join(Floor, Floor.id == Room.floor_id)
        .where(Floor.building_id == Building.id, Room.deleted_at.is_(None))
        .scalar_subquery()
    )
    return list(
        session.execute(
            select(Building, etages, salles).order_by(Building.sort_order, Building.name)
        ).all()
    )


def get_building(session: Session, building_id: uuid.UUID) -> Building:
    batiment = session.get(Building, building_id)
    if batiment is None:
        raise NotFoundError("Bâtiment introuvable.")
    return batiment


def list_floors(session: Session, building_id: uuid.UUID) -> list[tuple[Floor, int]]:
    get_building(session, building_id)
    salles = (
        select(func.count())
        .select_from(Room)
        .where(Room.floor_id == Floor.id, Room.deleted_at.is_(None))
        .scalar_subquery()
    )
    return list(
        session.execute(
            select(Floor, salles)
            .where(Floor.building_id == building_id)
            .order_by(Floor.level)
        ).all()
    )


def get_floor(session: Session, floor_id: uuid.UUID) -> Floor:
    etage = session.get(Floor, floor_id)
    if etage is None:
        raise NotFoundError("Étage introuvable.")
    return etage


def get_floor_plan(session: Session, floor_id: uuid.UUID) -> FloorPlan:
    get_floor(session, floor_id)
    plan = session.scalars(
        select(FloorPlan).where(FloorPlan.floor_id == floor_id)
    ).one_or_none()
    if plan is None:
        raise NotFoundError("Aucun plan pour cet étage.")
    return plan


def replace_floor_plan(
    session: Session,
    floor_id: uuid.UUID,
    *,
    contenu: bytes,
    content_type: str | None,
    file_name: str | None,
    admin_id: uuid.UUID | None,
) -> FloorPlan:
    """Dépose le plan d'un étage, en remplaçant le précédent.

    Le fichier précédent est effacé du disque après le remplacement : le garder
    laisserait s'accumuler des plans que plus rien ne référence.
    """
    get_floor(session, floor_id)
    extension = storage.verifier(content_type, len(contenu))
    url = storage.enregistrer("plans", contenu, extension)

    plan = session.scalars(
        select(FloorPlan).where(FloorPlan.floor_id == floor_id)
    ).one_or_none()
    ancienne_url = plan.file_url if plan is not None else None
    avant = audit_service.snapshot(plan, CHAMPS_PLAN) if plan is not None else None

    if plan is None:
        plan = FloorPlan(floor_id=floor_id)
        session.add(plan)

    plan.kind = (
        PlanDocumentKind.PDF if extension == ".pdf" else PlanDocumentKind.IMAGE
    )
    plan.file_url = url
    plan.file_name = storage.nom_affiche(file_name)
    plan.file_size_bytes = len(contenu)
    plan.uploaded_by_admin_id = admin_id
    plan.uploaded_at = datetime.now(UTC)
    session.flush()

    audit_service.record(
        session,
        action=AuditAction.MODIFICATION if avant else AuditAction.CREATION,
        target_type="floor_plan",
        target_label=plan.file_name,
        target_id=plan.id,
        before=avant,
        after=audit_service.snapshot(plan, CHAMPS_PLAN),
    )
    if ancienne_url:
        storage.supprimer(ancienne_url)
    return plan


def delete_floor_plan(session: Session, floor_id: uuid.UUID) -> None:
    plan = get_floor_plan(session, floor_id)
    url = plan.file_url
    audit_service.record(
        session,
        action=AuditAction.SUPPRESSION,
        target_type="floor_plan",
        target_label=plan.file_name,
        target_id=plan.id,
        before=audit_service.snapshot(plan, CHAMPS_PLAN),
    )
    session.delete(plan)
    session.flush()
    storage.supprimer(url)


def set_placements(
    session: Session, floor_id: uuid.UUID, placements: list[Any]
) -> list[RoomPlacement]:
    """Repositionne les salles sur le plan d'un étage.

    Les salles archivées sont refusées : les placer sur un plan promettrait une
    salle qui n'existe plus au catalogue.
    """
    get_floor(session, floor_id)
    demandees = {item.room_id for item in placements}

    connues = {
        salle.id: salle
        for salle in session.scalars(
            select(Room).where(Room.id.in_(demandees), Room.deleted_at.is_(None))
        )
    }
    manquantes = demandees - set(connues)
    if manquantes:
        raise NotFoundError(f"{len(manquantes)} salle(s) introuvable(s).")

    hors_etage = [item for item in connues.values() if item.floor_id != floor_id]
    if hors_etage:
        raise RuleViolationError(
            f"« {hors_etage[0].name} » n'appartient pas à cet étage.", code="etage"
        )

    archivees = [item for item in connues.values() if item.status is RoomStatus.ARCHIVEE]
    if archivees:
        raise RuleViolationError(
            f"« {archivees[0].name} » est archivée et ne peut pas être placée.",
            code="salle_archivee",
        )

    resultat: list[RoomPlacement] = []
    for demande in placements:
        placement = session.get(RoomPlacement, demande.room_id)
        if placement is None:
            placement = RoomPlacement(room_id=demande.room_id)
            session.add(placement)
        placement.pos_x = demande.pos_x
        placement.pos_y = demande.pos_y
        placement.width = demande.width
        placement.height = demande.height
        placement.rotation = demande.rotation
        placement.is_entrance_marked = demande.is_entrance_marked
        resultat.append(placement)

    audit_service.record(
        session,
        action=AuditAction.MODIFICATION,
        target_type="floor_plan",
        target_label=f"Plan de l'étage {floor_id}",
        target_id=floor_id,
        after={"placements": len(resultat)},
    )
    session.flush()
    return resultat


def unplace(session: Session, room_id: uuid.UUID) -> None:
    session.execute(delete(RoomPlacement).where(RoomPlacement.room_id == room_id))
    session.flush()


# --------------------------------------------------------------------------- #
# Équipements
# --------------------------------------------------------------------------- #


def list_equipments(
    session: Session,
    params: PageParams,
    *,
    category: str | None = None,
    filterable: bool | None = None,
) -> tuple[list[tuple[Equipment, int]], int]:
    salles = (
        select(func.count())
        .select_from(RoomEquipment)
        .join(Room, Room.id == RoomEquipment.room_id)
        .where(RoomEquipment.equipment_id == Equipment.id, Room.deleted_at.is_(None))
        .scalar_subquery()
    )
    requete: Select = select(Equipment, salles)
    if category is not None:
        requete = requete.where(Equipment.category == category)
    if filterable is not None:
        requete = requete.where(Equipment.is_filterable.is_(filterable))
    if params.sort is None:
        requete = requete.order_by(Equipment.category, Equipment.label)

    from app.core.pagination import apply_sort

    if params.sort is not None:
        requete = apply_sort(requete, params, TRI_EQUIPEMENTS)

    total = session.scalar(
        select(func.count()).select_from(requete.order_by(None).subquery())
    ) or 0
    lignes = session.execute(requete.limit(params.size).offset(params.offset)).all()
    return list(lignes), total


def create_equipment(session: Session, payload: Any) -> Equipment:
    materiel = Equipment(**payload.model_dump())
    session.add(materiel)
    session.flush()

    audit_service.record(
        session,
        action=AuditAction.CREATION,
        target_type="equipment",
        target_label=materiel.label,
        target_id=materiel.id,
        after=audit_service.snapshot(materiel, CHAMPS_EQUIPEMENT),
    )
    return materiel


def update_equipment(session: Session, equipment_id: uuid.UUID, payload: Any) -> Equipment:
    materiel = session.get(Equipment, equipment_id)
    if materiel is None:
        raise NotFoundError("Équipement introuvable.")

    avant = audit_service.snapshot(materiel, CHAMPS_EQUIPEMENT)
    for champ, valeur in payload.model_dump(exclude_unset=True).items():
        setattr(materiel, champ, valeur)
    session.flush()

    audit_service.record(
        session,
        action=AuditAction.MODIFICATION,
        target_type="equipment",
        target_label=materiel.label,
        target_id=materiel.id,
        before=avant,
        after=audit_service.snapshot(materiel, CHAMPS_EQUIPEMENT),
    )
    return materiel


def delete_equipment(session: Session, equipment_id: uuid.UUID) -> None:
    """Suppression physique, refusée si l'équipement équipe encore une salle.

    Le retirer silencieusement des salles ferait mentir leurs fiches ; la clé
    étrangère le refuserait de toute façon, autant l'expliquer.
    """
    materiel = session.get(Equipment, equipment_id)
    if materiel is None:
        raise NotFoundError("Équipement introuvable.")

    utilise = session.scalar(
        select(func.count())
        .select_from(RoomEquipment)
        .where(RoomEquipment.equipment_id == equipment_id)
    ) or 0
    if utilise:
        raise RuleViolationError(
            f"« {materiel.label} » équipe encore {utilise} salle(s).", code="reference"
        )

    audit_service.record(
        session,
        action=AuditAction.SUPPRESSION,
        target_type="equipment",
        target_label=materiel.label,
        target_id=materiel.id,
        before=audit_service.snapshot(materiel, CHAMPS_EQUIPEMENT),
    )
    session.delete(materiel)
    session.flush()


# --------------------------------------------------------------------------- #
# Salles
# --------------------------------------------------------------------------- #


def _requete_salle() -> Select:
    """Chargements explicites : sans eux, sérialiser trente salles déclencherait
    cent requêtes d'équipements, de photos et d'étages.

    `populate_existing` écrase les collections déjà chargées : après avoir
    remplacé l'équipement d'une salle, relire sans cette option rendrait la
    version d'avant, toujours présente dans la carte d'identité de la session.
    """
    return (
        select(Room)
        .options(
            selectinload(Room.floor).selectinload(Floor.building),
            selectinload(Room.room_equipments).selectinload(RoomEquipment.equipment),
            selectinload(Room.photos),
            selectinload(Room.placement),
        )
        .execution_options(populate_existing=True)
    )


def list_rooms(
    session: Session,
    params: PageParams,
    *,
    building_id: uuid.UUID | None = None,
    floor_id: uuid.UUID | None = None,
    min_capacity: int | None = None,
    equipment_ids: list[uuid.UUID] | None = None,
    accessible_only: bool = False,
    status: RoomStatus | None = None,
    query: str | None = None,
) -> tuple[list[Room], int]:
    requete = _requete_salle().where(Room.deleted_at.is_(None))

    if building_id is not None or floor_id is not None:
        requete = requete.join(Floor, Floor.id == Room.floor_id)
        if building_id is not None:
            requete = requete.where(Floor.building_id == building_id)
        if floor_id is not None:
            requete = requete.where(Room.floor_id == floor_id)

    if min_capacity is not None:
        requete = requete.where(Room.capacity >= min_capacity)
    if accessible_only:
        requete = requete.where(Room.is_accessible.is_(True))
    requete = requete.where(
        Room.status == status if status is not None else Room.status != RoomStatus.ARCHIVEE
    )
    if query:
        requete = requete.where(Room.name.ilike(f"%{query}%"))

    for equipement in equipment_ids or []:
        # Un `EXISTS` par équipement : une jointure multiple rendrait la salle
        # autant de fois qu'elle a d'équipements et fausserait le total.
        requete = requete.where(
            select(RoomEquipment.room_id)
            .where(
                RoomEquipment.room_id == Room.id,
                RoomEquipment.equipment_id == equipement,
            )
            .exists()
        )

    if params.sort is None:
        requete = requete.order_by(Room.name)

    return paginate(session, requete, params, colonnes=TRI_SALLES)


def occupancy_map(
    session: Session, room_ids: list[uuid.UUID], *, days: int = 30
) -> dict[uuid.UUID, int]:
    """Taux d'occupation moyen des salles données, sur la fenêtre récente.

    Lu dans la vue matérialisée qui alimente déjà les tableaux de bord : le
    recalculer ici donnerait un second chiffre, et deux écrans afficheraient
    deux occupations différentes pour la même salle.

    Une seule requête pour toute la page — une par ligne rendrait la liste
    proportionnellement lente au nombre de salles affichées.
    """
    if not room_ids:
        return {}

    lignes = session.execute(
        text(
            """
            SELECT room_id, ROUND(AVG(occupancy_rate) * 100)::int AS taux
              FROM v_room_occupancy_daily
             WHERE occupancy_date >= CURRENT_DATE - CAST(:jours AS int)
               AND room_id = ANY(CAST(:salles AS uuid[]))
             GROUP BY room_id
            """
        ),
        {"jours": days, "salles": [str(item) for item in room_ids]},
    ).all()
    return {ligne.room_id: ligne.taux for ligne in lignes}


def get_room(session: Session, room_id: uuid.UUID) -> Room:
    salle = session.scalars(
        _requete_salle().where(Room.id == room_id, Room.deleted_at.is_(None))
    ).one_or_none()
    if salle is None:
        raise NotFoundError("Salle introuvable.")
    return salle


def _appliquer_equipements(session: Session, salle: Room, demandes: list[Any]) -> None:
    """Remplace l'équipement d'une salle par la liste fournie."""
    session.execute(delete(RoomEquipment).where(RoomEquipment.room_id == salle.id))
    for demande in demandes:
        session.add(
            RoomEquipment(
                room_id=salle.id,
                equipment_id=demande.equipment_id,
                quantity=demande.quantity,
            )
        )


def create_room(session: Session, payload: Any) -> Room:
    get_floor(session, payload.floor_id)
    donnees = payload.model_dump(exclude={"equipments", "slug"})

    salle = Room(**donnees, slug=payload.slug or _slug_libre(session, payload.name))
    session.add(salle)
    session.flush()

    _appliquer_equipements(session, salle, payload.equipments)
    audit_service.record(
        session,
        action=AuditAction.CREATION,
        target_type="room",
        target_label=salle.name,
        target_id=salle.id,
        after=audit_service.snapshot(salle, CHAMPS_SALLE),
    )
    session.flush()
    return get_room(session, salle.id)


def _slug_libre(session: Session, nom: str) -> str:
    """Dérive un identifiant du nom, suffixé s'il est déjà pris."""
    base = slugify(nom) or "salle"
    candidat, suffixe = base, 2
    while session.scalar(select(func.count()).select_from(Room).where(Room.slug == candidat)):
        candidat, suffixe = f"{base}-{suffixe}", suffixe + 1
    return candidat


def update_room(session: Session, room_id: uuid.UUID, payload: Any) -> Room:
    salle = get_room(session, room_id)
    avant = audit_service.snapshot(salle, CHAMPS_SALLE)

    donnees = payload.model_dump(exclude_unset=True, exclude={"equipments"})
    if "floor_id" in donnees:
        get_floor(session, donnees["floor_id"])
    for champ, valeur in donnees.items():
        setattr(salle, champ, valeur)

    if payload.equipments is not None:
        _appliquer_equipements(session, salle, payload.equipments)

    session.flush()
    audit_service.record(
        session,
        action=AuditAction.MODIFICATION,
        target_type="room",
        target_label=salle.name,
        target_id=salle.id,
        before=avant,
        after=audit_service.snapshot(salle, CHAMPS_SALLE),
    )
    session.flush()
    return get_room(session, room_id)


def archive_room(session: Session, room_id: uuid.UUID) -> Room:
    """Archive plutôt que supprimer : les réservations passées y renvoient encore.

    Une salle qui porte des réservations à venir n'est pas archivable : elles
    disparaîtraient des écrans sans que personne ne soit prévenu.
    """
    from sqlalchemy.dialects.postgresql import Range

    salle = get_room(session, room_id)
    a_venir = session.scalar(
        select(func.count())
        .select_from(Booking)
        .where(
            Booking.room_id == room_id,
            Booking.status != BookingStatus.ANNULEE,
            Booking.deleted_at.is_(None),
            Booking.time_range.op("&&")(Range(datetime.now(UTC), None, bounds="[)")),
        )
    ) or 0
    if a_venir:
        raise RuleViolationError(
            f"« {salle.name} » porte {a_venir} réservation(s) à venir. "
            "Annulez-les ou déplacez-les avant d'archiver.",
            code="reservations_actives",
        )

    avant = audit_service.snapshot(salle, CHAMPS_SALLE)
    salle.status = RoomStatus.ARCHIVEE
    salle.deleted_at = datetime.now(UTC)
    session.flush()

    audit_service.record(
        session,
        action=AuditAction.SUPPRESSION,
        target_type="room",
        target_label=salle.name,
        target_id=salle.id,
        before=avant,
        after=audit_service.snapshot(salle, CHAMPS_SALLE),
    )
    session.flush()
    return salle


def bulk_update_rooms(session: Session, payload: Any) -> tuple[list[uuid.UUID], list[dict]]:
    """Applique une action à plusieurs salles, chacune indépendamment.

    Une salle en échec n'annule pas les autres : le point de sauvegarde par
    salle isole la faute, et la réponse dit précisément laquelle a échoué.
    """
    reussies: list[uuid.UUID] = []
    echouees: list[dict[str, str]] = []

    for room_id in payload.room_ids:
        point = session.begin_nested()
        try:
            salle = get_room(session, room_id)
            avant = audit_service.snapshot(salle, CHAMPS_SALLE)

            if payload.action == "status":
                salle.status = payload.status
            elif payload.action == "accessible":
                salle.is_accessible = payload.value
            elif payload.action == "badge":
                salle.badge_required = payload.value
            else:
                archive_room(session, room_id)

            session.flush()
            audit_service.record(
                session,
                action=AuditAction.MODIFICATION,
                target_type="room",
                target_label=salle.name,
                target_id=salle.id,
                before=avant,
                after=audit_service.snapshot(salle, CHAMPS_SALLE),
            )
            point.commit()
            reussies.append(room_id)
        except Exception as erreur:  # noqa: BLE001
            point.rollback()
            message = getattr(erreur, "message", None) or "Action impossible."
            echouees.append({"room_id": str(room_id), "message": message})

    session.flush()
    return reussies, echouees


def list_photos(session: Session, room_id: uuid.UUID) -> list[RoomPhoto]:
    get_room(session, room_id)
    return list(
        session.scalars(
            select(RoomPhoto)
            .where(RoomPhoto.room_id == room_id)
            .order_by(RoomPhoto.position)
        )
    )


def add_photo(
    session: Session,
    room_id: uuid.UUID,
    *,
    contenu: bytes,
    content_type: str | None,
    alt_text: str | None,
) -> RoomPhoto:
    """Ajoute une photo à une salle, à la suite des existantes.

    La position n'est pas demandée à l'appelant : six photos au maximum, la
    première sert de couverture, et laisser le client choisir un rang libre
    l'obligerait à connaître un état qu'il vient à peine de lire.
    """
    get_room(session, room_id)
    extension = storage.verifier(content_type, len(contenu))
    if extension == ".pdf":
        raise RuleViolationError(
            "Une photo de salle doit être une image.", code="format_invalide"
        )

    existantes = list_photos(session, room_id)
    if len(existantes) >= 6:
        raise RuleViolationError(
            "Six photos au maximum par salle.", code="trop_de_photos"
        )

    photo = RoomPhoto(
        room_id=room_id,
        file_url=storage.enregistrer("photos", contenu, extension),
        alt_text=(alt_text or None),
        position=max((item.position for item in existantes), default=-1) + 1,
    )
    session.add(photo)
    session.flush()
    audit_service.record(
        session,
        action=AuditAction.CREATION,
        target_type="room_photo",
        target_label=photo.file_url,
        target_id=photo.id,
        after=audit_service.snapshot(photo, CHAMPS_PHOTO),
    )
    return photo


def delete_photo(session: Session, room_id: uuid.UUID, photo_id: uuid.UUID) -> None:
    photo = session.scalars(
        select(RoomPhoto).where(RoomPhoto.id == photo_id, RoomPhoto.room_id == room_id)
    ).one_or_none()
    if photo is None:
        raise NotFoundError("Photo introuvable.")
    session.delete(photo)
    session.flush()


def room_filters(session: Session) -> dict[str, Any]:
    """Valeurs proposées par les filtres, mesurées sur le parc réel."""
    bornes = session.execute(
        select(func.min(Room.capacity), func.max(Room.capacity)).where(
            Room.deleted_at.is_(None), Room.status != RoomStatus.ARCHIVEE
        )
    ).one()

    return {
        "buildings": list_buildings(session),
        # Sous-requête corrélée plutôt que GROUP BY : `Floor.building` est
        # chargé en `joined`, et ses colonnes casseraient le regroupement.
        "floors": list(
            session.execute(
                select(
                    Floor,
                    select(func.count())
                    .select_from(Room)
                    .where(Room.floor_id == Floor.id, Room.deleted_at.is_(None))
                    .scalar_subquery(),
                ).order_by(Floor.level)
            ).all()
        ),
        "equipments": list(
            session.execute(
                select(
                    Equipment,
                    select(func.count())
                    .select_from(RoomEquipment)
                    .where(RoomEquipment.equipment_id == Equipment.id)
                    .scalar_subquery(),
                )
                .where(Equipment.is_filterable.is_(True))
                .order_by(Equipment.category, Equipment.label)
            ).all()
        ),
        "statuses": [item.value for item in RoomStatus],
        "capacity_min": bornes[0] or 0,
        "capacity_max": bornes[1] or 0,
    }

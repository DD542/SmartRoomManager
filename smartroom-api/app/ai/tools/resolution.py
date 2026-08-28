"""Résolution des noms en identifiants, côté serveur.

Le modèle ne connaît pas les UUID du parc et ne doit pas les inventer. Il
transmet ce que l'utilisateur a dit — « Eiffel 3 », « la salle Curie », « une
salle avec visio » — et la traduction se fait ici, contre la base.

Le rapprochement est volontairement tolérant sur la casse et les accents, et
volontairement strict sur l'ambiguïté : deux salles également plausibles ne
donnent pas un choix arbitraire, elles donnent une question. Choisir à la
place de l'utilisateur produirait une réservation dans la mauvaise salle, et
personne ne saurait pourquoi.
"""

from __future__ import annotations

import uuid
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import Building, Equipment, Floor, Room


class Ambiguite(Exception):
    """Plusieurs candidats également valables, ou aucun.

    Exception ordinaire et non `dataclass` : une exception porte déjà `args`,
    et les deux mécanismes d'initialisation se marchent dessus.
    """

    def __init__(self, *, quoi: str, candidats: tuple[str, ...] = ()) -> None:
        super().__init__(quoi)
        self.quoi = quoi
        self.candidats = candidats

    def message(self) -> str:
        if not self.candidats:
            return f"Aucune correspondance parmi les {self.quoi} connus."
        liste = ", ".join(self.candidats)
        return f"Plusieurs {self.quoi} correspondent : {liste}. Lequel voulez-vous ?"


def _normaliser(valeur: str) -> str:
    """Minuscules sans accents ni ponctuation, pour comparer « Ampère » et « ampere ».

    `unidecode` fait le travail quand il est présent ; sinon la table de
    correspondance ci-dessous couvre le français, qui est la seule langue des
    données. Une dépendance absente ne doit pas rendre la recherche inopérante.
    """
    try:
        from unidecode import unidecode

        base = unidecode(valeur)
    except ImportError:  # pragma: no cover - dépend de l'installation
        table = str.maketrans("àâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ", "aaaeeeeiioouuucAAAEEEEIIOOUUUC")
        base = valeur.translate(table)
    return " ".join(base.lower().replace("-", " ").split())


def resoudre_batiment(session: Session, texte: str | None) -> uuid.UUID | None:
    """« Eiffel 3 », « EIF3 », ou un UUID déjà résolu. `None` si rien n'est demandé."""
    if not texte:
        return None

    try:
        return uuid.UUID(str(texte))
    except (ValueError, AttributeError):
        pass

    cible = _normaliser(texte)
    batiments = session.scalars(select(Building).order_by(Building.sort_order)).all()

    exacts = [b for b in batiments if _normaliser(b.code) == cible or _normaliser(b.name) == cible]
    if len(exacts) == 1:
        return exacts[0].id

    partiels = [b for b in batiments if cible in _normaliser(f"{b.name} {b.code}")]
    if len(partiels) == 1:
        return partiels[0].id
    if len(partiels) > 1:
        raise Ambiguite(quoi="bâtiments", candidats=tuple(b.name for b in partiels))

    raise Ambiguite(quoi="bâtiments", candidats=tuple(b.name for b in batiments))


def resoudre_salle(session: Session, *, salle_id=None, nom: str | None = None) -> Room:
    """Rend la salle désignée par son identifiant ou par son nom.

    Lève `Ambiguite` quand le nom ne tranche pas : la liste des candidates part
    alors au modèle, qui la présente à l'utilisateur.
    """
    requete = select(Room).options(
        selectinload(Room.floor).selectinload(Floor.building),
        selectinload(Room.room_equipments),
    ).where(Room.deleted_at.is_(None))

    if salle_id is not None:
        salle = session.scalars(requete.where(Room.id == salle_id)).one_or_none()
        if salle is None:
            raise Ambiguite(quoi="salles", candidats=())
        return salle

    if not nom:
        raise Ambiguite(quoi="salles", candidats=())

    cible = _normaliser(nom)
    salles = session.scalars(requete).all()

    exactes = [s for s in salles if _normaliser(s.name) == cible]
    if len(exactes) == 1:
        return exactes[0]

    partielles = [s for s in salles if cible in _normaliser(s.name)]
    if len(partielles) == 1:
        return partielles[0]
    if partielles:
        raise Ambiguite(quoi="salles", candidats=tuple(s.name for s in partielles[:6]))

    # Dernier recours : le mot le plus distinctif de la demande. « la salle
    # Curie » et « Curie » doivent aboutir au même endroit.
    mots = [mot for mot in cible.split() if mot not in {"salle", "labo", "atelier", "amphi", "la", "le"}]
    for mot in mots:
        candidates = [s for s in salles if mot in _normaliser(s.name)]
        if len(candidates) == 1:
            return candidates[0]
        if candidates:
            raise Ambiguite(quoi="salles", candidats=tuple(s.name for s in candidates[:6]))

    raise Ambiguite(quoi="salles", candidats=())


def resoudre_equipements(session: Session, codes) -> frozenset[uuid.UUID]:
    """Traduit les codes d'équipement du schéma en identifiants.

    Un code inconnu est ignoré plutôt que refusé : le modèle a pu en inventer
    un, et faire échouer toute la recherche pour cela priverait l'utilisateur
    des salles qui répondaient à ses autres critères. L'écart reste visible —
    le résultat mentionne les équipements réellement retenus.
    """
    codes = [code for code in (codes or []) if code]
    if not codes:
        return frozenset()

    lignes = session.execute(
        select(Equipment.id, Equipment.code).where(Equipment.code.in_(codes))
    ).all()
    return frozenset(ligne.id for ligne in lignes)


def codes_equipements(session: Session, identifiants) -> tuple[str, ...]:
    """Chemin inverse : des identifiants vers les codes, pour l'affichage."""
    if not identifiants:
        return ()
    lignes = session.execute(
        select(Equipment.code).where(Equipment.id.in_(list(identifiants))).order_by(Equipment.code)
    ).all()
    return tuple(ligne.code for ligne in lignes)


def resume_salle(session: Session, salle: Room) -> dict:
    """Portrait court d'une salle, tel que le modèle et l'écran le reçoivent."""
    etage = salle.floor
    batiment = etage.building if etage else None

    return {
        "salle_id": str(salle.id),
        "nom": salle.name,
        "capacite": salle.capacity,
        # `float` et non `Decimal` : la carte finit en JSONB et repart au
        # modèle. Un `Decimal` fait échouer la sérialisation — et donc la
        # persistance du tour entier, alors que la réponse, elle, était bonne.
        "surface_m2": float(salle.area_m2) if salle.area_m2 is not None else None,
        "accessible_pmr": salle.is_accessible,
        "badge_requis": salle.badge_required,
        "statut": salle.status.value if hasattr(salle.status, "value") else str(salle.status),
        "etage": etage.label if etage else None,
        "batiment": batiment.name if batiment else None,
        "adresse": batiment.address if batiment else None,
        "equipements": sorted(item.equipment.code for item in salle.room_equipments),
    }

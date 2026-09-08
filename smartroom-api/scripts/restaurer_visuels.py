"""Rebranche les visuels versionnés sur les lignes du parc.

Pourquoi ce script existe
-------------------------
Les fichiers de `media/` suivent le dépôt : ils sont versionnés, parce que le
disque de l'hébergeur est éphémère. La **correspondance** entre un fichier et la
salle qu'il illustre, elle, ne vit que dans la base. Un `seed --reset` refait
donc des données neuves avec des visuels de remplacement, et les vraies photos
se retrouvent orphelines : présentes sur le disque, référencées par personne.

Ce script relit un relevé (`visuels.json`) et repose les liens. Il ne déplace
aucun fichier et n'en télécharge aucun : il n'écrit que des chemins, et
seulement si le fichier correspondant existe réellement sous `MEDIA_ROOT`. Un
lien vers un fichier absent afficherait une image cassée sans rien signaler,
ce qui est pire que le visuel de remplacement qu'il remplacerait.

Format attendu du relevé :

    {
      "batiments": {"EIF1": "/media/batiments/<fichier>"},
      "salles":    {"amphi-eiffel": {"repere": "/media/reperes/<fichier>",
                                     "photos": [{"url": "...", "alt": null,
                                                 "position": 1}]}},
      "plans":     {"EIF1|0": "/media/plans/<fichier>"}
    }

Usage :
    python -m scripts.restaurer_visuels visuels.json [--appliquer]

Sans `--appliquer`, le script montre ce qu'il ferait et ne touche à rien.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
import uuid

from sqlalchemy import text

from app.core.config import get_settings
from app.db.session import SessionLocal


def chemin_disque(url: str) -> pathlib.Path:
    """`/media/reperes/x.jpg` -> <MEDIA_ROOT>/reperes/x.jpg."""
    return pathlib.Path(get_settings().media_root) / url.removeprefix("/media/").lstrip(
        "/"
    )


def main() -> int:
    analyseur = argparse.ArgumentParser(description=__doc__)
    analyseur.add_argument("releve", help="fichier JSON du relevé")
    analyseur.add_argument(
        "--appliquer",
        action="store_true",
        help="écrit réellement en base ; sans ce drapeau, simple aperçu",
    )
    args = analyseur.parse_args()

    releve = json.loads(pathlib.Path(args.releve).read_text(encoding="utf-8"))
    absents: list[str] = []
    poses = {"batiments": 0, "reperes": 0, "photos": 0, "plans": 0}

    session = SessionLocal()
    try:
        # --- bâtiments ---------------------------------------------------
        for code, url in releve.get("batiments", {}).items():
            if not chemin_disque(url).is_file():
                absents.append(url)
                continue
            r = session.execute(
                text("UPDATE buildings SET image_url = :u WHERE code = :c"),
                {"u": url, "c": code},
            )
            poses["batiments"] += r.rowcount

        # --- salles : repère de localisation et photos --------------------
        for slug, visuels in releve.get("salles", {}).items():
            salle = session.execute(
                text("SELECT id FROM rooms WHERE slug = :s"), {"s": slug}
            ).first()
            if salle is None:
                continue
            room_id = salle[0]

            repere = visuels.get("repere")
            if repere:
                if chemin_disque(repere).is_file():
                    r = session.execute(
                        text("UPDATE rooms SET location_plan_url = :u WHERE id = :i"),
                        {"u": repere, "i": room_id},
                    )
                    poses["reperes"] += r.rowcount
                else:
                    absents.append(repere)

            photos = [
                p
                for p in visuels.get("photos", [])
                if chemin_disque(p["url"]).is_file()
            ]
            absents.extend(
                p["url"]
                for p in visuels.get("photos", [])
                if not chemin_disque(p["url"]).is_file()
            )
            if photos:
                # Les visuels de remplacement du jeu de démonstration cèdent la
                # place : les garder à côté des vraies photos ferait deux séries
                # concurrentes sur la même salle.
                session.execute(
                    text("DELETE FROM room_photos WHERE room_id = :i"), {"i": room_id}
                )
                for p in photos:
                    session.execute(
                        text(
                            "INSERT INTO room_photos "
                            "(id, room_id, file_url, alt_text, position) "
                            "VALUES (:id, :r, :u, :a, :p)"
                        ),
                        {
                            "id": uuid.uuid4(),
                            "r": room_id,
                            "u": p["url"],
                            "a": p.get("alt"),
                            "p": p.get("position") or 1,
                        },
                    )
                    poses["photos"] += 1

        # --- plans d'étage -------------------------------------------------
        for cle, url in releve.get("plans", {}).items():
            code, _, niveau = cle.partition("|")
            if not chemin_disque(url).is_file():
                absents.append(url)
                continue
            etage = session.execute(
                text(
                    "SELECT f.id FROM floors f JOIN buildings b ON b.id = f.building_id "
                    "WHERE b.code = :c AND f.level = :n"
                ),
                {"c": code, "n": int(niveau)},
            ).first()
            if etage is None:
                continue
            session.execute(
                text("DELETE FROM floor_plans WHERE floor_id = :f"), {"f": etage[0]}
            )
            session.execute(
                text(
                    "INSERT INTO floor_plans (id, floor_id, file_url) "
                    "VALUES (:id, :f, :u)"
                ),
                {"id": uuid.uuid4(), "f": etage[0], "u": url},
            )
            poses["plans"] += 1

        print(f"  batiments  : {poses['batiments']}")
        print(f"  reperes    : {poses['reperes']}")
        print(f"  photos     : {poses['photos']}")
        print(f"  plans      : {poses['plans']}")
        if absents:
            print(f"  IGNORES (fichier absent du disque) : {len(absents)}")
            for u in absents[:5]:
                print(f"    {u}")

        if args.appliquer:
            session.commit()
            print("  -> ecrit en base.")
        else:
            session.rollback()
            print("  -> apercu seulement ; relancer avec --appliquer pour ecrire.")
    finally:
        session.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())

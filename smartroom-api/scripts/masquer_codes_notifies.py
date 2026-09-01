"""Retire des notifications déjà écrites les codes d'accès qu'elles portent.

`mail_service.notify` masque désormais le code avant de l'écrire en base. Restent
les notifications émises avant cette correction : elles gardent le code complet
et s'affichent indéfiniment dans l'écran des notifications.

Ici, et seulement ici, le masquage se fait par expression régulière sur le texte
rendu. C'est ce qu'on peut faire : la valeur d'origine n'existe plus, seule sa
trace dans une phrase subsiste. Dans `notify`, le masquage porte sur la valeur
avant le rendu — un gabarit réécrit par l'administration pourrait présenter le
code autrement, et une expression régulière écrite pour la forme d'aujourd'hui
le laisserait passer demain.

    python -m scripts.masquer_codes_notifies            # montre, n'écrit rien
    python -m scripts.masquer_codes_notifies --appliquer # écrit
"""

from __future__ import annotations

import argparse
import re
import sys

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models import Notification

#: Un code émis : une lettre, un tiret, quatre chiffres. Le libellé garde sa
#: première lettre, comme la fiche de réservation — « E-**** ».
FORME_DU_CODE = re.compile(r"\b([A-Za-z])-(\d{4})\b")


def masquer(texte: str | None) -> str | None:
    if not texte:
        return texte
    return FORME_DU_CODE.sub(lambda t: f"{t.group(1)}-****", texte)


def main(argv: list[str] | None = None) -> int:
    analyseur = argparse.ArgumentParser(description=__doc__)
    analyseur.add_argument(
        "--appliquer",
        action="store_true",
        help="écrit les modifications ; sans ce drapeau, rien n'est touché",
    )
    options = analyseur.parse_args(argv)

    session = SessionLocal()
    touchees = []
    for notification in session.scalars(select(Notification)).all():
        corps = masquer(notification.body)
        titre = masquer(notification.title)
        if corps == notification.body and titre == notification.title:
            continue
        touchees.append((notification, titre, corps))

    if not touchees:
        print("Aucune notification ne porte de code en clair.")
        return 0

    print(f"{len(touchees)} notification(s) portent un code en clair.")
    for notification, _, corps in touchees[:5]:
        avant = FORME_DU_CODE.findall(notification.body or "")
        print(f"  · {notification.id} : {['-'.join(t) for t in avant][:3]}")
    if len(touchees) > 5:
        print(f"  · … et {len(touchees) - 5} autres")

    if not options.appliquer:
        print("\nRien n'a été écrit. Relancez avec --appliquer pour masquer.")
        return 0

    for notification, titre, corps in touchees:
        notification.title = titre
        notification.body = corps
    session.commit()
    print(f"\n{len(touchees)} notification(s) masquées.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

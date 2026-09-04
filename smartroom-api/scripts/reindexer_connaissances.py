r"""Reconstruit l'index vectoriel de la base de connaissances.

À lancer quand le **modèle de vecteurs change**, et à ce moment-là seulement.

Les fragments stockés portent les coordonnées que leur a données un modèle
donné. Interroger avec un autre ne provoque aucune erreur : la similarité
cosinus reste calculable, elle compare simplement deux espaces sans rapport.
La recherche cesse de trouver, sans que rien ne l'explique — c'est la panne la
plus coûteuse à diagnostiquer, et la raison d'être de ce script.

    ..\.venv\Scripts\python.exe -m scripts.reindexer_connaissances

La base visée est celle du `.env` ou des variables d'environnement en place.
Elle est affichée avant d'écrire, et une confirmation est demandée : réindexer
la production depuis un poste de développement doit rester un geste conscient.
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from sqlalchemy import select

from app.ai.rag.indexation import reindexer_tout
from app.ai.reglages import get_reglages_ia
from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models import FaqArticle


async def principal(sans_demander: bool) -> int:
    reglages = get_reglages_ia()
    settings = get_settings()

    hote = settings.postgres_host
    modele = reglages.distant_modele_vecteurs or reglages.modele_vecteurs

    print(f"base    : {settings.postgres_user}@{hote}/{settings.postgres_db}")
    print(f"modele  : {modele} ({reglages.dimension_vecteurs} dimensions)")
    print(
        f"etage   : {'distant impose' if reglages.vecteurs_toujours_distants else 'ordre habituel'}"
    )

    if not sans_demander:
        distante = "neon.tech" in hote or not hote.startswith("127.")
        avertissement = " — BASE DISTANTE" if distante else ""
        if input(f"Reindexer{avertissement} ? [oui/non] ").strip().lower() != "oui":
            print("Abandonne.")
            return 1

    with SessionLocal() as session:
        articles = session.scalars(select(FaqArticle)).all()
        print(f"\n{len(articles)} article(s) a reindexer...")

        rapport = await reindexer_tout(session)
        session.commit()

    print(f"\n{rapport}")
    return 0


if __name__ == "__main__":
    analyseur = argparse.ArgumentParser(description=__doc__)
    analyseur.add_argument(
        "--oui", action="store_true", help="ne pas demander confirmation"
    )
    sys.exit(asyncio.run(principal(analyseur.parse_args().oui)))

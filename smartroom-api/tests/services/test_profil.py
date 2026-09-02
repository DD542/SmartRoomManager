"""Photo de profil et sessions ouvertes : ce qu'un compte gère lui-même.

Deux sujets qui se ressemblent peu mais partagent un risque : ils touchent au
disque et aux jetons, c'est-à-dire aux deux endroits ou une erreur ne se voit
pas tout de suite. Une photo remplacée qui laisse son fichier derrière elle
remplit un volume sans que rien ne le signale ; une session « fermee » qui
reste ouverte donne une fausse assurance à qui vient de signaler un acces
suspect.
"""

from __future__ import annotations

import base64
import uuid
import zlib

import pytest
from sqlalchemy import select

from app.core import storage
from app.models import RefreshToken, User
from tests.services.conftest import connecter

pytestmark = pytest.mark.integration


def _png(largeur: int = 1, hauteur: int = 1) -> bytes:
    """PNG minuscule mais valide, construit sans dependance d'imagerie.

    Un `b"pas une image"` passerait tout aussi bien nos controles, qui portent
    sur le type declare et le poids : autant deposer un fichier que le
    navigateur saurait afficher, pour que le test decrive un usage reel.
    """

    def bloc(nom: bytes, donnees: bytes) -> bytes:
        corps = nom + donnees
        return (
            len(donnees).to_bytes(4, "big")
            + corps
            + zlib.crc32(corps).to_bytes(4, "big")
        )

    entete = (
        largeur.to_bytes(4, "big") + hauteur.to_bytes(4, "big") + bytes([8, 2, 0, 0, 0])
    )
    pixels = zlib.compress(b"\x00" + b"\x00\x00\x00" * largeur)
    return (
        b"\x89PNG\r\n\x1a\n"
        + bloc(b"IHDR", entete)
        + bloc(b"IDAT", pixels)
        + bloc(b"IEND", b"")
    )


def _corps(contenu: bytes, content_type: str = "image/png") -> dict:
    return {
        "content_type": content_type,
        "content": base64.b64encode(contenu).decode(),
    }


class TestPhotoDeProfil:
    def test_le_depot_rend_le_profil_portant_son_adresse(
        self, client, session, creer_compte
    ):
        compte = creer_compte("Awa")
        entetes = connecter(client, compte.email)

        reponse = client.put(
            "/api/v1/users/me/avatar", headers=entetes, json=_corps(_png())
        )

        assert reponse.status_code == 200, reponse.text
        adresse = reponse.json()["avatar_url"]
        assert adresse and adresse.endswith(".png")
        # Le fichier existe vraiment : rendre une adresse sans l'ecrire
        # produirait une image cassee a l'ecran, et rien ici ne le dirait.
        assert (storage.racine() / adresse.split("/media/", 1)[1]).exists()

    def test_un_second_depot_efface_le_fichier_precedent(
        self, client, session, creer_compte
    ):
        """Sans cela, chaque changement de photo laisse un fichier que plus rien
        ne reference — un volume qui grossit sans que personne ne le voie."""
        compte = creer_compte("Bilal")
        entetes = connecter(client, compte.email)

        premiere = client.put(
            "/api/v1/users/me/avatar", headers=entetes, json=_corps(_png())
        ).json()["avatar_url"]
        chemin_premier = storage.racine() / premiere.split("/media/", 1)[1]
        assert chemin_premier.exists()

        seconde = client.put(
            "/api/v1/users/me/avatar", headers=entetes, json=_corps(_png(2, 2))
        ).json()["avatar_url"]

        assert seconde != premiere
        assert not chemin_premier.exists()

    def test_le_retrait_rend_le_compte_a_ses_initiales(
        self, client, session, creer_compte
    ):
        compte = creer_compte("Chloe")
        entetes = connecter(client, compte.email)
        depose = client.put(
            "/api/v1/users/me/avatar", headers=entetes, json=_corps(_png())
        ).json()["avatar_url"]

        reponse = client.delete("/api/v1/users/me/avatar", headers=entetes)

        assert reponse.status_code == 200, reponse.text
        assert reponse.json()["avatar_url"] is None
        assert not (storage.racine() / depose.split("/media/", 1)[1]).exists()

    def test_le_retrait_sans_photo_ne_proteste_pas(self, client, creer_compte):
        """Retirer ce qui n'existe pas laisse le compte dans l'etat voulu :
        c'est le resultat demande, pas une erreur."""
        entetes = connecter(client, creer_compte("Dario").email)
        reponse = client.delete("/api/v1/users/me/avatar", headers=entetes)
        assert reponse.status_code == 200
        assert reponse.json()["avatar_url"] is None

    @pytest.mark.parametrize(
        ("type_declare", "raison"),
        [
            ("image/svg+xml", "le SVG porte du script"),
            ("application/pdf", "un PDF ne fait pas un portrait"),
            ("text/html", "type hors du magasin de medias"),
        ],
    )
    def test_les_types_hors_photo_sont_refuses(
        self, client, creer_compte, type_declare, raison
    ):
        """Le magasin de medias accepte le SVG et le PDF pour les plans
        d'etage ; la photo de profil non. Servi depuis le domaine de
        l'application, un SVG s'executerait avec ses droits."""
        entetes = connecter(client, creer_compte("Elias").email)

        reponse = client.put(
            "/api/v1/users/me/avatar",
            headers=entetes,
            json=_corps(_png(), type_declare),
        )

        assert reponse.status_code == 422, raison
        assert reponse.json()["error"]["code"] == "format_invalide"

    def test_un_fichier_trop_lourd_est_refuse(self, client, creer_compte):
        entetes = connecter(client, creer_compte("Fanta").email)
        trop = b"\x89PNG\r\n\x1a\n" + b"\x00" * (storage.TAILLE_MAX + 1)

        reponse = client.put(
            "/api/v1/users/me/avatar", headers=entetes, json=_corps(trop)
        )

        assert reponse.status_code == 422
        assert "5 Mo" in reponse.json()["error"]["message"]

    def test_la_photo_accompagne_le_profil_lu(self, client, creer_compte):
        entetes = connecter(client, creer_compte("Gaby").email)
        client.put("/api/v1/users/me/avatar", headers=entetes, json=_corps(_png()))

        profil = client.get("/api/v1/users/me", headers=entetes).json()

        assert profil["avatar_url"] is not None

    def test_un_visiteur_anonyme_ne_depose_rien(self, client):
        reponse = client.put("/api/v1/users/me/avatar", json=_corps(_png()))
        assert reponse.status_code == 401


class TestSessionsOuvertes:
    def test_une_session_est_une_famille_et_non_un_jeton(
        self, client, session, creer_compte
    ):
        """Chaque rafraichissement emet un jeton et consomme le precedent : les
        compter un par un afficherait « 47 appareils connectes » a qui n'en a
        qu'un."""
        compte = creer_compte("Hana")
        entetes = connecter(client, compte.email)
        client.post("/api/v1/auth/refresh")
        client.post("/api/v1/auth/refresh")

        jetons = session.scalars(
            select(RefreshToken).where(RefreshToken.user_id == compte.id)
        ).all()
        sessions = client.get("/api/v1/users/me/sessions", headers=entetes).json()

        assert len(jetons) > len(sessions)
        assert len(sessions) == 1

    def test_la_session_qui_appelle_se_reconnait(self, client, creer_compte):
        entetes = connecter(client, creer_compte("Ines").email)

        sessions = client.get("/api/v1/users/me/sessions", headers=entetes).json()

        assert len(sessions) == 1
        assert sessions[0]["current"] is True
        # L'adresse est un `INET` en base : sans conversion, la lecture entiere
        # tomberait en 500 — le meme defaut que le journal d'audit avait.
        assert isinstance(sessions[0]["ip_address"], (str, type(None)))

    def test_la_fermeture_epargne_la_session_courante(
        self, client, session, creer_compte
    ):
        """Se deconnecter soi-meme en fermant les autres obligerait a se
        reconnecter pour verifier que l'ordre a ete suivi."""
        compte = creer_compte("Jonas")
        entetes = connecter(client, compte.email)
        courante = client.get("/api/v1/users/me/sessions", headers=entetes).json()[0][
            "id"
        ]

        # Une seconde session, comme si le compte s'etait connecte ailleurs.
        autre = uuid.UUID(courante)
        session.add(
            RefreshToken(
                user_id=compte.id,
                token_hash="a" * 64,
                family_id=uuid.uuid4(),
                scope="user",
                expires_at=session.scalar(
                    select(RefreshToken.expires_at).where(
                        RefreshToken.user_id == compte.id
                    )
                ),
            )
        )
        session.flush()
        assert len(client.get("/api/v1/users/me/sessions", headers=entetes).json()) == 2

        reponse = client.delete("/api/v1/users/me/sessions", headers=entetes)

        assert reponse.status_code == 200, reponse.text
        assert reponse.json()["closed"] == 1
        restantes = client.get("/api/v1/users/me/sessions", headers=entetes).json()
        assert [item["id"] for item in restantes] == [str(autre)]

    def test_les_sessions_d_un_autre_compte_restent_invisibles(
        self, client, session, creer_compte
    ):
        voisin = creer_compte("Kader")
        connecter(client, voisin.email)
        entetes = connecter(client, creer_compte("Lina").email)

        sessions = client.get("/api/v1/users/me/sessions", headers=entetes).json()

        proprietaires = session.scalars(
            select(User.id).join(RefreshToken, RefreshToken.user_id == User.id)
        ).all()
        assert voisin.id in proprietaires, "le voisin a bien une session ouverte"
        assert len(sessions) == 1

    def test_un_visiteur_anonyme_ne_lit_aucune_session(self, client):
        assert client.get("/api/v1/users/me/sessions").status_code == 401

"""Durcissements de sécurité : bourrage, limitation, dépôts, en-têtes.

Chaque test verrouille une faille constatée sur l'application en service :

- les échecs de connexion n'étaient jamais gardés au journal, la transaction
  les emportant avec le refus ;
- aucune limite par compte : la limite par adresse IP se contournait en
  inventant une adresse `X-Forwarded-For` à chaque essai ;
- le type d'un fichier déposé n'était jugé que sur ce qu'annonçait le client ;
- les fichiers servis depuis le domaine de l'application ne portaient aucune
  politique interdisant le script.
"""

from __future__ import annotations

import base64

from sqlalchemy import func, select
from starlette.requests import Request

from app.core import limiter as module_limiteur
from app.core import storage
from app.db.enums import AuditAction
from app.models import AuditLog
from app.services import auth_service
from tests.services.conftest import MOT_DE_PASSE, connecter

PNG_MINIMAL = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000d49444154789c6360000002000100e221bc330000000049454e44ae426082"
)


def _connexion(client, email, mot_de_passe):
    return client.post(
        "/api/v1/auth/login", json={"email": email, "password": mot_de_passe}
    )


class TestBourrage:
    def test_un_echec_reste_au_journal(self, client, session, creer_compte):
        compte = creer_compte("Lina")

        assert _connexion(client, compte.email, "mauvais").status_code == 401

        echecs = session.scalar(
            select(func.count())
            .select_from(AuditLog)
            .where(
                AuditLog.action == AuditAction.CONNEXION,
                AuditLog.target_label == compte.email,
                AuditLog.diff_after["success"].astext == "false",
            )
        )
        assert echecs == 1

    def test_le_compte_se_ferme_apres_trop_d_echecs(self, client, creer_compte):
        compte = creer_compte("Omar")
        for _ in range(auth_service.ECHECS_TOLERES):
            assert _connexion(client, compte.email, "mauvais").status_code == 401

        # Même le bon mot de passe est refusé pendant la fenêtre : sinon le
        # bourrage continuerait, il suffirait de tomber juste.
        reponse = _connexion(client, compte.email, MOT_DE_PASSE)
        assert reponse.status_code == 429
        assert reponse.json()["error"]["code"] == "trop_de_requetes"

    def test_une_adresse_inconnue_recoit_le_meme_traitement(self, client):
        # Rien ne doit distinguer un compte existant d'un compte inventé.
        for _ in range(auth_service.ECHECS_TOLERES):
            _connexion(client, "personne@exemple.test", "mauvais")
        assert _connexion(client, "personne@exemple.test", "x").status_code == 429

    def test_les_autres_comptes_restent_ouverts(self, client, creer_compte):
        vise, autre = creer_compte("Paul"), creer_compte("Rita")
        for _ in range(auth_service.ECHECS_TOLERES):
            _connexion(client, vise.email, "mauvais")
        connecter(client, autre.email)


class TestCleDeLimitation:
    def _requete(self, entete: str | None):
        entetes = [(b"x-forwarded-for", entete.encode())] if entete else []
        return Request(
            {"type": "http", "headers": entetes, "client": ("10.0.0.9", 1234)}
        )

    def test_l_adresse_inventee_par_le_client_est_ignoree(self):
        # Le client écrit ce qu'il veut en tête ; le relais ajoute la vraie
        # adresse à la fin. Seule celle-ci compte.
        cle = module_limiteur.cle_client(self._requete("1.2.3.4, 203.0.113.7"))
        assert cle == "203.0.113.7"

    def test_sans_en_tete_l_adresse_de_connexion_compte(self):
        assert module_limiteur.cle_client(self._requete(None)) == "10.0.0.9"


class TestFichiersDeposes:
    def test_un_faux_png_est_refuse(self, client, creer_compte):
        entetes = connecter(client, creer_compte("Sami").email)
        page = b"<html><script>alert(1)</script></html>"

        reponse = client.put(
            "/api/v1/users/me/avatar",
            headers=entetes,
            json={
                "content_type": "image/png",
                "content": base64.b64encode(page).decode(),
            },
        )

        assert reponse.status_code == 422
        assert reponse.json()["error"]["code"] == "format_invalide"

    def test_les_signatures_reconnues(self):
        assert storage._signature_conforme(".png", PNG_MINIMAL)
        assert storage._signature_conforme(".pdf", b"%PDF-1.7\n")
        assert storage._signature_conforme(".svg", b'<?xml version="1.0"?><svg/>')
        assert not storage._signature_conforme(".svg", b"#!/bin/sh\n")
        assert not storage._signature_conforme(".jpg", PNG_MINIMAL)

    def test_une_photo_est_servie_sans_droit_au_script(self, client, creer_compte):
        entetes = connecter(client, creer_compte("Tess").email)
        adresse = client.put(
            "/api/v1/users/me/avatar",
            headers=entetes,
            json={
                "content_type": "image/png",
                "content": base64.b64encode(PNG_MINIMAL).decode(),
            },
        ).json()["avatar_url"]

        reponse = client.get(adresse)

        assert "sandbox" in reponse.headers["content-security-policy"]
        assert reponse.headers["x-content-type-options"] == "nosniff"


class TestEntetes:
    def test_chaque_reponse_porte_les_en_tetes_de_durcissement(self, client):
        reponse = client.get("/api/v1/health")
        assert reponse.headers["x-content-type-options"] == "nosniff"
        assert reponse.headers["x-frame-options"] == "DENY"
        assert reponse.headers["referrer-policy"] == "no-referrer"

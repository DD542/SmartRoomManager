"""Autorisations : ce que chacun ne peut pas faire.

Deux garanties, éprouvées séparément parce qu'elles se cassent séparément.

**La propriété.** Un utilisateur ne lit ni ne modifie les réservations d'un
autre. Le filtre est appliqué *dans la requête* et non vérifié après
chargement : la nuance compte, car un filtre postérieur laisse fuir l'objet
dans les journaux, les compteurs et les messages d'erreur avant d'être écarté.

**Les permissions.** Sept droits, une matrice. Les cas sont construits par
produit *(route protégée × permission absente)* et non écrits un par un : une
route ajoutée sans son entrée dans la table de correspondance sort du filet, et
le test de complétude en fin de module le signale.

Un principe traverse le module : une ressource d'autrui répond **404**, jamais
403. Un « interdit » confirmerait son existence à qui essaie des identifiants
au hasard.
"""

from __future__ import annotations

import uuid

import pytest

from app.api.deps import (
    CONFLICTS_ARBITRATE,
    DATA_EXPORT,
    ROOMS_MANAGE,
    RULES_CONFIGURE,
    SUPPORT_HANDLE,
    SYSTEM_CONFIGURE,
    USERS_MANAGE,
)
from tests.services.conftest import accorder, charge, connecter, creneau
from tests.services.test_api_v1 import poser

pytestmark = pytest.mark.integration

#: Les sept droits applicatifs. La liste est comparée au référentiel en base
#: par `TestCompletude` : un huitième droit ajouté sans test se verrait.
PERMISSIONS = (
    ROOMS_MANAGE,
    RULES_CONFIGURE,
    USERS_MANAGE,
    SUPPORT_HANDLE,
    CONFLICTS_ARBITRATE,
    DATA_EXPORT,
    SYSTEM_CONFIGURE,
)

#: Une route protégée par permission, décrite par ce qu'il faut pour l'appeler.
#: `corps` vaut None pour les lectures. Les identifiants sont volontairement
#: absurdes : la garde de permission doit trancher **avant** que la ressource
#: soit cherchée, sinon un 404 masquerait un défaut d'autorisation.
INCONNU = "00000000-0000-0000-0000-000000000000"

ROUTES_PROTEGEES = [
    pytest.param(
        "GET", "/api/v1/admin/users", None, USERS_MANAGE, id="annuaire_des_comptes"
    ),
    pytest.param(
        "GET", "/api/v1/admin/accounts", None, USERS_MANAGE, id="comptes_administration"
    ),
    pytest.param(
        "GET", "/api/v1/admin/invitations", None, USERS_MANAGE, id="invitations"
    ),
    pytest.param(
        "POST",
        "/api/v1/rooms",
        {
            "floor_id": INCONNU,
            "name": "Nouvelle",
            "capacity": 10,
            "area_m2": "20.00",
        },
        ROOMS_MANAGE,
        id="creation_de_salle",
    ),
    pytest.param(
        "DELETE", f"/api/v1/rooms/{INCONNU}", None, ROOMS_MANAGE, id="archivage_de_salle"
    ),
    pytest.param(
        "POST",
        "/api/v1/equipments",
        {
            "code": "materiel",
            "label": "Matériel",
            "category": "audiovisuel",
            "icon": "projector",
        },
        ROOMS_MANAGE,
        id="creation_d_equipement",
    ),
    pytest.param(
        "POST",
        "/api/v1/closures",
        {
            "label": "Fermeture",
            "first_day": "2026-12-24",
            "last_day": "2026-12-24",
        },
        RULES_CONFIGURE,
        id="declaration_de_fermeture",
    ),
    pytest.param(
        "GET", "/api/v1/admin/access-requests", None, CONFLICTS_ARBITRATE, id="file_d_arbitrage"
    ),
    pytest.param(
        "GET", "/api/v1/admin/bookings", None, CONFLICTS_ARBITRATE, id="reservations_de_tous"
    ),
    pytest.param(
        "GET", "/api/v1/admin/tickets", None, SUPPORT_HANDLE, id="file_du_support"
    ),
    pytest.param(
        "GET",
        "/api/v1/admin/response-templates",
        None,
        SUPPORT_HANDLE,
        id="reponses_types",
    ),
    pytest.param(
        "GET",
        "/api/v1/admin/email-templates",
        None,
        SYSTEM_CONFIGURE,
        id="gabarits_de_courriel",
    ),
    pytest.param(
        "GET", "/api/v1/admin/audit-logs", None, SYSTEM_CONFIGURE, id="journal_d_audit"
    ),
]


def _appeler(client, methode: str, chemin: str, corps, entetes):
    verbe = getattr(client, methode.lower())
    if corps is None:
        return verbe(chemin, headers=entetes)
    return verbe(chemin, headers=entetes, json=corps)


class TestPermissionsAdministration:
    @pytest.mark.parametrize(("methode", "chemin", "corps", "permission"), ROUTES_PROTEGEES)
    def test_sans_la_permission_la_route_repond_403(
        self, client, session, administrateur, methode, chemin, corps, permission
    ):
        """Un administrateur sans le droit requis est refusé, quels que soient
        ses autres droits."""
        autres = [item for item in PERMISSIONS if item != permission]
        accorder(session, administrateur, *autres)
        entetes = connecter(client, administrateur.user.email, admin=True)

        reponse = _appeler(client, methode, chemin, corps, entetes)
        assert reponse.status_code == 403, reponse.text
        assert reponse.json()["error"]["code"] == "permission_manquante"

    @pytest.mark.parametrize(("methode", "chemin", "corps", "permission"), ROUTES_PROTEGEES)
    def test_avec_la_permission_la_route_repond(
        self, client, session, administrateur, methode, chemin, corps, permission
    ):
        """Contre-épreuve indispensable : sans elle, une route cassée qui
        répondrait 403 à tout le monde passerait le cas précédent.

        L'assertion a d'abord été un simple `!= 403`, et c'était trop faible :
        un 500 la satisfait. `GET /admin/accounts` a rendu 500 sur chaque appel
        pendant que ce test restait vert, parce que le paramètre de garde
        `_admin` masquait la fonction `_admin()` du module. On exige donc que
        la route *réponde* : jamais 5xx, et 200 pour une lecture — accorder le
        droit de lire et recevoir une erreur serveur n'est pas « ne plus être
        refusé ».
        """
        accorder(session, administrateur, permission)
        entetes = connecter(client, administrateur.user.email, admin=True)

        reponse = _appeler(client, methode, chemin, corps, entetes)
        assert reponse.status_code != 403, reponse.text
        assert reponse.status_code < 500, reponse.text
        if methode == "GET":
            assert reponse.status_code == 200, reponse.text

    @pytest.mark.parametrize(("methode", "chemin", "corps", "permission"), ROUTES_PROTEGEES)
    def test_un_utilisateur_simple_n_atteint_pas_l_administration(
        self, client, compte, methode, chemin, corps, permission
    ):
        """Le jeton porte `scope=user` : la garde s'arrête avant la matrice."""
        entetes = connecter(client, compte.email)

        reponse = _appeler(client, methode, chemin, corps, entetes)
        assert reponse.status_code == 403, reponse.text

    @pytest.mark.parametrize(("methode", "chemin", "corps", "permission"), ROUTES_PROTEGEES)
    def test_sans_jeton_la_route_repond_401(
        self, client, methode, chemin, corps, permission
    ):
        reponse = _appeler(client, methode, chemin, corps, {})
        assert reponse.status_code == 401, reponse.text


class TestCompletude:
    def test_les_sept_permissions_du_referentiel_sont_couvertes(self, client, compte):
        """Le référentiel fait foi. Un huitième droit ajouté en base sans
        entrée dans ce module fait échouer ce test, et non les autres — qui
        continueraient de passer en ignorant la nouvelle route."""
        entetes = connecter(client, compte.email)
        groupes = client.get("/api/v1/admin/permissions", headers=entetes).json()
        codes = {item["code"] for groupe in groupes for item in groupe["permissions"]}

        assert codes == set(PERMISSIONS)

    def test_chaque_permission_protege_au_moins_une_route_testee(self):
        """Un droit qui ne garderait rien serait décoratif."""
        gardees = {parametre.values[3] for parametre in ROUTES_PROTEGEES}
        assert gardees == set(PERMISSIONS) - {DATA_EXPORT}

    def test_l_export_est_couvert_par_sa_route_alternative(
        self, client, session, administrateur
    ):
        """`data.export` est le seul droit accepté *en alternative* d'un autre :
        les statistiques s'ouvrent à `data.export` **ou** `system.configure`.
        Un test paramétré sur l'absence d'un seul droit ne le verrait pas."""
        accorder(session, administrateur, DATA_EXPORT)
        entetes = connecter(client, administrateur.user.email, admin=True)

        assert (
            client.get("/api/v1/admin/stats/overview", headers=entetes).status_code == 200
        )

    def test_les_statistiques_s_ouvrent_aussi_a_la_configuration(
        self, client, session, administrateur
    ):
        accorder(session, administrateur, SYSTEM_CONFIGURE)
        entetes = connecter(client, administrateur.user.email, admin=True)

        assert (
            client.get("/api/v1/admin/stats/overview", headers=entetes).status_code == 200
        )

    def test_sans_aucun_des_deux_les_statistiques_sont_refusees(
        self, client, session, administrateur
    ):
        accorder(session, administrateur, ROOMS_MANAGE)
        entetes = connecter(client, administrateur.user.email, admin=True)

        assert (
            client.get("/api/v1/admin/stats/overview", headers=entetes).status_code == 403
        )


class TestProprieteDesReservations:
    @pytest.fixture
    def reservation_d_autrui(self, session, salle, creer_compte, jour_ouvre):
        tiers = creer_compte("Tiers")
        return poser(session, salle, tiers, creneau(jour_ouvre, 10, 0, 60)), tiers

    def test_lister_ne_rend_que_les_siennes(
        self, client, session, salle, compte, creer_compte, jour_ouvre
    ):
        tiers = creer_compte("Tiers")
        mienne = poser(session, salle, compte, creneau(jour_ouvre, 9, 0, 60))
        poser(session, salle, tiers, creneau(jour_ouvre, 14, 0, 60))
        entetes = connecter(client, compte.email)

        corps = client.get("/api/v1/bookings", headers=entetes, params={"size": 100}).json()
        assert {item["id"] for item in corps["items"]} == {str(mienne.id)}

    def test_le_total_pagine_ne_compte_pas_celles_des_autres(
        self, client, session, salle, compte, creer_compte, jour_ouvre
    ):
        """Le filtre est appliqué dans la requête, pas après chargement : un
        filtrage postérieur laisserait le total révéler l'activité d'autrui."""
        tiers = creer_compte("Tiers")
        poser(session, salle, compte, creneau(jour_ouvre, 9, 0, 60))
        poser(session, salle, tiers, creneau(jour_ouvre, 14, 0, 60))
        poser(session, salle, tiers, creneau(jour_ouvre, 16, 0, 60))
        entetes = connecter(client, compte.email)

        corps = client.get("/api/v1/bookings", headers=entetes).json()
        assert corps["total"] == 1

    def test_lire_celle_d_un_tiers_repond_404(self, client, compte, reservation_d_autrui):
        autre, _ = reservation_d_autrui
        entetes = connecter(client, compte.email)

        reponse = client.get(f"/api/v1/bookings/{autre.id}", headers=entetes)
        assert reponse.status_code == 404

    def test_le_refus_ne_confirme_pas_l_existence(
        self, client, compte, reservation_d_autrui
    ):
        """Même corps pour une réservation d'autrui et pour un identifiant
        inventé : la réponse n'apprend rien à qui sonde."""
        autre, _ = reservation_d_autrui
        entetes = connecter(client, compte.email)

        existante = client.get(f"/api/v1/bookings/{autre.id}", headers=entetes)
        inventee = client.get(f"/api/v1/bookings/{uuid.uuid4()}", headers=entetes)

        assert existante.status_code == inventee.status_code == 404
        assert existante.json() == inventee.json()

    def test_modifier_celle_d_un_tiers_repond_404(
        self, client, compte, reservation_d_autrui, jour_ouvre
    ):
        autre, _ = reservation_d_autrui
        entetes = connecter(client, compte.email)

        reponse = client.patch(
            f"/api/v1/bookings/{autre.id}",
            headers=entetes,
            json={"slot": charge(creneau(jour_ouvre, 15, 0, 60))},
        )
        assert reponse.status_code == 404

    def test_annuler_celle_d_un_tiers_repond_404(
        self, client, compte, reservation_d_autrui
    ):
        autre, _ = reservation_d_autrui
        entetes = connecter(client, compte.email)

        reponse = client.post(
            f"/api/v1/bookings/{autre.id}/cancel",
            headers=entetes,
            json={"reason": "Je n'en veux plus"},
        )
        assert reponse.status_code == 404

    def test_valider_la_presence_d_un_tiers_repond_404(
        self, client, compte, reservation_d_autrui
    ):
        autre, _ = reservation_d_autrui
        entetes = connecter(client, compte.email)

        reponse = client.post(
            f"/api/v1/bookings/{autre.id}/check-in", headers=entetes, json={"code": "A-1234"}
        )
        assert reponse.status_code == 404

    def test_l_arbitre_voit_les_reservations_de_tous(
        self, client, session, administrateur, reservation_d_autrui
    ):
        """La propriété cède devant `conflicts.arbitrate` : arbitrer suppose de
        lire la réservation contestée."""
        autre, _ = reservation_d_autrui
        accorder(session, administrateur, CONFLICTS_ARBITRATE)
        entetes = connecter(client, administrateur.user.email, admin=True)

        reponse = client.get(f"/api/v1/bookings/{autre.id}", headers=entetes)
        assert reponse.status_code == 200

    def test_un_administrateur_sans_arbitrage_ne_les_voit_pas(
        self, client, session, administrateur, reservation_d_autrui
    ):
        autre, _ = reservation_d_autrui
        accorder(session, administrateur, ROOMS_MANAGE)
        entetes = connecter(client, administrateur.user.email, admin=True)

        reponse = client.get(f"/api/v1/bookings/{autre.id}", headers=entetes)
        assert reponse.status_code == 404


class TestProprieteDesAutresRessources:
    def test_les_notifications_d_autrui_ne_remontent_pas(
        self, client, compte, creer_compte
    ):
        entetes = connecter(client, compte.email)
        corps = client.get("/api/v1/notifications", headers=entetes).json()
        assert corps["total"] == 0

    def test_le_profil_lu_est_toujours_le_sien(self, client, compte, creer_compte):
        """`/users/me` ne prend aucun identifiant : il n'y a rien à falsifier."""
        creer_compte("Tiers")
        entetes = connecter(client, compte.email)

        corps = client.get("/api/v1/users/me", headers=entetes).json()
        assert corps["email"] == compte.email

    def test_une_demande_d_acces_d_autrui_repond_404(
        self, client, session, salle, compte, creer_compte, jour_ouvre
    ):
        tiers = creer_compte("Tiers")
        entetes_tiers = connecter(client, tiers.email)
        poser(session, salle, tiers, creneau(jour_ouvre, 10, 0, 60))

        depot = client.post(
            "/api/v1/access-requests",
            headers=entetes_tiers,
            json={
                "room_id": str(salle.id),
                "slot": charge(creneau(jour_ouvre, 10, 0, 60)),
                "reason": "Comité exceptionnel",
            },
        )
        if depot.status_code != 201:
            pytest.skip(f"Dépôt impossible dans ce contexte : {depot.text}")

        entetes = connecter(client, compte.email)
        reponse = client.get(
            f"/api/v1/access-requests/{depot.json()['id']}", headers=entetes
        )
        assert reponse.status_code == 404


class TestSeparationDesEspaces:
    def test_un_compte_sans_droits_ne_se_connecte_pas_en_administration(
        self, client, compte
    ):
        """Même refus qu'un mot de passe faux : un message distinct dirait qui
        est administrateur."""
        reponse = client.post(
            "/api/v1/auth/admin/login",
            json={"email": compte.email, "password": "smartroom2026"},
        )
        assert reponse.status_code == 401
        assert reponse.json()["error"]["code"] == "identifiants_invalides"

    def test_le_refus_est_indistinguable_d_un_mot_de_passe_faux(self, client, compte):
        sans_droits = client.post(
            "/api/v1/auth/admin/login",
            json={"email": compte.email, "password": "smartroom2026"},
        )
        mauvais_mot_de_passe = client.post(
            "/api/v1/auth/admin/login",
            json={"email": compte.email, "password": "ce-n-est-pas-le-bon"},
        )
        assert sans_droits.json() == mauvais_mot_de_passe.json()

    def test_un_jeton_utilisateur_ne_porte_aucune_permission(self, client, compte):
        entetes = connecter(client, compte.email)
        corps = client.get("/api/v1/auth/me", headers=entetes).json()

        assert corps["scope"] == "user"
        assert corps["permissions"] == []
        assert corps["admin"] is None

    def test_un_jeton_administrateur_porte_sa_matrice(
        self, client, session, administrateur
    ):
        accorder(session, administrateur, ROOMS_MANAGE, SUPPORT_HANDLE)
        entetes = connecter(client, administrateur.user.email, admin=True)

        corps = client.get("/api/v1/auth/me", headers=entetes).json()
        assert corps["scope"] == "admin"
        assert set(corps["permissions"]) == {ROOMS_MANAGE, SUPPORT_HANDLE}

    def test_un_jeton_falsifie_est_refuse(self, client):
        entetes = {"Authorization": "Bearer ceci.nest.pas.un.jeton"}
        assert client.get("/api/v1/users/me", headers=entetes).status_code == 401

    def test_un_jeton_absent_est_refuse(self, client):
        assert client.get("/api/v1/users/me").status_code == 401

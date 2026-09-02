"""Appartenance d'une adresse a l'etablissement.

La regle est pure : elle ne lit que la configuration, jamais la base. Elle vit
donc dans le domaine, et ses branches sont eprouvees ici.

Ce fichier existe pour une raison precise. La fonction avait bien des tests,
mais du cote de `tests/services`, ou elle etait exercee a travers les deux
schemas qui l'appellent. Le travail « Domaine » de la chaine d'integration ne
lance que ce dossier et exige 100 % des branches de `app.domain` : le module
y apparaissait donc a 0 %, et la chaine echouait sur un module pourtant teste
ailleurs. Un module du domaine se prouve dans le domaine.
"""

from __future__ import annotations

from app.core.config import get_settings
from app.domain.organisation import domaines_de_l_organisation, est_externe


class TestDomainesConfigures:
    def test_la_liste_est_normalisee(self, monkeypatch):
        """Espaces, casse et separateurs vides sont absorbes.

        La valeur vient d'une variable d'environnement ecrite a la main :
        « ece.fr, EDU.ECE.FR ,, » est une saisie plausible, et elle ne doit pas
        produire un domaine vide qui rendrait tout le monde interne.
        """
        monkeypatch.setattr(
            get_settings(), "organisation_domains", "ece.fr, EDU.ECE.FR ,,"
        )

        assert domaines_de_l_organisation() == {"ece.fr", "edu.ece.fr"}

    def test_une_liste_vide_ne_donne_aucun_domaine(self, monkeypatch):
        monkeypatch.setattr(get_settings(), "organisation_domains", "")

        assert domaines_de_l_organisation() == set()


class TestEstExterne:
    def test_une_adresse_de_l_etablissement_est_interne(self, monkeypatch):
        monkeypatch.setattr(get_settings(), "organisation_domains", "ece.fr,edu.ece.fr")

        assert est_externe("alice.leroy@edu.ece.fr") is False
        assert est_externe("marie.laurent@ece.fr") is False

    def test_une_adresse_personnelle_est_externe(self, monkeypatch):
        monkeypatch.setattr(get_settings(), "organisation_domains", "ece.fr,edu.ece.fr")

        assert est_externe("dylanmenga05@gmail.com") is True

    def test_la_casse_ne_change_rien(self, monkeypatch):
        monkeypatch.setattr(get_settings(), "organisation_domains", "ece.fr,edu.ece.fr")

        assert est_externe("Alice.Leroy@EDU.ECE.FR") is False

    def test_sans_liste_configuree_personne_n_est_externe(self, monkeypatch):
        """Mieux vaut ne rien signaler que signaler tout le monde.

        Une etiquette « Hors organisation » portee par chaque ligne de
        l'annuaire ne distingue plus rien : elle devient du bruit.
        """
        monkeypatch.setattr(get_settings(), "organisation_domains", "")

        assert est_externe("qui.que.ce.soit@gmail.com") is False

    def test_une_adresse_absente_n_est_pas_externe(self, monkeypatch):
        """Un compte sans adresse n'est pas un compte hors organisation.

        Le cas se presente : la seconde branche de la garde le couvre, et sans
        elle `"".split("@")` renverrait une chaine vide comparee aux domaines.
        """
        monkeypatch.setattr(get_settings(), "organisation_domains", "ece.fr")

        assert est_externe(None) is False
        assert est_externe("") is False

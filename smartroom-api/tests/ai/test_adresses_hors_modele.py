"""Une adresse de fichier va à l'écran, jamais dans la phrase du modèle.

Constaté sur « où se trouve la salle Vinci ? ». L'outil rendait
`plan_localisation_url` valant `/media/reperes/….jpg`, et le modèle recopiait
cette adresse dans sa réponse sous forme d'image Markdown — en lui inventant un
hôte :

    ![](http://media/reperes/bce1c0f355e743d4a4c440de8cfa6fcd.jpg)

« media » y devient un nom de domaine. Le navigateur n'affichait qu'un lien
mort, à côté de la carte qui montrait déjà la bonne image.

Le garde-fou d'étayage voyait le problème — son expression régulière
`_ADRESSES` a justement été écrite pour ce cas — mais il ne peut qu'ajouter une
réserve après coup, sur un texte déjà diffusé. La correction est en amont : ce
que le modèle ne reçoit pas, il ne peut pas le recopier.

La règle vit dans `ToolResult` et non chez chaque outil : un outil peut oublier
de signaler qu'il rend une adresse, ce fichier ne peut pas oublier de la
retirer.
"""

from __future__ import annotations

from app.ai.tools.base import Carte, ToolResult


class TestVueDuModele:
    def test_une_adresse_ne_lui_parvient_pas(self):
        resultat = ToolResult.ok(
            data={
                "nom": "Salle Vinci",
                "plan_localisation_url": "/media/reperes/a.jpg",
            },
            carte=Carte.PLAN,
        )

        vu = resultat.pour_modele()["donnees"]

        assert vu == {"nom": "Salle Vinci"}

    def test_la_carte_la_conserve(self):
        """L'écran en a besoin : c'est lui qui affiche l'image."""
        resultat = ToolResult.ok(
            data={
                "nom": "Salle Vinci",
                "plan_localisation_url": "/media/reperes/a.jpg",
            },
            carte=Carte.PLAN,
        )

        assert resultat.data["plan_localisation_url"] == "/media/reperes/a.jpg"

    def test_le_retrait_descend_dans_les_structures(self):
        """Une adresse enfouie est une adresse quand même.

        Les outils composent leurs données à partir de résumés imbriqués :
        ne nettoyer que la surface laisserait passer la moitié des cas.
        """
        resultat = ToolResult.ok(
            data={
                "salles": [
                    {"nom": "Vinci", "photo_url": "/media/photos/a.jpg"},
                    {"nom": "Curie", "detail": {"image_url": "/media/photos/b.jpg"}},
                ]
            },
            carte=Carte.TEXTE,
        )

        vu = resultat.pour_modele()["donnees"]

        assert vu == {"salles": [{"nom": "Vinci"}, {"nom": "Curie", "detail": {}}]}

    def test_le_reste_traverse_intact(self):
        """Contre-épreuve : un filtre trop large priverait le modèle des faits
        qu'il doit citer, et il inventerait à leur place."""
        resultat = ToolResult.ok(
            data={"nom": "Salle Vinci", "capacite": 12, "etage": "2e étage"},
            carte=Carte.PLAN,
        )

        assert resultat.pour_modele()["donnees"] == {
            "nom": "Salle Vinci",
            "capacite": 12,
            "etage": "2e étage",
        }

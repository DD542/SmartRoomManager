"""Traduction des erreurs de validation, cas par cas.

Ce que Pydantic rend est technique et anglais — « String should match pattern
'^(day|week|month)$' » —, et le front l'affiche tel quel dans son encart
d'erreur. Un utilisateur y lisait une expression régulière.

La table de correspondance est éprouvée exhaustivement parce qu'elle n'a pas
d'autre garde-fou : une branche oubliée ne casse rien, elle laisse simplement
passer le message anglais d'origine. Le défaut est invisible partout sauf à
l'écran de la personne qui vient de se tromper de saisie.

Aucune base ici : la traduction est du calcul pur sur un dictionnaire.
"""

from __future__ import annotations

import pytest

from app.api.messages import nommer, traduire


class TestNomDeChamp:
    def test_un_champ_connu_prend_son_nom_francais(self):
        assert nommer("granularity") == "la granularité"

    def test_un_chemin_imbrique_ne_retient_que_le_dernier_segment(self):
        # `body.slot.starts_at` désigne l'heure de début : citer le chemin
        # entier demanderait à l'utilisateur de connaître la forme du corps.
        assert nommer("slot.starts_at") == "l'heure de début"

    def test_un_champ_inconnu_garde_son_nom_technique(self):
        # Mieux vaut un mot anglais entre guillemets qu'une traduction inventée
        # qui désignerait un autre champ.
        assert nommer("obscure_column") == "« obscure_column »"

    def test_un_chemin_vide_designe_la_requete_elle_meme(self):
        assert nommer("") == "la requête"


class TestTraduction:
    def test_un_champ_manquant_est_annonce_comme_obligatoire(self):
        message = traduire({"loc": ["body", "reason"], "type": "missing"})
        assert message == "Le motif est obligatoire."

    def test_un_motif_enumere_est_rendu_en_clair(self):
        """`^(day|week|month)$` décrit une énumération, pas une contrainte de
        forme : la lister vaut mieux que de recopier l'expression."""
        message = traduire(
            {
                "loc": ["query", "granularity"],
                "type": "string_pattern_mismatch",
                "ctx": {"pattern": "^(day|week|month)$"},
            }
        )
        assert (
            message
            == "La granularité doit valoir l'une de ces valeurs : day, week, month."
        )

    def test_un_motif_non_enumere_reste_decrit_sans_etre_recopie(self):
        message = traduire(
            {
                "loc": ["body", "code"],
                "type": "string_pattern_mismatch",
                "ctx": {"pattern": r"^[A-Z]{2}\d{4}$"},
            }
        )
        assert message == "Le code n'a pas le format attendu."
        assert "^" not in message

    def test_une_enumeration_annoncee_par_pydantic_est_reprise(self):
        message = traduire(
            {
                "loc": ["body", "status"],
                "type": "enum",
                "ctx": {"expected": "'actif' ou 'suspendu'"},
            }
        )
        assert "actif" in message and "suspendu" in message

    @pytest.mark.parametrize(
        ("type_erreur", "attendu"),
        [
            ("int_parsing", "La capacité doit être un nombre."),
            ("int_type", "La capacité doit être un nombre."),
            ("float_parsing", "La capacité doit être un nombre."),
            ("decimal_parsing", "La capacité doit être un nombre."),
        ],
    )
    def test_les_erreurs_numeriques_disent_ce_qui_est_attendu(
        self, type_erreur, attendu
    ):
        assert traduire({"loc": ["body", "capacity"], "type": type_erreur}) == attendu

    @pytest.mark.parametrize(
        "type_erreur",
        ["datetime_parsing", "datetime_type", "datetime_from_date_parsing"],
    )
    def test_une_date_heure_cite_le_format_attendu(self, type_erreur):
        message = traduire({"loc": ["query", "from_date"], "type": type_erreur})
        assert message.startswith("La date de début doit être une date et une heure")
        # L'exemple compte autant que la règle : « ISO 8601 » ne dit rien à qui
        # ne connaît pas la norme.
        assert "2026-08-25T14:30:00Z" in message

    @pytest.mark.parametrize(
        "type_erreur", ["date_parsing", "date_type", "date_from_datetime_parsing"]
    )
    def test_une_date_seule_cite_son_propre_format(self, type_erreur):
        message = traduire({"loc": ["query", "first_day"], "type": type_erreur})
        assert message == "Le premier jour doit être une date au format AAAA-MM-JJ."

    @pytest.mark.parametrize("type_erreur", ["time_parsing", "time_type"])
    def test_une_heure_cite_son_format(self, type_erreur):
        assert traduire({"loc": ["body", "starts_at"], "type": type_erreur}) == (
            "L'heure de début doit être une heure au format HH:MM:SS."
        )

    @pytest.mark.parametrize("type_erreur", ["uuid_parsing", "uuid_type"])
    def test_un_identifiant_mal_forme_ne_montre_pas_le_mot_uuid(self, type_erreur):
        message = traduire({"loc": ["path", "room_id"], "type": type_erreur})
        assert message == "La salle doit être un identifiant valide."
        assert "uuid" not in message.lower()

    @pytest.mark.parametrize("type_erreur", ["bool_parsing", "bool_type"])
    def test_un_booleen_est_dit_en_francais(self, type_erreur):
        assert traduire({"loc": ["body", "flagged"], "type": type_erreur}) == (
            "« flagged » doit valoir vrai ou faux."
        )

    @pytest.mark.parametrize(
        ("type_erreur", "contexte", "attendu"),
        [
            (
                "greater_than_equal",
                {"ge": 1},
                "La taille de page doit valoir au moins 1.",
            ),
            ("greater_than", {"gt": 0}, "La taille de page doit dépasser 0."),
            (
                "less_than_equal",
                {"le": 100},
                "La taille de page ne peut pas dépasser 100.",
            ),
            ("less_than", {"lt": 200}, "La taille de page doit rester sous 200."),
        ],
    )
    def test_les_bornes_numeriques_citent_la_valeur_refusee(
        self, type_erreur, contexte, attendu
    ):
        """La borne est citée : « trop grand » n'aide personne à corriger."""
        message = traduire(
            {"loc": ["query", "size"], "type": type_erreur, "ctx": contexte}
        )
        assert message == attendu

    @pytest.mark.parametrize("type_erreur", ["string_too_short", "too_short"])
    def test_une_longueur_minimale_est_chiffree(self, type_erreur):
        message = traduire(
            {"loc": ["body", "reason"], "type": type_erreur, "ctx": {"min_length": 3}}
        )
        assert message == "Le motif doit compter au moins 3 caractères."

    @pytest.mark.parametrize("type_erreur", ["string_too_long", "too_long"])
    def test_une_longueur_maximale_est_chiffree(self, type_erreur):
        message = traduire(
            {"loc": ["body", "title"], "type": type_erreur, "ctx": {"max_length": 160}}
        )
        assert message == "Le titre ne peut pas dépasser 160 caractères."

    @pytest.mark.parametrize(
        "type_erreur",
        ["string_type", "list_type", "dict_type", "model_attributes_type"],
    )
    def test_un_type_inattendu_le_dit_sans_jargon(self, type_erreur):
        assert traduire({"loc": ["body", "permissions"], "type": type_erreur}) == (
            "Les permissions n'a pas le type attendu."
        )

    def test_un_champ_refuse_est_nomme_comme_tel(self):
        assert traduire({"loc": ["query", "order"], "type": "extra_forbidden"}) == (
            "« order » n'est pas un champ accepté."
        )

    def test_un_validateur_metier_garde_son_message_redige(self):
        """Les validateurs du domaine lèvent déjà une phrase française écrite
        pour l'affichage : la recopier vaut mieux que de la paraphraser."""
        message = traduire(
            {
                "loc": ["body"],
                "type": "value_error",
                "msg": "Value error, La durée maximale doit dépasser la durée minimale.",
            }
        )
        assert message == "La durée maximale doit dépasser la durée minimale."

    def test_un_validateur_sans_message_reste_explicite(self):
        assert (
            traduire({"loc": ["body"], "type": "value_error", "msg": ""})
            == "Valeur refusée."
        )

    def test_un_type_inconnu_conserve_le_message_d_origine(self):
        """Le dernier recours ne masque rien : une traduction absente vaut mieux
        qu'un message inventé qui décrirait la mauvaise contrainte."""
        assert (
            traduire({"loc": ["body", "x"], "type": "type_jamais_vu", "msg": "Boom"})
            == "Boom"
        )

    def test_un_type_inconnu_sans_message_reste_affichable(self):
        assert traduire({"type": "type_jamais_vu"}) == "Requête invalide."

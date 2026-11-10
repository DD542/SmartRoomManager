"""Documentation interactive de l'API.

Elle remplace le Swagger par défaut : bandeau, thème, bouton « Authorize ».
Ce bouton n'existait pas, aucune route ne déclarant de schéma de sécurité.
"""

from __future__ import annotations


def test_la_documentation_porte_le_bandeau_et_le_theme(client):
    page = client.get("/docs")

    assert page.status_code == 200
    assert "sr-bandeau" in page.text
    assert "/docs/theme.css" in page.text
    assert client.get("/docs/theme.css").headers["content-type"].startswith("text/css")


def test_le_jeton_peut_etre_saisi_sans_etre_exige(client):
    schema = client.get("/openapi.json").json()

    assert schema["components"]["securitySchemes"]["jeton"]["scheme"] == "bearer"
    # `{}` garde les routes publiques ouvertes dans la documentation.
    assert {} in schema["security"]

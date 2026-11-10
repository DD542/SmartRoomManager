"""Documentation interactive de l'API, aux couleurs de SmartRoom.

FastAPI sert d'office un Swagger générique. Celui-ci reprend la charte de
l'application (marine, corail, Plus Jakarta Sans), ajoute un bandeau qui relie
l'application et la supervision, et règle l'interface pour qu'on s'y retrouve
sur cent soixante routes : sections repliées, filtre par mot, durée affichée,
jeton conservé d'un rechargement à l'autre.

Le bouton « Authorize » n'existait pas : aucune route ne déclare de schéma de
sécurité, l'authentification passant par une dépendance maison. Le schéma
`Bearer` est donc déclaré ici, en option sur toutes les routes — les routes
publiques le restent, c'est le serveur qui décide.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.openapi.utils import get_openapi
from fastapi.responses import HTMLResponse, Response

from app.core.config import get_settings

#: Réglages de Swagger UI : https://swagger.io/docs/open-source-tools/swagger-ui/usage/configuration/
REGLAGES_SWAGGER = {
    "docExpansion": "none",
    "filter": True,
    "displayRequestDuration": True,
    "persistAuthorization": True,
    "deepLinking": True,
    "defaultModelsExpandDepth": -1,
    "tryItOutEnabled": False,
    "syntaxHighlight": {"theme": "nord"},
}

BANDEAU = """
<header class="sr-bandeau">
  <div class="sr-bandeau__marque">
    <svg viewBox="0 0 32 32" width="34" height="34" aria-hidden="true">
      <path d="M22.6 9.6c-.8-2.6-3.4-4.3-6.8-4.3-4 0-6.9 2.2-6.9 5.3 0 6.9 14.3 4.4
        14.3 11.6 0 3.2-3 5.5-7.4 5.5-3.8 0-6.6-1.8-7.4-4.5" fill="none" stroke="#FF8053"
        stroke-width="3.6" stroke-linecap="round"/>
    </svg>
    <div>
      <p class="sr-bandeau__titre">SmartRoom Manager <span>API</span></p>
      <p class="sr-bandeau__sous-titre">Réservation intelligente des salles — référence interactive</p>
    </div>
  </div>
  <nav class="sr-bandeau__liens" aria-label="Liens utiles">
    <a href="{application}">Application</a>
    <a href="/redoc">Lecture continue</a>
    <a href="/openapi.json">OpenAPI JSON</a>
    <a href="/api/v1/health" class="sr-pastille">État du service</a>
  </nav>
</header>
"""

THEME = """
:root {
  --sr-marine: #263171;
  --sr-marine-profond: #0c1547;
  --sr-corail: #ff8053;
  --sr-framboise: #cc3366;
  --sr-lavande: #e3e8ff;
  --sr-creme: #f8f4f1;
  --sr-trait: #ece6e1;
}
body { margin: 0; background: #fdfbf9; font-family: "Plus Jakarta Sans", system-ui, sans-serif; }
.swagger-ui, .swagger-ui .info .title, .swagger-ui .opblock-tag, .swagger-ui .btn,
.swagger-ui .opblock .opblock-summary-description, .swagger-ui .model-title,
.swagger-ui table thead tr th, .swagger-ui .parameter__name, .swagger-ui .tab li,
.swagger-ui .response-col_status, .swagger-ui label, .swagger-ui select, .swagger-ui input,
.swagger-ui .info, .swagger-ui .info *, .swagger-ui .markdown, .swagger-ui .renderedMarkdown {
  font-family: "Plus Jakarta Sans", system-ui, sans-serif !important;
}
.swagger-ui .topbar { display: none; }

/* Bandeau */
.sr-bandeau {
  position: sticky; top: 0; z-index: 10; display: flex; flex-wrap: wrap; gap: 16px;
  align-items: center; justify-content: space-between; margin: 12px; padding: 14px 22px;
  border-radius: 22px; background: var(--sr-marine); color: #fff;
  box-shadow: 0 18px 40px -20px rgba(12, 21, 71, .55);
}
.sr-bandeau__marque { display: flex; align-items: center; gap: 12px; }
.sr-bandeau__titre { margin: 0; font-size: 18px; font-weight: 700; letter-spacing: -.01em; }
.sr-bandeau__titre span {
  margin-left: 6px; padding: 2px 10px; border-radius: 999px; background: var(--sr-corail);
  color: var(--sr-marine-profond); font-size: 12px; font-weight: 700; vertical-align: middle;
}
.sr-bandeau__sous-titre { margin: 2px 0 0; font-size: 13px; opacity: .75; }
.sr-bandeau__liens { display: flex; flex-wrap: wrap; gap: 6px; }
.sr-bandeau__liens a {
  padding: 8px 14px; border-radius: 999px; color: rgba(255,255,255,.85); font-size: 13px;
  font-weight: 600; text-decoration: none; transition: background .2s, color .2s;
}
.sr-bandeau__liens a:hover { background: rgba(255,255,255,.12); color: #fff; }
.sr-bandeau__liens a.sr-pastille { background: var(--sr-corail); color: var(--sr-marine-profond); }

/* Introduction */
.swagger-ui .wrapper { max-width: 1180px; padding: 0 24px; }
.swagger-ui .information-container { margin: 18px 0 8px; }
.swagger-ui .info { margin: 24px 0; }
.swagger-ui .info .title { color: var(--sr-marine-profond); font-weight: 400; font-size: 34px; letter-spacing: -.02em; }
.swagger-ui .info .title small { background: var(--sr-lavande) !important; color: var(--sr-marine) !important; border-radius: 999px; }
.swagger-ui .info .title small.version-stamp { background: var(--sr-corail) !important; color: var(--sr-marine-profond) !important; }
.swagger-ui .info .description, .swagger-ui .markdown p, .swagger-ui .markdown li { color: #485074; font-size: 14.5px; line-height: 1.65; }
.swagger-ui .markdown h2, .swagger-ui .markdown h3 { color: var(--sr-marine-profond); }
.swagger-ui .markdown code, .swagger-ui .renderedMarkdown code {
  background: var(--sr-creme); color: var(--sr-framboise); border-radius: 6px; padding: 1px 6px;
}
.swagger-ui .markdown table { border-collapse: collapse; }
.swagger-ui .markdown table td, .swagger-ui .markdown table th { border-bottom: 1px solid var(--sr-trait); padding: 6px 12px; }
.swagger-ui .scheme-container { background: transparent; box-shadow: none; padding: 0 0 12px; }

/* Bouton d'autorisation */
.swagger-ui .btn.authorize {
  border-color: var(--sr-corail); color: var(--sr-marine-profond); background: #fff; border-radius: 999px;
  font-weight: 700;
}
.swagger-ui .btn.authorize svg { fill: var(--sr-corail); }

/* Sections */
.swagger-ui .opblock-tag-section { margin-bottom: 10px; }
.swagger-ui .opblock-tag {
  border-bottom: 0; border-radius: 18px; padding: 14px 18px; margin: 0 0 8px; background: #fff;
  box-shadow: 0 1px 2px rgba(12,21,71,.05), 0 12px 30px -20px rgba(12,21,71,.25);
  color: var(--sr-marine-profond); font-size: 18px; font-weight: 700; text-transform: capitalize;
}
.swagger-ui .opblock-tag small { color: #69727d; font-weight: 500; font-size: 13.5px; text-transform: none; }
.swagger-ui .opblock-tag:hover { background: var(--sr-creme); }

/* Opérations : une teinte par méthode */
.swagger-ui .opblock { border-radius: 14px; border-width: 1px; box-shadow: none; margin: 0 0 8px; overflow: hidden; }
.swagger-ui .opblock .opblock-summary { padding: 8px 12px; }
.swagger-ui .opblock .opblock-summary-method { border-radius: 999px; min-width: 76px; font-weight: 700; }
.swagger-ui .opblock .opblock-summary-path { color: var(--sr-marine-profond); font-weight: 600; }
.swagger-ui .opblock.opblock-get { background: rgba(38,49,113,.05); border-color: rgba(38,49,113,.25); }
.swagger-ui .opblock.opblock-get .opblock-summary-method { background: var(--sr-marine); }
.swagger-ui .opblock.opblock-post { background: rgba(255,128,83,.07); border-color: rgba(255,128,83,.45); }
.swagger-ui .opblock.opblock-post .opblock-summary-method { background: var(--sr-corail); color: var(--sr-marine-profond); }
.swagger-ui .opblock.opblock-put, .swagger-ui .opblock.opblock-patch { background: rgba(224,161,0,.07); border-color: rgba(224,161,0,.4); }
.swagger-ui .opblock.opblock-put .opblock-summary-method,
.swagger-ui .opblock.opblock-patch .opblock-summary-method { background: #e0a100; color: var(--sr-marine-profond); }
.swagger-ui .opblock.opblock-delete { background: rgba(204,51,102,.06); border-color: rgba(204,51,102,.35); }
.swagger-ui .opblock.opblock-delete .opblock-summary-method { background: var(--sr-framboise); }
.swagger-ui .opblock.opblock-head .opblock-summary-method { background: #69727d; }

/* Boutons d'essai */
.swagger-ui .btn { border-radius: 999px; }
.swagger-ui .btn.execute { background: var(--sr-marine); border-color: var(--sr-marine); }
.swagger-ui .btn.try-out__btn { border-color: var(--sr-marine); color: var(--sr-marine); }
.swagger-ui .btn.cancel { border-color: var(--sr-framboise); color: var(--sr-framboise); }

/* Champs et filtre */
.swagger-ui .filter-container { margin: 6px 0 14px; }
.swagger-ui .filter .operation-filter-input {
  border: 1px solid var(--sr-trait); border-radius: 999px; padding: 10px 18px; margin: 0;
}
.swagger-ui input[type=text], .swagger-ui textarea, .swagger-ui select { border-radius: 10px; border-color: var(--sr-trait); }
.swagger-ui .responses-inner h4, .swagger-ui .responses-inner h5 { color: var(--sr-marine-profond); }
.swagger-ui .highlight-code > .microlight { border-radius: 12px; }
.swagger-ui .dialog-ux .modal-ux { border-radius: 20px; border: 0; box-shadow: 0 30px 80px -28px rgba(12,21,71,.5); }
.swagger-ui .dialog-ux .modal-ux-header h3 { color: var(--sr-marine-profond); }
"""


def _schema(app: FastAPI) -> dict:
    """Schéma OpenAPI, avec le jeton `Bearer` déclaré une fois pour toutes."""
    if app.openapi_schema:
        return app.openapi_schema
    schema = get_openapi(
        title=app.title,
        version=app.version,
        description=app.description,
        routes=app.routes,
        tags=app.openapi_tags,
    )
    schema.setdefault("components", {}).setdefault("securitySchemes", {})["jeton"] = {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "JWT",
        "description": (
            "Jeton d'accès rendu par `POST /api/v1/auth/login` (ou `/auth/admin/login` "
            "pour l'administration), champ `access_token`. Valable 15 minutes."
        ),
    }
    # `{}` en second : le jeton est proposé partout sans être exigé par la
    # documentation — c'est le serveur qui sait quelles routes sont publiques.
    schema["security"] = [{"jeton": []}, {}]
    app.openapi_schema = schema
    return schema


def installer(app: FastAPI) -> None:
    """Remplace la documentation par défaut par la version habillée."""
    app.openapi = lambda: _schema(app)

    @app.get("/docs", include_in_schema=False)
    def documentation() -> HTMLResponse:
        page = get_swagger_ui_html(
            openapi_url=app.openapi_url,
            title=f"{app.title} — Documentation de l'API",
            swagger_favicon_url="/docs/favicon.svg",
            swagger_ui_parameters=REGLAGES_SWAGGER,
        ).body.decode("utf-8")
        tete = (
            '<link rel="preconnect" href="https://fonts.googleapis.com">'
            '<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:'
            'ital,wght@0,400;0,500;0,600;0,700;1,700&display=swap" rel="stylesheet">'
            '<link rel="stylesheet" href="/docs/theme.css">'
        )
        page = page.replace("</head>", f"{tete}</head>", 1)
        # Le front vit sur une autre origine que l'API : la première origine
        # autorisée par le CORS est justement la sienne.
        origines = get_settings().cors_origins
        application = f"{origines[0].rstrip('/')}/presentation" if origines else "/"
        bandeau = BANDEAU.replace("{application}", application)
        page = page.replace("<body>", f"<body>{bandeau}", 1)
        return HTMLResponse(page)

    @app.get("/docs/theme.css", include_in_schema=False)
    def theme() -> Response:
        return Response(THEME, media_type="text/css")

    @app.get("/docs/favicon.svg", include_in_schema=False)
    def favicon() -> Response:
        return Response(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
            '<rect width="32" height="32" rx="9" fill="#263171"/>'
            '<path d="M21.5 10.6c-.6-2-2.7-3.4-5.6-3.4-3.3 0-5.6 1.8-5.6 4.3 0 5.6 11.6 '
            '3.6 11.6 9.4 0 2.6-2.4 4.4-6 4.4-3.1 0-5.4-1.4-6-3.6" fill="none" '
            'stroke="#FF8053" stroke-width="3" stroke-linecap="round"/></svg>',
            media_type="image/svg+xml",
        )

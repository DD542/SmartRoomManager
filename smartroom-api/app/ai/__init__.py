"""Couche d'assistance conversationnelle.

Le découpage suit celui du document d'architecture `docs/ia/00-architecture.md` :

    providers/   fourniture d'inférence, interchangeable
    agent/       boucle, budget de contexte, orchestration
    tools/       façades minces sur les services métier
    rag/         base de connaissances vectorisée
    guardrails/  validation, filtrage, repli
    prompts/     prompts système versionnés

Aucun de ces modules n'est importé par le reste de l'application : la couche IA
dépend des services, jamais l'inverse. Retirer `app/ai` laisserait une API
complète et fonctionnelle.
"""

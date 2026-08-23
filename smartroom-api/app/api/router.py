"""Assemblage des routeurs sous un préfixe unique.

Le préfixe `/api` est porté ici et nulle part ailleurs : les routeurs restent
montables tels quels dans un test, sans dépendre de leur emplacement final.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.api.routes import admin, auth, bookings, rooms

api_router = APIRouter(prefix="/api")
api_router.include_router(auth.router)
api_router.include_router(rooms.router)
api_router.include_router(bookings.router)
api_router.include_router(admin.router)

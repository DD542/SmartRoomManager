"""Assemblage de la version 1 de l'API.

Le préfixe est porté ici et nulle part ailleurs : chaque routeur reste montable
tel quel dans un test, sans dépendre de son emplacement final.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.api.v1 import (
    access_requests,
    admin,
    auth,
    availability,
    bookings,
    buildings,
    chat,
    equipments,
    notifications,
    recommendations,
    rooms,
    rules,
    stats,
    support,
    users,
)

v1_router = APIRouter(prefix="/api/v1")
v1_router.include_router(auth.router)
v1_router.include_router(buildings.router)
v1_router.include_router(rooms.router)
v1_router.include_router(equipments.router)
v1_router.include_router(availability.router)
v1_router.include_router(bookings.router)
v1_router.include_router(recommendations.router)
v1_router.include_router(access_requests.router)
v1_router.include_router(rules.router)
v1_router.include_router(support.router)
v1_router.include_router(chat.router)
v1_router.include_router(notifications.router)
v1_router.include_router(users.router)
v1_router.include_router(stats.router)
v1_router.include_router(admin.router)

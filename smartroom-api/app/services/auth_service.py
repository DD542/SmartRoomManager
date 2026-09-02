"""Ouverture, renouvellement et fermeture de session.

Le renouvellement fait tourner le jeton : l'ancien est consommé, un nouveau est
émis dans la même famille. Un jeton déjà consommé qui reparaît ne peut venir que
d'une copie — la famille entière est alors révoquée, ce qu'un simple compteur ne
permettrait pas de détecter.
"""

from __future__ import annotations

import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.orm import Session, selectinload

from app.api.context import current_context
from app.core.errors import AuthenticationError, NotFoundError, PermissionError_
from app.core.security import (
    create_access_token,
    fingerprint,
    hash_password,
    new_opaque_token,
    refresh_expiry,
    reset_expiry,
    verify_password,
)
from app.db.enums import AuditAction, UserStatus
from app.models import AdminAccount, PasswordResetToken, RefreshToken, User
from app.services import audit_service, google_service

#: Message unique quel que soit le motif : distinguer « compte inconnu » de
#: « mot de passe faux » transformerait la connexion en énumérateur d'adresses.
REFUS = "Adresse e-mail ou mot de passe incorrect."


@dataclass(frozen=True, slots=True)
class Session_:
    """Résultat d'une ouverture ou d'un renouvellement de session."""

    user: User
    admin: AdminAccount | None
    access_token: str
    expires_in: int
    refresh_token: str
    scope: str


def _charger(session: Session, email: str) -> User | None:
    return session.scalars(
        select(User)
        .options(
            selectinload(User.preferences),
            selectinload(User.admin_account).selectinload(AdminAccount.permissions),
        )
        .where(User.email == email, User.deleted_at.is_(None))
    ).one_or_none()


def _emettre(
    session: Session, compte: User, scope: str, *, family_id: uuid.UUID | None = None
) -> tuple[str, str, int]:
    """Émet un couple accès + rafraîchissement, dans une famille donnée."""
    contexte = current_context()
    # La famille est tirée avant l'émission : le jeton d'accès la porte, pour
    # que l'écran des sessions sache laquelle est la sienne sans que le cookie
    # de rafraîchissement ait à sortir de son chemin.
    famille = family_id or uuid.uuid4()
    acces, duree = create_access_token(
        subject=compte.id, scope=scope, family_id=famille
    )
    clair, empreinte = new_opaque_token()

    session.add(
        RefreshToken(
            user_id=compte.id,
            token_hash=empreinte,
            family_id=famille,
            scope=scope,
            expires_at=refresh_expiry(),
            ip_address=contexte.ip_address,
            user_agent=contexte.user_agent,
        )
    )
    return acces, clair, duree


def login(
    session: Session, *, email: str, password: str, admin: bool = False
) -> Session_:
    """Ouvre une session sur l'espace demandé.

    Un administrateur qui se connecte sur l'espace public obtient un jeton de
    portée `user` : le back-office lui restera fermé jusqu'à ce qu'il s'y
    connecte explicitement.
    """
    compte = _charger(session, email)

    if compte is None or not verify_password(password, compte.password_hash):
        audit_service.record_login(
            session, label=email, scope="admin" if admin else "user", success=False
        )
        raise AuthenticationError(REFUS, code="identifiants_invalides")

    if compte.status is UserStatus.SUSPENDU:
        audit_service.record_login(
            session, label=email, scope="admin" if admin else "user", success=False
        )
        raise PermissionError_(
            "Compte suspendu. Contactez l'administration.", code="compte_suspendu"
        )

    if admin and compte.admin_account is None:
        # Même message que pour un mot de passe faux : un utilisateur qui
        # tâtonne sur la page d'administration n'apprend pas quels comptes en sont.
        audit_service.record_login(session, label=email, scope="admin", success=False)
        raise AuthenticationError(REFUS, code="identifiants_invalides")

    scope = "admin" if admin else "user"
    maintenant = datetime.now(UTC)
    compte.last_login_at = maintenant
    if admin and compte.admin_account is not None:
        compte.admin_account.last_admin_login_at = maintenant

    acces, rafraichissement, duree = _emettre(session, compte, scope)
    audit_service.record_login(
        session,
        label=f"{compte.first_name} {compte.last_name}",
        scope=scope,
        success=True,
    )
    session.flush()

    return Session_(
        user=compte,
        admin=compte.admin_account if admin else None,
        access_token=acces,
        expires_in=duree,
        refresh_token=rafraichissement,
        scope=scope,
    )


def login_google(session: Session, *, jeton: str) -> tuple[Session_, bool]:
    """Ouvre une session à partir d'un jeton d'identité Google.

    Le compte est créé s'il n'existe pas : c'est le propre d'une connexion
    déléguée — l'utilisateur n'a rien à remplir, et exiger une inscription
    préalable reviendrait à lui demander deux fois qui il est.

    Rend aussi si le compte vient d'être créé, pour que l'écran sache s'il
    accueille un nouveau venu ou en retrouve un.

    **Le mot de passe reste inconnu de tous.** La colonne ne peut pas être
    nulle, et un mot de passe vide serait une porte ouverte : le compte reçoit
    l'empreinte d'un secret aléatoire que personne — pas même le serveur — ne
    conserve. Se connecter par mot de passe est donc impossible tant que
    l'utilisateur n'en a pas choisi un par « mot de passe oublié », qui
    fonctionne pour lui comme pour les autres.

    Un compte suspendu le reste : déléguer l'identité ne délègue pas la
    décision d'ouvrir la porte.
    """
    identite = google_service.verifier(jeton)

    compte = _charger(session, identite.email)
    creation = compte is None

    if compte is None:
        compte = User(
            email=identite.email,
            password_hash=hash_password(secrets.token_urlsafe(32)),
            first_name=identite.prenom,
            last_name=identite.nom,
            avatar_url=identite.photo,
        )
        session.add(compte)
        session.flush()
    elif compte.avatar_url is None and identite.photo:
        # La photo de Google comble un profil vide, sans jamais remplacer celle
        # que l'utilisateur a déposée lui-même.
        compte.avatar_url = identite.photo

    if compte.status is UserStatus.SUSPENDU:
        audit_service.record_login(
            session, label=identite.email, scope="user", success=False
        )
        raise PermissionError_(
            "Compte suspendu. Contactez l'administration.", code="compte_suspendu"
        )

    compte.last_login_at = datetime.now(UTC)
    acces, rafraichissement, duree = _emettre(session, compte, "user")
    audit_service.record_login(
        session,
        label=f"{compte.first_name} {compte.last_name}",
        scope="user",
        success=True,
    )
    session.flush()

    return (
        Session_(
            user=compte,
            admin=None,
            access_token=acces,
            expires_in=duree,
            refresh_token=rafraichissement,
            scope="user",
        ),
        creation,
    )


def refresh(session: Session, *, token: str) -> Session_:
    """Consomme un jeton de rafraîchissement et en émet un nouveau.

    Trois refus possibles, tous en 401 : jeton inconnu, expiré, ou déjà
    consommé. Le dernier révoque la famille entière — un jeton rejoué signale
    une copie en circulation.
    """
    ligne = session.scalars(
        select(RefreshToken)
        .options(
            selectinload(RefreshToken.user)
            .selectinload(User.admin_account)
            .selectinload(AdminAccount.permissions)
        )
        .where(RefreshToken.token_hash == fingerprint(token))
    ).one_or_none()

    if ligne is None:
        raise AuthenticationError("Session inconnue.", code="jeton_invalide")

    maintenant = datetime.now(UTC)

    if ligne.used_at is not None or ligne.revoked_at is not None:
        revoke_family(session, ligne.family_id)
        session.flush()
        raise AuthenticationError(
            "Session compromise : reconnectez-vous.", code="jeton_rejoue"
        )

    if ligne.expires_at <= maintenant:
        raise AuthenticationError("Session expirée.", code="session_expiree")

    compte = ligne.user
    if compte.deleted_at is not None or compte.status is UserStatus.SUSPENDU:
        raise PermissionError_("Compte suspendu.", code="compte_suspendu")

    ligne.used_at = maintenant
    acces, rafraichissement, duree = _emettre(
        session, compte, ligne.scope, family_id=ligne.family_id
    )
    session.flush()

    return Session_(
        user=compte,
        admin=compte.admin_account if ligne.scope == "admin" else None,
        access_token=acces,
        expires_in=duree,
        refresh_token=rafraichissement,
        scope=ligne.scope,
    )


def logout(session: Session, *, token: str | None) -> None:
    """Ferme la session en révoquant sa famille.

    Sans jeton — cookie déjà perdu — la déconnexion réussit quand même : le
    front doit pouvoir oublier sa session dans tous les cas.
    """
    if not token:
        return

    ligne = session.scalars(
        select(RefreshToken).where(RefreshToken.token_hash == fingerprint(token))
    ).one_or_none()
    if ligne is not None:
        revoke_family(session, ligne.family_id)
        session.flush()


def revoke_family(session: Session, family_id: uuid.UUID) -> int:
    """Révoque toutes les émissions issues d'une même connexion."""
    resultat = session.execute(
        update(RefreshToken)
        .where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC))
    )
    return resultat.rowcount or 0


def revoke_all(session: Session, user_id: uuid.UUID) -> int:
    """Ferme toutes les sessions d'un compte : suspension, mot de passe changé."""
    resultat = session.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC))
    )
    return resultat.rowcount or 0


# --------------------------------------------------------------------------- #
# Mot de passe
# --------------------------------------------------------------------------- #


def request_password_reset(session: Session, *, email: str) -> tuple[User, str] | None:
    """Émet un lien de réinitialisation, ou None si l'adresse est inconnue.

    L'appelant répond 202 dans les deux cas : un 404 sur une adresse inconnue
    transformerait cette route en énumérateur de comptes.
    """
    compte = _charger(session, email)
    if compte is None or compte.status is UserStatus.SUSPENDU:
        return None

    # Les demandes précédentes sont périmées : deux liens valides simultanément
    # doublent la surface d'attaque sans rien apporter.
    session.execute(
        update(PasswordResetToken)
        .where(
            PasswordResetToken.user_id == compte.id,
            PasswordResetToken.used_at.is_(None),
        )
        .values(used_at=datetime.now(UTC))
    )

    clair, empreinte = new_opaque_token()
    session.add(
        PasswordResetToken(
            user_id=compte.id,
            token_hash=empreinte,
            expires_at=reset_expiry(),
            requested_ip=current_context().ip_address,
        )
    )
    session.flush()
    return compte, clair


def reset_password(session: Session, *, token: str, password: str) -> User:
    """Consomme un lien de réinitialisation et remplace le mot de passe.

    Toutes les sessions du compte tombent : changer son mot de passe parce
    qu'on le croit compromis doit déconnecter l'éventuel intrus.
    """
    ligne = session.scalars(
        select(PasswordResetToken)
        .options(selectinload(PasswordResetToken.user))
        .where(PasswordResetToken.token_hash == fingerprint(token))
    ).one_or_none()

    if ligne is None:
        raise NotFoundError("Lien de réinitialisation inconnu.", code="jeton_invalide")

    maintenant = datetime.now(UTC)
    if ligne.used_at is not None:
        raise AuthenticationError("Lien déjà utilisé.", code="jeton_consomme")
    if ligne.expires_at <= maintenant:
        raise AuthenticationError("Lien expiré.", code="jeton_expire")

    ligne.used_at = maintenant
    ligne.user.password_hash = hash_password(password)
    revoke_all(session, ligne.user_id)

    audit_service.record(
        session,
        action=AuditAction.MODIFICATION,
        target_type="user",
        target_label=ligne.user.email,
        target_id=ligne.user_id,
        after={"password_hash": "***", "reason": "reinitialisation"},
    )
    session.flush()
    return ligne.user


def change_password(
    session: Session, compte: User, *, current: str, next_: str
) -> User:
    """Change le mot de passe d'une session ouverte, ancien mot de passe à l'appui."""
    if not verify_password(current, compte.password_hash):
        raise AuthenticationError(
            "Mot de passe actuel incorrect.", code="mot_de_passe_invalide"
        )

    compte.password_hash = hash_password(next_)
    revoke_all(session, compte.id)

    audit_service.record(
        session,
        action=AuditAction.MODIFICATION,
        target_type="user",
        target_label=compte.email,
        target_id=compte.id,
        after={"password_hash": "***", "reason": "changement"},
    )
    session.flush()
    return compte


def purge_expired(session: Session) -> int:
    """Supprime les jetons expirés ou consommés. Appelée par la maintenance."""
    maintenant = datetime.now(UTC)
    supprimes = 0
    for modele, condition in (
        (RefreshToken, RefreshToken.expires_at <= maintenant),
        (PasswordResetToken, PasswordResetToken.expires_at <= maintenant),
    ):
        resultat = session.execute(modele.__table__.delete().where(condition))
        supprimes += resultat.rowcount or 0
    return supprimes

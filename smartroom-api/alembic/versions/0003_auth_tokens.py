"""Jetons de session et de réinitialisation.

Deux tables, aucun secret en clair : elles ne stockent que des empreintes
SHA-256. `family_id` relie les rotations successives d'une même connexion, ce
qui permet de tout révoquer d'un coup quand un jeton déjà consommé reparaît.

Revision ID: 0003_auth_tokens
Revises: 0002_min_advance
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = '0003_auth_tokens'
down_revision: str | None = '0002_min_advance'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('password_reset_tokens',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('requested_ip', postgresql.INET(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('expires_at > created_at', name=op.f('ck_password_reset_tokens_expiry_after_creation')),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name='fk_password_reset_tokens_user', onupdate='CASCADE', ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_password_reset_tokens')),
    sa.UniqueConstraint('token_hash', name='uq_password_reset_tokens_hash')
    )
    op.create_index('idx_password_reset_tokens_pending', 'password_reset_tokens', ['user_id', 'expires_at'], unique=False, postgresql_where=sa.text('used_at IS NULL'))
    op.create_table('refresh_tokens',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('family_id', sa.UUID(), nullable=False),
    sa.Column('scope', sa.String(length=10), server_default=sa.text("'user'"), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('ip_address', postgresql.INET(), nullable=True),
    sa.Column('user_agent', sa.String(length=255), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("scope IN ('user', 'admin')", name=op.f('ck_refresh_tokens_scope')),
    sa.CheckConstraint('expires_at > created_at', name=op.f('ck_refresh_tokens_expiry_after_creation')),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name='fk_refresh_tokens_user', onupdate='CASCADE', ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_refresh_tokens')),
    sa.UniqueConstraint('token_hash', name='uq_refresh_tokens_hash')
    )
    op.create_index('idx_refresh_tokens_active', 'refresh_tokens', ['user_id', 'expires_at'], unique=False, postgresql_where=sa.text('revoked_at IS NULL'))
    op.create_index('idx_refresh_tokens_family', 'refresh_tokens', ['family_id', 'revoked_at'], unique=False)


def downgrade() -> None:
    op.drop_index('idx_refresh_tokens_family', table_name='refresh_tokens')
    op.drop_index('idx_refresh_tokens_active', table_name='refresh_tokens', postgresql_where=sa.text('revoked_at IS NULL'))
    op.drop_table('refresh_tokens')
    op.drop_index('idx_password_reset_tokens_pending', table_name='password_reset_tokens', postgresql_where=sa.text('used_at IS NULL'))
    op.drop_table('password_reset_tokens')

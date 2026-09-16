"""Photo gallery + claim flow schema — follow-up to Phase 1 initial schema.

Adds two entities flagged as gaps by the original Phase 1 pass, on top
of (not modifying) the 11 tables created in
`20260912_0001_initial_phase1_schema.py`:

- `restaurant_photo` — backs DECISIONS.md "Photo gallery: 2 photos
  free, 10 photos paid per location" (`docs/DATA_MODEL.md` "Open
  items"). Stores both the single cover photo (`is_cover=true`) and
  the count-limited gallery photos (`is_cover=false`) for a location.
- `claim_request` — backs DECISIONS.md "Claim flow: Google Business
  Profile match OR phone verification, admin-reviewed, 2-business-day
  SLA" (`docs/API_CONTRACTS.md` "Claim flow (`/claim`)", previously
  documented with no backing table).

Hand-authored (not run through `alembic revision --autogenerate`
against a live database — see root CLAUDE.md "NEVER run Alembic
migrations — generate migration files only"). Content matches the
models in `app/models/restaurant_photo.py` and
`app/models/claim_request.py` exactly; see `docs/DATA_MODEL.md` for
the column-by-column rationale.

Revision ID: 0002_photo_gallery_claim_schema
Revises: 0001_initial_phase1_schema
Create Date: 2026-09-12

Revision ID shortened 2026-09-16 (was "0002_photo_gallery_and_claim_schema",
36 chars) -- Alembic's default `alembic_version.version_num` column is
`VARCHAR(32)`, and the original id overflowed it, discovered when the real
`alembic_upgrade` management command (backend/app/scripts/run_migrations.py)
was actually run against the real dev database for the first time: 0001
applied fine (26 chars), 0002 failed on its final version-stamp UPDATE and
rolled back entirely (Postgres DDL is transactional, so no partial schema
was left behind -- confirmed by re-running from a clean 0001 state, not
assumed). Safe to rename here since this revision had never successfully
applied to any real database before this fix. Filename unchanged (not
DB-constrained, only this string is).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0002_photo_gallery_claim_schema"
down_revision: Union[str, None] = "0001_initial_phase1_schema"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- restaurant_photo ----------------------------------------------
    op.create_table(
        "restaurant_photo",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("location_id", sa.BigInteger(), nullable=False),
        sa.Column("s3_key", sa.String(length=512), nullable=False),
        sa.Column(
            "is_cover", sa.Boolean(), server_default=sa.false(), nullable=False
        ),
        sa.Column(
            "display_order",
            sa.SmallInteger(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column("uploaded_by", sa.String(length=64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["location_id"], ["restaurant_location.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    # Makes the gallery-count enforcement query cheap:
    #   SELECT count(*) FROM restaurant_photo
    #   WHERE location_id = :id AND is_cover = false
    op.create_index(
        "ix_restaurant_photo_location_cover",
        "restaurant_photo",
        ["location_id", "is_cover"],
    )
    # Partial unique: at most one cover-photo row per location.
    op.create_index(
        "uq_restaurant_photo_one_cover_per_location",
        "restaurant_photo",
        ["location_id"],
        unique=True,
        postgresql_where=sa.text("is_cover = true"),
    )

    # --- claim_request ---------------------------------------------------
    op.create_table(
        "claim_request",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("brand_id", sa.BigInteger(), nullable=False),
        sa.Column("location_id", sa.BigInteger(), nullable=True),
        sa.Column("claimant_user_id", sa.String(length=36), nullable=False),
        sa.Column("proof_method", sa.String(length=32), nullable=False),
        sa.Column("google_business_profile_url", sa.String(length=500), nullable=True),
        sa.Column("supporting_document_key", sa.String(length=512), nullable=True),
        sa.Column(
            "status",
            sa.String(length=16),
            server_default="pending_review",
            nullable=False,
        ),
        sa.Column(
            "submitted_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("reviewed_by", sa.String(length=64), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewer_notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["brand_id"], ["restaurant_brand.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["location_id"], ["restaurant_location.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_claim_request_brand_id", "claim_request", ["brand_id"]
    )
    op.create_index(
        "ix_claim_request_claimant_user_id",
        "claim_request",
        ["claimant_user_id"],
    )
    # Cheap ordered scan for the single admin review queue (oldest
    # pending first, for the 2-business-day SLA).
    op.create_index(
        "ix_claim_request_status_submitted",
        "claim_request",
        ["status", "submitted_at"],
    )
    # Partial unique: at most one pending claim per brand at a time.
    op.create_index(
        "uq_claim_request_pending_brand",
        "claim_request",
        ["brand_id"],
        unique=True,
        postgresql_where=sa.text("status = 'pending_review'"),
    )


def downgrade() -> None:
    # Reverse creation order.
    op.drop_table("claim_request")
    op.drop_table("restaurant_photo")

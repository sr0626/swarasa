"""restaurant_photo — gallery + cover photo storage for a location.

Backs DECISIONS.md "Photo gallery: 2 photos free, 10 photos paid per
location" and the owner-portal scope in `backend/CLAUDE.md` ("up to 2
gallery photos"). `restaurant_location` has **no** existing
`cover_photo`-style column (checked before writing this model — see
JUDGMENT CALL below), so this single new table stores both the one
cover photo and the count-limited gallery photos, distinguished by
`is_cover`.

Storage follows root CLAUDE.md's media pattern: S3 + CloudFront,
presigned URLs for upload, never through Lambda. `s3_key` is the raw
object key; the service layer resolves it to a CloudFront-served URL
at read time (so a CDN domain change never touches stored data).

JUDGMENT CALL (flagged for review): the task that added this table
described the cover photo as a pre-existing `restaurant_location`
concept to avoid duplicating/conflicting with — it isn't one; no such
column exists today, and `docs/DATA_MODEL.md` "Open items" /
`docs/API_CONTRACTS.md` already flag `cover_photo_url` as an unbacked
response field. Rather than leave that gap open *and* invent a third
"cover photo" concept, this table folds the cover photo in via
`is_cover` (partial-unique per location, so at most one cover row can
exist) instead of adding a `cover_photo`-style column onto
`restaurant_location` itself, which would mean editing one of the
existing 11 models — out of scope for this task. `is_cover=true` rows
do NOT count toward the 2-free/10-paid gallery cap; only
`is_cover=false` rows do. This closes a real gap but is a product-
shaped call the Architect made rather than something already decided
in DECISIONS.md — confirm it matches intent before Backend Dev builds
the upload endpoint(s) against it.

Count enforcement (2 free / 10 paid) is Backend Dev's job at the
service layer, same pattern as `location_manager`'s manager cap — the
composite index below exists to make that count cheap:
    SELECT count(*) FROM restaurant_photo
    WHERE location_id = :id AND is_cover = false;
"""
from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import (
    BigInteger,
    Boolean,
    ForeignKey,
    Index,
    SmallInteger,
    String,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.restaurant_location import RestaurantLocation


class RestaurantPhoto(TimestampMixin, Base):
    __tablename__ = "restaurant_photo"
    __table_args__ = (
        Index(
            "ix_restaurant_photo_location_cover",
            "location_id",
            "is_cover",
        ),
        # Partial unique: at most one cover-photo row per location. Also
        # serves as the cheap "does this location have a cover photo"
        # lookup alongside the composite index above.
        Index(
            "uq_restaurant_photo_one_cover_per_location",
            "location_id",
            unique=True,
            postgresql_where=text("is_cover = true"),
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)

    location_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("restaurant_location.id", ondelete="CASCADE"),
        nullable=False,
    )

    # S3 object key (never a full URL — root CLAUDE.md "Media" pattern:
    # S3 + CloudFront, presigned URLs for upload). Despite the plain
    # column name, this always holds the resize pipeline's `processed/`
    # key (BRD 5.3), never the client's original `raw/` upload key — see
    # app/services/location_service.py's create_location_photo, which
    # computes the transform before this row is ever created.
    s3_key: Mapped[str] = mapped_column(String(512), nullable=False)

    # Added 2026-09-16 (migration 0003_photo_thumbnail_key) alongside the
    # resize Lambda's second output variant — a smaller `thumbnails/`
    # JPEG for card/list-view and email/notification imagery (user
    # request beyond the BRD's documented single-processed-image spec;
    # see docs/DECISIONS.md "Resize Lambda: thumbnail variant"). Nullable
    # (unlike `s3_key`) purely so direct construction (tests, or a photo
    # row that somehow predates this column) doesn't require it — every
    # real write path (app/services/location_service.py
    # create_location_photo) always computes and sets it, same
    # predictable-key timing as `s3_key` itself.
    thumbnail_s3_key: Mapped[str | None] = mapped_column(String(512), nullable=True)

    # True = the single cover photo for this location (allowed regardless
    # of tier — DECISIONS.md "Photo gallery" treats the cover photo as
    # distinct from the counted gallery). False = a counted gallery photo
    # (2 free / 10 paid). See JUDGMENT CALL above.
    is_cover: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Display order within the gallery (meaningless for the cover row).
    # Zero-based; owner/manager reorders via the owner portal.
    display_order: Mapped[int] = mapped_column(
        SmallInteger, default=0, nullable=False
    )

    # Cognito sub of whoever uploaded this photo (owner, or an assigned
    # manager). `restaurant_photo` is not in root CLAUDE.md's audit_log
    # table list, but this attribution is cheap to keep and useful for
    # support/disputes without a full audit trail.
    uploaded_by: Mapped[str | None] = mapped_column(String(64), nullable=True)

    location: Mapped["RestaurantLocation"] = relationship()

    def __repr__(self) -> str:  # pragma: no cover
        return (
            f"<RestaurantPhoto location_id={self.location_id} "
            f"is_cover={self.is_cover} order={self.display_order}>"
        )

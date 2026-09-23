"""deal — owner/manager-authored promotion on a `restaurant_location`.

Phase 2 feature, explicitly requested by the human 2026-09-23 (see
`docs/DECISIONS.md` "Deals: Phase 2 scope explicitly authorized mid-Phase-1"
for the root CLAUDE.md scope-guardrail override). Deals are NOT tied to
Stripe/billing — root CLAUDE.md's `is_paid`/`paid_until` tier model governs a
*different* set of paid-only features (dish photos beyond the free gallery,
custom page, analytics, promoted placement); deal CREATION is deliberately
NOT gated on `is_paid`. JUDGMENT CALL (flagged for review): neither the BRD
excerpt available to this task nor `docs/DECISIONS.md` states a paid-tier
restriction on deal creation one way or the other, so this defaults to
"any location, free or paid, may have deals" per this task's own explicit
instruction. If the BRD elsewhere says otherwise, that's a product decision
for the human to confirm, not something this task should have silently
guessed differently on.

## Two independent axes

1. **`deal_type`** (`"deal"` | `"special"`) — pre-existing product decision,
   `docs/DECISIONS.md` "deal type ENUM (deal | special)" (dated May 2026,
   i.e. decided before this task, honored here rather than re-decided): a
   "deal" is framed as time-limited (`end_at` set), a "special" as
   permanent-until-removed (`end_at` NULL). This column is purely
   descriptive/display metadata — no query or the expiry cron branches on
   it; only `end_at` drives actual expiry behavior. Kept as a plain
   `String`, not a DB-level ENUM, matching the established precedent for
   every other status-like column in this codebase
   (`claim_request.status`, `listing_report.status`,
   `restaurant_location.status` — see that model's own judgment-call note):
   a DB ENUM needs a migration to add a value later, a plain String with
   documented allowed values doesn't.
2. **`applicable_days`** (new, this task's own design) — which day(s) of
   the week the deal/special is offered, independent of whether it's
   time-bounded. `NULL` = every day (no restriction). A non-null value is a
   list of ints using the EXACT SAME 0=Monday..6=Sunday convention already
   established by `restaurant_hours.day_of_week` /
   `hours_service.today_weekday` — deliberately reused rather than
   reinvented, so "today" resolves identically across hours and deals.
   Stored as plain `JSON` (not Postgres `ARRAY` or `JSONB`), matching
   `restaurant_location.specialties`'s own precedent and reasoning
   (`app/models/restaurant_location.py`: "Plain JSON (not JSONB) so the
   SQLite test DB works"). An empty list is rejected at the Pydantic schema
   layer (`app/schemas/deal.py`) — ambiguous ("no day ever") is avoided by
   construction rather than given stored meaning.

`start_at`/`end_at` are full timestamps (not dates) so the expiry cron's
comparison against `NOW()` (see `docs/DECISIONS.md` "Single EventBridge cron
rule for deal expiry") is exact, not date-truncated. Naming matches that
pre-existing decision's own SQL (`end_at`, not this task's suggested
`end_date`) for consistency with the already-documented cron behavior.

## No `created_by`/`updated_by` columns

Matches the established pattern for every other Architect-owned write-heavy
table in this schema (`restaurant_brand`, `restaurant_location`,
`claim_request`'s `reviewed_by` is the one exception, and that's a
resolution actor, not a creation actor) — `audit_log` (required on every
deal write per root CLAUDE.md "ALWAYS — Quality", already anticipating
`deal` in its table list) is the system of record for "who did this and
when," not a denormalized column on the row itself. Keeps this table
symmetric with its siblings rather than inventing a new convention.

## `location_id` cascade

`ON DELETE CASCADE` (not `RESTRICT`, unlike `restaurant_location.brand_id`)
— a deal has no downstream FK dependents of its own (nothing references
`deal.id`), and there is no product reason to block a location's own
deletion just because it still has deal rows attached; the location
delete path already goes through `location_service.remove_location`'s own
guardrails independent of this table.
"""
from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.restaurant_location import RestaurantLocation


class Deal(TimestampMixin, Base):
    __tablename__ = "deal"
    __table_args__ = (
        # Backs the expiry cron's exact WHERE predicate (DECISIONS.md
        # "Single EventBridge cron rule for deal expiry":
        # `WHERE is_active=true AND end_at IS NOT NULL AND end_at <= NOW()`)
        # so that scan stays index-backed as the table grows past Phase 2
        # seed volume.
        Index("ix_deal_active_end_at", "is_active", "end_at"),
    )

    TYPE_DEAL = "deal"
    TYPE_SPECIAL = "special"
    TYPES = (TYPE_DEAL, TYPE_SPECIAL)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)

    location_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("restaurant_location.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # "deal" | "special" — see module docstring. Display/framing metadata
    # only; expiry logic keys off `end_at`, not this column.
    deal_type: Mapped[str] = mapped_column(
        String(16), default=TYPE_DEAL, server_default=TYPE_DEAL, nullable=False
    )

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # 0=Monday..6=Sunday, matching restaurant_hours.day_of_week exactly. NULL
    # = every day. Plain JSON (not ARRAY/JSONB) — see module docstring.
    applicable_days: Mapped[list[int] | None] = mapped_column(JSON, nullable=True)

    # Optional bounded promotional window. NULL start_at = active
    # immediately; NULL end_at = runs indefinitely until deactivated
    # (DECISIONS.md "deal type ENUM" framing: this is what makes a row a
    # "special" in spirit, regardless of the `deal_type` label chosen).
    start_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Owner/manager toggle; also the field the expiry cron flips to False.
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)

    location: Mapped["RestaurantLocation"] = relationship()

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Deal id={self.id} location_id={self.location_id} type={self.deal_type!r}>"

"""restaurant_location — a physical, addressable location of a brand.

owner_account (1) -> restaurant_brand (N) -> restaurant_location (N) -> location_manager (N)

Each location has its own paid/free status (root CLAUDE.md "Tier model"
and "Per-location billing" in DECISIONS.md) and its own geo point for
radius search (DECISIONS.md "Aurora PostgreSQL Serverless v2 +
PostGIS"). Tier is NOT a stored enum — `is_paid` + `paid_until` only.

## Location status lifecycle (added migration 0008, docs/DECISIONS.md
"Location status lifecycle")

`status` replaces the old plain `is_active` boolean with four values:

  - `active` — normal, publicly visible everywhere (search, direct URL,
    tiles). The only visible state.
  - `owner_deactivated` — owner (or admin) self-service hide, freely
    reversible in both directions by the owner themselves.
  - `coming_soon` — a new, not-yet-open location. Self-service like
    `owner_deactivated`, but surfaced distinctly in the owner console so a
    new listing being finished isn't confused with a deliberately hidden
    one. Owner flips it to `active` themselves once ready.
  - `closed_pending_reopen` — owner-initiated "temporarily closed"
    (self-service, immediate), but the owner CANNOT self-reopen it: only an
    admin-approved `location_reopen_request` (see that model) can move it
    back to `active`. This is the one asymmetric transition in the model —
    every other pair of statuses is freely self-service both ways.

JUDGMENT CALL (flagged for review — single `status` column, not a stored
enum type): root CLAUDE.md's Architect guardrails forbid a stored *tier*
enum specifically (`is_paid` stays a boolean by explicit product decision),
but say nothing about a status/lifecycle enum elsewhere in the schema —
`claim_request.status` and `listing_report.status` already use exactly
this pattern (plain `String`, allowed values documented in a comment, no
DB-level ENUM type) and passed prior Architect review, so this follows
established precedent rather than inventing a new one. A DB-level ENUM
would need a migration to add a 5th value later; plain `String` doesn't.

JUDGMENT CALL (flagged for review — `is_active` kept as a backward-compat
hybrid property, not renamed): this repo reads/writes
`RestaurantLocation.is_active` in ~15 call sites across services, scripts,
and the test factories (grepped before deciding — `search_service.py`,
`claim_service.py`, `restaurant_service.py`, `location_service.py`,
`geocode_backfill.py`, `seed_dev_data.py`, `restaurant_bulk_import_service.py`,
`tests/factories.py`, several integration tests). A hard rename would touch
every one of those for no functional gain, since "hidden" has always meant
exactly one thing until now (soft-deleted) and now means exactly one thing
still (not `active`) — there is no state where `is_active` and "publicly
visible" diverge. So `is_active` stays as a `hybrid_property`:
  - reads (`location.is_active`, `RestaurantLocation.is_active == True` in
    a query) evaluate `status == 'active'`, in Python and in SQL alike;
  - writes (`location.is_active = False`) set `status = 'owner_deactivated'`
    — the closest existing status to the old blanket soft-hide meaning.
    Code that needs a MORE specific hidden state (`coming_soon`,
    `closed_pending_reopen`) sets `.status` directly instead — the setter
    is a compatibility shim for old callers, not the primary write path
    for new code.
This is the "keep is_active as a derived/computed property" option named
directly in this task's own instructions, chosen over a full rename because
it is strictly less code to review for the same correctness guarantee.
"""
from __future__ import annotations

from datetime import datetime, time
from typing import TYPE_CHECKING

from geoalchemy2 import Geography
from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    JSON,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.location_manager import LocationManager
    from app.models.restaurant_brand import RestaurantBrand
    from app.models.restaurant_hours import RestaurantHours


class RestaurantLocation(TimestampMixin, Base):
    __tablename__ = "restaurant_location"
    # One slug per location, unique within its brand (not globally) — the
    # public location page is /restaurant/{brand_slug}/{location_slug}.
    __table_args__ = (
        UniqueConstraint("brand_id", "slug", name="uq_restaurant_location_brand_slug"),
    )

    # Status values — see module docstring "Location status lifecycle".
    STATUS_ACTIVE = "active"
    STATUS_OWNER_DEACTIVATED = "owner_deactivated"
    STATUS_COMING_SOON = "coming_soon"
    STATUS_CLOSED_PENDING_REOPEN = "closed_pending_reopen"
    STATUSES = (
        STATUS_ACTIVE,
        STATUS_OWNER_DEACTIVATED,
        STATUS_COMING_SOON,
        STATUS_CLOSED_PENDING_REOPEN,
    )
    # Statuses a caller with no special access to this location can never
    # see (search, `GET /restaurants/{id}/locations`, `GET /locations/{id}`
    # direct fetch) — every non-`active` status, deliberately: there is no
    # partially-visible hidden state in this model.
    HIDDEN_STATUSES = (STATUS_OWNER_DEACTIVATED, STATUS_COMING_SOON, STATUS_CLOSED_PENDING_REOPEN)
    # Statuses an owner/admin can move a location into or out of themselves,
    # with no admin review — everything except the one-way trip out of
    # `closed_pending_reopen` (see `update_location_status` in
    # `location_service.py`, which enforces the asymmetric part; this tuple
    # only names the four legal target values for the self-service endpoint).
    SELF_SERVICE_STATUSES = STATUSES

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)

    brand_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("restaurant_brand.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    # URL slug of this location's own public page,
    # /restaurant/{brand_slug}/{slug} (migration 0014, docs/DECISIONS.md
    # "Location pages"). Generated ONCE at create time by
    # `app.services.location_slug.assign_location_slug` (city, else city +
    # street, else + "-2"...) and FIXED afterwards — an address edit never
    # changes it, so shared links keep working. Unique per brand.
    slug: Mapped[str] = mapped_column(String(100), nullable=False)

    # Optional override of the brand name for this specific location
    # (e.g. "Spice Route - Plano"). NULL means display the brand name.
    location_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    address_line1: Mapped[str] = mapped_column(String(255), nullable=False)
    address_line2: Mapped[str | None] = mapped_column(String(255), nullable=True)
    city: Mapped[str] = mapped_column(String(120), nullable=False)
    state: Mapped[str] = mapped_column(String(2), nullable=False)
    postal_code: Mapped[str] = mapped_column(String(10), nullable=False)
    country: Mapped[str] = mapped_column(String(2), default="US", nullable=False)

    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Owner/manager-authored public profile content (free tier). Lives on
    # the location, not the brand, so an assigned manager can edit it
    # (root CLAUDE.md "Permission model" — managers write only
    # location-level fields). `about` is free text ("we specialize in
    # ..."), max 1000 chars enforced by the API schema; `specialties` is a
    # JSON list of short strings (max 8, each 1-40 chars, normalised by
    # the API schema). Plain `JSON` (not JSONB) so the SQLite test DB
    # works; both NULL until an owner/manager sets them.
    about: Mapped[str | None] = mapped_column(Text, nullable=True)
    specialties: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)

    # IANA tz name — required for computing display open/closed status
    # from restaurant_hours (DECISIONS.md "Restaurant hours": "per-row
    # lookup using restaurant_hours + timezone").
    timezone: Mapped[str] = mapped_column(
        String(64), default="America/Chicago", nullable=False
    )

    # Plain lat/lng kept alongside `geom` for simple display/serialization
    # without needing a PostGIS function call. `geom` is the column
    # actually queried for radius search (ST_DWithin) and is kept in
    # sync with lat/lng by the service layer on write (see judgment-call
    # note in docs/DATA_MODEL.md — no DB trigger, to avoid procedural SQL
    # outside Alembic-managed DDL).
    latitude: Mapped[float | None] = mapped_column(Numeric(9, 6), nullable=True)
    longitude: Mapped[float | None] = mapped_column(Numeric(9, 6), nullable=True)
    geom: Mapped[str | None] = mapped_column(
        Geography(geometry_type="POINT", srid=4326, spatial_index=False),
        nullable=True,
    )

    # Tier — see root CLAUDE.md "Tier model (is_paid)". NOT a stored enum.
    is_paid: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    paid_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Stripe Subscription Item id for this location's paid subscription
    # item (root CLAUDE.md "Billing model" — one Subscription Item per
    # paid location; DECISIONS.md "Stripe Subscription Items model").
    stripe_sub_item_id: Mapped[str | None] = mapped_column(
        String(255), unique=True, nullable=True
    )

    # Admin-reviewed at seed/claim time (DECISIONS.md "Data seeding" —
    # "Each seeded row is admin-reviewed and marked verified=true before
    # it's publicly visible"). Drives search default sort ("verified
    # first, then distance, then alphabetical").
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Product-state lifecycle — see module docstring "Location status
    # lifecycle". Replaces the old plain `is_active` boolean (migration
    # 0008); `is_active` lives on below as a backward-compat hybrid
    # property, not a second stored column.
    status: Mapped[str] = mapped_column(
        String(24), default=STATUS_ACTIVE, server_default=STATUS_ACTIVE, nullable=False, index=True
    )

    @hybrid_property
    def is_active(self) -> bool:
        """Backward-compat read: True only when `status == 'active'` — the
        only visible state, so this is exactly the old "is this hidden"
        boolean. See module docstring judgment-call note."""
        return self.status == self.STATUS_ACTIVE

    @is_active.inplace.setter
    def _is_active_setter(self, value: bool) -> None:
        """Backward-compat write for old `location.is_active = True/False`
        call sites. `False` maps to `owner_deactivated` — the closest
        existing status to the old blanket soft-hide meaning. New code that
        needs a specific hidden state (`coming_soon`,
        `closed_pending_reopen`) should set `.status` directly instead."""
        self.status = self.STATUS_ACTIVE if value else self.STATUS_OWNER_DEACTIVATED

    @is_active.inplace.expression
    @classmethod
    def _is_active_expression(cls):
        """Backward-compat query filter: `RestaurantLocation.is_active ==
        True` keeps working unchanged, translated to `status == 'active'`."""
        return cls.status == cls.STATUS_ACTIVE

    brand: Mapped["RestaurantBrand"] = relationship(back_populates="locations")
    managers: Mapped[list["LocationManager"]] = relationship(
        back_populates="location"
    )
    hours: Mapped[list["RestaurantHours"]] = relationship(
        back_populates="location"
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<RestaurantLocation id={self.id} brand_id={self.brand_id}>"

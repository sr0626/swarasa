"""restaurant_location — a physical, addressable location of a brand.

owner_account (1) -> restaurant_brand (N) -> restaurant_location (N) -> location_manager (N)

Each location has its own paid/free status (root CLAUDE.md "Tier model"
and "Per-location billing" in DECISIONS.md) and its own geo point for
radius search (DECISIONS.md "Aurora PostgreSQL Serverless v2 +
PostGIS"). Tier is NOT a stored enum — `is_paid` + `paid_until` only.
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
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.location_manager import LocationManager
    from app.models.restaurant_brand import RestaurantBrand
    from app.models.restaurant_hours import RestaurantHours


class RestaurantLocation(TimestampMixin, Base):
    __tablename__ = "restaurant_location"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)

    brand_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("restaurant_brand.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

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

    # Soft-hide switch (e.g. permanently closed) without deleting the
    # row or its audit history — root CLAUDE.md "NEVER delete or
    # truncate any DB table".
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    brand: Mapped["RestaurantBrand"] = relationship(back_populates="locations")
    managers: Mapped[list["LocationManager"]] = relationship(
        back_populates="location"
    )
    hours: Mapped[list["RestaurantHours"]] = relationship(
        back_populates="location"
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<RestaurantLocation id={self.id} brand_id={self.brand_id}>"

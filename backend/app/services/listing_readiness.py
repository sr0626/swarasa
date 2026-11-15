"""What a listing needs before it can go live (leave `coming_soon`).

docs/DECISIONS.md "New manual listings start in setup". A location created
through the Add-restaurant / Add-location UI starts as `coming_soon` (a
hidden, non-public status — only `active` is ever public). Moving it to
`active` is a second, explicit step and the SERVER refuses it until the
required info exists:

  - `name`    the brand has a name (always true for a real brand; checked
              so a blank one can never go live);
  - `address` street, city, state and ZIP are all non-blank;
  - `phone`   the stored phone is a valid US number (app/core/phone.py);
  - `hours`   all 7 days are entered — each day either closed, or open with
              both an open and a close time. A day with no row, or with
              `is_closed IS NULL` ("unknown"), counts as missing.

Photos / about text / menu are deliberately NOT required.

The gate applies to EVERY transition into `active` made through the API
(`ensure_ready_for_activation` below), whatever the previous status: a
`coming_soon` listing cannot be published by detouring through
`owner_deactivated`, and an admin-approved reopen of a `closed_pending_reopen`
listing is gated the same way. Listings that are ALREADY live are never
re-checked (only a re-activation is) — see docs/DECISIONS.md "New manual
listings start in setup".

The rule functions are pure over already-loaded data so
`LocationOut.setup_missing` costs no extra query and the unit tests need no DB;
only `ensure_ready_for_activation` touches the session.
"""
from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.phone import normalize_us_phone
from app.models.restaurant_brand import RestaurantBrand
from app.models.restaurant_hours import RestaurantHours
from app.models.restaurant_location import RestaurantLocation
from app.services import hours_service

MISSING_NAME = "name"
MISSING_ADDRESS = "address"
MISSING_PHONE = "phone"
MISSING_HOURS = "hours"

# Human wording per key, used in the 422 `detail` sentence.
MISSING_LABELS: dict[str, str] = {
    MISSING_NAME: "the restaurant name",
    MISSING_ADDRESS: "the full street address",
    MISSING_PHONE: "a valid US phone number",
    MISSING_HOURS: "opening hours for all 7 days",
}


def hours_complete(hours: Iterable[RestaurantHours]) -> bool:
    """True when every weekday 0..6 has an explicit answer."""
    by_day = {row.day_of_week: row for row in hours}
    for day in range(7):
        row = by_day.get(day)
        if row is None or row.is_closed is None:
            return False
        if row.is_closed is False and (row.open_time is None or row.close_time is None):
            return False
    return True


def missing_for_activation(
    location: RestaurantLocation, brand_name: str | None, hours: Iterable[RestaurantHours]
) -> list[str]:
    """Keys (in checklist order) of what is still missing; `[]` = ready."""
    missing: list[str] = []
    if not (brand_name or "").strip():
        missing.append(MISSING_NAME)
    if not all(
        (value or "").strip()
        for value in (location.address_line1, location.city, location.state, location.postal_code)
    ):
        missing.append(MISSING_ADDRESS)
    if not location.phone or normalize_us_phone(location.phone) is None:
        missing.append(MISSING_PHONE)
    if not hours_complete(hours):
        missing.append(MISSING_HOURS)
    return missing


def incomplete_detail(missing: list[str]) -> str:
    """Generic, human-readable 422 message (no internals)."""
    items = ", ".join(MISSING_LABELS[key] for key in missing if key in MISSING_LABELS)
    return f"This listing isn't ready to go live yet. Still needed: {items}."


async def ensure_ready_for_activation(db: AsyncSession, location: RestaurantLocation) -> None:
    """Raise 422 `listing_incomplete` (with `extra={"missing": [...]}` naming
    ALL gaps) unless `location` has the required info to be made `active`.

    Call this before writing `status = 'active'` on ANY path where the previous
    status is not `active` (user-facing status change, admin reopen approval).
    Does not write anything, so a refusal leaves the location and the audit
    log untouched.
    """
    brand = await db.get(RestaurantBrand, location.brand_id)
    hours_rows = await hours_service.get_hours_for_location(db, location.id)
    missing = missing_for_activation(location, brand.name if brand else None, hours_rows)
    if missing:
        raise AppError(
            422,
            incomplete_detail(missing),
            "listing_incomplete",
            extra={"missing": missing},
        )

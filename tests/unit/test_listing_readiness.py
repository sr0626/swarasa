"""Unit tests: app.services.listing_readiness — the pure "what's missing before
this listing can go live" rules. No DB, no HTTP."""
from __future__ import annotations

from datetime import time

from app.models.restaurant_hours import RestaurantHours
from app.models.restaurant_location import RestaurantLocation
from app.services.listing_readiness import (
    hours_complete,
    incomplete_detail,
    missing_for_activation,
)


def _hours(*, skip: tuple[int, ...] = (), unknown: tuple[int, ...] = ()) -> list[RestaurantHours]:
    rows = []
    for day in range(7):
        if day in skip:
            continue
        if day in unknown:
            rows.append(RestaurantHours(day_of_week=day, is_closed=None))
        elif day == 0:
            rows.append(RestaurantHours(day_of_week=day, is_closed=True))
        else:
            rows.append(
                RestaurantHours(
                    day_of_week=day, is_closed=False, open_time=time(11), close_time=time(22)
                )
            )
    return rows


def _location(**overrides) -> RestaurantLocation:
    values = dict(
        address_line1="1 Main St",
        city="Irving",
        state="TX",
        postal_code="75038",
        phone="+19725550142",
    )
    values.update(overrides)
    return RestaurantLocation(**values)


def test_complete_listing_has_nothing_missing():
    assert missing_for_activation(_location(), "Spice Garden", _hours()) == []


def test_hours_complete_needs_all_seven_explicit_days():
    assert hours_complete(_hours())
    assert not hours_complete(_hours(skip=(6,)))
    assert not hours_complete(_hours(unknown=(2,)))
    assert not hours_complete([])
    open_without_times = _hours()[:-1] + [RestaurantHours(day_of_week=6, is_closed=False)]
    assert not hours_complete(open_without_times)


def test_everything_missing_is_listed_in_checklist_order():
    assert missing_for_activation(
        _location(address_line1="  ", phone=None), "", []
    ) == ["name", "address", "phone", "hours"]


def test_phone_must_be_a_valid_us_number():
    for bad in (None, "", "97255501420", "+442079460958"):
        assert missing_for_activation(_location(phone=bad), "X", _hours()) == ["phone"]
    # Legacy stored formats that still satisfy the rule are fine.
    assert missing_for_activation(_location(phone="(972) 555-0142"), "X", _hours()) == []


def test_detail_sentence_is_generic_and_lists_items():
    text = incomplete_detail(["phone", "hours"])
    assert text == (
        "This listing isn't ready to go live yet. Still needed: "
        "a valid US phone number, opening hours for all 7 days."
    )

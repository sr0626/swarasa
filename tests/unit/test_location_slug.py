"""Unit tests for `restaurant_location.slug` generation
(`app/services/location_slug.py`) and its frozen copy inside migration
`0014_location_slug` (the migration must stay self-contained, so the two
implementations are compared here to catch drift).
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

from app.models.restaurant_location import RestaurantLocation
from app.services import location_slug as ls

_MIGRATION = (
    Path(__file__).resolve().parents[2]
    / "backend"
    / "migrations"
    / "versions"
    / "20260924_0014_location_slug.py"
)


def _load_migration():
    spec = importlib.util.spec_from_file_location("migration_0014_location_slug", _MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# ---------------------------------------------------------------------------
# slugify / street_part
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "text, expected",
    [
        ("Irving", "irving"),
        ("Fort Worth", "fort-worth"),
        ("  Dallas / Uptown!  ", "dallas-uptown"),
        ("Café Río", "cafe-rio"),
        ("", ""),
        ("!!!", ""),
    ],
)
def test_slugify(text, expected):
    assert ls.slugify(text) == expected


@pytest.mark.parametrize(
    "address, expected",
    [
        ("2234 W Walnut Hill Ln", "2234-w-walnut-hill"),
        ("100 Main St", "100-main"),
        ("5 Way", "5-way"),  # too short to drop the suffix
        ("12 Legacy Dr, Suite 400", "12-legacy"),  # only the first segment
        ("77 Elm Blvd #12", "77-elm"),
        ("", ""),
    ],
)
def test_street_part(address, expected):
    assert ls.street_part(address) == expected


# ---------------------------------------------------------------------------
# pick_location_slug — the rule and its collision handling
# ---------------------------------------------------------------------------


def test_plain_city_slug_when_free():
    assert ls.pick_location_slug("Irving", "2234 W Walnut Hill Ln", []) == "irving"


def test_city_plus_street_when_city_is_taken():
    assert (
        ls.pick_location_slug("Irving", "2234 W Walnut Hill Ln", {"irving"})
        == "irving-2234-w-walnut-hill"
    )


def test_numeric_suffix_when_city_plus_street_is_also_taken():
    taken = {"irving", "irving-2234-w-walnut-hill"}
    assert (
        ls.pick_location_slug("Irving", "2234 W Walnut Hill Ln", taken)
        == "irving-2234-w-walnut-hill-2"
    )
    taken.add("irving-2234-w-walnut-hill-2")
    assert (
        ls.pick_location_slug("Irving", "2234 W Walnut Hill Ln", taken)
        == "irving-2234-w-walnut-hill-3"
    )


def test_missing_street_falls_back_to_numbered_city():
    assert ls.pick_location_slug("Irving", "", {"irving"}) == "irving-2"


def test_empty_city_uses_generic_word():
    assert ls.pick_location_slug("", "1 Main St", []) == "branch"
    assert ls.pick_location_slug("!!!", "1 Main St", []) == "branch"


def test_reserved_words_are_never_used_as_a_slug():
    # A city called "Report" would collide with the /restaurant/{brand}/report route.
    slug = ls.pick_location_slug("Report", "10 Oak St", [])
    assert slug not in ls.RESERVED_LOCATION_SLUGS
    assert slug == "report-10-oak"


def test_slug_is_url_safe_lowercase_and_bounded():
    slug = ls.pick_location_slug("A" * 300 + " City", "1 " + "B" * 300, {"a" * 100})
    assert len(slug) <= ls.MAX_SLUG_LENGTH
    assert slug == slug.lower()
    assert all(c.isalnum() or c == "-" for c in slug)
    assert not slug.startswith("-") and not slug.endswith("-")


def test_numeric_suffix_respects_max_length():
    long_city = "c" * 200
    first = ls.pick_location_slug(long_city, "", [])
    second = ls.pick_location_slug(long_city, "", {first})
    assert len(second) <= ls.MAX_SLUG_LENGTH
    assert second != first and second.endswith("-2")


def test_deterministic():
    args = ("Plano", "500 Legacy Dr", {"plano"})
    assert ls.pick_location_slug(*args) == ls.pick_location_slug(*args)


def test_model_declares_per_brand_unique_constraint():
    names = {c.name for c in RestaurantLocation.__table__.constraints}
    assert "uq_restaurant_location_brand_slug" in names
    assert RestaurantLocation.__table__.c.slug.nullable is False


# ---------------------------------------------------------------------------
# Migration backfill logic (self-contained copy) — same rule, no drift
# ---------------------------------------------------------------------------


def test_migration_revision_chain_and_id_length():
    migration = _load_migration()
    assert migration.revision == "0014_location_slug"
    assert migration.down_revision == "0013_menu"
    assert len(migration.revision) <= 32  # alembic_version.version_num is VARCHAR(32)


def test_migration_backfill_on_a_small_fixture():
    migration = _load_migration()
    # (id, brand_id, city, address_line1) in (brand_id, id) order, like the
    # migration's SELECT ... ORDER BY brand_id, id.
    rows = [
        (1, 10, "Irving", "2234 W Walnut Hill Ln"),
        (2, 10, "Irving", "800 N Belt Line Rd"),
        (3, 10, "Plano", "500 Legacy Dr"),
        (4, 10, "Irving", "800 N Belt Line Rd"),  # exact duplicate address in the brand
        (5, 11, "Irving", "1 Main St"),  # another brand: plain city slug again
        (6, 12, "Report", "10 Oak St"),  # reserved word as a city
    ]
    assert migration.backfill_slugs(rows) == {
        1: "irving",
        2: "irving-800-n-belt-line",
        3: "plano",
        4: "irving-800-n-belt-line-2",
        5: "irving",
        6: "report-10-oak",
    }


def test_migration_backfill_slugs_are_unique_per_brand():
    migration = _load_migration()
    rows = [(i, 1, "Irving", "1 Main St") for i in range(1, 30)]
    slugs = list(migration.backfill_slugs(rows).values())
    assert len(slugs) == len(set(slugs))


@pytest.mark.parametrize(
    "city, address",
    [
        ("Irving", "2234 W Walnut Hill Ln"),
        ("Fort Worth", "5 Way"),
        ("Café", "12 Legacy Dr, Suite 400"),
        ("", "1 Main St"),
        ("Report", "10 Oak St"),
        ("X" * 250, "7 " + "Y" * 250),
    ],
)
@pytest.mark.parametrize("taken", [set(), {"irving"}, {"irving", "irving-2234-w-walnut-hill"}])
def test_migration_copy_matches_app_helper(city, address, taken):
    migration = _load_migration()
    assert migration.pick_location_slug(city, address, taken) == ls.pick_location_slug(
        city, address, taken
    )
    # And the constants the two copies share.
    assert migration.RESERVED_LOCATION_SLUGS == ls.RESERVED_LOCATION_SLUGS
    assert migration.MAX_SLUG_LENGTH == ls.MAX_SLUG_LENGTH

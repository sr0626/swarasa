"""Unit tests for migration `0016_location_cuisine`: the backfill SQL (every
existing location gets its brand's tags), idempotency, the FK cascade and the
downgrade round-trip. Runs the migration's real `upgrade()`/`downgrade()`
through Alembic `Operations` on an in-memory SQLite database — the backfill SQL
is deliberately plain enough to be identical on Postgres.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

_MIGRATION = (
    Path(__file__).resolve().parents[2]
    / "backend"
    / "migrations"
    / "versions"
    / "20260924_0016_location_cuisine.py"
)


def _load():
    spec = importlib.util.spec_from_file_location("migration_0016_location_cuisine", _MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def conn():
    engine = sa.create_engine("sqlite://")

    @sa.event.listens_for(engine, "connect")
    def _fk(dbapi_connection, _record):
        dbapi_connection.execute("PRAGMA foreign_keys=ON")

    with engine.begin() as connection:
        # Minimal pre-0016 schema (only the columns the migration touches).
        connection.execute(sa.text("CREATE TABLE restaurant_brand (id INTEGER PRIMARY KEY)"))
        connection.execute(
            sa.text(
                "CREATE TABLE restaurant_location (id INTEGER PRIMARY KEY, "
                "brand_id INTEGER NOT NULL REFERENCES restaurant_brand(id), status TEXT)"
            )
        )
        connection.execute(sa.text("CREATE TABLE cuisine_tag (id INTEGER PRIMARY KEY, name TEXT)"))
        connection.execute(
            sa.text(
                "CREATE TABLE restaurant_cuisine (id INTEGER PRIMARY KEY AUTOINCREMENT, "
                "brand_id INTEGER NOT NULL REFERENCES restaurant_brand(id), "
                "cuisine_tag_id INTEGER NOT NULL REFERENCES cuisine_tag(id), "
                "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, "
                "UNIQUE (brand_id, cuisine_tag_id))"
            )
        )
        for brand_id in (1, 2, 3):
            connection.execute(sa.text("INSERT INTO restaurant_brand (id) VALUES (:i)"), {"i": brand_id})
        for tag_id, name in ((1, "andhra"), (2, "nut_free"), (3, "breakfast_menu")):
            connection.execute(
                sa.text("INSERT INTO cuisine_tag (id, name) VALUES (:i, :n)"), {"i": tag_id, "n": name}
            )
        # Brand 1: two locations (one hidden), tags {1, 2}. Brand 2: one location,
        # tag {3}. Brand 3: two locations, no tags at all.
        for loc_id, brand_id, status in (
            (10, 1, "active"),
            (11, 1, "coming_soon"),
            (20, 2, "active"),
            (30, 3, "active"),
            (31, 3, "owner_deactivated"),
        ):
            connection.execute(
                sa.text("INSERT INTO restaurant_location (id, brand_id, status) VALUES (:i, :b, :s)"),
                {"i": loc_id, "b": brand_id, "s": status},
            )
        for brand_id, tag_id in ((1, 1), (1, 2), (2, 3)):
            connection.execute(
                sa.text("INSERT INTO restaurant_cuisine (brand_id, cuisine_tag_id) VALUES (:b, :t)"),
                {"b": brand_id, "t": tag_id},
            )
        yield connection


def _run(conn, fn):
    ctx = MigrationContext.configure(conn)
    with Operations.context(ctx):
        fn()


def _links(conn):
    return sorted(
        tuple(r)
        for r in conn.execute(
            sa.text("SELECT location_id, cuisine_tag_id FROM location_cuisine")
        ).all()
    )


def test_revision_chain():
    m = _load()
    assert m.revision == "0016_location_cuisine"
    assert m.down_revision == "0015_hide_menu_and_deals"
    assert len(m.revision) <= 32  # alembic_version.version_num is VARCHAR(32)


def test_upgrade_backfills_every_location_with_its_brands_tags(conn):
    m = _load()
    _run(conn, m.upgrade)
    # Both of brand 1's locations (hidden one included) get {1, 2}; brand 2's
    # location gets {3}; brand 3 has no tags so its locations get nothing.
    assert _links(conn) == [(10, 1), (10, 2), (11, 1), (11, 2), (20, 3)]


def test_backfill_is_idempotent(conn):
    m = _load()
    _run(conn, m.upgrade)
    before = _links(conn)
    conn.execute(sa.text(m.BACKFILL_SQL))
    conn.execute(sa.text(m.BACKFILL_SQL))
    assert _links(conn) == before


def test_old_table_is_left_untouched(conn):
    m = _load()
    _run(conn, m.upgrade)
    count = conn.execute(sa.text("SELECT COUNT(*) FROM restaurant_cuisine")).scalar_one()
    assert count == 3


def test_link_rows_cascade_when_location_is_deleted(conn):
    m = _load()
    _run(conn, m.upgrade)
    conn.execute(sa.text("DELETE FROM restaurant_location WHERE id = 10"))
    assert _links(conn) == [(11, 1), (11, 2), (20, 3)]


def test_downgrade_folds_per_location_tags_back_into_the_brand_table(conn):
    m = _load()
    _run(conn, m.upgrade)
    # Owners edit per location after the upgrade: brand 3's second branch gets a tag.
    conn.execute(sa.text("INSERT INTO location_cuisine (location_id, cuisine_tag_id) VALUES (31, 2)"))
    _run(conn, m.downgrade)

    assert not sa.inspect(conn).has_table("location_cuisine")
    rows = sorted(
        tuple(r)
        for r in conn.execute(sa.text("SELECT brand_id, cuisine_tag_id FROM restaurant_cuisine")).all()
    )
    assert rows == [(1, 1), (1, 2), (2, 3), (3, 2)]  # no duplicates for brand 1's two branches

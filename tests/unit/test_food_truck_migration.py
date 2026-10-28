"""Unit tests for migration `0021_food_truck_type`: inserts the `food_truck`
type tag only when missing, never touches an existing (possibly renamed or
deactivated) row, is idempotent, and its downgrade is a data-preserving no-op.
Runs the real `upgrade()`/`downgrade()` via Alembic `Operations` on in-memory
SQLite.
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
    / "20261028_0021_food_truck_type.py"
)


def _load():
    spec = importlib.util.spec_from_file_location("migration_0021_food_truck_type", _MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def conn():
    engine = sa.create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                "CREATE TABLE cuisine_tag (id INTEGER PRIMARY KEY AUTOINCREMENT, "
                "name TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, "
                "category TEXT NOT NULL, is_active BOOLEAN NOT NULL DEFAULT 1)"
            )
        )
        yield connection


def _run(conn, fn):
    with Operations.context(MigrationContext.configure(conn)):
        fn()


def _rows(conn):
    return [
        tuple(r)
        for r in conn.execute(
            sa.text("SELECT name, display_name, category, is_active FROM cuisine_tag")
        ).all()
    ]


def test_revision_ids():
    module = _load()
    assert module.revision == "0021_food_truck_type"
    assert module.down_revision == "0020_manager_invite"


def test_inserts_when_missing(conn):
    _run(conn, _load().upgrade)
    assert _rows(conn) == [("food_truck", "Food Truck", "type", 1)]


def test_idempotent(conn):
    module = _load()
    _run(conn, module.upgrade)
    _run(conn, module.upgrade)
    assert len(_rows(conn)) == 1


def test_existing_row_is_left_untouched(conn):
    conn.execute(
        sa.text(
            "INSERT INTO cuisine_tag (name, display_name, category, is_active) "
            "VALUES ('food_truck', 'Truck (renamed)', 'type', 0)"
        )
    )
    _run(conn, _load().upgrade)
    assert _rows(conn) == [("food_truck", "Truck (renamed)", "type", 0)]


def test_downgrade_preserves_data(conn):
    module = _load()
    _run(conn, module.upgrade)
    _run(conn, module.downgrade)
    assert len(_rows(conn)) == 1

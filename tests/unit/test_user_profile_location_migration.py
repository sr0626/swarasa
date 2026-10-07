"""Unit test: migration 0018_user_profile_location adds exactly the two
nullable `user_profile` columns (see also test_alembic_single_head.py)."""
from __future__ import annotations

import importlib.util
from pathlib import Path

MIGRATION = (
    Path(__file__).resolve().parents[2]
    / "backend"
    / "migrations"
    / "versions"
    / "20261007_0018_user_profile_location.py"
)


def _load():
    spec = importlib.util.spec_from_file_location("mig_0018", MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_revision_ids_fit_alembic_version_column():
    module = _load()
    assert module.revision == "0018_user_profile_location"
    assert len(module.revision) <= 32
    assert module.down_revision == "0017_admin_message"


def test_upgrade_adds_nullable_city_and_postal_code():
    module = _load()
    added: list[tuple[str, str, bool, int | None]] = []

    class _Op:
        @staticmethod
        def add_column(table, column):
            added.append((table, column.name, column.nullable, column.type.length))

    module.op = _Op
    module.upgrade()
    assert added == [
        ("user_profile", "city", True, 100),
        ("user_profile", "postal_code", True, 10),
    ]

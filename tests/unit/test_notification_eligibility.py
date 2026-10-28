"""Unit tests: `notification_service.should_notify_for_deal` (pure) and
migration 0019_user_notification (revision chain + shape)."""
from __future__ import annotations

import importlib.util
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.services.notification_service import should_notify_for_deal

from factories import DealFactory, RestaurantLocationFactory

NOW = datetime.now(timezone.utc)


def _deal(**kw):
    return DealFactory(**kw)


def _location(**kw):
    return RestaurantLocationFactory(**kw)


def test_active_visible_deal_notifies():
    assert should_notify_for_deal(_deal(), _location(), brand_deleted=False, now=NOW)


def test_inactive_deal_does_not():
    assert not should_notify_for_deal(_deal(is_active=False), _location(), brand_deleted=False, now=NOW)


def test_deals_hidden_does_not():
    assert not should_notify_for_deal(_deal(), _location(deals_hidden=True), brand_deleted=False, now=NOW)


def test_deleted_brand_does_not():
    assert not should_notify_for_deal(_deal(), _location(), brand_deleted=True, now=NOW)


def test_non_active_location_status_does_not():
    for status in ("owner_deactivated", "coming_soon", "closed_pending_reopen"):
        assert not should_notify_for_deal(
            _deal(), _location(status=status), brand_deleted=False, now=NOW
        )


def test_already_ended_deal_does_not_but_future_end_does():
    assert not should_notify_for_deal(
        _deal(end_at=NOW - timedelta(hours=1)), _location(), brand_deleted=False, now=NOW
    )
    assert should_notify_for_deal(
        _deal(end_at=NOW + timedelta(days=3)), _location(), brand_deleted=False, now=NOW
    )


MIGRATION = (
    Path(__file__).resolve().parents[2]
    / "backend"
    / "migrations"
    / "versions"
    / "20261028_0019_user_notification.py"
)


def _load():
    spec = importlib.util.spec_from_file_location("mig_0019", MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_migration_revision_chain_fits_alembic_version_column():
    module = _load()
    assert module.revision == "0019_user_notification"
    assert len(module.revision) <= 32
    assert module.down_revision == "0018_user_profile_location"


def test_migration_creates_table_and_index():
    module = _load()
    calls: list[tuple[str, str]] = []

    class _Op:
        @staticmethod
        def create_table(name, *cols):
            calls.append(("create_table", name))

        @staticmethod
        def create_index(name, table, columns):
            calls.append(("create_index", name))
            assert columns == ["user_sub", "read_at", "created_at"]

    module.op = _Op
    module.upgrade()
    assert ("create_table", "user_notification") in calls
    assert ("create_index", "ix_user_notification_user_read_created") in calls

"""Pure-logic tests for manager invites: token hashing/masking/status, the
deterministic role precedence a dual-group invitee relies on, and migration
0020's shape."""
from __future__ import annotations

import importlib.util
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.dependencies.auth import _extract_role
from app.models.manager_invite import ManagerInvite
from app.schemas.manager_invite import ManagerInviteCreate
from app.services import manager_invite_service as svc

NOW = datetime(2026, 10, 28, 12, 0, tzinfo=timezone.utc)


def test_tokens_are_long_unique_and_hash_is_stable_sha256_hex():
    tokens = {svc.new_token() for _ in range(50)}
    assert len(tokens) == 50
    assert all(len(t) >= 43 for t in tokens)  # 32 bytes urlsafe-base64
    token = next(iter(tokens))
    digest = svc.hash_token(token)
    assert digest == svc.hash_token(token)
    assert len(digest) == 64 and token not in digest
    assert digest != svc.hash_token(token + "x")


@pytest.mark.parametrize(
    ("email", "hint"),
    [
        ("jane.doe@example.com", "j***@example.com"),
        ("a@b.co", "a***@b.co"),
        ("nodomain", "***"),
    ],
)
def test_mask_email(email, hint):
    assert svc.mask_email(email) == hint


def _invite(**kw):
    values = {
        "expires_at": NOW + timedelta(days=1),
        "accepted_at": None,
        "revoked_at": None,
    }
    values.update(kw)
    return SimpleNamespace(**values)


def test_invite_status_derivation():
    assert svc.invite_status(_invite(), NOW) == "pending"
    assert svc.invite_status(_invite(expires_at=NOW - timedelta(seconds=1)), NOW) == "expired"
    assert svc.invite_status(_invite(expires_at=NOW), NOW) == "expired"
    assert svc.invite_status(_invite(revoked_at=NOW), NOW) == "revoked"
    assert svc.invite_status(_invite(accepted_at=NOW), NOW) == "accepted"
    # Used beats expired/revoked.
    assert (
        svc.invite_status(_invite(accepted_at=NOW, expires_at=NOW - timedelta(days=1)), NOW)
        == "accepted"
    )


def test_naive_expiry_is_treated_as_utc():
    naive = datetime(2026, 10, 29, 12, 0)
    assert svc.invite_status(_invite(expires_at=naive), NOW) == "pending"


def test_rate_limit_and_expiry_constants():
    assert svc.INVITES_PER_OWNER_PER_DAY == 20
    assert svc.INVITE_TTL_DAYS == 14


def test_create_request_lowercases_and_validates_email():
    assert ManagerInviteCreate(email="  Sam@Example.COM ").email == "sam@example.com"
    for bad in ("nope", "a@b", "two words@x.com", "@x.com"):
        with pytest.raises(ValueError):
            ManagerInviteCreate(email=bad)


def test_role_precedence_is_deterministic_not_token_order():
    # An invitee who signed up as a diner and was then added to `manager`.
    assert _extract_role(["registered_user", "manager"]) == "manager"
    assert _extract_role(["manager", "registered_user"]) == "manager"
    assert _extract_role(["manager", "owner"]) == "owner"
    assert _extract_role(["registered_user", "admin"]) == "admin"
    assert _extract_role(["unknown"]) == "registered_user"
    assert _extract_role([]) == "registered_user"


MIGRATION = (
    Path(__file__).resolve().parents[2]
    / "backend"
    / "migrations"
    / "versions"
    / "20261028_0020_manager_invite.py"
)


def _load():
    spec = importlib.util.spec_from_file_location("mig_0020", MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_migration_revision_chain():
    module = _load()
    assert module.revision == "0020_manager_invite"
    assert len(module.revision) <= 32
    assert module.down_revision == "0019_user_notification"


def test_migration_creates_table_and_indexes_matching_the_model():
    module = _load()
    calls: list[tuple] = []

    class _Op:
        @staticmethod
        def create_table(name, *cols):
            calls.append(("create_table", name, {c.name for c in cols if hasattr(c, "name")}))

        @staticmethod
        def create_index(name, table, columns, unique=False):
            calls.append(("create_index", name, tuple(columns), unique))

    module.op = _Op
    module.upgrade()

    table = next(c for c in calls if c[0] == "create_table")
    assert table[1] == "manager_invite"
    model_columns = {c.name for c in ManagerInvite.__table__.columns}
    assert model_columns <= table[2]
    assert ("create_index", "uq_manager_invite_token_hash", ("token_hash",), True) in calls
    index_names = {c[1] for c in calls if c[0] == "create_index"}
    assert index_names == {i.name for i in ManagerInvite.__table__.indexes}

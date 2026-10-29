"""Integration tests: the additive `summary` object on the admin list
endpoints (docs/API_CONTRACTS.md "Admin list summaries").

For each page: the summary counts the WHOLE dataset (equal to what the
unfiltered list shows for a seeded fixture) and does NOT move with the
`q` search text, role/status filters or page.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest

from app.models.user_profile import UserProfile
from app.services import cognito_service
from app.services.cognito_service import PoolUserRecord
from factories import (
    create_brand,
    create_location,
    create_location_manager,
    create_owner,
    create_user_profile,
)

NOW = datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# /admin/users
# ---------------------------------------------------------------------------


def _rec(*, email: str, status: str = "CONFIRMED", enabled: bool = True) -> PoolUserRecord:
    sub = str(uuid.uuid4())
    return PoolUserRecord(
        username=sub,
        cognito_sub=sub,
        email=email,
        name=None,
        status=status,
        enabled=enabled,
        created_at=NOW - timedelta(days=1),
    )


@pytest.fixture
def pool(monkeypatch):
    groups: dict[str, list[PoolUserRecord]] = {
        "admin": [],
        "owner": [],
        "manager": [],
        "registered_user": [],
    }
    state = {"truncated": set()}

    def list_group_users(group: str):
        return list(groups[group]), group in state["truncated"]

    monkeypatch.setattr(cognito_service, "list_group_users", list_group_users)
    groups["_state"] = state  # type: ignore[assignment]
    return groups


@pytest.mark.asyncio
async def test_users_summary_matches_unfiltered_list_and_ignores_filters(
    client, db_session, as_user, pool
):
    admin = _rec(email="admin@example.com")
    owner_a = _rec(email="oa@example.com")
    owner_off = _rec(email="ooff@example.com", enabled=False)
    mgr = _rec(email="m@example.com", status="UNCONFIRMED")
    diner = _rec(email="d@example.com")
    pool["admin"] = [admin]
    pool["owner"] = [owner_a, owner_off]
    pool["manager"] = [mgr]
    # `owner_a` is also in registered_user: counted once, under its highest role.
    pool["registered_user"] = [diner, owner_a]
    await create_user_profile(db_session, cognito_sub=diner.cognito_sub, last_seen_at=NOW - timedelta(days=2))
    await create_user_profile(db_session, cognito_sub=owner_off.cognito_sub, last_seen_at=NOW - timedelta(days=90))
    await db_session.commit()

    as_user("admin")
    full = (await client.get("/admin/users", params={"page_size": 100})).json()
    s = full["summary"]
    rows = full["results"]
    assert s["total"] == full["total"] == len(rows) == 5
    assert s["active"] == sum(1 for r in rows if r["enabled"]) == 4
    assert s["inactive"] == sum(1 for r in rows if not r["enabled"]) == 1
    assert s["unconfirmed"] == sum(1 for r in rows if not r["confirmed"]) == 1
    assert s["seen_last_30_days"] == 1
    assert s["by_role"] == {"admin": 1, "owner": 2, "manager": 1, "registered_user": 1}
    assert sum(s["by_role"].values()) == s["total"]
    assert s["truncated"] is False

    # Search, role/status filter and paging leave the summary untouched.
    for params in (
        {"q": "ooff"},
        {"role": "owner"},
        {"status": "disabled"},
        {"page_size": 1, "page": 2},
    ):
        filtered = (await client.get("/admin/users", params=params)).json()
        assert filtered["summary"] == s, params
    assert (await client.get("/admin/users", params={"q": "ooff"})).json()["total"] == 1


@pytest.mark.asyncio
async def test_users_summary_carries_truncated_flag(client, db_session, as_user, pool):
    pool["admin"] = [_rec(email="a@example.com")]
    pool["_state"]["truncated"].add("registered_user")  # type: ignore[index]
    as_user("admin")
    body = (await client.get("/admin/users")).json()
    assert body["truncated"] is True
    assert body["summary"]["truncated"] is True


# ---------------------------------------------------------------------------
# /admin/registered-users
# ---------------------------------------------------------------------------


def _cognito_user(*, sub: str, email: str, status: str = "CONFIRMED", enabled: bool = True) -> dict:
    return {
        "Username": sub,
        "UserStatus": status,
        "Enabled": enabled,
        "UserCreateDate": NOW - timedelta(days=5),
        "Attributes": [{"Name": "sub", "Value": sub}, {"Name": "email", "Value": email}],
    }


@pytest.mark.asyncio
async def test_registered_users_summary(client, db_session, as_user, monkeypatch):
    monkeypatch.setenv("COGNITO_USER_POOL_ID", "us-east-1_testpool")
    fake = MagicMock()
    monkeypatch.setattr(cognito_service, "_cognito_client", fake)
    subs = [str(uuid.uuid4()) for _ in range(4)]
    fake.list_users_in_group.return_value = {
        "Users": [
            _cognito_user(sub=subs[0], email="a@example.com"),
            _cognito_user(sub=subs[1], email="b@example.com", enabled=False),
            _cognito_user(sub=subs[2], email="c@example.com", status="UNCONFIRMED"),
            _cognito_user(sub=subs[3], email="d@example.com"),
        ]
    }
    db_session.add(UserProfile(cognito_sub=subs[0], last_seen_at=NOW - timedelta(days=1)))
    db_session.add(UserProfile(cognito_sub=subs[3], last_seen_at=NOW - timedelta(days=45)))
    await db_session.commit()

    as_user("admin")
    full = (await client.get("/admin/registered-users")).json()
    s = full["summary"]
    assert s == {
        "total": 4,
        "active": 3,
        "inactive": 1,
        "unconfirmed": 1,
        "seen_last_30_days": 1,
        "truncated": False,
    }
    assert s["total"] == full["total"] == len(full["results"])

    searched = (await client.get("/admin/registered-users", params={"q": "b@example"})).json()
    assert searched["total"] == 1
    assert searched["summary"] == s


# ---------------------------------------------------------------------------
# /admin/owners
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_owners_summary(client, db_session, as_user):
    active_owner = await create_owner(db_session, email="active@example.com")
    brand = await create_brand(db_session, owner_id=active_owner.id, is_claimed=True)
    await create_location(db_session, brand_id=brand.id, status="active")

    hidden_owner = await create_owner(db_session, email="hidden@example.com")
    hb = await create_brand(db_session, owner_id=hidden_owner.id, is_claimed=True)
    await create_location(db_session, brand_id=hb.id, status="owner_deactivated")

    deleted_brand_owner = await create_owner(db_session, email="gone@example.com")
    db_ = await create_brand(
        db_session, owner_id=deleted_brand_owner.id, is_claimed=True, deleted_at=NOW
    )
    await create_location(db_session, brand_id=db_.id, status="active")

    await create_owner(db_session, email="empty@example.com")  # no brands
    # An unclaimed brand has no owner and never creates/counts an owner.
    ub = await create_brand(db_session, owner_id=None, is_claimed=False)
    await create_location(db_session, brand_id=ub.id, status="active")
    await db_session.commit()

    as_user("admin")
    full = (await client.get("/admin/owners")).json()
    s = full["summary"]
    assert s["total"] == full["total"] == len(full["results"]) == 4
    assert s["active"] == sum(1 for r in full["results"] if r["by_status"]["active"] > 0) == 1
    assert s["inactive"] == 3
    # hidden-only owner has a location; deleted-brand owner + empty owner have none live.
    assert s["without_locations"] == 2

    searched = (await client.get("/admin/owners", params={"q": "hidden"})).json()
    assert searched["total"] == 1
    assert searched["summary"] == s


# ---------------------------------------------------------------------------
# /admin/managers
# ---------------------------------------------------------------------------


@pytest.fixture
def manager_emails(monkeypatch):
    monkeypatch.setattr(cognito_service, "list_group_emails", lambda group: {})
    monkeypatch.setattr(cognito_service, "find_email_by_sub", lambda sub: None)


@pytest.mark.asyncio
async def test_managers_summary(client, db_session, as_user, manager_emails):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    loc1 = await create_location(db_session, brand_id=brand.id)
    loc2 = await create_location(db_session, brand_id=brand.id)
    active_sub, revoked_sub, both_sub = (str(uuid.uuid4()) for _ in range(3))
    await create_location_manager(db_session, location_id=loc1.id, user_id=active_sub, is_active=True)
    await create_location_manager(db_session, location_id=loc1.id, user_id=revoked_sub, is_active=False)
    await create_location_manager(db_session, location_id=loc1.id, user_id=both_sub, is_active=False)
    await create_location_manager(db_session, location_id=loc2.id, user_id=both_sub, is_active=True)
    await create_user_profile(db_session, cognito_sub=active_sub, last_seen_at=NOW - timedelta(days=3))
    await create_user_profile(db_session, cognito_sub=revoked_sub, last_seen_at=NOW - timedelta(days=60))
    await db_session.commit()

    as_user("admin")
    full = (await client.get("/admin/managers")).json()
    s = full["summary"]
    assert s == {"total": 3, "active": 2, "inactive": 1, "seen_last_30_days": 1}
    assert s["total"] == full["total"] == len(full["results"])
    assert s["active"] == sum(1 for r in full["results"] if r["active_location_count"] > 0)

    paged = (await client.get("/admin/managers", params={"page_size": 1, "page": 2})).json()
    assert paged["summary"] == s


@pytest.mark.asyncio
async def test_managers_summary_empty(client, db_session, as_user, manager_emails):
    as_user("admin")
    body = (await client.get("/admin/managers")).json()
    assert body["summary"] == {"total": 0, "active": 0, "inactive": 0, "seen_last_30_days": 0}


# ---------------------------------------------------------------------------
# /admin/listings
# ---------------------------------------------------------------------------


@pytest.fixture
def listing_cognito(monkeypatch):
    monkeypatch.setattr(cognito_service, "list_group_emails", lambda group: {})
    monkeypatch.setattr(cognito_service, "find_email_by_sub", lambda sub: None)


@pytest.mark.asyncio
async def test_listings_summary(client, db_session, as_user, listing_cognito):
    owner = await create_owner(db_session)
    claimed = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    await create_location(db_session, brand_id=claimed.id, status="active")
    await create_location(db_session, brand_id=claimed.id, status="coming_soon")
    unclaimed = await create_brand(db_session, owner_id=None, is_claimed=False)
    await create_location(db_session, brand_id=unclaimed.id, status="owner_deactivated")
    await create_location(db_session, brand_id=unclaimed.id, status="closed_pending_reopen")
    gone = await create_brand(db_session, owner_id=owner.id, is_claimed=True, deleted_at=NOW)
    await create_location(db_session, brand_id=gone.id, status="active")  # not counted
    await db_session.commit()

    as_user("admin")
    full = (await client.get("/admin/listings")).json()
    s = full["summary"]
    assert s == {
        "brands": 2,
        "unclaimed_brands": 1,
        "locations": 4,
        "active": 1,
        "coming_soon": 1,
        "owner_deactivated": 1,
        "closed_pending_reopen": 1,
    }
    assert s["brands"] == full["total"]
    assert s["active"] + s["coming_soon"] + s["owner_deactivated"] + s["closed_pending_reopen"] == s["locations"]

    filtered = (await client.get("/admin/listings", params={"status": "coming_soon"})).json()
    assert filtered["total"] == 1
    assert filtered["summary"] == s


@pytest.mark.asyncio
async def test_summaries_are_admin_only(client, db_session, as_user, pool, manager_emails):
    as_user("owner")
    for path in ("/admin/users", "/admin/owners", "/admin/managers", "/admin/registered-users", "/admin/listings"):
        assert (await client.get(path)).status_code == 403, path

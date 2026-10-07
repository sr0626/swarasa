"""Integration tests: `GET /admin/managers` — the admin "Managers" report
(docs/API_CONTRACTS.md "GET /admin/managers").

Covers: admin-only auth, empty state, who-is-listed rule (any assignment row;
revoked-only managers appear with 0 active), active-location count, owners
they work under, compact location list, soft-deleted brands excluded,
search (email + name, LIKE wildcards literal), every sort, pagination, and
best-effort Cognito email resolution (batched; degraded flag on failure).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.services import cognito_service
from factories import (
    create_brand,
    create_location,
    create_location_manager,
    create_owner,
    create_user_profile,
)


class FakeCognito:
    def __init__(self) -> None:
        self.manager_emails: dict[str, str] = {}
        self.group_calls: list[str] = []
        self.sub_calls: list[str] = []
        self.fail = False

    def list_group_emails(self, group_name: str) -> dict[str, str]:
        self.group_calls.append(group_name)
        if self.fail:
            raise RuntimeError("cognito down")
        return self.manager_emails if group_name == "manager" else {}

    def find_email_by_sub(self, sub: str) -> str | None:
        self.sub_calls.append(sub)
        return None


@pytest.fixture
def cognito(monkeypatch) -> FakeCognito:
    fake = FakeCognito()
    monkeypatch.setattr(cognito_service, "list_group_emails", fake.list_group_emails)
    monkeypatch.setattr(cognito_service, "find_email_by_sub", fake.find_email_by_sub)
    return fake


async def _assign(db, *, sub: str, location, is_active: bool = True, assigned_at=None):
    values = {"location_id": location.id, "user_id": sub, "is_active": is_active}
    if assigned_at is not None:
        values["assigned_at"] = assigned_at
    return await create_location_manager(db, **values)


@pytest.mark.asyncio
async def test_requires_admin(client, db_session, as_user, cognito):
    as_user("owner")
    assert (await client.get("/admin/managers")).status_code == 403
    as_user("manager")
    assert (await client.get("/admin/managers")).status_code == 403
    as_user("registered_user")
    assert (await client.get("/admin/managers")).status_code == 403


@pytest.mark.asyncio
async def test_anonymous_rejected(client, as_anonymous):
    assert (await client.get("/admin/managers")).status_code in (401, 403)


@pytest.mark.asyncio
async def test_empty_state(client, db_session, as_user, cognito):
    as_user("admin")
    resp = await client.get("/admin/managers")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "results": [],
        "page": 1,
        "page_size": 20,
        "total": 0,
        "email_lookup_degraded": False,
    }
    assert cognito.group_calls == []  # nothing to resolve => no Cognito call


@pytest.mark.asyncio
async def test_row_shape_counts_owners_and_locations(client, db_session, as_user, cognito):
    owner_a = await create_owner(db_session, email="a-owner@example.com", full_name="Alice Owner")
    owner_b = await create_owner(db_session, email="b-owner@example.com")
    brand_a = await create_brand(db_session, owner_id=owner_a.id, name="Zeta Grill", is_claimed=True)
    brand_b = await create_brand(db_session, owner_id=owner_b.id, name="Alpha Chaat", is_claimed=True)
    loc_a = await create_location(db_session, brand_id=brand_a.id, city="Plano")
    loc_b = await create_location(db_session, brand_id=brand_b.id, city="Irving", location_name="Irving Main")
    loc_revoked = await create_location(db_session, brand_id=brand_a.id, city="Dallas")

    sub = str(uuid.uuid4())
    seen = datetime.now(timezone.utc) - timedelta(hours=2)
    await create_user_profile(db_session, cognito_sub=sub, full_name="Mona Manager", last_seen_at=seen)
    first = datetime.now(timezone.utc) - timedelta(days=30)
    await _assign(db_session, sub=sub, location=loc_a, assigned_at=first)
    await _assign(db_session, sub=sub, location=loc_b, assigned_at=first + timedelta(days=5))
    await _assign(db_session, sub=sub, location=loc_revoked, is_active=False, assigned_at=first + timedelta(days=9))
    await db_session.commit()
    cognito.manager_emails = {sub: "mona@example.com"}

    as_user("admin")
    body = (await client.get("/admin/managers")).json()
    assert body["total"] == 1 and body["email_lookup_degraded"] is False
    row = body["results"][0]
    assert row["cognito_sub"] == sub
    assert row["email"] == "mona@example.com"
    assert row["full_name"] == "Mona Manager"
    assert row["active_location_count"] == 2  # the revoked one is not counted
    assert row["first_assigned_at"] is not None and row["last_seen_at"] is not None
    assert {o["email"] for o in row["owners"]} == {"a-owner@example.com", "b-owner@example.com"}
    # Compact list: brand then city, ACTIVE only, with ids for the listing link.
    assert [(l["brand_name"], l["city"]) for l in row["locations"]] == [
        ("Alpha Chaat", "Irving"),
        ("Zeta Grill", "Plano"),
    ]
    assert row["locations"][0]["location_name"] == "Irving Main"
    assert row["locations"][0]["brand_id"] == brand_b.id
    assert row["locations"][0]["location_id"] == loc_b.id
    assert cognito.group_calls == ["manager"]


@pytest.mark.asyncio
async def test_revoked_only_manager_is_listed_with_zero_active(client, db_session, as_user, cognito):
    brand = await create_brand(db_session, is_claimed=True)
    loc = await create_location(db_session, brand_id=brand.id)
    sub = str(uuid.uuid4())
    await _assign(db_session, sub=sub, location=loc, is_active=False)
    await db_session.commit()

    as_user("admin")
    body = (await client.get("/admin/managers")).json()
    assert body["total"] == 1
    row = body["results"][0]
    assert row["cognito_sub"] == sub
    assert row["active_location_count"] == 0
    assert row["locations"] == [] and row["owners"] == []
    assert row["email"] is None and row["full_name"] is None and row["last_seen_at"] is None


@pytest.mark.asyncio
async def test_soft_deleted_brand_assignments_are_not_active_locations(
    client, db_session, as_user, cognito
):
    owner = await create_owner(db_session)
    live = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    gone = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    gone.deleted_at = datetime.now(timezone.utc)
    sub = str(uuid.uuid4())
    await _assign(db_session, sub=sub, location=await create_location(db_session, brand_id=live.id))
    await _assign(db_session, sub=sub, location=await create_location(db_session, brand_id=gone.id))
    await db_session.commit()

    as_user("admin")
    row = (await client.get("/admin/managers")).json()["results"][0]
    assert row["active_location_count"] == 1
    assert [l["brand_id"] for l in row["locations"]] == [live.id]


@pytest.mark.asyncio
async def test_ccpa_deleted_owner_is_redacted(client, db_session, as_user, cognito):
    owner = await create_owner(db_session, email="deleted-owner-3@deleted.swarasa.invalid")
    owner.personal_data_deleted_at = datetime.now(timezone.utc)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    await _assign(db_session, sub=str(uuid.uuid4()), location=await create_location(db_session, brand_id=brand.id))
    await db_session.commit()

    as_user("admin")
    row = (await client.get("/admin/managers")).json()["results"][0]
    assert row["owners"] == [{"id": owner.id, "email": None, "full_name": None}]


async def _three_managers(db_session, cognito):
    """(sub, email, name, first_assigned days ago, active locs, last_seen hrs ago)"""
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    now = datetime.now(timezone.utc)
    spec = [
        ("carol@example.com", "Carol Diaz", 30, 1, 5),
        ("bob@example.com", "Bob Lee", 10, 3, None),
        ("alice@example.com", None, 20, 2, 1),
    ]
    subs = []
    for email, name, days, n_locs, seen_hrs in spec:
        sub = str(uuid.uuid4())
        subs.append(sub)
        cognito.manager_emails[sub] = email
        if name or seen_hrs is not None:
            await create_user_profile(
                db_session,
                cognito_sub=sub,
                full_name=name,
                last_seen_at=None if seen_hrs is None else now - timedelta(hours=seen_hrs),
            )
        for _ in range(n_locs):
            loc = await create_location(db_session, brand_id=brand.id)
            await _assign(db_session, sub=sub, location=loc, assigned_at=now - timedelta(days=days))
    await db_session.commit()
    return subs


@pytest.mark.asyncio
async def test_sorts(client, db_session, as_user, cognito):
    await _three_managers(db_session, cognito)
    as_user("admin")

    async def order(sort: str) -> list[str]:
        resp = await client.get(f"/admin/managers?sort={sort}")
        assert resp.status_code == 200, resp.text
        return [r["email"] for r in resp.json()["results"]]

    assert await order("newest") == ["bob@example.com", "alice@example.com", "carol@example.com"]
    assert await order("oldest") == ["carol@example.com", "alice@example.com", "bob@example.com"]
    assert await order("most_locations") == ["bob@example.com", "alice@example.com", "carol@example.com"]
    assert await order("email") == ["alice@example.com", "bob@example.com", "carol@example.com"]
    # last_seen: most recent first, never-seen (bob) last.
    assert await order("last_seen") == ["alice@example.com", "carol@example.com", "bob@example.com"]
    assert (await client.get("/admin/managers?sort=bogus")).status_code == 422


@pytest.mark.asyncio
async def test_search_matches_email_or_name_case_insensitively(client, db_session, as_user, cognito):
    await _three_managers(db_session, cognito)
    as_user("admin")

    async def emails(q: str) -> list[str]:
        body = (await client.get("/admin/managers", params={"q": q, "sort": "email"})).json()
        return [r["email"] for r in body["results"]]

    assert await emails("BOB@") == ["bob@example.com"]
    assert await emails("diaz") == ["carol@example.com"]  # name only
    assert await emails("example.com") == ["alice@example.com", "bob@example.com", "carol@example.com"]
    assert await emails("nobody") == []
    # LIKE wildcards are literal, not patterns.
    assert await emails("%") == []
    assert await emails("_") == []
    body = (await client.get("/admin/managers?q=nobody")).json()
    assert body["total"] == 0 and body["results"] == []


@pytest.mark.asyncio
async def test_pagination(client, db_session, as_user, cognito):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    now = datetime.now(timezone.utc)
    for i in range(5):
        loc = await create_location(db_session, brand_id=brand.id)
        await _assign(
            db_session, sub=str(uuid.uuid4()), location=loc, assigned_at=now - timedelta(days=i)
        )
    await db_session.commit()

    as_user("admin")
    p1 = (await client.get("/admin/managers?page=1&page_size=2")).json()
    p3 = (await client.get("/admin/managers?page=3&page_size=2")).json()
    assert p1["total"] == 5 and len(p1["results"]) == 2
    assert p1["page"] == 1 and p1["page_size"] == 2
    assert len(p3["results"]) == 1
    seen = {r["cognito_sub"] for r in p1["results"]}
    p2 = (await client.get("/admin/managers?page=2&page_size=2")).json()
    assert not seen & {r["cognito_sub"] for r in p2["results"]}
    assert (await client.get("/admin/managers?page_size=101")).status_code == 422


@pytest.mark.asyncio
async def test_cognito_failure_degrades_emails_not_the_report(client, db_session, as_user, cognito):
    brand = await create_brand(db_session, is_claimed=True)
    sub = str(uuid.uuid4())
    await create_user_profile(db_session, cognito_sub=sub, full_name="Nadia Named")
    await _assign(db_session, sub=sub, location=await create_location(db_session, brand_id=brand.id))
    await db_session.commit()
    cognito.fail = True

    as_user("admin")
    resp = await client.get("/admin/managers")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["email_lookup_degraded"] is True
    assert body["results"][0]["email"] is None
    assert body["results"][0]["full_name"] == "Nadia Named"
    assert cognito.sub_calls == []  # no per-sub fan-out while Cognito is failing
    # Name search still works while emails are unavailable.
    assert (await client.get("/admin/managers?q=nadia")).json()["total"] == 1


@pytest.mark.asyncio
async def test_email_resolution_is_batched_not_per_manager(client, db_session, as_user, cognito):
    """One `manager` group sweep resolves every manager; per-sub lookups are
    only a capped fallback for subs the sweep did not return."""
    await _three_managers(db_session, cognito)
    as_user("admin")
    assert (await client.get("/admin/managers")).status_code == 200
    assert cognito.group_calls == ["manager"]
    assert cognito.sub_calls == []

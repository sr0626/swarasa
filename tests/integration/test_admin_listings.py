"""Integration tests: `GET /admin/listings` — the admin Listings page's data
source (docs/API_CONTRACTS.md "GET /admin/listings").

Covers: admin-only auth, every-status location visibility (the "Coming soon
filter can't tell which location" defect), per-location `matches_filter`,
single-location filter semantics, deleted view, owner email / unclaimed,
created-by resolution (owner / manager / admin / system / unknown, batched
Cognito best-effort with graceful fallback), pagination + sort, a
query-count test proving no N+1, and that none of the provenance fields leak
onto the public / owner payloads.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import event

from app.models.audit_log import AuditLog
from app.services import cognito_service
from factories import (
    create_brand,
    create_claim,
    create_follow,
    create_location,
    create_owner,
)

CREATOR_FIELDS = {"created_at", "created_by_role", "created_by_email", "created_by_label"}


class FakeCognito:
    """Stand-in for the two Cognito lookups the resolver may make."""

    def __init__(self) -> None:
        self.group_emails: dict[str, dict[str, str]] = {}
        self.by_sub: dict[str, str] = {}
        self.group_calls: list[str] = []
        self.sub_calls: list[str] = []
        self.fail = False

    def list_group_emails(self, group_name: str) -> dict[str, str]:
        self.group_calls.append(group_name)
        if self.fail:
            raise RuntimeError("cognito down")
        return self.group_emails.get(group_name, {})

    def find_email_by_sub(self, sub: str) -> str | None:
        self.sub_calls.append(sub)
        if self.fail:
            raise RuntimeError("cognito down")
        return self.by_sub.get(sub)


@pytest.fixture
def cognito(monkeypatch) -> FakeCognito:
    fake = FakeCognito()
    monkeypatch.setattr(cognito_service, "list_group_emails", fake.list_group_emails)
    monkeypatch.setattr(cognito_service, "find_email_by_sub", fake.find_email_by_sub)
    return fake


async def _audit_create(db, table: str, record_id: int, actor_id: str, role: str, **kw) -> None:
    db.add(
        AuditLog(
            table_name=table,
            record_id=record_id,
            action="create",
            actor_id=actor_id,
            actor_role=role,
            **kw,
        )
    )
    await db.flush()


def _by_id(body: dict) -> dict[int, dict]:
    return {row["id"]: row for row in body["results"]}


@pytest.mark.asyncio
async def test_requires_admin(client, db_session, as_user, cognito):
    as_user("owner")
    assert (await client.get("/admin/listings")).status_code == 403
    as_user("manager")
    assert (await client.get("/admin/listings")).status_code == 403
    as_user("registered_user")
    assert (await client.get("/admin/listings")).status_code == 403


@pytest.mark.asyncio
async def test_anonymous_rejected(client, as_anonymous):
    assert (await client.get("/admin/listings")).status_code in (401, 403)


@pytest.mark.asyncio
async def test_empty_state(client, db_session, as_user, cognito):
    as_user("admin")
    resp = await client.get("/admin/listings")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"results": [], "page": 1, "page_size": 20, "total": 0}


@pytest.mark.asyncio
async def test_returns_every_location_with_status_and_detail(client, db_session, as_user, cognito):
    """The defect: the old page only saw ACTIVE locations, so a brand that
    matched `status=coming_soon` showed nothing to identify WHICH location."""
    owner = await create_owner(db_session, email="o@example.com")
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True, name="Spice Route")
    active = await create_location(
        db_session, brand_id=brand.id, status="active", city="Plano", phone="+12145550101"
    )
    soon = await create_location(
        db_session,
        brand_id=brand.id,
        status="coming_soon",
        city="Frisco",
        postal_code="75034",
        phone="+12145550102",
    )
    hidden = await create_location(db_session, brand_id=brand.id, status="owner_deactivated")
    await db_session.commit()

    as_user("admin")
    body = (await client.get("/admin/listings")).json()
    row = body["results"][0]
    assert row["id"] == brand.id
    assert row["location_count"] == 1  # ACTIVE only, same meaning as RestaurantOut
    locs = {loc["id"]: loc for loc in row["locations"]}
    assert set(locs) == {active.id, soon.id, hidden.id}
    assert locs[soon.id]["status"] == "coming_soon"
    assert locs[soon.id]["city"] == "Frisco"
    assert locs[soon.id]["postal_code"] == "75034"
    assert locs[soon.id]["phone"] == "+12145550102"
    assert locs[soon.id]["is_paid"] is False
    assert locs[hidden.id]["status"] == "owner_deactivated"


@pytest.mark.asyncio
async def test_status_filter_flags_the_matching_location(client, db_session, as_user, cognito):
    brand = await create_brand(db_session, name="Two Faces")
    active = await create_location(db_session, brand_id=brand.id, status="active")
    soon = await create_location(db_session, brand_id=brand.id, status="coming_soon")
    other = await create_brand(db_session, name="Only Active")
    await create_location(db_session, brand_id=other.id, status="active")
    await db_session.commit()

    as_user("admin")
    body = (await client.get("/admin/listings?status=coming_soon")).json()
    assert body["total"] == 1
    row = body["results"][0]
    flags = {loc["id"]: loc["matches_filter"] for loc in row["locations"]}
    assert flags == {active.id: False, soon.id: True}

    # No location filter => every location "matches".
    body = (await client.get("/admin/listings")).json()
    assert all(loc["matches_filter"] for row in body["results"] for loc in row["locations"])


@pytest.mark.asyncio
async def test_combined_location_filters_apply_to_a_single_location(
    client, db_session, as_user, cognito
):
    """`status=coming_soon&is_paid=true`: the brand's coming-soon branch is
    free and its active branch is paid — no ONE location is both, so it must
    not match (unlike GET /restaurants' independent any-location tests)."""
    split = await create_brand(db_session, name="Split", owner_id=None)
    await create_location(db_session, brand_id=split.id, status="coming_soon", is_paid=False)
    await create_location(db_session, brand_id=split.id, status="active", is_paid=True)
    both = await create_brand(db_session, name="Both")
    match = await create_location(db_session, brand_id=both.id, status="coming_soon", is_paid=True)
    await db_session.commit()

    as_user("admin")
    body = (await client.get("/admin/listings?status=coming_soon&is_paid=true")).json()
    assert [r["id"] for r in body["results"]] == [both.id]
    assert [loc["id"] for loc in body["results"][0]["locations"] if loc["matches_filter"]] == [
        match.id
    ]

    # The legacy endpoint DOES match `split` (documented difference).
    legacy = (await client.get("/restaurants?status=coming_soon&is_paid=true")).json()
    assert split.id in {r["id"] for r in legacy["results"]}

    # A single filter agrees with GET /restaurants exactly (Overview tiles).
    single = (await client.get("/admin/listings?status=coming_soon")).json()
    legacy_single = (await client.get("/restaurants?status=coming_soon")).json()
    assert single["total"] == legacy_single["total"] == 2


@pytest.mark.asyncio
async def test_city_filter_is_case_insensitive_and_flags_location(
    client, db_session, as_user, cognito
):
    brand = await create_brand(db_session)
    plano = await create_location(db_session, brand_id=brand.id, city="Plano")
    await create_location(db_session, brand_id=brand.id, city="Dallas")
    await db_session.commit()

    as_user("admin")
    body = (await client.get("/admin/listings?city=plano")).json()
    assert body["total"] == 1
    assert [loc["id"] for loc in body["results"][0]["locations"] if loc["matches_filter"]] == [
        plano.id
    ]


@pytest.mark.asyncio
async def test_deleted_view_returns_soft_deleted_brand_with_locations(
    client, db_session, as_user, cognito
):
    live = await create_brand(db_session, name="Live")
    gone = await create_brand(db_session, name="Gone")
    gone.deleted_at = datetime.now(timezone.utc)
    loc = await create_location(db_session, brand_id=gone.id, status="owner_deactivated")
    await create_location(db_session, brand_id=live.id)
    await db_session.commit()

    as_user("admin")
    default = (await client.get("/admin/listings")).json()
    assert [r["id"] for r in default["results"]] == [live.id]

    deleted = (await client.get("/admin/listings?status=deleted")).json()
    assert [r["id"] for r in deleted["results"]] == [gone.id]
    row = deleted["results"][0]
    assert row["deleted_at"] is not None
    assert [(l["id"], l["matches_filter"]) for l in row["locations"]] == [(loc.id, True)]


@pytest.mark.asyncio
async def test_owner_email_unclaimed_and_deleted_owner(client, db_session, as_user, cognito):
    owner = await create_owner(db_session, email="boss@example.com")
    claimed = await create_brand(db_session, owner_id=owner.id, is_claimed=True, name="Claimed")
    unclaimed = await create_brand(db_session, owner_id=None, is_claimed=False, name="Unclaimed")
    gone_owner = await create_owner(db_session, email="deleted-owner-9@deleted.swarasa.invalid")
    gone_owner.personal_data_deleted_at = datetime.now(timezone.utc)
    erased = await create_brand(db_session, owner_id=gone_owner.id, is_claimed=True, name="Erased")
    await create_claim(db_session, brand_id=unclaimed.id)  # pending claim
    await db_session.commit()

    as_user("admin")
    rows = _by_id((await client.get("/admin/listings")).json())
    assert rows[claimed.id]["owner_email"] == "boss@example.com"
    assert rows[claimed.id]["owner_id"] == owner.id
    assert rows[unclaimed.id]["owner_email"] is None
    assert rows[unclaimed.id]["owner_id"] is None
    assert rows[unclaimed.id]["has_pending_claim"] is True
    assert rows[erased.id]["owner_email"] is None
    assert rows[erased.id]["owner_deleted"] is True
    assert "invalid" not in str(rows[erased.id])

    filtered = (await client.get("/admin/listings?owner_email=BOSS@")).json()
    assert [r["id"] for r in filtered["results"]] == [claimed.id]


@pytest.mark.asyncio
async def test_created_by_resolves_owner_admin_manager_system_and_unknown(
    client, db_session, as_user, cognito
):
    owner = await create_owner(db_session, email="creator-owner@example.com")
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    by_owner = await create_location(db_session, brand_id=brand.id)
    by_manager = await create_location(db_session, brand_id=brand.id)
    by_admin = await create_location(db_session, brand_id=brand.id)
    by_import = await create_location(db_session, brand_id=brand.id)
    by_ghost = await create_location(db_session, brand_id=brand.id)
    no_audit = await create_location(db_session, brand_id=brand.id)

    manager_sub, admin_sub, ghost_sub = (str(uuid.uuid4()) for _ in range(3))
    when = datetime(2026, 9, 1, 15, 30, tzinfo=timezone.utc)
    await _audit_create(db_session, "restaurant_brand", brand.id, owner.cognito_sub, "owner", created_at=when)
    await _audit_create(db_session, "restaurant_location", by_owner.id, owner.cognito_sub, "owner")
    await _audit_create(db_session, "restaurant_location", by_manager.id, manager_sub, "manager")
    await _audit_create(db_session, "restaurant_location", by_admin.id, admin_sub, "admin")
    await _audit_create(
        db_session, "restaurant_location", by_import.id, "system:bulk_import_restaurants_csv", "admin"
    )
    await _audit_create(db_session, "restaurant_location", by_ghost.id, ghost_sub, "manager")
    await db_session.commit()

    cognito.group_emails = {
        "manager": {manager_sub: "mgr@example.com"},
        "admin": {admin_sub: "root@example.com"},
    }

    as_user("admin")
    row = (await client.get("/admin/listings")).json()["results"][0]
    assert row["created_by_role"] == "owner"
    assert row["created_by_email"] == "creator-owner@example.com"
    assert row["created_by_label"] == "creator-owner@example.com"
    assert row["created_at"].startswith("2026-09-01T15:30:00")

    locs = {loc["id"]: loc for loc in row["locations"]}
    assert locs[by_owner.id]["created_by_role"] == "owner"
    assert locs[by_owner.id]["created_by_email"] == "creator-owner@example.com"
    assert locs[by_manager.id]["created_by_role"] == "manager"
    assert locs[by_manager.id]["created_by_email"] == "mgr@example.com"
    assert locs[by_admin.id]["created_by_role"] == "admin"
    assert locs[by_admin.id]["created_by_email"] == "root@example.com"
    assert locs[by_import.id]["created_by_role"] == "system"
    assert locs[by_import.id]["created_by_label"] == "import"
    assert locs[by_import.id]["created_by_email"] is None
    # Unknown to Cognito: short sub, role still known, no email.
    assert locs[by_ghost.id]["created_by_role"] == "manager"
    assert locs[by_ghost.id]["created_by_email"] is None
    assert locs[by_ghost.id]["created_by_label"] == ghost_sub[:8]
    # No audit row: no creator, but a created_at fallback from the record.
    assert locs[no_audit.id]["created_by_role"] is None
    assert locs[no_audit.id]["created_by_label"] is None
    assert locs[no_audit.id]["created_at"] is not None

    # Batched: one sweep per role (manager, admin), not one call per actor.
    assert sorted(cognito.group_calls) == ["admin", "manager"]


@pytest.mark.asyncio
async def test_earliest_create_row_wins(client, db_session, as_user, cognito):
    owner = await create_owner(db_session, email="first@example.com")
    second = await create_owner(db_session, email="second@example.com")
    brand = await create_brand(db_session, owner_id=owner.id)
    await _audit_create(db_session, "restaurant_brand", brand.id, owner.cognito_sub, "owner")
    await _audit_create(db_session, "restaurant_brand", brand.id, second.cognito_sub, "owner")
    await db_session.commit()

    as_user("admin")
    row = (await client.get("/admin/listings")).json()["results"][0]
    assert row["created_by_email"] == "first@example.com"


@pytest.mark.asyncio
async def test_cognito_failure_degrades_to_short_sub_not_an_error(
    client, db_session, as_user, cognito
):
    brand = await create_brand(db_session)
    admin_sub = str(uuid.uuid4())
    await _audit_create(db_session, "restaurant_brand", brand.id, admin_sub, "admin")
    await db_session.commit()
    cognito.fail = True

    as_user("admin")
    resp = await client.get("/admin/listings")
    assert resp.status_code == 200, resp.text
    row = resp.json()["results"][0]
    assert row["created_by_role"] == "admin"
    assert row["created_by_email"] is None
    assert row["created_by_label"] == admin_sub[:8]
    # Failing group sweep must not fan out into per-sub calls.
    assert cognito.sub_calls == []


@pytest.mark.asyncio
async def test_deleted_owner_creator_is_not_revealed(client, db_session, as_user, cognito):
    owner = await create_owner(db_session, email="deleted-owner-1@deleted.swarasa.invalid")
    owner.personal_data_deleted_at = datetime.now(timezone.utc)
    brand = await create_brand(db_session, owner_id=owner.id)
    await _audit_create(db_session, "restaurant_brand", brand.id, owner.cognito_sub, "owner")
    await db_session.commit()

    as_user("admin")
    row = (await client.get("/admin/listings")).json()["results"][0]
    assert row["created_by_email"] is None
    assert row["created_by_label"] == "deleted account"


@pytest.mark.asyncio
async def test_pagination_and_sort(client, db_session, as_user, cognito):
    brands = [await create_brand(db_session, name=f"B{i}") for i in range(5)]
    for _ in range(3):
        await create_follow(db_session, brand_id=brands[1].id)
    await create_follow(db_session, brand_id=brands[3].id)
    await db_session.commit()

    as_user("admin")
    page1 = (await client.get("/admin/listings?page=1&page_size=2")).json()
    assert page1["total"] == 5 and len(page1["results"]) == 2
    assert [r["id"] for r in page1["results"]] == [brands[4].id, brands[3].id]  # newest first
    page3 = (await client.get("/admin/listings?page=3&page_size=2")).json()
    assert [r["id"] for r in page3["results"]] == [brands[0].id]

    oldest = (await client.get("/admin/listings?sort=oldest")).json()
    assert [r["id"] for r in oldest["results"]][:2] == [brands[0].id, brands[1].id]

    followed = (await client.get("/admin/listings?sort=followers")).json()
    assert [(r["id"], r["follower_count"]) for r in followed["results"]][:2] == [
        (brands[1].id, 3),
        (brands[3].id, 1),
    ]
    assert (await client.get("/admin/listings?sort=bogus")).status_code == 422


@pytest.mark.asyncio
async def test_query_count_does_not_grow_with_page_size(
    client, db_session, as_user, cognito
):
    """No N+1: the statement count is the same for 2 brands as for 8, each
    with several locations, audit rows and (Cognito-resolved) creators."""

    async def seed(n: int) -> None:
        for i in range(n):
            owner = await create_owner(db_session)
            brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
            await _audit_create(db_session, "restaurant_brand", brand.id, owner.cognito_sub, "owner")
            for j in range(3):
                loc = await create_location(db_session, brand_id=brand.id)
                await _audit_create(
                    db_session, "restaurant_location", loc.id, str(uuid.uuid4()), "manager"
                )
            await create_follow(db_session, brand_id=brand.id)
        await db_session.commit()

    statements: list[str] = []

    def _count(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    engine = db_session.bind.sync_engine
    as_user("admin")

    async def measure() -> tuple[int, dict]:
        statements.clear()
        event.listen(engine, "before_cursor_execute", _count)
        try:
            resp = await client.get("/admin/listings")
        finally:
            event.remove(engine, "before_cursor_execute", _count)
        assert resp.status_code == 200
        return len(statements), resp.json()

    await seed(2)
    small, _ = await measure()
    await seed(6)
    large, body = await measure()

    assert body["total"] == 8 and sum(len(r["locations"]) for r in body["results"]) == 24
    assert small == large, f"statement count grew with page size: {small} -> {large}"
    assert small <= 14


@pytest.mark.asyncio
async def test_provenance_never_on_public_or_owner_payloads(client, db_session, as_user, cognito):
    owner = await create_owner(db_session, email="hidden@example.com")
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    await create_location(db_session, brand_id=brand.id)
    await _audit_create(db_session, "restaurant_brand", brand.id, owner.cognito_sub, "owner")
    await db_session.commit()

    # Anonymous public reads.
    public_brand = (await client.get(f"/restaurants/{brand.id}")).json()
    public_locs = (await client.get(f"/restaurants/{brand.id}/locations")).json()
    for payload in (public_brand, *public_locs["results"]):
        assert not CREATOR_FIELDS & set(payload)
        assert "owner_email" not in payload
    assert "hidden@example.com" not in str(public_brand) + str(public_locs)

    # Admin's legacy list + the owner's own list carry no provenance either.
    as_user("admin")
    legacy = (await client.get("/restaurants")).json()
    assert not CREATOR_FIELDS & set(legacy["results"][0])
    assert "owner_email" not in legacy["results"][0]
    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    mine = (await client.get("/restaurants")).json()
    assert not CREATOR_FIELDS & set(mine["results"][0])
    assert "owner_email" not in mine["results"][0]

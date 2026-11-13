"""Integration tests: the hidden `import_review` ("Import issues") status
(docs/DECISIONS.md "Bulk import creates `import_review`").

Covers: never public anywhere (sitemap, cities, brand location list, direct
read), the SAME readiness gate as `coming_soon` (422 `listing_incomplete`
listing everything missing, for admin and owner), editing never flips the
status, only an admin can SET it (an owner can move a listing out of it),
`GET /admin/listings` `setup_missing` (+ the 'ready' case, the status filter
and the summary count) with a query-count guard that includes the bulk hours
lookup, and the `mark_imported_for_review` management command (dry run by
default, apply, idempotent, only imported + unclaimed + coming_soon, one audit
row per change, strict flag validation).
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import event, select

import app.main as app_main
from app.dependencies.auth import CurrentUser, get_current_user_optional
from app.models.audit_log import AuditLog
from app.models.restaurant_location import RestaurantLocation
from app.scripts.mark_imported_for_review import (
    MarkImportedError,
    mark_imported_for_review,
    parse_flag,
    parse_location_ids,
)
from app.scripts.management import _COMMANDS, run_management_command
from app.services import cognito_service
from factories import add_full_week_hours, create_brand, create_location, create_owner


@pytest.fixture(autouse=True)
def _no_cognito(monkeypatch):
    monkeypatch.setattr(cognito_service, "list_group_emails", lambda group: {})
    monkeypatch.setattr(cognito_service, "find_email_by_sub", lambda sub: None)


def _hours_payload(closed_days=(0,)) -> dict:
    entries = []
    for day in range(7):
        if day in closed_days:
            entries.append({"day_of_week": day, "is_closed": True})
        else:
            entries.append(
                {"day_of_week": day, "is_closed": False, "open_time": "11:00:00", "close_time": "22:00:00"}
            )
    return {"hours": entries}


def _as_optional(role: str, sub: str) -> None:
    user = CurrentUser(cognito_sub=sub, email=f"{sub}@example.com", role=role)

    async def _dep():
        return user

    app_main.app.dependency_overrides[get_current_user_optional] = _dep


async def _import_review(db, *, phone="+12145550101", with_hours=False, owner=None, **brand_kw):
    brand = await create_brand(
        db, owner_id=owner.id if owner else None, is_claimed=owner is not None, **brand_kw
    )
    loc = await create_location(db, brand_id=brand.id, status="import_review", phone=phone)
    if with_hours:
        await add_full_week_hours(db, loc.id)
    await db.commit()
    return brand, loc


# ---------------------------------------------------------------------------
# Never public
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_import_review_is_not_public_anywhere(client, db_session, as_anonymous):
    brand, loc = await _import_review(db_session, with_hours=True)

    assert (await client.get(f"/locations/{loc.id}")).status_code == 404
    listed = (await client.get(f"/restaurants/{brand.id}/locations")).json()
    assert listed["results"] == []
    assert (await client.get("/sitemap/locations")).json()["results"] == []
    assert (await client.get("/cities")).json()["results"] == []
    # The exact filter search/follow/deals/tiles use never matches it.
    active = (
        await db_session.execute(select(RestaurantLocation.id).where(RestaurantLocation.is_active == True))  # noqa: E712
    ).scalars().all()
    assert loc.id not in active


# ---------------------------------------------------------------------------
# Activation gate and transition rules
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_admin_activation_is_refused_listing_every_missing_item(client, db_session, as_user):
    _brand, loc = await _import_review(db_session, phone=None)
    as_user("admin")

    refused = await client.post(f"/locations/{loc.id}/status", json={"status": "active"})
    assert refused.status_code == 422
    body = refused.json()
    assert body["code"] == "listing_incomplete" and body["missing"] == ["phone", "hours"]
    assert "phone" in body["detail"] and "opening hours" in body["detail"]
    await db_session.refresh(loc)
    assert loc.status == "import_review"


@pytest.mark.asyncio
async def test_owner_sees_the_same_checklist_and_gate(client, db_session, as_user):
    owner = await create_owner(db_session)
    _brand, loc = await _import_review(db_session, owner=owner)
    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    _as_optional("owner", owner.cognito_sub)

    detail = (await client.get(f"/locations/{loc.id}")).json()
    assert detail["status"] == "import_review" and detail["setup_missing"] == ["hours"]
    refused = await client.post(f"/locations/{loc.id}/status", json={"status": "active"})
    assert refused.status_code == 422 and refused.json()["missing"] == ["hours"]

    assert (await client.put(f"/locations/{loc.id}/hours", json=_hours_payload())).status_code == 200
    ok = await client.post(f"/locations/{loc.id}/status", json={"status": "active"})
    assert ok.status_code == 200 and ok.json()["status"] == "active"


@pytest.mark.asyncio
async def test_editing_until_complete_never_flips_the_status(client, db_session, as_user):
    _brand, loc = await _import_review(db_session)
    admin = as_user("admin")
    _as_optional("admin", admin.cognito_sub)

    assert (await client.put(f"/locations/{loc.id}/hours", json=_hours_payload())).status_code == 200
    patched = await client.patch(f"/locations/{loc.id}", json={"city": "Plano"})
    assert patched.status_code == 200
    assert patched.json()["status"] == "import_review" and patched.json()["setup_missing"] == []
    await db_session.refresh(loc)
    assert loc.status == "import_review"

    # Activation stays a deliberate step.
    ok = await client.post(f"/locations/{loc.id}/status", json={"status": "active"})
    assert ok.status_code == 200 and ok.json()["status"] == "active"


@pytest.mark.asyncio
async def test_only_an_admin_can_set_import_review(client, db_session, as_user):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    loc = await create_location(db_session, brand_id=brand.id, status="coming_soon")
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    refused = await client.post(f"/locations/{loc.id}/status", json={"status": "import_review"})
    assert refused.status_code == 422 and refused.json()["code"] == "invalid_status"

    as_user("admin")
    ok = await client.post(f"/locations/{loc.id}/status", json={"status": "import_review"})
    assert ok.status_code == 200 and ok.json()["status"] == "import_review"


@pytest.mark.asyncio
async def test_owner_can_move_a_listing_out_of_import_review(client, db_session, as_user):
    owner = await create_owner(db_session)
    _brand, loc = await _import_review(db_session, owner=owner)
    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    for target in ("coming_soon", "owner_deactivated"):
        resp = await client.post(f"/locations/{loc.id}/status", json={"status": target})
        assert resp.status_code == 200 and resp.json()["status"] == target
        await db_session.refresh(loc)
        loc.status = "import_review"
        await db_session.commit()


# ---------------------------------------------------------------------------
# GET /admin/listings
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_admin_listings_setup_missing_ready_filter_and_summary(client, db_session, as_user):
    owner = await create_owner(db_session)
    _b1, incomplete = await _import_review(db_session, phone=None, name="Zztest Incomplete")
    _b2, ready = await _import_review(db_session, with_hours=True, name="Zztest Ready")
    _b3, soon = await _import_review(db_session, name="Zztest Soon")
    soon.status = "coming_soon"
    live_brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True, name="Live One")
    live = await create_location(db_session, brand_id=live_brand.id, status="active", phone=None)
    await db_session.commit()
    as_user("admin")

    body = (await client.get("/admin/listings")).json()
    locs = {l["id"]: l for r in body["results"] for l in r["locations"]}
    assert locs[incomplete.id]["setup_missing"] == ["phone", "hours"]
    assert locs[ready.id]["status"] == "import_review" and locs[ready.id]["setup_missing"] == []
    assert locs[soon.id]["setup_missing"] == ["hours"]  # coming soon gets chips too
    assert locs[live.id]["setup_missing"] == []  # not in setup: never advertised
    assert body["summary"]["import_review"] == 2 and body["summary"]["coming_soon"] == 1

    filtered = (await client.get("/admin/listings", params={"status": "import_review"})).json()
    assert filtered["total"] == 2
    flagged = {l["id"] for r in filtered["results"] for l in r["locations"] if l["matches_filter"]}
    assert flagged == {incomplete.id, ready.id}
    assert filtered["summary"] == body["summary"]


@pytest.mark.asyncio
async def test_admin_listings_query_count_with_setup_locations_does_not_grow(
    client, db_session, as_user
):
    async def seed(n: int) -> None:
        for _ in range(n):
            brand = await create_brand(db_session)
            for _j in range(3):
                loc = await create_location(db_session, brand_id=brand.id, status="import_review")
                await add_full_week_hours(db_session, loc.id)
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
    assert all(
        l["setup_missing"] == [] for r in body["results"] for l in r["locations"]
    )  # hours supplied by the single bulk query
    assert small == large, f"statement count grew with page size: {small} -> {large}"
    assert small <= 16


# ---------------------------------------------------------------------------
# mark_imported_for_review
# ---------------------------------------------------------------------------


async def _audit_create(db, loc_id: int, **new_val) -> None:
    db.add(
        AuditLog(
            table_name="restaurant_location",
            record_id=loc_id,
            action="create",
            actor_id=str(uuid.uuid4()),
            actor_role="admin",
            new_val=new_val or None,
        )
    )


async def _setup_mark(db):
    """imported+unclaimed+coming_soon (target), manual coming_soon (no
    provenance), imported but CLAIMED, imported but already active, imported
    unclaimed in a soft-deleted brand."""
    from datetime import datetime, timezone

    owner = await create_owner(db)
    out = {}
    b = await create_brand(db, name="Imported Unclaimed")
    out["target"] = await create_location(db, brand_id=b.id, status="coming_soon")
    await _audit_create(db, out["target"].id, provenance="bulk_import", status="coming_soon")

    b = await create_brand(db, name="Manual Listing")
    out["manual"] = await create_location(db, brand_id=b.id, status="coming_soon")
    await _audit_create(db, out["manual"].id, status="coming_soon")

    b = await create_brand(db, name="Imported Claimed", owner_id=owner.id, is_claimed=True)
    out["claimed"] = await create_location(db, brand_id=b.id, status="coming_soon")
    await _audit_create(db, out["claimed"].id, provenance="bulk_import")

    b = await create_brand(db, name="Imported Active")
    out["active"] = await create_location(db, brand_id=b.id, status="active")
    await _audit_create(db, out["active"].id, provenance="bulk_import")

    b = await create_brand(db, name="Imported Deleted", deleted_at=datetime.now(timezone.utc))
    out["deleted"] = await create_location(db, brand_id=b.id, status="coming_soon")
    await _audit_create(db, out["deleted"].id, provenance="bulk_import")
    await db.commit()
    return out


async def _statuses(db) -> dict[int, str]:
    rows = (await db.execute(select(RestaurantLocation.id, RestaurantLocation.status))).all()
    return {i: s for i, s in rows}


def test_command_is_registered():
    assert "mark_imported_for_review" in _COMMANDS


@pytest.mark.asyncio
async def test_dry_run_is_default_and_changes_nothing(db_session):
    locs = await _setup_mark(db_session)
    before = await _statuses(db_session)
    audits_before = len((await db_session.execute(select(AuditLog))).scalars().all())

    report = await mark_imported_for_review(db_session)

    assert report["mode"] == "dry_run" and report["changed"] == 0 and report["matched"] == 1
    assert [item["location_id"] for item in report["listings"]] == [locs["target"].id]
    assert await _statuses(db_session) == before
    assert len((await db_session.execute(select(AuditLog))).scalars().all()) == audits_before


@pytest.mark.asyncio
async def test_apply_flags_only_imported_unclaimed_coming_soon_with_audit(db_session):
    locs = await _setup_mark(db_session)

    report = await mark_imported_for_review(db_session, apply=True)

    assert report["mode"] == "apply" and report["changed"] == 1
    statuses = await _statuses(db_session)
    assert statuses[locs["target"].id] == "import_review"
    assert statuses[locs["manual"].id] == "coming_soon"  # no bulk_import provenance
    assert statuses[locs["claimed"].id] == "coming_soon"  # has an owner
    assert statuses[locs["active"].id] == "active"
    assert statuses[locs["deleted"].id] == "coming_soon"  # soft-deleted brand

    audits = (
        (
            await db_session.execute(
                select(AuditLog).where(AuditLog.actor_id == "system:mark_imported_for_review")
            )
        )
        .scalars()
        .all()
    )
    assert len(audits) == 1
    a = audits[0]
    assert a.record_id == locs["target"].id and a.table_name == "restaurant_location"
    assert a.action == "update"
    assert a.old_val == {"status": "coming_soon"} and a.new_val == {"status": "import_review"}


@pytest.mark.asyncio
async def test_apply_is_idempotent(db_session):
    await _setup_mark(db_session)
    await mark_imported_for_review(db_session, apply=True)
    count = len((await db_session.execute(select(AuditLog))).scalars().all())

    again = await mark_imported_for_review(db_session, apply=True)

    assert again["matched"] == 0 and again["changed"] == 0
    assert len((await db_session.execute(select(AuditLog))).scalars().all()) == count


@pytest.mark.asyncio
async def test_location_ids_limits_the_run(db_session):
    locs = await _setup_mark(db_session)
    b = await create_brand(db_session, name="Second Import")
    second = await create_location(db_session, brand_id=b.id, status="coming_soon")
    await _audit_create(db_session, second.id, provenance="bulk_import")
    await db_session.commit()

    ids = sorted([second.id, locs["manual"].id])
    report = await mark_imported_for_review(db_session, apply=True, location_ids=ids)

    assert report["location_ids"] == ids
    assert report["changed"] == 1
    statuses = await _statuses(db_session)
    assert statuses[second.id] == "import_review"
    assert statuses[locs["target"].id] == "coming_soon"  # eligible but not named
    assert statuses[locs["manual"].id] == "coming_soon"  # named but not imported


def test_flags_and_ids_are_strictly_validated():
    assert parse_flag({}, "apply") is False and parse_flag({"apply": True}, "apply") is True
    for bad in ("true", "false", 1, None):
        with pytest.raises(MarkImportedError):
            parse_flag({"apply": bad}, "apply")
    assert parse_location_ids({"location_ids": [3, 1, 3]}) == [1, 3]
    for bad in ([], "67", [True], [0], ["1"]):
        with pytest.raises(MarkImportedError):
            parse_location_ids({"location_ids": bad})


def test_management_wrapper_rejects_bad_input_without_touching_the_db():
    out = run_management_command({"_management_command": "mark_imported_for_review", "apply": "false"}, None)
    assert out["ok"] is False and "'apply' must be true or false" in out["error"]
    out = run_management_command({"_management_command": "mark_imported_for_review", "location_ids": "67"}, None)
    assert out["ok"] is False and "location_ids" in out["error"]

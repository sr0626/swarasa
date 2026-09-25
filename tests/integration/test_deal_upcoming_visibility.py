"""Integration tests: `GET /locations/{id}` -> `upcoming_deals` (the
location's OTHER active deals — not applicable today, not expired), added
2026-09-23 after owner feedback.

Same content gate as `deals_today` (`deal_service.
caller_may_view_deal_content_for_location`): since 2026-09-25 ANY signed-in
caller (registered_user, admin, any owner incl. another brand's, any manager
incl. unassigned) gets an array (possibly empty); only anonymous callers get
`null` — never `[]`, never a count, never a title anywhere in the response
body.

Dates are built relative to the real "now" in the location's timezone
(America/Chicago via LocationFactory) so the tests hold on any weekday.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

import app.main as app_main
from app.dependencies.auth import CurrentUser, get_current_user_optional
from factories import create_brand, create_deal, create_location, create_location_manager, create_owner

_TZ = ZoneInfo("America/Chicago")


def _as_optional_user(role: str, *, sub: str | None = None, email: str | None = None) -> CurrentUser:
    user = CurrentUser(
        cognito_sub=sub or str(uuid.uuid4()),
        email=email if email is not None else f"{uuid.uuid4().hex[:10]}@example.com",
        role=role,
    )

    async def _override():
        return user

    app_main.app.dependency_overrides[get_current_user_optional] = _override
    return user


def _today_weekday() -> int:
    return datetime.now(_TZ).weekday()


def _other_weekday(offset: int = 1) -> int:
    return (_today_weekday() + offset) % 7


async def _seed(db_session):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id)
    location = await create_location(db_session, brand_id=brand.id)
    return owner, location


@pytest.mark.asyncio
async def test_anonymous_gets_null_and_no_leak(client, db_session, as_anonymous):
    _, location = await _seed(db_session)
    await create_deal(
        db_session, location_id=location.id, title="Secret Later Deal", applicable_days=[_other_weekday()]
    )
    await db_session.commit()

    response = await client.get(f"/locations/{location.id}")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["upcoming_deals"] is None
    assert body["deals_today"] is None
    assert body["has_deal_today"] is False  # existing signal unchanged
    assert "Secret Later Deal" not in response.text


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["registered_user", "admin"])
async def test_registered_user_and_admin_get_array(client, db_session, role):
    _, location = await _seed(db_session)
    await create_deal(
        db_session,
        location_id=location.id,
        title="Weekend Brunch",
        description="Bottomless chai",
        applicable_days=[_other_weekday()],
    )
    await db_session.commit()

    _as_optional_user(role)
    response = await client.get(f"/locations/{location.id}")
    assert response.status_code == 200, response.text
    body = response.json()
    assert [d["title"] for d in body["upcoming_deals"]] == ["Weekend Brunch"]
    deal = body["upcoming_deals"][0]
    assert deal["description"] == "Bottomless chai"
    assert deal["applicable_days"] == [_other_weekday()]
    assert deal["deal_type"] == "special"  # end_at NULL -> derived special
    assert deal["next_occurrence"]  # ISO date
    assert "start_at" in deal and "end_at" in deal
    # Not a management view: no is_active / location_id leak.
    assert "is_active" not in deal and "location_id" not in deal


@pytest.mark.asyncio
async def test_registered_user_gets_empty_array_when_nothing_else(client, db_session):
    _, location = await _seed(db_session)
    await db_session.commit()
    _as_optional_user("registered_user")
    body = (await client.get(f"/locations/{location.id}")).json()
    assert body["upcoming_deals"] == []


@pytest.mark.asyncio
async def test_owner_and_assigned_manager_get_array(client, db_session):
    owner, location = await _seed(db_session)
    manager_sub = str(uuid.uuid4())
    await create_location_manager(db_session, location_id=location.id, user_id=manager_sub, is_active=True)
    await create_deal(db_session, location_id=location.id, title="Later", applicable_days=[_other_weekday()])
    await db_session.commit()

    _as_optional_user("owner", sub=owner.cognito_sub, email=owner.email)
    assert [d["title"] for d in (await client.get(f"/locations/{location.id}")).json()["upcoming_deals"]] == ["Later"]

    _as_optional_user("manager", sub=manager_sub)
    assert [d["title"] for d in (await client.get(f"/locations/{location.id}")).json()["upcoming_deals"]] == ["Later"]


@pytest.mark.asyncio
async def test_other_owner_and_unassigned_manager_now_get_the_list(client, db_session):
    _, location = await _seed(db_session)
    other_owner = await create_owner(db_session)
    await create_deal(db_session, location_id=location.id, title="Nope", applicable_days=[_other_weekday()])
    await db_session.commit()

    _as_optional_user("owner", sub=other_owner.cognito_sub, email=other_owner.email)
    response = await client.get(f"/locations/{location.id}")
    assert [d["title"] for d in response.json()["upcoming_deals"]] == ["Nope"]

    _as_optional_user("manager", sub=str(uuid.uuid4()))
    response = await client.get(f"/locations/{location.id}")
    assert [d["title"] for d in response.json()["upcoming_deals"]] == ["Nope"]


@pytest.mark.asyncio
async def test_excludes_todays_inactive_and_expired_and_sorts_soonest_first(client, db_session):
    _, location = await _seed(db_session)
    now = datetime.now(timezone.utc)
    lid = location.id
    await create_deal(db_session, location_id=lid, title="Today daily")  # applies today -> not "other"
    await create_deal(db_session, location_id=lid, title="Today weekday", applicable_days=[_today_weekday()])
    await create_deal(
        db_session, location_id=lid, title="Inactive later", applicable_days=[_other_weekday()], is_active=False
    )
    await create_deal(
        db_session, location_id=lid, title="Expired", end_at=now - timedelta(days=2), applicable_days=[_other_weekday()]
    )
    await create_deal(db_session, location_id=lid, title="In three days", applicable_days=[_other_weekday(3)])
    await create_deal(db_session, location_id=lid, title="Tomorrow", applicable_days=[_other_weekday(1)])
    await create_deal(db_session, location_id=lid, title="Grand opening", start_at=now + timedelta(days=30))
    await db_session.commit()

    _as_optional_user("registered_user")
    body = (await client.get(f"/locations/{lid}")).json()
    titles = [d["title"] for d in body["upcoming_deals"]]
    assert titles == ["Tomorrow", "In three days", "Grand opening"]
    assert {d["title"] for d in body["deals_today"]} == {"Today daily", "Today weekday"}
    dates = [d["next_occurrence"] for d in body["upcoming_deals"]]
    assert dates == sorted(dates)


@pytest.mark.asyncio
async def test_upcoming_field_costs_no_extra_deal_queries(client, db_session):
    """N+1 guard: the deal table is read exactly once per location detail
    request no matter how many deals exist (today's + upcoming share one
    query)."""
    from sqlalchemy import event

    _, location = await _seed(db_session)
    for i in range(5):
        await create_deal(db_session, location_id=location.id, title=f"D{i}", applicable_days=[_other_weekday(i + 1)])
    await db_session.commit()

    statements: list[str] = []
    engine = db_session.bind.sync_engine

    def _capture(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", _capture)
    try:
        _as_optional_user("registered_user")
        response = await client.get(f"/locations/{location.id}")
    finally:
        event.remove(engine, "before_cursor_execute", _capture)
    assert response.status_code == 200, response.text
    deal_selects = [s for s in statements if "FROM deal" in s]
    assert len(deal_selects) == 1, deal_selects

"""Integration tests: in-app deal alerts (the bell) — `deal_service.create_deal`
fans a `deal_new` `user_notification` out to every follower of the location's
BRAND (follows are brand-level), and `GET /notifications`,
`POST /notifications/{id}/read`, `POST /notifications/read-all` expose them to
registered users only, own rows only. See docs/API_CONTRACTS.md "Notifications".
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import func, select

from app.models.user_notification import UserNotification
from app.services import notification_service

from factories import (
    create_brand,
    create_deal,
    create_follow,
    create_location,
    create_notification,
    create_owner,
)

_DATES = {"start_at": "2027-01-01T00:00:00Z", "end_at": "2099-02-01T00:00:00Z"}


async def _setup(db_session):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id)
    location = await create_location(db_session, brand_id=brand.id)
    await db_session.commit()
    return owner, brand, location


async def _rows(db_session, **filters):
    stmt = select(UserNotification)
    for key, value in filters.items():
        stmt = stmt.where(getattr(UserNotification, key) == value)
    return (await db_session.execute(stmt)).scalars().all()


# ---------------------------------------------------------------------------
# Fan-out
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_new_deal_notifies_every_brand_follower_but_not_others(client, db_session, as_user):
    owner, brand, location = await _setup(db_session)
    other_brand = await create_brand(db_session)
    follower_a, follower_b, stranger = (str(uuid.uuid4()) for _ in range(3))
    await create_follow(db_session, user_id=follower_a, brand_id=brand.id)
    await create_follow(db_session, user_id=follower_b, brand_id=brand.id)
    await create_follow(db_session, user_id=stranger, brand_id=other_brand.id)
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    response = await client.post(
        f"/locations/{location.id}/deals", json={**_DATES, "title": "Buy 1 Get 1"}
    )
    assert response.status_code == 201, response.text
    deal_id = response.json()["id"]

    rows = await _rows(db_session)
    assert {r.user_sub for r in rows} == {follower_a, follower_b}
    for row in rows:
        assert row.kind == "deal_new"
        assert row.location_id == location.id
        assert row.deal_id == deal_id
        assert row.title == "Buy 1 Get 1"
        assert row.read_at is None


@pytest.mark.asyncio
async def test_actor_is_never_notified(client, db_session, as_user):
    owner, brand, location = await _setup(db_session)
    other = str(uuid.uuid4())
    # Contrived (owners cannot follow via the API) but pins the exclusion.
    await create_follow(db_session, user_id=owner.cognito_sub, brand_id=brand.id)
    await create_follow(db_session, user_id=other, brand_id=brand.id)
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    response = await client.post(f"/locations/{location.id}/deals", json={**_DATES, "title": "X"})
    assert response.status_code == 201, response.text
    assert {r.user_sub for r in await _rows(db_session)} == {other}


@pytest.mark.asyncio
async def test_no_notification_when_deals_hidden(client, db_session, as_user):
    owner, brand, _ = await _setup(db_session)
    location = await create_location(db_session, brand_id=brand.id, deals_hidden=True)
    await create_follow(db_session, user_id=str(uuid.uuid4()), brand_id=brand.id)
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    response = await client.post(f"/locations/{location.id}/deals", json={**_DATES, "title": "X"})
    assert response.status_code == 201, response.text
    assert await _rows(db_session) == []


@pytest.mark.asyncio
async def test_no_notification_for_inactive_deal(client, db_session, as_user):
    owner, brand, location = await _setup(db_session)
    await create_follow(db_session, user_id=str(uuid.uuid4()), brand_id=brand.id)
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    response = await client.post(
        f"/locations/{location.id}/deals", json={**_DATES, "title": "X", "is_active": False}
    )
    assert response.status_code == 201, response.text
    assert await _rows(db_session) == []


@pytest.mark.asyncio
async def test_no_notification_when_location_not_publicly_active(client, db_session, as_user):
    owner, brand, _ = await _setup(db_session)
    location = await create_location(db_session, brand_id=brand.id, status="coming_soon")
    await create_follow(db_session, user_id=str(uuid.uuid4()), brand_id=brand.id)
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    response = await client.post(f"/locations/{location.id}/deals", json={**_DATES, "title": "X"})
    assert response.status_code == 201, response.text
    assert await _rows(db_session) == []


@pytest.mark.asyncio
async def test_manager_created_deal_also_notifies(client, db_session, as_user):
    from factories import create_location_manager

    owner, brand, location = await _setup(db_session)
    manager_sub = str(uuid.uuid4())
    await create_location_manager(db_session, location_id=location.id, user_id=manager_sub, is_active=True)
    follower = str(uuid.uuid4())
    await create_follow(db_session, user_id=follower, brand_id=brand.id)
    await db_session.commit()

    as_user("manager", sub=manager_sub)
    response = await client.post(f"/locations/{location.id}/deals", json={**_DATES, "title": "Lunch"})
    assert response.status_code == 201, response.text
    assert {r.user_sub for r in await _rows(db_session)} == {follower}


@pytest.mark.asyncio
async def test_fanout_is_capped(client, db_session, as_user, monkeypatch):
    monkeypatch.setattr(notification_service, "MAX_FANOUT_PER_DEAL", 2)
    owner, brand, location = await _setup(db_session)
    for _ in range(4):
        await create_follow(db_session, user_id=str(uuid.uuid4()), brand_id=brand.id)
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    response = await client.post(f"/locations/{location.id}/deals", json={**_DATES, "title": "X"})
    assert response.status_code == 201, response.text
    count = (await db_session.execute(select(func.count()).select_from(UserNotification))).scalar_one()
    assert count == 2


@pytest.mark.asyncio
async def test_fanout_failure_never_blocks_deal_creation(client, db_session, as_user, monkeypatch):
    owner, brand, location = await _setup(db_session)
    await create_follow(db_session, user_id=str(uuid.uuid4()), brand_id=brand.id)
    await db_session.commit()

    def _boom(*args, **kwargs):
        raise RuntimeError("insert exploded")

    monkeypatch.setattr(notification_service, "insert", _boom)

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    response = await client.post(f"/locations/{location.id}/deals", json={**_DATES, "title": "X"})
    assert response.status_code == 201, response.text
    assert await _rows(db_session) == []


# ---------------------------------------------------------------------------
# GET /notifications
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_returns_own_newest_first_with_unread_count(client, db_session, as_user):
    _, brand, location = await _setup(db_session)
    me = str(uuid.uuid4())
    first = await create_notification(db_session, user_sub=me, location_id=location.id, title="First")
    second = await create_notification(db_session, user_sub=me, location_id=location.id, title="Second")
    await create_notification(db_session, user_sub=str(uuid.uuid4()), location_id=location.id)
    await db_session.commit()

    as_user("registered_user", sub=me)
    response = await client.get("/notifications")
    assert response.status_code == 200, response.text
    body = response.json()
    assert [n["id"] for n in body["results"]] == [second.id, first.id]
    assert body["total"] == 2
    assert body["unread_count"] == 2
    item = body["results"][0]
    assert item["brand_slug"] == brand.slug
    assert item["location_slug"] == location.slug
    assert item["restaurant_name"] == (location.location_name or brand.name)
    assert item["read_at"] is None


@pytest.mark.asyncio
async def test_list_paginates_but_unread_count_spans_all_pages(client, db_session, as_user):
    _, _, location = await _setup(db_session)
    me = str(uuid.uuid4())
    for i in range(3):
        await create_notification(db_session, user_sub=me, location_id=location.id, title=f"n{i}")
    await db_session.commit()

    as_user("registered_user", sub=me)
    body = (await client.get("/notifications?page=1&page_size=2")).json()
    assert len(body["results"]) == 2
    assert body["total"] == 3
    assert body["unread_count"] == 3


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["owner", "manager", "admin"])
async def test_non_registered_roles_are_forbidden(client, db_session, as_user, role):
    as_user(role)
    for method, path in (
        ("GET", "/notifications"),
        ("POST", "/notifications/read-all"),
        ("POST", "/notifications/1/read"),
    ):
        response = await client.request(method, path)
        assert response.status_code == 403, (method, path, response.text)


@pytest.mark.asyncio
async def test_anonymous_is_unauthorized(client, db_session, as_anonymous):
    assert (await client.get("/notifications")).status_code == 401


# ---------------------------------------------------------------------------
# Mark read
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_mark_one_read_is_idempotent_and_updates_unread_count(client, db_session, as_user):
    _, _, location = await _setup(db_session)
    me = str(uuid.uuid4())
    target = await create_notification(db_session, user_sub=me, location_id=location.id)
    await create_notification(db_session, user_sub=me, location_id=location.id)
    await db_session.commit()

    as_user("registered_user", sub=me)
    assert (await client.post(f"/notifications/{target.id}/read")).status_code == 204
    assert (await client.post(f"/notifications/{target.id}/read")).status_code == 204
    body = (await client.get("/notifications")).json()
    assert body["unread_count"] == 1
    read = next(n for n in body["results"] if n["id"] == target.id)
    assert read["read_at"] is not None


@pytest.mark.asyncio
async def test_cannot_mark_another_users_notification(client, db_session, as_user):
    _, _, location = await _setup(db_session)
    victim = str(uuid.uuid4())
    theirs = await create_notification(db_session, user_sub=victim, location_id=location.id)
    await db_session.commit()
    theirs_id = theirs.id

    as_user("registered_user")
    response = await client.post(f"/notifications/{theirs_id}/read")
    assert response.status_code == 404
    assert response.json()["code"] == "not_found"
    db_session.expire_all()
    assert (await db_session.get(UserNotification, theirs_id)).read_at is None


@pytest.mark.asyncio
async def test_unknown_notification_is_404(client, db_session, as_user):
    as_user("registered_user")
    assert (await client.post("/notifications/999999/read")).status_code == 404


@pytest.mark.asyncio
async def test_read_all_marks_only_my_unread(client, db_session, as_user):
    _, _, location = await _setup(db_session)
    me, other = str(uuid.uuid4()), str(uuid.uuid4())
    await create_notification(db_session, user_sub=me, location_id=location.id)
    await create_notification(db_session, user_sub=me, location_id=location.id)
    theirs = await create_notification(db_session, user_sub=other, location_id=location.id)
    await db_session.commit()
    theirs_id = theirs.id

    as_user("registered_user", sub=me)
    response = await client.post("/notifications/read-all")
    assert response.status_code == 200, response.text
    assert response.json() == {"marked_read": 2}
    assert (await client.get("/notifications")).json()["unread_count"] == 0
    db_session.expire_all()
    assert (await db_session.get(UserNotification, theirs_id)).read_at is None


# ---------------------------------------------------------------------------
# Cascades
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_deleting_the_deal_retracts_its_alerts(client, db_session, as_user):
    owner, brand, location = await _setup(db_session)
    await create_follow(db_session, user_id=str(uuid.uuid4()), brand_id=brand.id)
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    deal_id = (
        await client.post(f"/locations/{location.id}/deals", json={**_DATES, "title": "Oops"})
    ).json()["id"]
    assert len(await _rows(db_session)) == 1

    response = await client.delete(f"/locations/{location.id}/deals/{deal_id}")
    assert response.status_code == 204, response.text
    db_session.expire_all()
    assert await _rows(db_session) == []

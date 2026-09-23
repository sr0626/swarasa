"""Integration tests: registered-user activity tracking (searches +
restaurant-tile clicks) — recording rules, retention, the admin per-user
activity endpoint, and CCPA export/deletion coverage.

docs/API_CONTRACTS.md "Activity tracking (`/activity`)",
docs/DECISIONS.md "Registered-user activity tracking (searches + tile
clicks)".

`GET /search` needs PostGIS (see tests/integration/test_search_api.py), so
`search_service.search` is stubbed here — what is under test is the
recording wrapped around it, not the geo query. Identity for `/search` goes
through `get_current_user_lenient`, overridden per-test; the real JWT path
(including a stale/invalid token) is covered by the two `real_jwt` tests.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from sqlalchemy import func, select

import app.main as app_main
from app.dependencies import auth as auth_deps
from app.dependencies.auth import CurrentUser, get_current_user_lenient
from app.models.user_activity_event import UserActivityEvent
from app.services import activity_service, search_service
from factories import (
    create_activity_event,
    create_brand,
    create_location,
    create_deletion_request,
)


@pytest.fixture(autouse=True)
def _reset_purge_throttle():
    activity_service._last_purge_monotonic = None
    yield
    activity_service._last_purge_monotonic = None


@pytest.fixture
def stub_search(monkeypatch):
    async def _fake_search(db, lat, lng, radius, cuisine, dietary, type_, pagination, q=None, has_deals_today=None):
        return [], 7

    monkeypatch.setattr(search_service, "search", _fake_search)


@pytest.fixture
def as_search_caller(client):
    def _set(role: str | None, *, sub: str | None = None) -> str | None:
        if role is None:
            app_main.app.dependency_overrides[get_current_user_lenient] = lambda: None
            return None
        user = CurrentUser(
            cognito_sub=sub or str(uuid.uuid4()), email="u@example.com", role=role
        )

        async def _override():
            return user

        app_main.app.dependency_overrides[get_current_user_lenient] = _override
        return user.cognito_sub

    return _set


async def _events(db_session, sub: str | None = None) -> list[UserActivityEvent]:
    stmt = select(UserActivityEvent).order_by(UserActivityEvent.id)
    if sub is not None:
        stmt = stmt.where(UserActivityEvent.user_sub == sub)
    return list((await db_session.execute(stmt)).scalars().all())


def _ago(**kwargs) -> datetime:
    return datetime.now(timezone.utc) - timedelta(**kwargs)


# ---------------------------------------------------------------------------
# Recording — GET /search
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_registered_user_search_is_recorded(client, db_session, stub_search, as_search_caller):
    sub = as_search_caller("registered_user")

    resp = await client.get(
        "/search",
        params={
            "q": "biryani",
            "cuisine[]": ["hyderabadi", "south_indian"],
            "dietary[]": ["vegetarian"],
            "loc": "Irving, TX",
            "has_deals_today": "true",
        },
    )
    assert resp.status_code == 200, resp.text

    rows = await _events(db_session, sub)
    assert len(rows) == 1
    assert rows[0].event_type == "search"
    assert rows[0].payload == {
        "q": "biryani",
        "cuisine": ["hyderabadi", "south_indian"],
        "dietary": ["vegetarian"],
        "loc": "Irving, TX",
        "has_deals_today": True,
        "result_count": 7,
    }


@pytest.mark.asyncio
async def test_anonymous_search_records_nothing(client, db_session, stub_search, as_search_caller):
    as_search_caller(None)
    resp = await client.get("/search", params={"q": "biryani"})
    assert resp.status_code == 200
    assert await _events(db_session) == []


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["owner", "manager", "admin"])
async def test_non_registered_roles_record_nothing(client, db_session, stub_search, as_search_caller, role):
    as_search_caller(role)
    resp = await client.get("/search", params={"q": "biryani"})
    assert resp.status_code == 200
    assert await _events(db_session) == []


@pytest.mark.asyncio
async def test_only_first_page_is_recorded(client, db_session, stub_search, as_search_caller):
    sub = as_search_caller("registered_user")
    assert (await client.get("/search", params={"q": "dosa", "page": 1})).status_code == 200
    assert (await client.get("/search", params={"q": "dosa", "page": 2})).status_code == 200
    assert len(await _events(db_session, sub)) == 1


@pytest.mark.asyncio
async def test_search_with_no_criteria_records_nothing(client, db_session, stub_search, as_search_caller):
    as_search_caller("registered_user")
    assert (await client.get("/search")).status_code == 200
    assert await _events(db_session) == []


@pytest.mark.asyncio
async def test_search_still_succeeds_when_recording_fails(
    client, db_session, stub_search, as_search_caller, monkeypatch
):
    as_search_caller("registered_user")

    async def _boom(*args, **kwargs):
        raise RuntimeError("db exploded")

    monkeypatch.setattr(activity_service, "_insert_event", _boom)

    resp = await client.get("/search", params={"q": "biryani"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["total"] == 7
    assert await _events(db_session) == []


def test_payload_is_truncated_and_bounded():
    payload = activity_service.build_search_payload(
        q="x" * 500,
        cuisine=[f"tag{i}" + "y" * 200 for i in range(40)],
        dietary=None,
        type_=["  ", "ok\x00tag"],
        loc="  Irving\n\tTX  " + "z" * 300,
        has_deals_today=None,
        result_count=-5,
    )
    assert payload is not None
    assert len(payload["q"]) == activity_service.MAX_QUERY_LEN
    assert len(payload["cuisine"]) == activity_service.MAX_TAGS
    assert all(len(t) <= activity_service.MAX_TAG_LEN for t in payload["cuisine"])
    assert payload["type"] == ["ok tag"]  # blank dropped, control char neutralised
    assert "dietary" not in payload
    assert len(payload["loc"]) == activity_service.MAX_LOCATION_TEXT_LEN
    assert payload["loc"].startswith("Irving TX")  # whitespace collapsed
    assert payload["result_count"] == 0  # clamped


def test_empty_search_builds_no_payload():
    assert (
        activity_service.build_search_payload(
            q="  ", cuisine=[], dietary=None, type_=None, loc="", has_deals_today=False, result_count=3
        )
        is None
    )


# ---------------------------------------------------------------------------
# Real JWT path (lenient dependency)
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def rsa_keypair():
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return private_key, private_key.public_key()


class _FakeSigningKey:
    def __init__(self, key):
        self.key = key


class _FakeJWKClient:
    def __init__(self, public_key):
        self._public_key = public_key

    def get_signing_key_from_jwt(self, token):
        return _FakeSigningKey(self._public_key)


def _issue_token(private_key, *, sub: str, groups: list[str]) -> str:
    issuer = f"https://cognito-idp.{auth_deps._region()}.amazonaws.com/{auth_deps._user_pool_id()}"
    claims = {
        "sub": sub,
        "iss": issuer,
        "token_use": "id",
        "email": "diner@example.com",
        "cognito:groups": groups,
    }
    return jwt.encode(claims, private_key, algorithm="RS256")


@pytest.mark.asyncio
async def test_real_jwt_registered_user_search_recorded(
    client, db_session, stub_search, rsa_keypair, monkeypatch
):
    private_key, public_key = rsa_keypair
    monkeypatch.setattr(auth_deps, "_get_jwk_client", lambda: _FakeJWKClient(public_key))
    sub = str(uuid.uuid4())
    token = _issue_token(private_key, sub=sub, groups=["registered_user"])

    resp = await client.get(
        "/search", params={"q": "chaat"}, headers={"Authorization": f"Bearer {token}"}
    )
    assert resp.status_code == 200, resp.text
    rows = await _events(db_session, sub)
    assert len(rows) == 1 and rows[0].payload["q"] == "chaat"


@pytest.mark.asyncio
async def test_invalid_token_does_not_break_public_search(client, db_session, stub_search, monkeypatch):
    class _BadJWKClient:
        def get_signing_key_from_jwt(self, token):
            raise jwt.PyJWTError("bad token")

    monkeypatch.setattr(auth_deps, "_get_jwk_client", lambda: _BadJWKClient())
    resp = await client.get(
        "/search", params={"q": "chaat"}, headers={"Authorization": "Bearer not-a-real-token"}
    )
    assert resp.status_code == 200, resp.text
    assert await _events(db_session) == []


# ---------------------------------------------------------------------------
# Recording — POST /activity/tile-click
# ---------------------------------------------------------------------------


async def _brand_and_location(db_session):
    brand = await create_brand(db_session)
    location = await create_location(db_session, brand_id=brand.id)
    await db_session.commit()
    return brand, location


@pytest.mark.asyncio
async def test_tile_click_recorded_for_registered_user(client, db_session, as_user):
    brand, location = await _brand_and_location(db_session)
    user = as_user("registered_user")

    resp = await client.post(
        "/activity/tile-click",
        json={"brand_id": brand.id, "location_id": location.id, "source": "search_results"},
    )
    assert resp.status_code == 204, resp.text

    rows = await _events(db_session, user.cognito_sub)
    assert len(rows) == 1
    assert rows[0].event_type == "tile_click"
    assert rows[0].payload == {
        "brand_id": brand.id,
        "location_id": location.id,
        "source": "search_results",
    }


@pytest.mark.asyncio
async def test_tile_click_location_is_optional(client, db_session, as_user):
    brand, _ = await _brand_and_location(db_session)
    user = as_user("registered_user")
    resp = await client.post(
        "/activity/tile-click", json={"brand_id": brand.id, "source": "favourites"}
    )
    assert resp.status_code == 204
    rows = await _events(db_session, user.cognito_sub)
    assert rows[0].payload["location_id"] is None


@pytest.mark.asyncio
async def test_tile_click_requires_auth(client, db_session, as_anonymous):
    resp = await client.post("/activity/tile-click", json={"brand_id": 1, "source": "homepage"})
    assert resp.status_code == 401
    assert await _events(db_session) == []


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["owner", "manager", "admin"])
async def test_tile_click_forbidden_for_other_roles(client, db_session, as_user, role):
    brand, _ = await _brand_and_location(db_session)
    as_user(role)
    resp = await client.post(
        "/activity/tile-click", json={"brand_id": brand.id, "source": "homepage"}
    )
    assert resp.status_code == 403
    assert await _events(db_session) == []


@pytest.mark.asyncio
async def test_tile_click_validates_brand_location_and_source(client, db_session, as_user):
    brand, location = await _brand_and_location(db_session)
    other_brand = await create_brand(db_session)
    await db_session.commit()
    as_user("registered_user")

    unknown_brand = await client.post(
        "/activity/tile-click", json={"brand_id": 999999, "source": "homepage"}
    )
    assert unknown_brand.status_code == 404

    unknown_location = await client.post(
        "/activity/tile-click",
        json={"brand_id": brand.id, "location_id": 999999, "source": "homepage"},
    )
    assert unknown_location.status_code == 404

    # A real location, but not this brand's.
    mismatched = await client.post(
        "/activity/tile-click",
        json={"brand_id": other_brand.id, "location_id": location.id, "source": "homepage"},
    )
    assert mismatched.status_code == 404

    bad_source = await client.post(
        "/activity/tile-click", json={"brand_id": brand.id, "source": "; DROP TABLE users"}
    )
    assert bad_source.status_code == 422

    assert await _events(db_session) == []


@pytest.mark.asyncio
async def test_tile_click_returns_204_even_when_write_fails(client, db_session, as_user, monkeypatch):
    brand, _ = await _brand_and_location(db_session)
    as_user("registered_user")

    async def _boom(*args, **kwargs):
        raise RuntimeError("db exploded")

    monkeypatch.setattr(activity_service, "_insert_event", _boom)
    resp = await client.post(
        "/activity/tile-click", json={"brand_id": brand.id, "source": "homepage"}
    )
    assert resp.status_code == 204
    assert await _events(db_session) == []


# ---------------------------------------------------------------------------
# Retention
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_purge_expired_deletes_only_rows_past_retention(db_session):
    sub = str(uuid.uuid4())
    expired = await create_activity_event(
        db_session, user_sub=sub, created_at=_ago(days=activity_service.ACTIVITY_RETENTION_DAYS + 5)
    )
    fresh = await create_activity_event(
        db_session, user_sub=sub, created_at=_ago(days=activity_service.ACTIVITY_RETENTION_DAYS - 5)
    )
    await db_session.commit()
    expired_id, fresh_id = expired.id, fresh.id

    deleted = await activity_service.purge_expired(db_session)
    assert deleted == 1

    remaining_ids = {e.id for e in await _events(db_session)}
    assert remaining_ids == {fresh_id}
    assert expired_id not in remaining_ids


@pytest.mark.asyncio
async def test_write_triggers_throttled_global_purge(client, db_session, stub_search, as_search_caller):
    """Opportunistic purge: a registered user's write ages out ANOTHER
    user's expired rows, and only runs once per throttle interval."""
    stale_owner = str(uuid.uuid4())
    await create_activity_event(
        db_session,
        user_sub=stale_owner,
        created_at=_ago(days=activity_service.ACTIVITY_RETENTION_DAYS + 30),
    )
    await db_session.commit()

    as_search_caller("registered_user")
    assert (await client.get("/search", params={"q": "dosa"})).status_code == 200
    assert await _events(db_session, stale_owner) == []

    # Second expired row added after the first purge: the throttle (1h)
    # must keep the next write from purging again.
    await create_activity_event(
        db_session,
        user_sub=stale_owner,
        created_at=_ago(days=activity_service.ACTIVITY_RETENTION_DAYS + 30),
    )
    await db_session.commit()
    assert (await client.get("/search", params={"q": "idli"})).status_code == 200
    assert len(await _events(db_session, stale_owner)) == 1


# ---------------------------------------------------------------------------
# Admin: GET /admin/registered-users/{user_sub}/activity
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_admin_activity_requires_admin(client, db_session, as_user, as_anonymous):
    sub = str(uuid.uuid4())
    assert (await client.get(f"/admin/registered-users/{sub}/activity")).status_code == 401
    for role in ("owner", "manager", "registered_user"):
        as_user(role)
        assert (await client.get(f"/admin/registered-users/{sub}/activity")).status_code == 403


@pytest.mark.asyncio
async def test_admin_activity_newest_first_with_names_and_isolation(client, db_session, as_user):
    brand = await create_brand(db_session, name="Spice Route")
    location = await create_location(
        db_session, brand_id=brand.id, address_line1="4900 W Park Blvd", city="Plano"
    )
    sub, other_sub = str(uuid.uuid4()), str(uuid.uuid4())
    await create_activity_event(
        db_session, user_sub=sub, created_at=_ago(hours=3), payload={"q": "oldest", "result_count": 1}
    )
    await create_activity_event(
        db_session,
        user_sub=sub,
        event_type="tile_click",
        created_at=_ago(hours=2),
        payload={"brand_id": brand.id, "location_id": location.id, "source": "homepage"},
    )
    await create_activity_event(
        db_session, user_sub=sub, created_at=_ago(hours=1), payload={"q": "newest", "result_count": 2}
    )
    await create_activity_event(db_session, user_sub=other_sub, payload={"q": "someone else"})
    await db_session.commit()

    as_user("admin")
    resp = await client.get(f"/admin/registered-users/{sub}/activity")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] == 3
    assert body["retention_days"] == activity_service.ACTIVITY_RETENTION_DAYS
    assert [e["event_type"] for e in body["results"]] == ["search", "tile_click", "search"]
    assert [e["payload"].get("q") for e in body["results"]] == ["newest", None, "oldest"]
    click = body["results"][1]
    assert click["brand_name"] == "Spice Route"
    assert click["location_label"] == "4900 W Park Blvd, Plano"

    only_clicks = (
        await client.get(f"/admin/registered-users/{sub}/activity", params={"event_type": "tile_click"})
    ).json()
    assert only_clicks["total"] == 1

    bad_type = await client.get(
        f"/admin/registered-users/{sub}/activity", params={"event_type": "nope"}
    )
    assert bad_type.status_code == 422


@pytest.mark.asyncio
async def test_admin_activity_removed_restaurant_has_null_name(client, db_session, as_user):
    sub = str(uuid.uuid4())
    await create_activity_event(
        db_session,
        user_sub=sub,
        event_type="tile_click",
        payload={"brand_id": 987654, "location_id": None, "source": "favourites"},
    )
    await db_session.commit()
    as_user("admin")
    body = (await client.get(f"/admin/registered-users/{sub}/activity")).json()
    assert body["results"][0]["brand_name"] is None
    assert body["results"][0]["location_label"] is None


@pytest.mark.asyncio
async def test_admin_activity_pagination_and_retention_window(client, db_session, as_user):
    sub = str(uuid.uuid4())
    for i in range(5):
        await create_activity_event(
            db_session, user_sub=sub, created_at=_ago(hours=i + 1), payload={"q": f"q{i}"}
        )
    await create_activity_event(
        db_session,
        user_sub=sub,
        created_at=_ago(days=activity_service.ACTIVITY_RETENTION_DAYS + 10),
        payload={"q": "expired"},
    )
    await db_session.commit()

    as_user("admin")
    page1 = (
        await client.get(f"/admin/registered-users/{sub}/activity", params={"page": 1, "page_size": 2})
    ).json()
    assert page1["total"] == 5  # expired row never counted
    assert [e["payload"]["q"] for e in page1["results"]] == ["q0", "q1"]

    page3 = (
        await client.get(f"/admin/registered-users/{sub}/activity", params={"page": 3, "page_size": 2})
    ).json()
    assert [e["payload"]["q"] for e in page3["results"]] == ["q4"]


# ---------------------------------------------------------------------------
# CCPA export + deletion
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_export_includes_own_activity_within_retention_only(client, db_session, as_user):
    my_sub, other_sub = str(uuid.uuid4()), str(uuid.uuid4())
    await create_activity_event(db_session, user_sub=my_sub, payload={"q": "mine", "result_count": 4})
    await create_activity_event(
        db_session,
        user_sub=my_sub,
        created_at=_ago(days=activity_service.ACTIVITY_RETENTION_DAYS + 1),
        payload={"q": "expired"},
    )
    await create_activity_event(db_session, user_sub=other_sub, payload={"q": "theirs"})
    await db_session.commit()

    as_user("registered_user", sub=my_sub)
    resp = await client.get("/auth/me/data-export")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert [e["payload"]["q"] for e in body["activity_events"]] == ["mine"]
    assert body["activity_events"][0]["event_type"] == "search"
    assert "12 months" in body["notice"]


@pytest.mark.asyncio
async def test_deletion_request_scope_counts_activity(client, db_session, as_user):
    sub = str(uuid.uuid4())
    await create_activity_event(db_session, user_sub=sub)
    await create_activity_event(db_session, user_sub=sub)
    await db_session.commit()

    as_user("registered_user", sub=sub)
    resp = await client.post("/auth/me/data-deletion", json={})
    assert resp.status_code in (200, 201), resp.text
    assert resp.json()["data_scope"]["activity_events"] == 2


@pytest.mark.asyncio
async def test_approved_deletion_removes_all_own_activity_but_not_others(client, db_session, as_user):
    sub, other_sub = str(uuid.uuid4()), str(uuid.uuid4())
    await create_activity_event(db_session, user_sub=sub)
    # Past-retention but not yet physically purged: deletion must take it too.
    await create_activity_event(
        db_session, user_sub=sub, created_at=_ago(days=activity_service.ACTIVITY_RETENTION_DAYS + 20)
    )
    await create_activity_event(db_session, user_sub=other_sub)
    request = await create_deletion_request(
        db_session, requester_user_id=sub, requester_role="registered_user"
    )
    await db_session.commit()

    as_user("admin")
    resp = await client.post(
        f"/data-deletion/{request.id}/approve", json={"reviewer_notes": "verified"}
    )
    assert resp.status_code == 200, resp.text

    assert await _events(db_session, sub) == []
    assert len(await _events(db_session, other_sub)) == 1
    total = (await db_session.execute(select(func.count()).select_from(UserActivityEvent))).scalar_one()
    assert total == 1

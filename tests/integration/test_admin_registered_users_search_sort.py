"""Integration tests: `GET /admin/registered-users` search (`q`) and `sort`
(docs/API_CONTRACTS.md "GET /admin/registered-users"). Same boto3-mocking
approach as `test_admin_registered_users_report.py`. Covers email + display
name search (case-insensitive, blank ignored), total/pagination following
the filter, all four sorts (never-seen last, invalid -> 422), and that every
timestamp leaves the API explicitly UTC.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest

from app.models.user_profile import UserProfile
from app.services import cognito_service


@pytest.fixture
def cognito_client(monkeypatch):
    monkeypatch.setenv("COGNITO_USER_POOL_ID", "us-east-1_testpool")
    fake = MagicMock()
    monkeypatch.setattr(cognito_service, "_cognito_client", fake)
    return fake


def _cognito_user(*, sub: str, email: str, created: datetime) -> dict:
    return {
        "Username": sub,
        "UserStatus": "CONFIRMED",
        "UserCreateDate": created,
        "Attributes": [
            {"Name": "sub", "Value": sub},
            {"Name": "email", "Value": email},
        ],
    }


async def _seed_three(cognito_client, db_session) -> dict[str, str]:
    """carol (oldest signup, named, seen 5h ago), bob (middle, never seen),
    alice (newest, seen 1h ago). Returns {email: sub}."""
    now = datetime.now(timezone.utc)
    spec = [
        ("carol@example.com", "Carol Diaz", 30, timedelta(hours=5)),
        ("bob@example.com", None, 20, None),
        ("alice@example.com", None, 10, timedelta(hours=1)),
    ]
    users, subs = [], {}
    for email, name, days, seen_ago in spec:
        sub = str(uuid.uuid4())
        subs[email] = sub
        users.append(_cognito_user(sub=sub, email=email, created=now - timedelta(days=days)))
        if name or seen_ago is not None:
            db_session.add(
                UserProfile(
                    cognito_sub=sub,
                    full_name=name,
                    last_seen_at=None if seen_ago is None else now - seen_ago,
                )
            )
    await db_session.commit()
    cognito_client.list_users_in_group.return_value = {"Users": users}
    return subs


@pytest.mark.asyncio
async def test_search_matches_email_or_display_name(client, db_session, as_user, cognito_client):
    await _seed_three(cognito_client, db_session)
    as_user("admin")

    async def emails(q: str) -> list[str]:
        resp = await client.get("/admin/registered-users", params={"q": q, "sort": "email"})
        assert resp.status_code == 200, resp.text
        return [r["email"] for r in resp.json()["results"]]

    assert await emails("BOB@") == ["bob@example.com"]  # case-insensitive
    assert await emails("diaz") == ["carol@example.com"]  # display name, not email
    assert await emails("example.com") == [
        "alice@example.com",
        "bob@example.com",
        "carol@example.com",
    ]
    assert await emails("nobody") == []
    assert await emails("   ") == [  # blank search = no filter
        "alice@example.com",
        "bob@example.com",
        "carol@example.com",
    ]
    assert await emails("%") == []  # literal, not a wildcard

    body = (await client.get("/admin/registered-users?q=nobody")).json()
    assert body == {"results": [], "page": 1, "page_size": 20, "total": 0}


@pytest.mark.asyncio
async def test_search_total_and_pagination_reflect_the_filter(
    client, db_session, as_user, cognito_client
):
    now = datetime.now(timezone.utc)
    cognito_client.list_users_in_group.return_value = {
        "Users": [
            _cognito_user(
                sub=str(uuid.uuid4()),
                email=f"{'match' if i % 2 == 0 else 'other'}{i}@example.com",
                created=now - timedelta(days=i),
            )
            for i in range(10)
        ]
    }
    as_user("admin")
    body = (await client.get("/admin/registered-users?q=match&page=2&page_size=2")).json()
    assert body["total"] == 5
    assert len(body["results"]) == 2
    assert all("match" in r["email"] for r in body["results"])


@pytest.mark.asyncio
async def test_sorts(client, db_session, as_user, cognito_client):
    await _seed_three(cognito_client, db_session)
    as_user("admin")

    async def order(sort: str) -> list[str]:
        resp = await client.get(f"/admin/registered-users?sort={sort}")
        assert resp.status_code == 200, resp.text
        return [r["email"] for r in resp.json()["results"]]

    assert await order("newest") == ["alice@example.com", "bob@example.com", "carol@example.com"]
    assert await order("oldest") == ["carol@example.com", "bob@example.com", "alice@example.com"]
    assert await order("email") == ["alice@example.com", "bob@example.com", "carol@example.com"]
    # last_seen: most recent first; never-seen (bob) last.
    assert await order("last_seen") == ["alice@example.com", "carol@example.com", "bob@example.com"]
    assert (await client.get("/admin/registered-users?sort=bogus")).status_code == 422


@pytest.mark.asyncio
async def test_rows_carry_display_name_and_utc_timestamps(
    client, db_session, as_user, cognito_client
):
    subs = await _seed_three(cognito_client, db_session)
    as_user("admin")
    rows = {r["email"]: r for r in (await client.get("/admin/registered-users")).json()["results"]}
    assert rows["carol@example.com"]["full_name"] == "Carol Diaz"
    assert rows["bob@example.com"]["full_name"] is None
    assert rows["carol@example.com"]["cognito_sub"] == subs["carol@example.com"]
    # Every instant leaves the API explicitly UTC (never a bare/naive time),
    # even though the SQLite test DB hands back naive datetimes.
    for row in rows.values():
        assert row["signup_at"].endswith(("Z", "+00:00"))
    assert rows["carol@example.com"]["last_seen_at"].endswith(("Z", "+00:00"))
    assert rows["bob@example.com"]["last_seen_at"] is None

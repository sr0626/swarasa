"""Integration tests: `GET /admin/audit-log` (docs/API_CONTRACTS.md).

Covers: admin-only auth, newest-first ordering, pagination, every filter
(entity, action, actor by sub / sub prefix / email, UTC date range), the
distinct entity-type list, batched actor-email resolution (never one Cognito
call per row; failure only degrades), system actors, snapshot passthrough
and truncation, and the summary line for admin user-management rows.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.models.audit_log import AuditLog
from app.services import cognito_service
from factories import create_owner


class FakeCognito:
    def __init__(self) -> None:
        self.group_emails: dict[str, dict[str, str]] = {}
        self.group_calls: list[str] = []
        self.sub_calls: list[str] = []
        self.email_to_sub: dict[str, str] = {}
        self.fail = False

    def list_group_emails(self, group_name: str) -> dict[str, str]:
        self.group_calls.append(group_name)
        if self.fail:
            raise RuntimeError("cognito down")
        return self.group_emails.get(group_name, {})

    def find_email_by_sub(self, sub: str) -> str | None:
        self.sub_calls.append(sub)
        return None

    def find_sub_by_email(self, email: str) -> str | None:
        if self.fail:
            raise RuntimeError("cognito down")
        return self.email_to_sub.get(email)


@pytest.fixture
def cognito(monkeypatch) -> FakeCognito:
    fake = FakeCognito()
    monkeypatch.setattr(cognito_service, "list_group_emails", fake.list_group_emails)
    monkeypatch.setattr(cognito_service, "find_email_by_sub", fake.find_email_by_sub)
    monkeypatch.setattr(cognito_service, "find_sub_by_email", fake.find_sub_by_email)
    return fake


async def _row(db, *, table="restaurant_brand", record_id=1, action="create", actor=None,
               role="admin", old=None, new=None, at=None) -> AuditLog:
    row = AuditLog(
        table_name=table,
        record_id=record_id,
        action=action,
        actor_id=actor or str(uuid.uuid4()),
        actor_role=role,
        old_val=old,
        new_val=new,
        created_at=at or datetime.now(timezone.utc),
    )
    db.add(row)
    await db.flush()
    return row


@pytest.mark.asyncio
async def test_requires_admin(client, as_user, cognito):
    for role in ("owner", "manager", "registered_user"):
        as_user(role)
        assert (await client.get("/admin/audit-log")).status_code == 403


@pytest.mark.asyncio
async def test_anonymous_rejected(client, as_anonymous):
    assert (await client.get("/admin/audit-log")).status_code in (401, 403)


@pytest.mark.asyncio
async def test_empty_state(client, as_user, cognito):
    as_user("admin")
    body = (await client.get("/admin/audit-log")).json()
    assert body == {
        "results": [],
        "page": 1,
        "page_size": 20,
        "total": 0,
        "entity_types": [],
        "email_lookup_degraded": False,
    }


@pytest.mark.asyncio
async def test_newest_first_pagination_and_entity_types(client, db_session, as_user, cognito):
    as_user("admin")
    now = datetime.now(timezone.utc)
    sub = str(uuid.uuid4())
    for i in range(5):
        await _row(db_session, record_id=i, actor=sub, at=now - timedelta(hours=i))
    await _row(db_session, table="restaurant_location", actor=sub, at=now - timedelta(days=1))
    await db_session.commit()

    body = (await client.get("/admin/audit-log", params={"page_size": 4})).json()
    assert body["total"] == 6 and len(body["results"]) == 4
    assert [r["record_id"] for r in body["results"]] == [0, 1, 2, 3]
    assert body["entity_types"] == ["restaurant_brand", "restaurant_location"]
    page2 = (await client.get("/admin/audit-log", params={"page_size": 4, "page": 2})).json()
    assert [r["table_name"] for r in page2["results"]] == ["restaurant_brand", "restaurant_location"]
    assert body["results"][0]["created_at"].endswith(("Z", "+00:00"))
    assert (await client.get("/admin/audit-log", params={"page_size": 101})).status_code == 422


@pytest.mark.asyncio
async def test_entity_and_action_filters(client, db_session, as_user, cognito):
    as_user("admin")
    await _row(db_session, table="restaurant_brand", action="create")
    await _row(db_session, table="restaurant_brand", action="update")
    await _row(db_session, table="restaurant_location", action="update")
    await db_session.commit()

    def total(**params):
        return client.get("/admin/audit-log", params=params)

    assert (await total(entity="restaurant_brand")).json()["total"] == 2
    assert (await total(action="update")).json()["total"] == 2
    assert (await total(entity="restaurant_brand", action="update")).json()["total"] == 1
    # entity_types is NOT narrowed by the filter
    assert (await total(entity="restaurant_brand")).json()["entity_types"] == [
        "restaurant_brand",
        "restaurant_location",
    ]
    # injection-shaped values are rejected by validation, never reach SQL
    assert (await total(entity="x'; drop table audit_log;--")).status_code == 422
    assert (await total(action="Update!")).status_code == 422


@pytest.mark.asyncio
async def test_date_range_is_inclusive_utc_days(client, db_session, as_user, cognito):
    as_user("admin")
    base = datetime(2026, 10, 10, 12, 0, tzinfo=timezone.utc)
    for offset, rid in ((-2, 1), (-1, 2), (0, 3), (1, 4), (2, 5)):
        await _row(db_session, record_id=rid, at=base + timedelta(days=offset))
    # 23:59 on the last day and 00:00 the next
    await _row(db_session, record_id=6, at=datetime(2026, 10, 11, 23, 59, tzinfo=timezone.utc))
    await _row(db_session, record_id=7, at=datetime(2026, 10, 12, 0, 0, tzinfo=timezone.utc))
    await db_session.commit()

    resp = await client.get(
        "/admin/audit-log", params={"date_from": "2026-10-09", "date_to": "2026-10-11"}
    )
    assert sorted(r["record_id"] for r in resp.json()["results"]) == [2, 3, 4, 6]
    only_from = await client.get("/admin/audit-log", params={"date_from": "2026-10-12"})
    assert sorted(r["record_id"] for r in only_from.json()["results"]) == [5, 7]
    bad = await client.get(
        "/admin/audit-log", params={"date_from": "2026-10-12", "date_to": "2026-10-01"}
    )
    assert bad.status_code == 422
    assert (await client.get("/admin/audit-log", params={"date_from": "nope"})).status_code == 422


@pytest.mark.asyncio
async def test_actor_filter_by_sub_prefix_and_email(client, db_session, as_user, cognito):
    as_user("admin")
    owner = await create_owner(db_session, email="owner@example.com")
    mgr_sub = str(uuid.uuid4())
    await _row(db_session, record_id=1, actor=owner.cognito_sub, role="owner")
    await _row(db_session, record_id=2, actor=mgr_sub, role="manager")
    await _row(db_session, record_id=3, actor=mgr_sub, role="manager")
    await db_session.commit()
    cognito.email_to_sub = {"mgr@example.com": mgr_sub}

    def ids(resp):
        return sorted(r["record_id"] for r in resp.json()["results"])

    assert ids(await client.get("/admin/audit-log", params={"actor": mgr_sub})) == [2, 3]
    assert ids(await client.get("/admin/audit-log", params={"actor": mgr_sub[:10]})) == [2, 3]
    # prefix LIKE wildcards are literal
    assert ids(await client.get("/admin/audit-log", params={"actor": "%%%%%%%%%"})) == []
    # owner email resolves locally (case-insensitive); manager via Cognito
    assert ids(await client.get("/admin/audit-log", params={"actor": "OWNER@example.com"})) == [1]
    assert ids(await client.get("/admin/audit-log", params={"actor": "mgr@example.com"})) == [2, 3]
    # unknown email -> empty, never "everything"
    unknown = await client.get("/admin/audit-log", params={"actor": "nobody@example.com"})
    assert unknown.json()["total"] == 0
    # Cognito down: the local owner match still works, others just don't resolve
    cognito.fail = True
    assert ids(await client.get("/admin/audit-log", params={"actor": "owner@example.com"})) == [1]
    assert (await client.get("/admin/audit-log", params={"actor": "mgr@example.com"})).json()["total"] == 0


@pytest.mark.asyncio
async def test_actor_emails_resolved_in_batch(client, db_session, as_user, cognito):
    as_user("admin")
    owner = await create_owner(db_session, email="owner@example.com")
    admin_sub, mgr_sub = str(uuid.uuid4()), str(uuid.uuid4())
    for i in range(6):  # many rows, few actors
        await _row(db_session, record_id=i, actor=[owner.cognito_sub, admin_sub, mgr_sub][i % 3],
                   role=["owner", "admin", "manager"][i % 3])
    await _row(db_session, record_id=99, actor="system:import_restaurants", role="admin")
    await db_session.commit()
    cognito.group_emails = {
        "admin": {admin_sub: "root@example.com"},
        "manager": {mgr_sub: "mona@example.com"},
    }

    body = (await client.get("/admin/audit-log")).json()
    by_sub = {r["actor_id"]: r for r in body["results"]}
    assert by_sub[owner.cognito_sub]["actor_email"] == "owner@example.com"
    assert by_sub[admin_sub]["actor_email"] == "root@example.com"
    assert by_sub[mgr_sub]["actor_label"] == "mona@example.com"
    system = by_sub["system:import_restaurants"]
    assert system["actor_email"] is None and system["actor_label"] == "import"
    assert sorted(cognito.group_calls) == ["admin", "manager"]  # one sweep per role, not per row
    assert cognito.sub_calls == []
    assert body["email_lookup_degraded"] is False


@pytest.mark.asyncio
async def test_cognito_failure_degrades_to_short_sub(client, db_session, as_user, cognito):
    as_user("admin")
    sub = str(uuid.uuid4())
    await _row(db_session, actor=sub, role="manager")
    await db_session.commit()
    cognito.fail = True
    resp = await client.get("/admin/audit-log")
    assert resp.status_code == 200
    body = resp.json()
    assert body["email_lookup_degraded"] is True
    assert body["results"][0]["actor_email"] is None
    assert body["results"][0]["actor_label"] == sub[:8]


@pytest.mark.asyncio
async def test_snapshots_are_plain_data_and_oversize_is_truncated(client, db_session, as_user, cognito):
    as_user("admin")
    xss = {"name": "<script>alert(1)</script>"}
    await _row(db_session, record_id=1, action="update", old={"name": "Old"}, new=xss)
    await _row(db_session, record_id=2, action="update", new={"blob": "x" * 20000})
    await db_session.commit()

    rows = {r["record_id"]: r for r in (await client.get("/admin/audit-log")).json()["results"]}
    assert rows[1]["old_val"] == {"name": "Old"}
    assert rows[1]["new_val"] == xss  # returned verbatim as JSON data; client renders as text
    assert "name" in rows[1]["summary"]
    big = rows[2]["new_val"]
    assert big["_truncated"] is True and len(big["_preview"]) <= 2000


@pytest.mark.asyncio
async def test_cognito_user_rows_get_a_readable_summary(client, db_session, as_user, cognito):
    as_user("admin")
    await _row(db_session, table="cognito_user", record_id=0, action="update",
               new={"operation": "disable", "target_email": "t@example.com"})
    await db_session.commit()
    row = (await client.get("/admin/audit-log")).json()["results"][0]
    assert row["summary"] == "User account disabled"

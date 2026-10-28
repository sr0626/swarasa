"""Integration tests: `GET /admin/users` and the admin account actions
`POST /admin/users/{username}/disable|enable|confirm|reset-password`
(docs/API_CONTRACTS.md "GET /admin/users").

Cognito is faked at the `cognito_service` function boundary (never a real
AWS call). Covers: admin-only auth, directory merge across groups, filters,
search, sort, pagination, truncation flag, 502 on Cognito failure, each
action's audit_log row, and the guardrails (self, last admin, confirm state,
username validation, generic errors).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from botocore.exceptions import ClientError
from sqlalchemy import select

from app.models.audit_log import AuditLog
from app.services import cognito_service
from app.services.cognito_service import PoolUserRecord
from factories import create_owner, create_user_profile


def _rec(
    *,
    sub: str | None = None,
    email: str | None = None,
    status: str = "CONFIRMED",
    enabled: bool = True,
    created: datetime | None = None,
    name: str | None = None,
    username: str | None = None,
) -> PoolUserRecord:
    sub = sub or str(uuid.uuid4())
    return PoolUserRecord(
        username=username or sub,
        cognito_sub=sub,
        email=email,
        name=name,
        status=status,
        enabled=enabled,
        created_at=created,
    )


class FakeCognito:
    def __init__(self) -> None:
        self.groups: dict[str, list[PoolUserRecord]] = {
            "admin": [],
            "owner": [],
            "manager": [],
            "registered_user": [],
        }
        self.truncated: set[str] = set()
        self.fail_list = False
        self.calls: list[tuple[str, str]] = []
        self.action_error: str | None = None
        self.group_sweeps: list[str] = []

    def list_group_users(self, group: str):
        self.group_sweeps.append(group)
        if self.fail_list:
            raise RuntimeError("cognito down: internal-secret-detail")
        return list(self.groups[group]), group in self.truncated

    def admin_get_user(self, username: str):
        for members in self.groups.values():
            for m in members:
                if m.username == username:
                    return m
        return None

    def _action(self, name: str):
        def call(username: str) -> None:
            self.calls.append((name, username))
            if self.action_error:
                raise ClientError(
                    {"Error": {"Code": self.action_error, "Message": "secret internals"}}, name
                )

        return call


@pytest.fixture
def cognito(monkeypatch) -> FakeCognito:
    fake = FakeCognito()
    monkeypatch.setattr(cognito_service, "list_group_users", fake.list_group_users)
    monkeypatch.setattr(cognito_service, "admin_get_user", fake.admin_get_user)
    monkeypatch.setattr(cognito_service, "admin_disable_user", fake._action("disable"))
    monkeypatch.setattr(cognito_service, "admin_enable_user", fake._action("enable"))
    monkeypatch.setattr(cognito_service, "admin_confirm_sign_up", fake._action("confirm"))
    monkeypatch.setattr(cognito_service, "admin_reset_user_password", fake._action("reset-password"))
    return fake


async def _audit_rows(db_session) -> list[AuditLog]:
    return list((await db_session.execute(select(AuditLog).order_by(AuditLog.id))).scalars())


# --------------------------------------------------------------------------
# auth
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_requires_admin_for_every_endpoint(client, as_user, cognito):
    paths = [
        ("get", "/admin/users"),
        ("post", "/admin/users/abc/disable"),
        ("post", "/admin/users/abc/enable"),
        ("post", "/admin/users/abc/confirm"),
        ("post", "/admin/users/abc/reset-password"),
    ]
    for role in ("owner", "manager", "registered_user"):
        as_user(role)
        for method, path in paths:
            assert (await getattr(client, method)(path)).status_code == 403, (role, path)
    assert cognito.calls == []


@pytest.mark.asyncio
async def test_anonymous_rejected(client, as_anonymous):
    assert (await client.get("/admin/users")).status_code in (401, 403)
    assert (await client.post("/admin/users/abc/disable")).status_code in (401, 403)


# --------------------------------------------------------------------------
# directory
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_directory_merges_groups_and_joins_profiles(client, db_session, as_user, cognito):
    now = datetime.now(timezone.utc)
    admin = as_user("admin", email="boss@example.com")
    boss = _rec(sub=admin.cognito_sub, email="boss@example.com", created=now - timedelta(days=90))
    # In two groups: owner + registered_user -> one row, role = owner.
    dual = _rec(email="dual@example.com", created=now - timedelta(days=10))
    mgr = _rec(email="mona@example.com", created=now - timedelta(days=5), enabled=False)
    diner = _rec(email="diner@example.com", status="UNCONFIRMED", created=now - timedelta(days=1))
    cognito.groups["admin"] = [boss]
    cognito.groups["owner"] = [dual]
    cognito.groups["registered_user"] = [dual, diner]
    cognito.groups["manager"] = [mgr]

    await create_user_profile(
        db_session, cognito_sub=mgr.cognito_sub, full_name="Mona M", last_seen_at=now - timedelta(hours=3)
    )
    await create_owner(db_session, cognito_sub=dual.cognito_sub, email="dual@example.com", full_name="Dual Owner")
    await db_session.commit()

    body = (await client.get("/admin/users")).json()
    assert body["total"] == 4 and body["truncated"] is False
    by_email = {r["email"]: r for r in body["results"]}

    assert by_email["boss@example.com"]["role"] == "admin"
    assert by_email["boss@example.com"]["is_self"] is True
    assert by_email["dual@example.com"]["role"] == "owner"
    assert by_email["dual@example.com"]["roles"] == ["owner", "registered_user"]
    assert by_email["dual@example.com"]["full_name"] == "Dual Owner"
    assert by_email["mona@example.com"]["enabled"] is False
    assert by_email["mona@example.com"]["full_name"] == "Mona M"
    assert by_email["mona@example.com"]["last_seen_at"] is not None
    assert by_email["diner@example.com"]["confirmed"] is False
    assert by_email["diner@example.com"]["status"] == "UNCONFIRMED"
    assert by_email["diner@example.com"]["last_seen_at"] is None
    # newest first by default
    assert [r["email"] for r in body["results"]][0] == "diner@example.com"
    # timestamps are timezone-aware
    assert body["results"][0]["created_at"].endswith(("Z", "+00:00"))
    # batched: exactly one sweep per role group
    assert sorted(cognito.group_sweeps) == ["admin", "manager", "owner", "registered_user"]


@pytest.mark.asyncio
async def test_filters_search_sort_pagination(client, as_user, cognito):
    now = datetime.now(timezone.utc)
    as_user("admin")
    cognito.groups["registered_user"] = [
        _rec(email=f"user{i}@example.com", created=now - timedelta(days=i)) for i in range(5)
    ]
    cognito.groups["owner"] = [_rec(email="priya@example.com", name="Priya Sharma", created=now)]
    cognito.groups["manager"] = [_rec(email="off@example.com", enabled=False, created=now)]

    assert (await client.get("/admin/users", params={"role": "owner"})).json()["total"] == 1
    assert (await client.get("/admin/users", params={"role": "manager"})).json()["total"] == 1
    assert (await client.get("/admin/users", params={"status": "disabled"})).json()["total"] == 1
    assert (await client.get("/admin/users", params={"status": "enabled"})).json()["total"] == 6
    assert (await client.get("/admin/users", params={"q": "PRIYA"})).json()["total"] == 1
    assert (await client.get("/admin/users", params={"q": "user3"})).json()["total"] == 1

    emails = [r["email"] for r in (await client.get("/admin/users", params={"sort": "email"})).json()["results"]]
    assert emails == sorted(emails)
    oldest = (await client.get("/admin/users", params={"sort": "oldest"})).json()["results"][0]
    assert oldest["email"] == "user4@example.com"

    page2 = (await client.get("/admin/users", params={"page": 2, "page_size": 4})).json()
    assert page2["total"] == 7 and len(page2["results"]) == 3 and page2["page"] == 2

    assert (await client.get("/admin/users", params={"role": "bogus"})).status_code == 422
    assert (await client.get("/admin/users", params={"page_size": 101})).status_code == 422


@pytest.mark.asyncio
async def test_truncated_flag_surfaces(client, as_user, cognito):
    as_user("admin")
    cognito.groups["registered_user"] = [_rec(email="a@example.com")]
    cognito.truncated.add("registered_user")
    assert (await client.get("/admin/users")).json()["truncated"] is True


@pytest.mark.asyncio
async def test_cognito_failure_is_generic_502(client, as_user, cognito):
    as_user("admin")
    cognito.fail_list = True
    resp = await client.get("/admin/users")
    assert resp.status_code == 502
    assert resp.json()["code"] == "upstream_error"
    assert "internal-secret-detail" not in resp.text


# --------------------------------------------------------------------------
# actions
# --------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "action,seed,expected",
    [
        ("disable", {"enabled": True}, {"enabled": False}),
        ("enable", {"enabled": False}, {"enabled": True}),
        ("confirm", {"status": "UNCONFIRMED"}, {"status": "CONFIRMED"}),
        ("reset-password", {}, {"status": "RESET_REQUIRED"}),
    ],
)
async def test_action_calls_cognito_and_writes_audit(
    client, db_session, as_user, cognito, action, seed, expected
):
    admin = as_user("admin")
    cognito.groups["admin"] = [_rec(sub=admin.cognito_sub, email="boss@example.com")]
    cognito.groups["admin"].append(_rec(email="other-admin@example.com"))
    target = _rec(email="target@example.com", **seed)
    cognito.groups["registered_user"] = [target]

    resp = await client.post(f"/admin/users/{target.username}/{action}")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["action"] == action and body["username"] == target.username
    for key, value in expected.items():
        assert body[key] == value
    assert cognito.calls == [(action, target.username)]

    rows = await _audit_rows(db_session)
    assert len(rows) == 1
    row = rows[0]
    assert row.table_name == "cognito_user" and row.action == "update"
    assert row.actor_id == admin.cognito_sub and row.actor_role == "admin"
    assert row.new_val["operation"] == action
    assert row.new_val["target_sub"] == target.cognito_sub
    assert row.new_val["target_email"] == "target@example.com"
    assert row.old_val["status"] == target.status


@pytest.mark.asyncio
async def test_cannot_disable_or_reset_self(client, db_session, as_user, cognito):
    admin = as_user("admin")
    me = _rec(sub=admin.cognito_sub, email="boss@example.com")
    cognito.groups["admin"] = [me, _rec(email="other@example.com")]
    for action in ("disable", "reset-password"):
        resp = await client.post(f"/admin/users/{me.username}/{action}")
        assert resp.status_code == 403
        assert resp.json()["code"] == "cannot_target_self"
    assert cognito.calls == [] and await _audit_rows(db_session) == []


@pytest.mark.asyncio
async def test_self_detected_by_sub_when_username_differs(client, as_user, cognito):
    admin = as_user("admin")
    me = _rec(sub=admin.cognito_sub, email="boss@example.com", username="boss@example.com")
    cognito.groups["admin"] = [me]
    assert (await client.post("/admin/users/boss@example.com/disable")).status_code == 403


@pytest.mark.asyncio
async def test_cannot_disable_last_enabled_admin(client, db_session, as_user, cognito):
    as_user("admin")
    solo = _rec(email="solo-admin@example.com")
    disabled_admin = _rec(email="old-admin@example.com", enabled=False)
    cognito.groups["admin"] = [solo, disabled_admin]
    for action in ("disable", "reset-password"):
        resp = await client.post(f"/admin/users/{solo.username}/{action}")
        assert resp.status_code == 409 and resp.json()["code"] == "last_admin"
    assert cognito.calls == [] and await _audit_rows(db_session) == []

    # With a second ENABLED admin it is allowed.
    cognito.groups["admin"].append(_rec(email="second@example.com"))
    assert (await client.post(f"/admin/users/{solo.username}/disable")).status_code == 200


@pytest.mark.asyncio
async def test_last_admin_check_fails_closed(client, as_user, cognito):
    as_user("admin")
    target = _rec(email="t@example.com")
    cognito.groups["registered_user"] = [target]
    cognito.fail_list = True
    resp = await client.post(f"/admin/users/{target.username}/disable")
    assert resp.status_code == 502 and "internal-secret-detail" not in resp.text
    assert cognito.calls == []


@pytest.mark.asyncio
async def test_confirm_only_for_unconfirmed(client, as_user, cognito):
    as_user("admin")
    ok = _rec(email="ok@example.com", status="CONFIRMED")
    cognito.groups["registered_user"] = [ok]
    resp = await client.post(f"/admin/users/{ok.username}/confirm")
    assert resp.status_code == 409 and resp.json()["code"] == "invalid_state"
    assert cognito.calls == []


@pytest.mark.asyncio
async def test_unknown_user_404_and_invalid_username_rejected(client, as_user, cognito):
    as_user("admin")
    resp = await client.post("/admin/users/does-not-exist/enable")
    assert resp.status_code == 404 and resp.json()["code"] == "not_found"
    for bad in ("a%20b", "a%3Bb", "a%22b", "%3Cscript%3E"):
        assert (await client.post(f"/admin/users/{bad}/enable")).status_code == 422, bad
    assert cognito.calls == []


@pytest.mark.asyncio
async def test_cognito_action_errors_are_generic_and_not_audited(
    client, db_session, as_user, cognito
):
    as_user("admin")
    target = _rec(email="t@example.com")
    cognito.groups["registered_user"] = [target]

    cognito.action_error = "InternalErrorException"
    resp = await client.post(f"/admin/users/{target.username}/enable")
    assert resp.status_code == 502 and resp.json()["code"] == "upstream_error"
    assert "secret internals" not in resp.text and "InternalError" not in resp.text

    cognito.action_error = "InvalidParameterException"
    resp = await client.post(f"/admin/users/{target.username}/reset-password")
    assert resp.status_code == 409 and resp.json()["code"] == "action_not_allowed"
    assert "secret internals" not in resp.text

    assert await _audit_rows(db_session) == []

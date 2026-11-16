"""Integration tests for the form guard: POST /forms/token, POST /forms/verify
and the guarded submission endpoints (docs/API_CONTRACTS.md "Form guard").

The clock is injected (`form_guard_service._now`) -- nothing sleeps -- and the
signing secret is a fixed test value. Enforcement is switched on per test with
the real `platform_config` flag row; the default (flag absent) is log-only.
"""
from __future__ import annotations

import logging
import uuid

import pytest
from sqlalchemy import func, select, text

import app.main as app_main
from app.dependencies.auth import CurrentUser, get_current_user_optional
from app.models.admin_message import AdminMessage
from app.models.claim_request import ClaimRequest
from app.models.form_guard_counter import FormGuardCounter
from app.models.listing_report import ListingReport
from app.models.platform_config import PlatformConfig
from app.models.restaurant_brand import RestaurantBrand
from app.schemas.forms import FORM_NAMES
from app.services import form_guard_service as fg
from factories import create_brand, create_catering_location, create_location, create_owner

T0 = 1_800_000_000


@pytest.fixture(autouse=True)
def _guard_env(monkeypatch):
    monkeypatch.setattr(fg, "_secret_material", lambda: "form-guard-test-secret")
    monkeypatch.setattr(fg, "_KEYS", {})
    monkeypatch.setattr(fg, "_random", lambda: 1.0)  # no purge unless a test wants it
    clock = {"now": T0}
    monkeypatch.setattr(fg, "_now", lambda: clock["now"])
    return clock


@pytest.fixture
def clock(_guard_env):
    return _guard_env


async def _set_config(db_session, key: str, value: str) -> None:
    row = await db_session.get(PlatformConfig, key)
    if row is None:
        db_session.add(PlatformConfig(key=key, value=value))
    else:
        row.value = value
    await db_session.commit()


async def _enforce(db_session) -> None:
    await _set_config(db_session, fg.FORM_GUARD_ENFORCED_KEY, "true")


async def _token(client, form: str, visitor: str | None = "203.0.113.7") -> str:
    headers = {"X-Visitor-IP": visitor} if visitor else {}
    resp = await client.post("/forms/token", json={"form": form}, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()["token"]


def _hdr(token: str | None, visitor: str | None = "203.0.113.7", trap: str | None = None) -> dict:
    headers: dict[str, str] = {}
    if token is not None:
        headers["X-Form-Token"] = token
    if visitor:
        headers["X-Visitor-IP"] = visitor
    if trap is not None:
        headers["X-Form-Trap"] = trap
    return headers


async def _report_body(db_session) -> dict:
    brand = await create_brand(db_session)
    await db_session.commit()
    return {"brand_id": brand.id, "category": "other", "details": "The sign outside is wrong."}


async def _count(db_session, model) -> int:
    return (await db_session.execute(select(func.count()).select_from(model))).scalar_one()


def _assert_generic_400(resp) -> None:
    assert resp.status_code == 400, resp.text
    assert resp.json() == {"detail": "Please try again.", "code": "form_check_failed"}


# ---------------------------------------------------------------------------
# Token endpoint
# ---------------------------------------------------------------------------
def test_form_names_match_policies():
    assert set(FORM_NAMES) == set(fg.TOKEN_FORMS)


@pytest.mark.asyncio
async def test_token_endpoint_issues_form_bound_token(client, as_anonymous):
    resp = await client.post("/forms/token", json={"form": "report"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["min_seconds"] == fg.POLICIES["report"].min_age
    assert body["token"].count(".") == 2
    assert resp.headers["cache-control"] == "no-store"


@pytest.mark.asyncio
async def test_token_endpoint_rejects_unknown_form(client, as_anonymous):
    assert (await client.post("/forms/token", json={"form": "nope"})).status_code == 422
    assert (await client.post("/forms/token", json={})).status_code == 422


@pytest.mark.asyncio
async def test_token_endpoint_is_rate_limited_per_client(client, db_session, as_anonymous):
    await _enforce(db_session)
    limit = fg.POLICIES["token"].direct_limit  # no visitor header => direct bucket
    for _ in range(limit):
        assert (await client.post("/forms/token", json={"form": "report"})).status_code == 200
    blocked = await client.post("/forms/token", json={"form": "report"})
    assert blocked.status_code == 429
    assert blocked.json()["code"] == "rate_limited"
    assert int(blocked.headers["retry-after"]) >= 1


@pytest.mark.asyncio
async def test_token_endpoint_not_blocked_when_not_enforced(client, db_session, as_anonymous):
    limit = fg.POLICIES["token"].direct_limit
    for _ in range(limit + 3):
        assert (await client.post("/forms/token", json={"form": "report"})).status_code == 200


@pytest.mark.asyncio
async def test_token_endpoint_fails_closed_without_secret(client, monkeypatch, as_anonymous):
    def boom():
        raise RuntimeError("no secret")

    monkeypatch.setattr(fg, "_secret_material", boom)
    monkeypatch.setattr(fg, "_KEYS", {})
    resp = await client.post("/forms/token", json={"form": "report"})
    assert resp.status_code == 503
    assert resp.json()["code"] == "unavailable"


# ---------------------------------------------------------------------------
# POST /reports (anonymous) -- enforced
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_valid_token_passes_and_report_is_stored(client, db_session, as_anonymous, clock):
    await _enforce(db_session)
    body = await _report_body(db_session)
    token = await _token(client, "report")
    clock["now"] += 5
    resp = await client.post("/reports", json=body, headers=_hdr(token))
    assert resp.status_code == 201, resp.text
    assert await _count(db_session, ListingReport) == 1


@pytest.mark.asyncio
async def test_missing_forged_expired_fast_wrong_form_and_replayed_tokens_are_all_the_same_400(
    client, db_session, as_anonymous, clock
):
    await _enforce(db_session)
    body = await _report_body(db_session)

    # missing
    _assert_generic_400(await client.post("/reports", json=body, headers=_hdr(None)))
    # forged
    good = await _token(client, "report")
    forged = good[:-3] + ("AAA" if not good.endswith("AAA") else "BBB")
    clock["now"] += 5
    _assert_generic_400(await client.post("/reports", json=body, headers=_hdr(forged)))
    # too fast: issued "now", submitted immediately
    fast = await _token(client, "report")
    _assert_generic_400(await client.post("/reports", json=body, headers=_hdr(fast)))
    # wrong form
    other = await _token(client, "claim")
    clock["now"] += 5
    _assert_generic_400(await client.post("/reports", json=body, headers=_hdr(other)))
    # expired
    clock["now"] += 2 * 3600 + 1
    _assert_generic_400(await client.post("/reports", json=body, headers=_hdr(good)))
    assert await _count(db_session, ListingReport) == 0

    # single use: the second submission with the same token is rejected
    fresh = await _token(client, "report")
    clock["now"] += 5
    assert (await client.post("/reports", json=body, headers=_hdr(fresh))).status_code == 201
    _assert_generic_400(await client.post("/reports", json=body, headers=_hdr(fresh)))
    assert await _count(db_session, ListingReport) == 1


@pytest.mark.asyncio
async def test_rejected_token_costs_no_counter_write(client, db_session, as_anonymous):
    await _enforce(db_session)
    body = await _report_body(db_session)
    before = await _count(db_session, FormGuardCounter)
    _assert_generic_400(await client.post("/reports", json=body, headers=_hdr("junk", visitor=None)))
    assert await _count(db_session, FormGuardCounter) == before


@pytest.mark.asyncio
async def test_honeypot_header_returns_receipt_but_stores_nothing(client, db_session, as_anonymous, clock):
    await _enforce(db_session)
    body = await _report_body(db_session)
    token = await _token(client, "report")
    clock["now"] += 5
    resp = await client.post("/reports", json=body, headers=_hdr(token, trap="http://spam.example"))
    assert resp.status_code == 201
    assert resp.json() == {"status": "received"}
    assert await _count(db_session, ListingReport) == 0


@pytest.mark.asyncio
async def test_visitor_rate_limit_returns_429_with_retry_after(client, db_session, as_anonymous, clock):
    await _enforce(db_session)
    body = await _report_body(db_session)
    limit = fg.POLICIES["report"].visitor_limit
    tokens = [await _token(client, "report", visitor=f"198.51.100.{i}") for i in range(limit + 1)]
    clock["now"] += 5
    for token in tokens[:limit]:
        assert (await client.post("/reports", json=body, headers=_hdr(token, "192.0.2.50"))).status_code == 201
    blocked = await client.post("/reports", json=body, headers=_hdr(tokens[limit], "192.0.2.50"))
    assert blocked.status_code == 429
    assert blocked.json() == {
        "detail": "Too many requests. Please wait a while and try again.",
        "code": "rate_limited",
    }
    assert 1 <= int(blocked.headers["retry-after"]) <= 3600
    assert await _count(db_session, ListingReport) == limit
    # A different visitor is unaffected.
    other = await client.post("/reports", json=body, headers=_hdr(await _token(client, "report", "192.0.2.99"), "192.0.2.99"))
    assert other.status_code in (400, 201)  # fresh token is too fast (same instant), but not 429
    assert other.status_code != 429


@pytest.mark.asyncio
async def test_direct_caller_without_visitor_header_gets_the_tight_bucket(client, db_session, as_anonymous, clock):
    await _enforce(db_session)
    body = await _report_body(db_session)
    limit = fg.POLICIES["report"].direct_limit
    tokens = [await _token(client, "report", visitor=None) for _ in range(limit + 1)]
    clock["now"] += 5
    for token in tokens[:limit]:
        assert (await client.post("/reports", json=body, headers=_hdr(token, None))).status_code == 201
    assert (await client.post("/reports", json=body, headers=_hdr(tokens[limit], None))).status_code == 429


@pytest.mark.asyncio
async def test_forging_a_new_visitor_header_each_time_still_hits_the_global_breaker(
    client, db_session, as_anonymous, clock
):
    await _enforce(db_session)
    await _set_config(db_session, f"{fg.GLOBAL_LIMIT_KEY_PREFIX}report", "3")
    body = await _report_body(db_session)
    tokens = [await _token(client, "report", visitor=f"10.0.0.{i}") for i in range(5)]
    clock["now"] += 5
    statuses = [
        (await client.post("/reports", json=body, headers=_hdr(t, f"10.0.1.{i}"))).status_code
        for i, t in enumerate(tokens)
    ]
    assert statuses == [201, 201, 201, 429, 429]
    assert await _count(db_session, ListingReport) == 3


@pytest.mark.asyncio
async def test_window_rolls_over(client, db_session, as_anonymous, clock):
    await _enforce(db_session)
    await _set_config(db_session, f"{fg.GLOBAL_LIMIT_KEY_PREFIX}report", "1")
    body = await _report_body(db_session)
    first = await _token(client, "report", "10.1.1.1")
    second = await _token(client, "report", "10.1.1.2")
    clock["now"] += 5
    assert (await client.post("/reports", json=body, headers=_hdr(first, "10.1.1.1"))).status_code == 201
    assert (await client.post("/reports", json=body, headers=_hdr(second, "10.1.1.2"))).status_code == 429
    clock["now"] += 3600
    third = await _token(client, "report", "10.1.1.3")
    clock["now"] += 5
    assert (await client.post("/reports", json=body, headers=_hdr(third, "10.1.1.3"))).status_code == 201


@pytest.mark.asyncio
async def test_signed_in_reporter_is_limited_per_user(client, db_session, clock):
    await _enforce(db_session)
    body = await _report_body(db_session)
    user = CurrentUser(cognito_sub=str(uuid.uuid4()), email="a@example.com", role="registered_user")

    async def _override():
        return user

    app_main.app.dependency_overrides[get_current_user_optional] = _override
    limit = fg.POLICIES["report"].user_limit
    tokens = [await _token(client, "report") for _ in range(limit + 1)]
    clock["now"] += 5
    for token in tokens[:limit]:
        assert (await client.post("/reports", json=body, headers=_hdr(token))).status_code == 201
    assert (await client.post("/reports", json=body, headers=_hdr(tokens[limit]))).status_code == 429


@pytest.mark.asyncio
async def test_counter_keys_hold_no_raw_identifiers(client, db_session, as_anonymous, clock):
    await _enforce(db_session)
    body = await _report_body(db_session)
    token = await _token(client, "report", "203.0.113.99")
    clock["now"] += 5
    await client.post("/reports", json=body, headers=_hdr(token, "203.0.113.99"))
    keys = (await db_session.execute(select(FormGuardCounter.counter_key))).scalars().all()
    assert keys
    assert not any("203.0.113" in k or "127.0.0.1" in k for k in keys)


# ---------------------------------------------------------------------------
# Not enforced (default): log-only, never blocks
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_not_enforced_lets_legacy_callers_through_and_logs_would_block(
    client, db_session, as_anonymous, caplog
):
    body = await _report_body(db_session)
    with caplog.at_level(logging.WARNING, logger="app.services.form_guard"):
        resp = await client.post("/reports", json=body)  # no token at all
    assert resp.status_code == 201
    assert await _count(db_session, ListingReport) == 1
    lines = [r.getMessage() for r in caplog.records if "form_guard" in r.getMessage()]
    assert lines == ["form_guard would_block form=report reason=token_missing"]


@pytest.mark.asyncio
async def test_flag_false_row_behaves_like_absent(client, db_session, as_anonymous):
    await _set_config(db_session, fg.FORM_GUARD_ENFORCED_KEY, "false")
    body = await _report_body(db_session)
    assert (await client.post("/reports", json=body)).status_code == 201


@pytest.mark.asyncio
async def test_not_enforced_honeypot_header_is_logged_not_dropped(client, db_session, as_anonymous):
    body = await _report_body(db_session)
    resp = await client.post("/reports", json=body, headers=_hdr(None, trap="x"))
    assert resp.status_code == 201
    assert await _count(db_session, ListingReport) == 1


@pytest.mark.asyncio
async def test_counter_store_failure_fails_open_even_when_enforced(client, db_session, as_anonymous, clock):
    await _enforce(db_session)
    body = await _report_body(db_session)
    token = await _token(client, "report")
    clock["now"] += 5
    await db_session.execute(text("DROP TABLE form_guard_counter"))
    # Migration 0025 not run yet: the stateless token check still applies, a
    # good token passes, and nothing 500s.
    assert (await client.post("/reports", json=body, headers=_hdr(token))).status_code == 201
    _assert_generic_400(await client.post("/reports", json=body, headers=_hdr("junk")))


@pytest.mark.asyncio
async def test_store_missing_does_not_break_submission_when_not_enforced(client, db_session, as_anonymous):
    body = await _report_body(db_session)
    await db_session.execute(text("DROP TABLE form_guard_counter"))
    resp = await client.post("/reports", json=body)
    assert resp.status_code == 201


@pytest.mark.asyncio
async def test_purge_removes_only_expired_rows(client, db_session, as_anonymous, clock, monkeypatch):
    monkeypatch.setattr(fg, "_random", lambda: 0.0)  # always purge
    db_session.add(FormGuardCounter(counter_key="g:old:1", n=3, expires_at=T0 - 10))
    db_session.add(FormGuardCounter(counter_key="g:live:1", n=3, expires_at=T0 + 1000))
    await db_session.commit()
    await client.post("/forms/token", json={"form": "report"})
    keys = set((await db_session.execute(select(FormGuardCounter.counter_key))).scalars().all())
    assert "g:old:1" not in keys and "g:live:1" in keys


# ---------------------------------------------------------------------------
# POST /forms/verify (Cognito flows)
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_verify_accepts_a_good_token_once(client, db_session, as_anonymous, clock):
    await _enforce(db_session)
    token = await _token(client, "signup")
    clock["now"] += 5
    payload = {"form": "signup", "token": token}
    assert (await client.post("/forms/verify", json=payload, headers=_hdr(None))).status_code == 204
    _assert_generic_400(await client.post("/forms/verify", json=payload, headers=_hdr(None)))


@pytest.mark.asyncio
async def test_verify_rejects_fast_wrong_form_forged_and_honeypot(client, db_session, as_anonymous, clock):
    await _enforce(db_session)
    token = await _token(client, "signup")
    _assert_generic_400(await client.post("/forms/verify", json={"form": "signup", "token": token}))  # too fast
    clock["now"] += 5
    _assert_generic_400(await client.post("/forms/verify", json={"form": "forgot", "token": token}))  # wrong form
    _assert_generic_400(await client.post("/forms/verify", json={"form": "signup", "token": "a.b.c"}))
    trapped = await _token(client, "signup")
    clock["now"] += 5
    _assert_generic_400(
        await client.post("/forms/verify", json={"form": "signup", "token": trapped, "trap": "bot"})
    )


@pytest.mark.asyncio
async def test_verify_is_always_204_when_not_enforced(client, as_anonymous):
    resp = await client.post("/forms/verify", json={"form": "login", "token": "junk"})
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_verify_visitor_rate_limit(client, db_session, as_anonymous, clock):
    await _enforce(db_session)
    limit = fg.POLICIES["signup"].visitor_limit
    tokens = [await _token(client, "signup", visitor=f"172.16.0.{i}") for i in range(limit + 1)]
    clock["now"] += 5
    for token in tokens[:limit]:
        assert (
            await client.post("/forms/verify", json={"form": "signup", "token": token}, headers=_hdr(None, "192.0.2.77"))
        ).status_code == 204
    blocked = await client.post(
        "/forms/verify", json={"form": "signup", "token": tokens[limit]}, headers=_hdr(None, "192.0.2.77")
    )
    assert blocked.status_code == 429
    assert "retry-after" in blocked.headers


# ---------------------------------------------------------------------------
# Signed-in endpoints
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_contact_admin_requires_token_when_enforced(client, db_session, as_user, clock):
    await _enforce(db_session)
    owner = await create_owner(db_session)
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    payload = {"subject": "Hours not saving", "body": "My Sunday hours revert after I save them."}

    _assert_generic_400(await client.post("/contact-admin", json=payload))
    assert await _count(db_session, AdminMessage) == 0

    token = await _token(client, "contact_admin")
    clock["now"] += 5
    assert (await client.post("/contact-admin", json=payload, headers=_hdr(token))).status_code == 201
    assert await _count(db_session, AdminMessage) == 1


@pytest.mark.asyncio
async def test_contact_admin_honeypot_is_a_generic_400_and_writes_nothing(client, db_session, as_user, clock):
    await _enforce(db_session)
    owner = await create_owner(db_session)
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    token = await _token(client, "contact_admin")
    clock["now"] += 5
    resp = await client.post(
        "/contact-admin",
        json={"subject": "Hours not saving", "body": "My Sunday hours revert after I save them."},
        headers=_hdr(token, trap="x"),
    )
    _assert_generic_400(resp)
    assert await _count(db_session, AdminMessage) == 0


@pytest.mark.asyncio
async def test_existing_contact_admin_limit_still_applies_with_valid_tokens(client, db_session, as_user, clock):
    await _enforce(db_session)
    owner = await create_owner(db_session)
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    payload = {"subject": "Hours not saving", "body": "My Sunday hours revert after I save them."}
    tokens = [await _token(client, "contact_admin") for _ in range(6)]
    clock["now"] += 5
    codes = [(await client.post("/contact-admin", json=payload, headers=_hdr(t))).status_code for t in tokens]
    assert codes == [201, 201, 201, 201, 201, 429]


@pytest.mark.asyncio
async def test_claim_requires_token_and_is_limited_per_user(client, db_session, as_user, clock):
    await _enforce(db_session)
    user = as_user("registered_user")
    brands = [await create_brand(db_session) for _ in range(6)]
    await db_session.commit()

    def payload(brand):
        return {
            "brand_id": brand.id,
            "proof_method": "google_business_profile",
            "google_business_profile_url": "https://business.google.com/x",
        }

    _assert_generic_400(await client.post("/claim", json=payload(brands[0])))
    assert await _count(db_session, ClaimRequest) == 0

    limit = fg.POLICIES["claim"].user_limit
    tokens = [await _token(client, "claim") for _ in range(limit + 1)]
    clock["now"] += 6
    for brand, token in zip(brands[:limit], tokens[:limit]):
        assert (await client.post("/claim", json=payload(brand), headers=_hdr(token))).status_code == 201
    over = await client.post("/claim", json=payload(brands[limit]), headers=_hdr(tokens[limit]))
    assert over.status_code == 429 and "retry-after" in over.headers
    assert user.cognito_sub  # per-user (hash) bucket, not per-IP


@pytest.mark.asyncio
async def test_brand_create_requires_token_when_enforced(client, db_session, as_user, clock):
    await _enforce(db_session)
    owner = await create_owner(db_session)
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    _assert_generic_400(await client.post("/restaurants", json={"name": "Spice Route"}))
    assert await _count(db_session, RestaurantBrand) == 0
    token = await _token(client, "brand_create")
    clock["now"] += 5
    resp = await client.post("/restaurants", json={"name": "Spice Route"}, headers=_hdr(token))
    assert resp.status_code == 201, resp.text


@pytest.mark.asyncio
async def test_catering_request_requires_token_when_enforced(client, db_session, as_user, clock):
    await _enforce(db_session)
    location = await create_catering_location(db_session)
    await db_session.commit()
    as_user("registered_user", email="diner@example.com")
    from datetime import datetime, timedelta, timezone

    payload = {
        "event_date": (datetime.now(timezone.utc) + timedelta(days=12)).date().isoformat(),
        "headcount": 50,
        "delivery_or_pickup": "delivery",
        "delivery_city": "Irving",
        "delivery_zip": "75038",
        "items": [{"item_name": "Chicken biryani", "size": "full_tray", "quantity": 2}],
        "location_ids": [location.id],
    }
    _assert_generic_400(await client.post("/catering/requests", json=payload))
    token = await _token(client, "catering_request")
    clock["now"] += 6
    assert (await client.post("/catering/requests", json=payload, headers=_hdr(token))).status_code == 201


def test_location_create_and_manager_invite_are_rate_limited_not_token_gated():
    for form in ("location_create", "manager_invite"):
        assert fg.POLICIES[form].require_token is False
        assert fg.POLICIES[form].user_limit


@pytest.mark.asyncio
async def test_manager_invite_per_user_limit_without_a_token(client, db_session, as_user, monkeypatch):
    await _enforce(db_session)
    monkeypatch.setitem(
        fg.POLICIES, "manager_invite", fg.FormPolicy("manager_invite", require_token=False, user_limit=2)
    )
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id)
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    codes = []
    for i in range(3):
        resp = await client.post(f"/locations/{location.id}/manager-invites", json={"email": f"m{i}@example.com"})
        codes.append(resp.status_code)
    assert codes == [201, 201, 429]


# ---------------------------------------------------------------------------
# Settings plumbing
# ---------------------------------------------------------------------------
def test_flag_and_global_limits_are_settable_by_management_commands():
    from app.scripts.set_platform_int import KNOWN_INT_SETTINGS
    from app.services import platform_config_service

    assert fg.FORM_GUARD_ENFORCED_KEY in platform_config_service.KNOWN_BOOL_FLAGS
    assert f"{fg.GLOBAL_LIMIT_KEY_PREFIX}report" in KNOWN_INT_SETTINGS
    assert f"{fg.GLOBAL_LIMIT_KEY_PREFIX}login" not in KNOWN_INT_SETTINGS  # no global breaker on login

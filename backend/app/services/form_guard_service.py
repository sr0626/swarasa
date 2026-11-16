"""Form guard -- free in-app abuse checks on public / user-submitted forms:
a signed form token (minimum time-to-submit, maximum age, single use), a
honeypot trap, and authoritative rate limits. See docs/API_CONTRACTS.md
"Form guard" and docs/DECISIONS.md.

WHY IT LIVES IN THE BACKEND. The Next.js server calls this API, so the
connection IP the backend sees is Amplify's, and the API URL is public so
anyone can call it directly with any header. Therefore:
  * the token is HMAC-signed (core/form_token.py) -- a caller cannot forge
    one, only fetch one from `POST /forms/token` (which is itself limited);
  * the visitor IP the Next server forwards (`X-Visitor-IP`) is a HINT, never
    trusted alone. Anonymous limits are therefore layered:
      - `v:` per forwarded-visitor hash (tight; forgeable by a direct caller),
      - `c:` per connection hash when a visitor header is present (generous:
        it is the shared Amplify egress for every real visitor),
      - `d:` per connection hash when NO visitor header is present (tight: a
        direct caller's real IP),
      - `g:` a GLOBAL per-form breaker (configurable) -- the control that
        actually bounds a distributed or header-forging flood.
    Signed-in forms use `u:` (per Cognito-sub hash, unforgeable) + `g:`.
  * all keys are salted, truncated hashes -- no raw IP / email / sub is ever
    stored or logged.

COST. One config query (the enforcement flag + that form's global limit, one
`IN` lookup) and ONE multi-row atomic upsert-with-RETURNING for every counter
(nonce, client, user, global) -- `INSERT ... ON CONFLICT DO UPDATE SET n =
n + 1 RETURNING`, the same PostgreSQL/SQLite dialect pattern as
`analytics_service`. A forged / missing / too-fast token is rejected BEFORE
any counter write, so garbage floods cost no store traffic.

ROLLOUT. Everything that can reject is behind the `form_guard_enforced`
platform flag (default FALSE): when off, every check is evaluated and a
`would_block` line is logged (form + reason, no PII) but the request
proceeds. The counter store failing (e.g. migration 0025 not run yet) FAILS
OPEN with a logged warning, never a 500.

Every rejection reason collapses to the same generic body (400
`form_check_failed` / 429 `rate_limited`) so a bot learns nothing.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
import random
import time
from dataclasses import dataclass
from enum import Enum

from fastapi import Request
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import form_token
from app.core.errors import AppError
from app.models.form_guard_counter import FormGuardCounter
from app.models.platform_config import PlatformConfig
from app.services import platform_config_service

logger = logging.getLogger("app.services.form_guard")

FORM_GUARD_ENFORCED_KEY = platform_config_service.FORM_GUARD_ENFORCED_KEY
GLOBAL_LIMIT_KEY_PREFIX = "form_guard_global_per_hour_"

WINDOW_SECONDS = 3600
TOKEN_MAX_AGE_SECONDS = 2 * 3600
PURGE_PROBABILITY = 0.02

TOKEN_HEADER = "x-form-token"
TRAP_HEADER = "x-form-trap"
VISITOR_HEADER = "x-visitor-ip"

def check_failed() -> AppError:
    return AppError(400, "Please try again.", "form_check_failed")


@dataclass(frozen=True)
class FormPolicy:
    name: str
    min_age: int = 3  # seconds a token must age before it is accepted
    require_token: bool = True
    # Per-hour limits; None = no limit of that kind.
    visitor_limit: int | None = None  # anonymous: per forwarded-visitor hash
    proxied_limit: int | None = None  # anonymous: per connection hash WITH a visitor header
    direct_limit: int | None = None  # anonymous: per connection hash WITHOUT one
    user_limit: int | None = None  # signed-in: per user hash
    global_default: int | None = None  # all callers; overridable via platform_config


POLICIES: dict[str, FormPolicy] = {
    p.name: p
    for p in (
        # --- issuing tokens (no global breaker: tokens are free and stateless)
        FormPolicy("token", min_age=0, require_token=False, visitor_limit=120, proxied_limit=3000, direct_limit=60),
        # --- anonymous data-creating form
        FormPolicy("report", min_age=3, visitor_limit=5, proxied_limit=300, direct_limit=5, user_limit=10, global_default=60),
        # --- signed-in forms (token + time check; per-user where none exists yet)
        FormPolicy("claim", min_age=5, user_limit=5, global_default=100),
        # contact_admin / catering_request keep their existing per-sender
        # limits (5/hour, 5/day) in their own services.
        FormPolicy("contact_admin", min_age=3, global_default=100),
        FormPolicy("catering_request", min_age=5, global_default=200),
        FormPolicy("brand_create", min_age=4, user_limit=20, global_default=200),
        # authenticated + owner-gated; rate limit only (the page makes follow-on calls)
        FormPolicy("location_create", require_token=False, user_limit=40, global_default=400),
        FormPolicy("manager_invite", require_token=False, user_limit=30, global_default=300),
        # --- Cognito flows: verified through POST /forms/verify before the
        # browser calls Cognito (cannot cover direct calls to Cognito itself).
        FormPolicy("signup", min_age=4, visitor_limit=5, proxied_limit=300, direct_limit=5, global_default=60),
        FormPolicy("forgot", min_age=2, visitor_limit=5, proxied_limit=300, direct_limit=5, global_default=60),
        FormPolicy("reset", min_age=3, visitor_limit=10, proxied_limit=300, direct_limit=10, global_default=120),
        FormPolicy("confirm", min_age=2, visitor_limit=15, proxied_limit=600, direct_limit=15, global_default=200),
        FormPolicy("login", min_age=1, visitor_limit=40, proxied_limit=3000, direct_limit=40),
    )
}

# Forms a browser may request a token for / verify (everything with a token).
TOKEN_FORMS: tuple[str, ...] = tuple(n for n, p in POLICIES.items() if p.require_token)

# Platform ints the human may tune via `set_platform_int`: key -> (default, min, max).
GLOBAL_LIMIT_SETTINGS: dict[str, tuple[int, int, int]] = {
    f"{GLOBAL_LIMIT_KEY_PREFIX}{p.name}": (p.global_default, 1, 100000)
    for p in POLICIES.values()
    if p.global_default is not None
}


class Outcome(str, Enum):
    PASS = "pass"
    DROP = "drop"  # honeypot tripped (enforced): caller must NOT write anything


# --- seams tests replace (no real clock / randomness / server secret) -------


def _now() -> int:
    return int(time.time())


def _random() -> float:
    return random.random()


def _secret_material() -> str:
    """Server-side secret the keys are derived from. `FORM_GUARD_SECRET` if
    set; otherwise the DB connection URL (Secrets Manager-sourced in
    deployed environments, which already holds the DB password and is already
    readable by the Lambda -- no new secret or IAM grant). Never hardcoded."""
    explicit = os.environ.get("FORM_GUARD_SECRET")
    if explicit:
        return explicit
    from app.db.session import _get_database_url

    return _get_database_url()


_KEYS: dict[str, bytes] = {}


def _key(purpose: str) -> bytes:
    cached = _KEYS.get(purpose)
    if cached is None:
        cached = form_token.derive_key(_secret_material(), purpose)
        _KEYS[purpose] = cached
    return cached


def _hash(scope: str, value: str) -> str:
    return hmac.new(_key("hash"), f"{scope}|{value}".encode("utf-8"), hashlib.sha256).hexdigest()[:20]


# --- token issuing ----------------------------------------------------------


def issue_token(form: str) -> tuple[str, int]:
    """`(token, min_seconds)`. Raises AppError 503 if no secret is available."""
    policy = POLICIES[form]
    try:
        token = form_token.issue_token(form, _now(), _key("token"))
    except RuntimeError as exc:  # no DATABASE_URL / secret configured
        logger.error("form guard: no secret material available: %s", type(exc).__name__)
        raise AppError(503, "Service temporarily unavailable", "unavailable") from exc
    return token, policy.min_age


# --- the guard ---------------------------------------------------------------


def _client_hashes(request: Request, policy: FormPolicy, now: int, bucket: int) -> list[tuple[str, int, int]]:
    """`(counter_key, limit, ttl_end)` rows for an anonymous caller."""
    rows: list[tuple[str, int, int]] = []
    end = (bucket + 1) * WINDOW_SECONDS
    raw_visitor = (request.headers.get(VISITOR_HEADER) or "").split(",")[0].strip()[:64]
    conn = request.client.host if request.client else ""
    if raw_visitor:
        if policy.visitor_limit is not None:
            rows.append((f"v:{policy.name}:{_hash('v', raw_visitor)}:{bucket}", policy.visitor_limit, end))
        if policy.proxied_limit is not None:
            rows.append((f"c:{policy.name}:{_hash('c', conn)}:{bucket}", policy.proxied_limit, end))
    elif policy.direct_limit is not None:
        rows.append((f"d:{policy.name}:{_hash('c', conn)}:{bucket}", policy.direct_limit, end))
    return rows


async def _read_config(db: AsyncSession, policy: FormPolicy) -> tuple[bool, int | None]:
    """`(enforced, global_limit)` in ONE query; defaults on any failure."""
    global_key = f"{GLOBAL_LIMIT_KEY_PREFIX}{policy.name}"
    try:
        rows = (
            await db.execute(
                select(PlatformConfig.key, PlatformConfig.value).where(
                    PlatformConfig.key.in_([FORM_GUARD_ENFORCED_KEY, global_key])
                )
            )
        ).all()
    except Exception:  # noqa: BLE001 - never let config break the form
        logger.warning("form guard: could not read config", exc_info=True)
        await _safe_rollback(db)
        return False, policy.global_default
    values = dict(rows)
    enforced = platform_config_service.parse_bool(values.get(FORM_GUARD_ENFORCED_KEY), False)
    limit = policy.global_default
    if limit is not None and global_key in values:
        try:
            limit = max(1, int(values[global_key]))
        except (TypeError, ValueError):
            limit = policy.global_default
    return enforced, limit


async def _safe_rollback(db: AsyncSession) -> None:
    try:
        await db.rollback()
    except Exception:  # noqa: BLE001
        pass


async def _hit(db: AsyncSession, rows: list[tuple[str, int]]) -> dict[str, int] | None:
    """Atomically `+1` every `(key, expires_at)` counter in ONE statement and
    return `{key: new_n}`. `None` when the store is unavailable (fail open)."""
    table = FormGuardCounter.__table__
    insert_fn = pg_insert if db.get_bind().dialect.name == "postgresql" else sqlite_insert
    stmt = insert_fn(table).values(
        [{"counter_key": key, "n": 1, "expires_at": expires} for key, expires in rows]
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["counter_key"], set_={"n": table.c.n + 1}
    ).returning(table.c.counter_key, table.c.n)
    try:
        result = await db.execute(stmt)
        counts = {key: n for key, n in result.all()}
        await db.commit()
        return counts
    except Exception:  # noqa: BLE001 - fail open, see module docstring
        logger.warning("form guard: counter store unavailable (failing open)", exc_info=True)
        await _safe_rollback(db)
        return None


async def _maybe_purge(db: AsyncSession, now: int) -> None:
    if _random() >= PURGE_PROBABILITY:
        return
    try:
        await db.execute(delete(FormGuardCounter).where(FormGuardCounter.expires_at < now))
        await db.commit()
    except Exception:  # noqa: BLE001
        logger.warning("form guard: purge failed", exc_info=True)
        await _safe_rollback(db)


def _block(enforced: bool, form: str, reason: str, error: AppError) -> None:
    """Log a rejection (form + reason only) and raise it when enforced."""
    logger.warning("form_guard %s form=%s reason=%s", "blocked" if enforced else "would_block", form, reason)
    if enforced:
        raise error


def _rate_limited(retry_after: int) -> AppError:
    return AppError(
        429,
        "Too many requests. Please wait a while and try again.",
        "rate_limited",
        headers={"Retry-After": str(max(1, retry_after))},
    )


async def enforce(
    db: AsyncSession,
    request: Request,
    form: str,
    *,
    user_sub: str | None = None,
    token: str | None = None,
    trap: str | None = None,
) -> Outcome:
    """Run every check for `form`. Raises `AppError` (400 `form_check_failed`
    or 429 `rate_limited`) when enforced and a check fails; returns
    `Outcome.DROP` when the honeypot is filled (enforced) so the caller can
    silently discard the submission; otherwise `Outcome.PASS`.

    `token` / `trap` default to the `X-Form-Token` / `X-Form-Trap` request
    headers (set by the Next server); `POST /forms/verify` passes its body
    values instead.
    """
    policy = POLICIES[form]
    now = _now()
    bucket = now // WINDOW_SECONDS
    enforced, global_limit = await _read_config(db, policy)

    try:
        _key("token")
        _key("hash")
    except RuntimeError:
        # No server secret to derive keys from: nothing can be verified or
        # hashed. Token forms are treated as failed checks (generic 400 when
        # enforced); everything else passes un-limited, never a 500.
        logger.error("form guard: no secret material available")
        if policy.require_token:
            _block(enforced, form, "token_no_key", check_failed())
        return Outcome.PASS

    # 1. Token (stateless; a bad one is rejected before any counter write).
    nonce: str | None = None
    if policy.require_token:
        supplied = token if token is not None else request.headers.get(TOKEN_HEADER)
        result = form_token.verify_token(
            supplied,
            form,
            now,
            _key("token"),
            min_age=policy.min_age,
            max_age=TOKEN_MAX_AGE_SECONDS,
        )
        if result.ok:
            nonce = result.nonce
        else:
            _block(enforced, form, f"token_{result.reason}", check_failed())

    # 2. Honeypot (humans never fill it).
    trap_value = trap if trap is not None else request.headers.get(TRAP_HEADER)
    if trap_value and trap_value.strip():
        logger.warning("form_guard %s form=%s reason=honeypot", "blocked" if enforced else "would_block", form)
        if enforced:
            return Outcome.DROP

    # 3. Counters: ONE upsert for nonce + client/user + global.
    end = (bucket + 1) * WINDOW_SECONDS
    rows: list[tuple[str, int]] = []
    limits: dict[str, int] = {}
    nonce_key: str | None = None
    if nonce is not None:
        nonce_key = f"n:{nonce}"
        rows.append((nonce_key, now + TOKEN_MAX_AGE_SECONDS + 60))
    if user_sub is not None:
        if policy.user_limit is not None:
            key = f"u:{policy.name}:{_hash('u', user_sub)}:{bucket}"
            rows.append((key, end))
            limits[key] = policy.user_limit
    else:
        for key, limit, expires in _client_hashes(request, policy, now, bucket):
            rows.append((key, expires))
            limits[key] = limit
    global_key: str | None = None
    if global_limit is not None:
        global_key = f"g:{policy.name}:{bucket}"
        rows.append((global_key, end))
        limits[global_key] = global_limit

    if not rows:
        return Outcome.PASS
    counts = await _hit(db, rows)
    await _maybe_purge(db, now)
    if counts is None:
        return Outcome.PASS

    if nonce_key is not None and counts.get(nonce_key, 1) > 1:
        _block(enforced, form, "token_replayed", check_failed())
    for key, limit in limits.items():
        if counts.get(key, 0) > limit:
            scope = "global" if key == global_key else "client"
            _block(enforced, form, f"rate_{scope}", _rate_limited(end - now))
    return Outcome.PASS


async def enforce_strict(
    db: AsyncSession, request: Request, form: str, *, user_sub: str | None = None
) -> None:
    """`enforce`, but a tripped honeypot is the same generic 400 as any other
    failure -- for endpoints that return a created id, where a fake success
    would hand the UI an id that does not exist."""
    if await enforce(db, request, form, user_sub=user_sub) is Outcome.DROP:
        raise check_failed()

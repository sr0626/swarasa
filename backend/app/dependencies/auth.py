"""Cognito JWT verification + permission-check dependencies.

Cognito itself (user pools, groups, hosted UI) is Infra's resource (root
CLAUDE.md "Auth: AWS Cognito") — this module is the FastAPI-side glue that
verifies a Cognito-issued JWT on every non-public request and derives the
caller's identity/role from its claims, per backend/CLAUDE.md's Auth
dependency pattern (`get_current_user`, `require_owner`,
`require_location_access`). No password ever touches this backend (root
CLAUDE.md "NEVER store passwords — Cognito handles all auth").

Verification: fetch Cognito's JWKS (public signing keys) for the configured
user pool and verify the RS256 signature + issuer on every request. Cognito
*access* tokens carry `client_id` (not `aud`); *id* tokens carry `aud`. We
accept either token type (either can name the caller and their groups) and
only enforce the app-client match when `COGNITO_APP_CLIENT_ID` is set.

JUDGMENT CALL (flagged for review): backend/CLAUDE.md's env var table lists
a single `JWT_SECRET` ("Cognito JWT public key (fetched from Cognito
endpoint)"). That description is actually "fetch the public key from
Cognito's JWKS endpoint at verify time", not a static secret value, so
there is nothing to put in a `JWT_SECRET` env var — the real inputs needed
to *build* the JWKS URL are the pool id/region. This module reads
`COGNITO_USER_POOL_ID` / `COGNITO_REGION` (and optional
`COGNITO_APP_CLIENT_ID`) instead of a `JWT_SECRET` value. Confirm this
naming with Infra once the real user pool exists.

Permission checks below never trust JWT claims alone for manager location
access (root/backend CLAUDE.md, "NEVER trust JWT claims for manager
location access") — every manager check re-queries `location_manager` with
`is_active=true`.

`_resolve_current_user` also fires a best-effort `last_seen_at` touch
(`auth_service.touch_last_seen`) for `registered_user`/`manager` callers —
see that function's docstring for the throttle and why owner/admin are
excluded, and `_touch_last_seen_best_effort` below for why a failure here
can never surface as, or block, the caller's real response.
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field

import jwt
from fastapi import Depends, Header
from jwt import PyJWKClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.dependencies.db import get_db
from app.models.location_manager import LocationManager
from app.models.restaurant_brand import RestaurantBrand
from app.models.restaurant_location import RestaurantLocation
from app.services import auth_service

logger = logging.getLogger("app.dependencies.auth")

_ROLE_GROUPS = {"owner", "manager", "admin", "registered_user"}

# Roles `_resolve_current_user` touches `last_seen_at` for — mirrors
# `auth_service._PROFILE_TABLE_ROLES` (the same two roles that already get
# a `user_profile` row for `full_name`). Kept as its own local constant
# rather than importing that private name across modules (same
# cross-module convention `cognito_service.py`'s docstring documents for
# its own env-var helpers): `owner` already has `owner_account` as its one
# "last active" record if that's ever wanted, and `admin` has no local
# profile record at all — adding a `last_seen_at`-only shadow row for
# either would contradict `user_profile`'s documented one-record-per-role
# invariant (see that model's docstring). Scoped this way per
# docs/DECISIONS.md "Registered-user last-seen tracking".
_LAST_SEEN_TRACKED_ROLES = {"registered_user", "manager"}


async def _touch_last_seen_best_effort(db: AsyncSession, cognito_sub: str) -> None:
    """Wraps `auth_service.touch_last_seen` so it can never fail — or even
    slow down error-handling — the request it rides in on. This runs
    inside `get_current_user`/`get_current_user_optional`, ahead of every
    route body; an exception escaping here (or a failed rollback) must not
    turn into a 500 for something as low-stakes as an admin "last seen"
    display value.
    """
    try:
        await auth_service.touch_last_seen(db, cognito_sub)
    except Exception:  # noqa: BLE001 - deliberately broad, see docstring
        logger.warning("last_seen touch failed for %s", cognito_sub, exc_info=True)
        try:
            await db.rollback()
        except Exception:  # noqa: BLE001 - never let cleanup itself raise
            pass


def _region() -> str:
    return os.environ.get("COGNITO_REGION", "us-east-1")


def _user_pool_id() -> str:
    pool_id = os.environ.get("COGNITO_USER_POOL_ID")
    if not pool_id:
        raise RuntimeError(
            "COGNITO_USER_POOL_ID is not set. Set it in the environment "
            "before serving authenticated requests — see "
            "app/dependencies/auth.py module docstring."
        )
    return pool_id


def _issuer() -> str:
    return f"https://cognito-idp.{_region()}.amazonaws.com/{_user_pool_id()}"


_jwk_client: PyJWKClient | None = None


def _get_jwk_client() -> PyJWKClient:
    global _jwk_client
    if _jwk_client is None:
        _jwk_client = PyJWKClient(f"{_issuer()}/.well-known/jwks.json")
    return _jwk_client


@dataclass
class CurrentUser:
    """The authenticated caller, derived from a verified JWT.

    `owner_account_id` is populated lazily (by `require_owner` or one of
    the location/brand access-check dependencies below) once the local
    `owner_account` row has been resolved — it is intentionally `None`
    until then rather than eagerly querying on every single request.
    """

    cognito_sub: str
    email: str | None
    role: str
    groups: list[str] = field(default_factory=list)
    owner_account_id: int | None = None


def _extract_role(groups: list[str]) -> str:
    for group in groups:
        if group in _ROLE_GROUPS:
            return group
    # Authenticated but in no recognized pool group -> treat as the
    # least-privileged authenticated role (read-only + follow, per root
    # CLAUDE.md "Permission model").
    return "registered_user"


def _decode_token(token: str) -> dict:
    try:
        signing_key = _get_jwk_client().get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=_issuer(),
            options={"verify_aud": False},
        )
    except jwt.PyJWTError as exc:
        raise AppError(401, "Invalid or expired token", "unauthorized") from exc

    if claims.get("token_use") not in ("id", "access"):
        raise AppError(401, "Invalid token", "unauthorized")

    app_client_id = os.environ.get("COGNITO_APP_CLIENT_ID")
    if app_client_id:
        client_id = claims.get("aud") or claims.get("client_id")
        if client_id != app_client_id:
            raise AppError(401, "Invalid token audience", "unauthorized")

    return claims


async def _resolve_current_user(
    authorization: str | None, db: AsyncSession | None = None
) -> CurrentUser | None:
    """Shared verification logic behind both `get_current_user` (below) and
    `get_current_user_optional`. Returns `None` when no bearer token was
    presented at all; raises `AppError(401, ...)` when one WAS presented
    but is malformed/invalid/expired — presenting bad credentials should
    always surface a clear 401, never silently fall back to anonymous.

    `db` is optional (not just for the two FastAPI-wired callers below):
    `tests/unit/test_auth_jwt.py` calls `get_current_user` directly,
    outside FastAPI's dependency resolution, where a `Depends(get_db)`
    default argument is a plain marker object, not a real session. When
    `db` isn't a usable session, `_touch_last_seen_best_effort`'s own
    broad try/except absorbs that instead of leaking an AttributeError —
    see that function's docstring.
    """
    if not authorization or not authorization.strip().lower().startswith("bearer "):
        return None

    token = authorization.split(" ", 1)[1].strip()
    if not token:
        return None

    claims = _decode_token(token)

    sub = claims.get("sub")
    if not sub:
        raise AppError(401, "Token missing subject", "unauthorized")

    groups = claims.get("cognito:groups") or []
    if isinstance(groups, str):
        groups = [groups]

    user = CurrentUser(
        cognito_sub=sub,
        email=claims.get("email"),
        role=_extract_role(list(groups)),
        groups=list(groups),
    )

    if db is not None and user.role in _LAST_SEEN_TRACKED_ROLES:
        await _touch_last_seen_best_effort(db, user.cognito_sub)

    return user


async def get_current_user(
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> CurrentUser:
    """Verify the bearer JWT and return the caller's identity/role.

    Public routes (backend/CLAUDE.md "Public Routes") do not depend on
    this at all. Every other route does. `db` was added alongside the
    `last_seen_at` touch (see module docstring) — every existing caller
    keeps working unchanged, since FastAPI resolves and caches `get_db`
    once per request regardless of how many dependencies ask for it.
    """
    user = await _resolve_current_user(authorization, db)
    if user is None:
        raise AppError(401, "Missing bearer token", "unauthorized")
    return user


async def get_current_user_optional(
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> CurrentUser | None:
    """Same verification as `get_current_user`, but returns `None` instead
    of raising when no bearer token is present — for a route that is
    public by default but behaves differently for an authenticated caller
    (e.g. `GET /restaurants/{id}/locations` additionally surfacing the
    owning owner's/admin's own deactivated locations — see
    `docs/API_CONTRACTS.md` "GET /restaurants/{id}/locations" and
    `docs/PROJECT_PLAN.csv` "Serialize paid_until/is_active on location
    endpoints..."). A token that IS present but invalid/expired still
    raises 401 via `_resolve_current_user`, same as `get_current_user` —
    a caller presenting bad credentials gets a clear error, not a silent
    fallback to anonymous/public behavior.

    Deliberately does NOT delegate to `get_current_user` via `Depends` —
    that sub-dependency would raise on a missing token unconditionally,
    defeating the "optional" purpose. Both this and `get_current_user`
    share `_resolve_current_user` instead, kept as two separate top-level
    dependency callables so each can still be overridden independently in
    tests (`app.dependency_overrides` keys on the exact callable).
    """
    return await _resolve_current_user(authorization, db)


async def get_current_user_lenient(
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> CurrentUser | None:
    """Like `get_current_user_optional`, but ALSO returns `None` (instead of
    raising 401) when a token is presented but invalid/expired.

    For a public route whose only use of identity is a best-effort side
    effect (currently: `GET /search` recording a signed-in diner's search
    history — see `app/services/activity_service.py`). A stale token must
    never turn a public search into a 401, and nothing else on that route
    depends on who the caller is. Do NOT use this where identity gates
    access or changes what is returned — use `get_current_user_optional`
    (bad credentials => clear 401) there.
    """
    try:
        return await _resolve_current_user(authorization, db)
    except Exception:  # noqa: BLE001 - see docstring: identity here is best-effort only
        logger.info("lenient auth: ignoring unusable credentials", exc_info=True)
        return None


async def require_owner(
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CurrentUser:
    """Auth: owner. Lazily provisions the local owner_account row (see
    `docs/API_CONTRACTS.md` "GET /auth/me") so `current_user.owner_account_id`
    is always populated afterward.
    """
    if current_user.role != "owner":
        raise AppError(403, "Owner access required", "forbidden")
    owner = await auth_service.get_or_create_owner_account(
        db, current_user.cognito_sub, current_user.email
    )
    await db.commit()
    current_user.owner_account_id = owner.id
    return current_user


async def require_admin(
    current_user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    """Auth: admin."""
    if current_user.role != "admin":
        raise AppError(403, "Admin access required", "forbidden")
    return current_user


async def require_owner_or_manager(
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CurrentUser:
    """Auth: owner or manager — `GET /auth/me/activity` (extended 2026-09-22
    to give managers their own, narrower view of the same endpoint; see
    `app/services/audit_query_service.py` module docstring for the two
    roles' different scoping). For an owner caller this lazily provisions/
    looks up the local `owner_account` row (same as `require_owner`) so
    `current_user.owner_account_id` is populated. A manager caller needs no
    such lookup — manager scoping is keyed off `current_user.cognito_sub`
    directly against `location_manager.user_id`, there is no local
    "manager_account" table the way there is `owner_account`.
    """
    if current_user.role == "manager":
        return current_user
    if current_user.role != "owner":
        raise AppError(403, "Owner or manager access required", "forbidden")
    owner = await auth_service.get_or_create_owner_account(
        db, current_user.cognito_sub, current_user.email
    )
    await db.commit()
    current_user.owner_account_id = owner.id
    return current_user


async def require_registered_user(
    current_user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    """Auth: registered_user only — `POST`/`DELETE /restaurants/{id}/follow`,
    `GET /auth/me/follows` (docs/API_CONTRACTS.md "Follows"). Root
    CLAUDE.md's Permission model scopes "follow" to the `registered_user`
    role specifically ("Registered user: read-only + follow + deals") — an
    owner/manager/admin caller has no `user_follow` use case of their own
    here, same reasoning as `require_owner`/`require_admin` gating their
    own routes to exactly one role rather than "any authenticated user."
    """
    if current_user.role != "registered_user":
        raise AppError(403, "Registered user access required", "forbidden")
    return current_user


async def require_owner_or_admin(
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CurrentUser:
    """Auth: owner or admin — `GET /restaurants` (docs/API_CONTRACTS.md
    "Owner-scoped restaurant list"). For an owner caller this lazily
    provisions/looks up the local `owner_account` row (same as
    `require_owner`) so `current_user.owner_account_id` is populated —
    the service layer uses that to hard-filter the list to the caller's
    own brands, with no query param able to widen it (never trust a
    client-supplied `owner_id` for a non-admin caller, same posture as
    `PATCH /auth/me`). An admin caller gets no `owner_account_id` here;
    they may instead pass an explicit `owner_id` query param, handled
    entirely in the service layer.
    """
    if current_user.role == "admin":
        return current_user
    if current_user.role != "owner":
        raise AppError(403, "Owner or admin access required", "forbidden")
    owner = await auth_service.get_or_create_owner_account(
        db, current_user.cognito_sub, current_user.email
    )
    await db.commit()
    current_user.owner_account_id = owner.id
    return current_user


async def require_brand_write_access(
    brand_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    """Auth: owner (must own the brand) or admin — PATCH /restaurants/{id}."""
    if current_user.role == "admin":
        return current_user
    if current_user.role != "owner":
        raise AppError(403, "Not authorized for this restaurant", "forbidden")

    brand = await db.get(RestaurantBrand, brand_id)
    # A soft-deleted brand 404s for an owner, same as a nonexistent one.
    # (`owner_id is None` = unclaimed: 404 for an owner caller, as before.)
    if brand is None or brand.deleted_at is not None or brand.owner_id is None:
        raise AppError(404, "Restaurant not found", "not_found")
    owner_id_on_brand = brand.owner_id

    owner = await auth_service.get_owner_account_by_sub(db, current_user.cognito_sub)
    if owner is None or owner_id_on_brand != owner.id:
        raise AppError(403, "Not authorized for this restaurant", "forbidden")

    current_user.owner_account_id = owner.id
    return current_user


async def _reject_if_brand_deleted(db: AsyncSession, location: RestaurantLocation) -> None:
    """404 (never 403, so existence isn't leaked) when the location's brand
    has been soft-deleted (`restaurant_brand.deleted_at`,
    docs/API_CONTRACTS.md "DELETE /restaurants/{id}"). Called by every
    owner/manager location dependency AFTER its admin short-circuit — an
    admin keeps full access to a deleted brand's locations (support/restore
    flows), everyone else treats them as gone.
    """
    brand = await db.get(RestaurantBrand, location.brand_id)
    if brand is not None and brand.deleted_at is not None:
        raise AppError(404, "Location not found", "not_found")


async def require_location_write_access(
    location_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    """Auth: owner (owns parent brand), manager with an active
    `location_manager` row for this location, or admin — backend/CLAUDE.md
    "Manager permission check" pattern, implemented exactly (owner branch
    via brand ownership, else a fresh `location_manager` query with
    `is_active=True`; JWT role claim alone is never sufficient for the
    manager branch).

    Admin branch added 2026-09-17 (`docs/PROJECT_PLAN.csv` "Platform admin
    full-access parity", `docs/DECISIONS.md` "Authentication &
    Permissions") so admin can edit a location's basic info/hours/photos
    on an owner's behalf for support, matching root CLAUDE.md's
    Permission model ("Admin: full platform access") and the pattern
    `require_location_owner_or_admin` / `require_location_read_access`
    already used elsewhere. This now gates every route that previously
    excluded admin: `PATCH /locations/{id}`, `PUT /locations/{id}/hours`,
    and all four `/locations/{id}/photos*` routes (`docs/API_CONTRACTS.md`).
    `POST /locations/{id}/managers` (assigning a manager) deliberately
    does NOT use this dependency and stays owner-only — see
    `require_location_owner_only` below.
    """
    location = await db.get(RestaurantLocation, location_id)
    if location is None:
        raise AppError(404, "Location not found", "not_found")

    if current_user.role == "admin":
        return current_user

    await _reject_if_brand_deleted(db, location)

    if current_user.role == "owner":
        owner = await auth_service.get_owner_account_by_sub(db, current_user.cognito_sub)
        brand = await db.get(RestaurantBrand, location.brand_id)
        if owner is None or brand is None or brand.owner_id != owner.id:
            raise AppError(403, "Not authorized for this location", "forbidden")
        current_user.owner_account_id = owner.id
        return current_user

    result = await db.execute(
        select(LocationManager).where(
            LocationManager.user_id == current_user.cognito_sub,
            LocationManager.location_id == location_id,
            LocationManager.is_active == True,  # noqa: E712
        )
    )
    if result.scalar_one_or_none() is None:
        raise AppError(403, "Not assigned to this location", "forbidden")
    return current_user


async def require_location_owner_or_admin(
    location_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    """Auth: owner (owns parent brand) or admin — DELETE /locations/{id}
    (no manager path; only owner/admin per `docs/API_CONTRACTS.md`). Also
    reused, unchanged, for `DELETE /locations/{id}/managers/{manager_id}`
    (same auth shape per `docs/API_CONTRACTS.md` "Location Managers").
    """
    if current_user.role == "admin":
        return current_user

    location = await db.get(RestaurantLocation, location_id)
    if location is None:
        raise AppError(404, "Location not found", "not_found")

    if current_user.role != "owner":
        raise AppError(403, "Not authorized for this location", "forbidden")

    await _reject_if_brand_deleted(db, location)

    owner = await auth_service.get_owner_account_by_sub(db, current_user.cognito_sub)
    brand = await db.get(RestaurantBrand, location.brand_id)
    if owner is None or brand is None or brand.owner_id != owner.id:
        raise AppError(403, "Not authorized for this location", "forbidden")

    current_user.owner_account_id = owner.id
    return current_user


async def require_location_owner_only(
    location_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    """Auth: owner only (must own the parent brand) — no admin, no manager
    path. `POST /locations/{id}/managers` (`docs/API_CONTRACTS.md`
    "Location Managers"): assigning a manager is exclusively an owner
    action (root CLAUDE.md Key Domain Concepts, "a manager can manage
    multiple locations, assigned by owner").

    New dependency, per the contract's own implementation note: neither
    existing dependency matches this shape —
    `require_location_write_access` also admits an already-assigned
    manager (wrong here), and `require_location_owner_or_admin` also
    admits admin (also wrong here; this route has no admin path).
    """
    location = await db.get(RestaurantLocation, location_id)
    if location is None:
        raise AppError(404, "Location not found", "not_found")

    if current_user.role != "owner":
        raise AppError(403, "Not authorized for this location", "forbidden")

    await _reject_if_brand_deleted(db, location)

    owner = await auth_service.get_owner_account_by_sub(db, current_user.cognito_sub)
    brand = await db.get(RestaurantBrand, location.brand_id)
    if owner is None or brand is None or brand.owner_id != owner.id:
        raise AppError(403, "Not authorized for this location", "forbidden")

    current_user.owner_account_id = owner.id
    return current_user


async def require_location_read_access(
    location_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    """Auth: owner (owns parent brand), admin, or manager with an active
    `location_manager` row — `GET /locations/{id}/managers`
    (`docs/API_CONTRACTS.md` "Location Managers").

    RESOLVED 2026-09-17 (was a JUDGMENT CALL, flagged for review): this
    used to need its own dedicated admin short-circuit because
    `require_location_write_access` had no admin branch at all — reusing
    it unmodified for this route would have 403'd an admin caller, and
    widening it in place would have incorrectly also opened `PATCH
    /locations/{id}` / `PUT /locations/{id}/hours` to admin too (those
    explicitly excluded admin at the time). That asymmetry is gone: the
    admin-parity work in `docs/PROJECT_PLAN.csv` "Platform admin
    full-access parity" deliberately opened those routes (and the photos
    routes) to admin too, by adding the admin branch directly to
    `require_location_write_access` — so this is now a plain delegation,
    no separate admin handling needed here.
    """
    return await require_location_write_access(location_id, db, current_user)

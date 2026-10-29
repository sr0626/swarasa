"""Admin user directory (`GET /admin/users`) and the admin account actions
(`POST /admin/users/{username}/disable|enable|confirm|reset-password`).

Directory: Cognito is the source of truth for who exists, so this sweeps the
four role groups with `ListUsersInGroup` (`cognito_service.list_group_users`,
paginated and capped per group), merges a user who is in several groups into
one row, then joins two local tables in ONE chunked query each (never per
row): `user_profile` (display name, throttled `last_seen_at`) and
`owner_account` (an owner's full name). Search, filters, sort and
pagination are applied in Python afterwards -- same posture as
`admin_registered_users_service` (Cognito's cursor pagination doesn't map
onto this project's page/page_size). A pool user in NO role group is not
listed (every sign-up lands in a group via the post-confirmation Lambda).

Actions: each one re-reads the target with `AdminGetUser` (404 when gone),
applies the guardrails below, calls the Cognito Admin API, and only after
Cognito succeeded writes an `audit_log` row (`table_name="cognito_user"`,
`record_id=0` -- the entity is a Cognito identity, not a local row, and the
table has no better integer key; the target's username/sub/email live in the
snapshot) in the same transaction as the commit.

Guardrails (docs/API_CONTRACTS.md): an admin cannot disable or reset
THEMSELVES, nor the last remaining enabled admin; `confirm` only applies to
an UNCONFIRMED user. If the admin-group sweep needed for the last-admin
check fails, disable/reset FAIL CLOSED (502) rather than skip the check.
Errors are generic -- Cognito messages never reach the response.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from botocore.exceptions import BotoCoreError, ClientError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.dependencies.auth import CurrentUser
from app.dependencies.pagination import Pagination
from app.models.owner_account import OwnerAccount
from app.models.user_profile import UserProfile
from app.schemas.admin_users import (
    AdminUserActionResponse,
    AdminUserOut,
    AdminUsersResponse,
    UserAction,
    UserRole,
    UserSort,
    UserStatusFilter,
)
from app.schemas.admin_summary import AdminUsersSummary, UserRoleCounts
from app.services import audit_service, cognito_service
from app.services.admin_summary import seen_cutoff, seen_recently

logger = logging.getLogger("app.services.admin_users_service")

_CHUNK = 500

# Highest privilege first: a user's displayed `role` is the first match.
ROLE_PRECEDENCE: tuple[UserRole, ...] = ("admin", "owner", "manager", "registered_user")
AUDIT_TABLE = "cognito_user"


def _ts(value: datetime | None) -> float | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.timestamp()


def _sorted_missing_last(items: list[AdminUserOut], key, *, reverse: bool) -> list[AdminUserOut]:
    present = [u for u in items if key(u) is not None]
    missing = [u for u in items if key(u) is None]
    present.sort(key=lambda u: (key(u), u.username), reverse=reverse)
    missing.sort(key=lambda u: u.username)
    return present + missing


def _apply_sort(items: list[AdminUserOut], sort: UserSort) -> list[AdminUserOut]:
    if sort == "oldest":
        return _sorted_missing_last(items, lambda u: _ts(u.created_at), reverse=False)
    if sort == "email":
        return _sorted_missing_last(
            items, lambda u: u.email.lower() if u.email else None, reverse=False
        )
    if sort == "last_seen":
        return _sorted_missing_last(items, lambda u: _ts(u.last_seen_at), reverse=True)
    return _sorted_missing_last(items, lambda u: _ts(u.created_at), reverse=True)


def _status_matches(user: AdminUserOut, status: UserStatusFilter) -> bool:
    if status == "disabled":
        return not user.enabled
    if status == "unconfirmed":
        return not user.confirmed
    return user.enabled


def build_users_summary(users: list[AdminUserOut], *, truncated: bool) -> AdminUsersSummary:
    """Counts over the merged, UNFILTERED directory (same rows the list
    would show with no search/role/status). `active` = Cognito Enabled."""
    cutoff = seen_cutoff()
    by_role = {role: 0 for role in ROLE_PRECEDENCE}
    for user in users:
        by_role[user.role] += 1
    active = sum(1 for u in users if u.enabled)
    return AdminUsersSummary(
        total=len(users),
        active=active,
        inactive=len(users) - active,
        unconfirmed=sum(1 for u in users if not u.confirmed),
        seen_last_30_days=sum(1 for u in users if seen_recently(u.last_seen_at, cutoff)),
        by_role=UserRoleCounts(**by_role),
        truncated=truncated,
    )


async def get_admin_users(
    db: AsyncSession,
    pagination: Pagination,
    current_user: CurrentUser,
    *,
    search: str | None = None,
    role: UserRole | None = None,
    status: UserStatusFilter | None = None,
    sort: UserSort = "newest",
) -> AdminUsersResponse:
    """Raises `RuntimeError`/`ClientError`/`BotoCoreError` from the Cognito
    sweep -- the router turns that into a generic 502 (no stale/fabricated
    directory)."""
    merged: dict[str, cognito_service.PoolUserRecord] = {}
    roles_by_username: dict[str, set[UserRole]] = {}
    truncated = False
    for group in ROLE_PRECEDENCE:
        members, group_truncated = cognito_service.list_group_users(group)
        truncated = truncated or group_truncated
        for member in members:
            merged.setdefault(member.username, member)
            roles_by_username.setdefault(member.username, set()).add(group)

    subs = sorted({m.cognito_sub for m in merged.values() if m.cognito_sub})
    profiles: dict[str, tuple[str | None, datetime | None]] = {}
    owner_names: dict[str, str | None] = {}
    for start in range(0, len(subs), _CHUNK):
        chunk = subs[start : start + _CHUNK]
        for sub, name, seen in (
            await db.execute(
                select(
                    UserProfile.cognito_sub, UserProfile.full_name, UserProfile.last_seen_at
                ).where(UserProfile.cognito_sub.in_(chunk))
            )
        ).all():
            profiles[sub] = (name, seen)
        for sub, name, deleted_at in (
            await db.execute(
                select(
                    OwnerAccount.cognito_sub,
                    OwnerAccount.full_name,
                    OwnerAccount.personal_data_deleted_at,
                ).where(OwnerAccount.cognito_sub.in_(chunk))
            )
        ).all():
            owner_names[sub] = None if deleted_at is not None else name

    users: list[AdminUserOut] = []
    for username, record in merged.items():
        roles = [r for r in ROLE_PRECEDENCE if r in roles_by_username[username]]
        profile_name, last_seen = profiles.get(record.cognito_sub, (None, None))
        users.append(
            AdminUserOut(
                username=username,
                cognito_sub=record.cognito_sub,
                email=record.email,
                full_name=profile_name or owner_names.get(record.cognito_sub) or record.name,
                role=roles[0],
                roles=roles,
                status=record.status,
                confirmed=record.status != "UNCONFIRMED",
                enabled=record.enabled,
                created_at=record.created_at,
                last_seen_at=last_seen,
                is_self=record.cognito_sub == current_user.cognito_sub
                or username == current_user.cognito_sub,
            )
        )

    summary = build_users_summary(users, truncated=truncated)

    if role is not None:
        users = [u for u in users if role in u.roles]
    if status is not None:
        users = [u for u in users if _status_matches(u, status)]
    term = (search or "").strip().lower()
    if term:
        users = [
            u
            for u in users
            if term in (u.email or "").lower() or term in (u.full_name or "").lower()
        ]

    users = _apply_sort(users, sort)
    return AdminUsersResponse(
        results=users[pagination.offset : pagination.offset + pagination.page_size],
        page=pagination.page,
        page_size=pagination.page_size,
        total=len(users),
        truncated=truncated,
        summary=summary,
    )


# ---------------------------------------------------------------------------
# Actions
# ---------------------------------------------------------------------------

# Looked up by name at call time (not bound at import) so tests can patch them.
_CALL_NAMES = {
    "disable": "admin_disable_user",
    "enable": "admin_enable_user",
    "confirm": "admin_confirm_sign_up",
    "reset-password": "admin_reset_user_password",
}


def _upstream_error() -> AppError:
    return AppError(502, "Unable to complete the request. Please try again.", "upstream_error")


def _is_last_enabled_admin(target: cognito_service.PoolUserRecord) -> bool:
    """True when `target` is an admin and no OTHER enabled admin exists.
    Raises on a Cognito failure (caller fails closed)."""
    admins, _truncated = cognito_service.list_group_users(cognito_service.ADMIN_GROUP)
    is_admin = any(a.cognito_sub == target.cognito_sub or a.username == target.username for a in admins)
    if not is_admin:
        return False
    others = [
        a
        for a in admins
        if a.enabled and a.cognito_sub != target.cognito_sub and a.username != target.username
    ]
    return not others


async def perform_user_action(
    db: AsyncSession,
    current_user: CurrentUser,
    username: str,
    action: UserAction,
) -> AdminUserActionResponse:
    try:
        target = cognito_service.admin_get_user(username)
    except (ClientError, BotoCoreError, RuntimeError) as exc:
        logger.warning("admin-user %s: lookup failed: %s", action, type(exc).__name__)
        raise _upstream_error() from exc
    if target is None:
        raise AppError(404, "User not found", "not_found")

    is_self = target.cognito_sub == current_user.cognito_sub or username == current_user.cognito_sub
    if action in ("disable", "reset-password"):
        if is_self:
            raise AppError(403, "You can't do that to your own account.", "cannot_target_self")
        try:
            last_admin = _is_last_enabled_admin(target)
        except (ClientError, BotoCoreError, RuntimeError) as exc:
            logger.warning("admin-user %s: admin check failed: %s", action, type(exc).__name__)
            raise _upstream_error() from exc
        if last_admin:
            raise AppError(
                409, "This is the last remaining admin account.", "last_admin"
            )
    if action == "confirm" and target.status != "UNCONFIRMED":
        raise AppError(409, "This account is already confirmed.", "invalid_state")

    try:
        getattr(cognito_service, _CALL_NAMES[action])(target.username)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "ClientError")
        logger.warning("admin-user %s: Cognito call failed: %s", action, code)
        if code == "UserNotFoundException":
            raise AppError(404, "User not found", "not_found") from exc
        if code in ("InvalidParameterException", "NotAuthorizedException"):
            raise AppError(
                409, "That action isn't available for this account.", "action_not_allowed"
            ) from exc
        raise _upstream_error() from exc
    except (BotoCoreError, RuntimeError) as exc:
        logger.warning("admin-user %s: Cognito call failed: %s", action, type(exc).__name__)
        raise _upstream_error() from exc

    after_enabled = target.enabled
    after_status = target.status
    if action == "disable":
        after_enabled = False
    elif action == "enable":
        after_enabled = True
    elif action == "confirm":
        after_status = "CONFIRMED"
    else:
        after_status = "RESET_REQUIRED"

    await audit_service.log(
        db,
        AUDIT_TABLE,
        0,
        "update",
        actor_id=current_user.cognito_sub,
        actor_role="admin",
        old_val={"enabled": target.enabled, "status": target.status},
        new_val={
            "operation": action,
            "enabled": after_enabled,
            "status": after_status,
            "target_username": target.username,
            "target_sub": target.cognito_sub,
            "target_email": target.email,
        },
    )
    await db.commit()

    if action in ("disable", "enable"):
        return AdminUserActionResponse(username=username, action=action, enabled=after_enabled)
    return AdminUserActionResponse(username=username, action=action, status=after_status)

"""Cognito Admin API lookups backing `/locations/{id}/managers`.

docs/API_CONTRACTS.md "Location Managers" identifies the manager being
assigned by email, not by Cognito `sub` (an owner knows the person's email,
not their opaque subject id — see the contract's "Identifier judgment
call" note). This module resolves between the two via `cognito-idp:
ListUsers`, filtered to this one user pool:
  - `find_sub_by_email` — POST /locations/{id}/managers, resolving the
    request body's `manager_email` to the `sub` written into
    `location_manager.user_id`. Returns `None` when nobody has signed up
    with that email yet; the router/service layer turns that into the
    contract's `404 manager_not_found` (no invite-by-email flow exists).
  - `find_email_by_sub` — read-time resolution of `location_manager.
    user_id` back to a display `email` on GET responses (never stored —
    same "resolve the external identifier back to something human-
    readable on the way out" pattern `s3_service.resolve_media_url` uses
    for `s3_key`). Returns `None` on any lookup failure (deleted user,
    throttling, etc.) rather than raising, since this is a display-only
    field (root CLAUDE.md "NEVER expose internal stack details").

`add_user_to_group` (claim approval -> `owner` group) additionally needs
`cognito-idp:AdminAddUserToGroup` — see its docstring.

`count_users_in_group` (added for `GET /admin/registered-user-count`, see
docs/API_CONTRACTS.md) additionally needs `cognito-idp:ListUsersInGroup` —
see its docstring for why this is a separate action/grant from the
`ListUsers` lookups above rather than a reuse of them.

`list_registered_users` (added for `GET /admin/registered-users`, see
docs/API_CONTRACTS.md) reuses that exact same `ListUsersInGroup` grant —
no new IAM action or scope needed, same call shape, just returning the
per-user records instead of only a running count.

IAM (root CLAUDE.md "AWS Best Practices" — least privilege): the lookups need
exactly one new action, `cognito-idp:ListUsers`, scoped to exactly one
resource — this app's single user pool ARN. No write actions
(AdminCreateUser, AdminDeleteUser, …), no access to any other pool. If the
Lambda execution role doesn't have this permission yet, that's an Infra
follow-up (see task report) — not something to work around here.

Reads `COGNITO_USER_POOL_ID` / `COGNITO_REGION`, the same env vars
`app/dependencies/auth.py` uses for JWKS verification (see that module's
JUDGMENT CALL note on naming) — duplicated here as module-private helpers
rather than importing auth.py's private (`_`-prefixed) functions across
modules.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime

import boto3
from botocore.exceptions import ClientError

OWNER_GROUP = "owner"
REGISTERED_USER_GROUP = "registered_user"

_cognito_client = None


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


def _get_client():
    global _cognito_client
    if _cognito_client is None:
        _cognito_client = boto3.client("cognito-idp", region_name=_region())
    return _cognito_client


def _escape_filter_value(value: str) -> str:
    # ListUsers `Filter` values are double-quoted strings; escape any
    # embedded quote/backslash so a crafted email can't break out of the
    # filter expression.
    return value.replace("\\", "\\\\").replace('"', '\\"')


def find_sub_by_email(email: str) -> str | None:
    """Look up a Cognito user's `sub` by email, scoped to this one pool.

    Uses a server-side `Filter` (not a full-pool scan/paginate-and-match)
    per the least-privilege/no-broad-read posture above. Returns `None`
    when no user pool account exists for that email.
    """
    response = _get_client().list_users(
        UserPoolId=_user_pool_id(),
        Filter=f'email = "{_escape_filter_value(email)}"',
        Limit=1,
    )
    users = response.get("Users") or []
    if not users:
        return None
    for attr in users[0].get("Attributes", []):
        if attr.get("Name") == "sub":
            return attr.get("Value")
    return None


def find_email_by_sub(sub: str) -> str | None:
    """Reverse lookup for read-time `email` resolution on manager rows.
    Never raises — a display-only field must not break the read path.
    """
    try:
        response = _get_client().list_users(
            UserPoolId=_user_pool_id(),
            Filter=f'sub = "{_escape_filter_value(sub)}"',
            Limit=1,
        )
    except ClientError:
        return None
    users = response.get("Users") or []
    if not users:
        return None
    for attr in users[0].get("Attributes", []):
        if attr.get("Name") == "email":
            return attr.get("Value")
    return None


def count_users_in_group(group_name: str) -> int:
    """Count members of a Cognito pool group, scoped to this one pool.

    Backs `GET /admin/registered-user-count` (docs/API_CONTRACTS.md) — the
    admin "total registered users" figure. "Registered users" here means
    the `registered_user` group specifically (diners), not the whole pool:
    `owner`/`manager`/`admin` accounts are excluded on purpose, the same
    reading `GET /admin/notifications`'s `new_users` limitation note
    anticipated when it called out this exact gap.

    Uses `ListUsersInGroup`, paginated via `NextToken`, summing page sizes
    rather than materializing every user's attributes — this only needs a
    count, not identities. This is a *different* IAM action from the
    `ListUsers`-based lookups above (`find_sub_by_email`/
    `find_email_by_sub`): `ListUsers` can filter by email/sub but has no
    per-group filter, and `ListUsersInGroup` has no equivalent free-text
    filter — they are complementary, not substitutable, so this module
    grants both narrowly rather than trying to force one API to do both
    jobs.

    Raises `RuntimeError` when `COGNITO_USER_POOL_ID` is unset and
    `botocore` `ClientError`/`BotoCoreError` on AWS failures — unlike the
    read-time lookups above, there is no sensible fallback value for a
    headline admin count, so this does not swallow errors; the caller
    (the router) turns a failure into a generic 502 rather than a stale or
    fabricated number (root CLAUDE.md "NEVER expose internal stack
    details").

    No caching: this is a live call on every request. Admin-only, low
    traffic (one operator-facing page), and `ListUsersInGroup` is cheap
    relative to Lambda's own per-invocation cost — not worth the added
    complexity of a cache + invalidation story for Phase 1. Revisit if the
    admin overview page starts polling this on an interval instead of a
    per-visit load.
    """
    client = _get_client()
    pool_id = _user_pool_id()
    count = 0
    next_token: str | None = None
    while True:
        kwargs = {"UserPoolId": pool_id, "GroupName": group_name, "Limit": 60}
        if next_token:
            kwargs["NextToken"] = next_token
        response = client.list_users_in_group(**kwargs)
        count += len(response.get("Users") or [])
        next_token = response.get("NextToken")
        if not next_token:
            break
    return count


@dataclass(frozen=True)
class RegisteredUserRecord:
    """One `registered_user` pool member, as returned by
    `list_registered_users` below. `cognito_sub` falls back to `Username`
    only in the (untested-in-practice, but not impossible) case a pool
    member has no `sub` attribute in the `ListUsersInGroup` response —
    `Username` is Cognito's own stable per-pool identifier either way."""

    cognito_sub: str
    email: str | None
    status: str
    signup_at: datetime | None


def list_registered_users() -> list[RegisteredUserRecord]:
    """List every member of the `registered_user` pool group, for the
    admin "Registered users" report (`GET /admin/registered-users`, see
    docs/API_CONTRACTS.md and `app/services/admin_registered_users_service.py`).

    Same `ListUsersInGroup` action/grant as `count_users_in_group` (see
    module docstring) — this is the "give me the records" sibling of that
    "give me just the count" call, not a new permission.

    JUDGMENT CALL (flagged for review): `ListUsersInGroup` paginates via an
    opaque `NextToken` cursor, not `page`/`page_size` offsets — incompatible
    with this project's usual `Pagination(page, page_size)` convention
    (backend/CLAUDE.md "ALWAYS include pagination on list endpoints"),
    which assumes a query-able local table. Rather than exposing Cognito's
    cursor directly (a leaky, backend-specific pagination contract the
    frontend would have to special-case) or building a local mirror table
    (rejected for `count_users_in_group` for the same reasons — see
    docs/DECISIONS.md "Admin registered-user count"), this function
    fetches every page from Cognito (same bounded, admin-only, low-traffic
    assumption already accepted for the count endpoint) and the caller
    (`admin_registered_users_service.get_registered_users`) paginates the
    resulting list in Python. Revisit only if the diner pool grows large
    enough that a full `ListUsersInGroup` sweep becomes slow or costly on
    every admin page-load — not a concern at Phase 1 scale.

    Raises `RuntimeError`/`ClientError`/`BotoCoreError` same as
    `count_users_in_group` — no silent fallback for an admin report's data.
    """
    client = _get_client()
    pool_id = _user_pool_id()
    records: list[RegisteredUserRecord] = []
    next_token: str | None = None
    while True:
        kwargs = {"UserPoolId": pool_id, "GroupName": REGISTERED_USER_GROUP, "Limit": 60}
        if next_token:
            kwargs["NextToken"] = next_token
        response = client.list_users_in_group(**kwargs)
        for user in response.get("Users") or []:
            attrs = {
                attr.get("Name"): attr.get("Value") for attr in user.get("Attributes", [])
            }
            records.append(
                RegisteredUserRecord(
                    cognito_sub=attrs.get("sub") or user.get("Username", ""),
                    email=attrs.get("email"),
                    status=user.get("UserStatus", "UNKNOWN"),
                    signup_at=user.get("UserCreateDate"),
                )
            )
        next_token = response.get("NextToken")
        if not next_token:
            break
    return records


def add_user_to_group(username: str, group_name: str) -> None:
    """`AdminAddUserToGroup` against this app's one user pool. Idempotent
    on the AWS side (adding an existing member is a no-op success).

    Raises `RuntimeError` when `COGNITO_USER_POOL_ID` is unset and
    `botocore` `ClientError`/`BotoCoreError` on AWS failures — the caller
    decides how to degrade (see `claim_service.approve_claim`).

    IAM: needs `cognito-idp:AdminAddUserToGroup` on this pool's ARN only
    (granted by a separate Infra change; the same action the post-
    confirmation Lambda already uses).
    """
    _get_client().admin_add_user_to_group(
        UserPoolId=_user_pool_id(), Username=username, GroupName=group_name
    )

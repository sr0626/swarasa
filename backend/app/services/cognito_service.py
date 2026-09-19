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

import boto3
from botocore.exceptions import ClientError

OWNER_GROUP = "owner"

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

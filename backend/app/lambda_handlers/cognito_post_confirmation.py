"""Cognito post-confirmation Lambda trigger — assigns a newly-confirmed user
to the matching Cognito pool group, based on the `custom:role` attribute set
at sign-up time (frontend/src/components/auth/SignUpForm.tsx, PR #79).

Gap this closes (docs/PROJECT_PLAN.csv row "Cognito post-confirmation Lambda
-- assign sign-up role to pool group"): the sign-up form already sets
`custom:role` to `owner` or `registered_user`, exactly as
infra/modules/cognito/main.tf's schema comment anticipates ("set by
post-confirmation Lambda or admin") — but until this handler existed, nothing
downstream ever read it. A self-signed-up owner landed in NO Cognito group
and was treated as a bare `registered_user` (the existing fallback) until an
admin manually ran `admin-add-user-to-group`.

Trigger: Cognito User Pool "post confirmation" Lambda trigger
(infra/modules/cognito/main.tf's `lambda_config { post_confirmation = ... }`
on `aws_cognito_user_pool.main`), invoked once per user immediately after
they confirm their account via the email verification code. Event shape:
https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-post-confirmation.html

Deliberately kept import-isolated the same way
`app/lambda_handlers/resize_photo.py` is: only stdlib + boto3, nothing from
`app.services` / `app.routers` / `app.models` / `app.core` (those pull in
fastapi/sqlalchemy/mangum, which this tiny zip-packaged Lambda does not
install — see infra/modules/cognito/main.tf's packaging comment for why this
Lambda is zip, not the API Lambda's container-image convention).

Role -> group mapping and the manager/admin question: the current sign-up
form only ever sends `custom:role = "owner"` or `custom:role =
"registered_user"` — `manager` accounts are provisioned by an existing owner
inviting an existing Cognito user by email (Location Managers sub-resource),
and `admin` accounts are provisioned manually by a human
(seed_dev_data.py's documented prerequisite). Neither goes through
self-service sign-up today. This handler still maps `manager` -> the
`manager` group and `admin` -> the `admin` group defensively (ROLE_TO_GROUP
below) rather than treating them as invalid: if a future sign-up flow (or a
bug) ever sends one of those values, silently leaving that user in no group
at all — with nothing in the logs to say why — is a worse failure mode than
honoring an explicit, well-formed role value the same way `owner`/
`registered_user` are honored. Both paths cost the same one
AdminAddUserToGroup call, so there is no real downside to supporting them.

Never raises. AWS's own guidance for Cognito Lambda triggers
(https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-triggers.html)
is explicit that a trigger which throws can fail the operation it's attached
to — here, that would mean a confirmed user gets an error back instead of a
completed sign-up, over what is at worst a cosmetic group-assignment miss
recoverable by an admin later. Every failure path (missing `custom:role`,
an unrecognized value, or a boto3/AdminAddUserToGroup error) is logged and
swallowed; `handler` always returns the incoming `event` unmodified, which
is what Cognito requires to proceed with confirmation.
"""
from __future__ import annotations

import logging

import boto3

logger = logging.getLogger("app.lambda_handlers.cognito_post_confirmation")

# custom:role value -> Cognito pool group name (infra/modules/cognito/main.tf
# defines exactly these 4 groups: owner, manager, admin, registered_user).
# Keys are lowercase; the handler lowercases the incoming attribute before
# lookup so a stray case mismatch doesn't fall through as "unrecognized".
ROLE_TO_GROUP = {
    "owner": "owner",
    "registered_user": "registered_user",
    # Defensive only — see module docstring. No current sign-up path sends
    # these, but honoring them costs nothing and avoids a silent no-op.
    "manager": "manager",
    "admin": "admin",
}

_cognito_client = None


def _get_cognito_client():
    global _cognito_client
    if _cognito_client is None:
        _cognito_client = boto3.client("cognito-idp")
    return _cognito_client


def handler(event, context):
    """Cognito `PostConfirmation_ConfirmSignUp` trigger entry point.

    Always returns `event` unmodified — required by Cognito to complete the
    confirmation flow regardless of whether group assignment succeeded.
    """
    user_pool_id = event.get("userPoolId")
    username = event.get("userName")
    attributes = event.get("request", {}).get("userAttributes", {}) or {}
    role = (attributes.get("custom:role") or "").strip().lower()

    if not role:
        logger.info("No custom:role attribute for user %s — no group assigned", username)
        return event

    group_name = ROLE_TO_GROUP.get(role)
    if not group_name:
        logger.warning(
            "Unrecognized custom:role %r for user %s — no group assigned", role, username
        )
        return event

    try:
        _get_cognito_client().admin_add_user_to_group(
            UserPoolId=user_pool_id,
            Username=username,
            GroupName=group_name,
        )
        logger.info("Added user %s to group %s (custom:role=%s)", username, group_name, role)
    except Exception:
        # Never let a group-assignment failure block sign-up confirmation —
        # see module docstring. Log and continue; an admin can fix group
        # membership by hand, the same manual fallback this Lambda exists
        # to eliminate for the common case.
        logger.exception("Failed to add user %s to group %s", username, group_name)

    return event

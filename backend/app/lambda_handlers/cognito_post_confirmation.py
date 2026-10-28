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

Role -> group mapping: ONLY `owner` and `registered_user` are honored.
`custom:role` is a client-settable attribute on a public app client, so
anyone can call Cognito SignUp directly with any value. Honoring `admin` or
`manager` here let a self-signed-up user confirm their email and land in the
admin group (privilege escalation, fixed 2026-10-28). `manager` accounts get
their group from the invite-accept path in the API (which validates a
single-use token and email match) or an owner assigning an existing user, and
`admin` accounts are provisioned manually by a human. Any other value is
logged and ignored (the user lands in no group).

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
# defines 4 groups; only the two self-service ones may be assigned here).
# Keys are lowercase; the handler lowercases the incoming attribute before
# lookup so a stray case mismatch doesn't fall through as "unrecognized".
ROLE_TO_GROUP = {
    "owner": "owner",
    "registered_user": "registered_user",
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

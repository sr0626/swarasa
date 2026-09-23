"""EventBridge cron Lambda — flips an expired deal's `is_active` to false.

Trigger: the 5-minute EventBridge cron rule already wired to this Lambda
(`infra/modules/eventbridge/main.tf` -> `infra/modules/lambda/main.tf`'s
`aws_lambda_function.deal_expiry`, `handler = "deal_expiry.handler"`) — that
resource was scaffolded ahead of this feature with only a placeholder body;
this file is the real handler it already calls.

Implements docs/DECISIONS.md "Single EventBridge cron rule for deal expiry":
    UPDATE deal SET is_active=false
    WHERE is_active=true AND end_at IS NOT NULL AND end_at <= NOW()

RECONCILED, not a literal single-statement translation of that SQL: this
task (root CLAUDE.md "ALWAYS — Quality") also requires an audit_log entry
for every deal write, `deal` included — a requirement that already existed
when the SQL above was first decided, but that decision's own text didn't
account for it. A bare bulk UPDATE has no "before" row to log, so this
handler instead SELECTs the expiring rows, flips `is_active` on each ORM
instance (same net WHERE predicate, executed as one query), and writes one
audit_log entry per row before committing — functionally the same
outcome, audit-compliant. At Phase 1/2 DFW seed volume (~500 restaurants,
docs/DECISIONS.md "Data seeding") the number of deals expiring in any given
5-minute window is small; revisit with a bulk UPDATE + a single aggregate
audit row if that ever stops being true.

## DB access — VPC confirmed provisioned, PACKAGING is not (flagged, not
## silently solved — this task's own instructions asked for exactly this
## check before assuming either way)

`infra/modules/lambda/main.tf`'s `aws_lambda_function.deal_expiry` already
has `vpc_config` (same `subnet_ids`/`lambda_sg_id` as the API Lambda) and
`DB_SECRET_NAME` in its environment — network reachability to Aurora and
DB-credential access are both already there, nothing to add on that front.

What is NOT there: this Lambda is declared with `package_type` implicitly
"Zip" (`runtime = "python3.12"`, `handler = "deal_expiry.handler"`,
`filename = data.archive_file.deal_expiry_placeholder.output_path`) and
`archive_file` only zips literal inline source text — there is no
dependency-bundling step (no requirements.txt install into that zip, unlike
the API Lambda's container image or even the resize Lambda's own
`Dockerfile.resize` + `requirements-resize.txt`). This handler necessarily
imports `app.db.session` / `app.models.deal` / `app.services.audit_service`
to do real Postgres work — pulling in the full sqlalchemy[asyncio] +
asyncpg + geoalchemy2 dependency chain (see `app/models/__init__.py`,
imported transitively) — deliberately NOT kept import-isolated the way
`resize_photo.py`/`cognito_post_confirmation.py` are, because "flip an
is_active flag in Postgres with an audit trail" has no minimal-dependency
alternative the way "resize an S3 image" or "call one Cognito API" does.
As currently packaged (a placeholder zip with one inline file, no installed
dependencies), this handler will fail on import the moment it's actually
deployed. This is an Infra/DevOps follow-up, not something resolved here
(out of this task's Architect/Backend scope, and root CLAUDE.md "NEVER
modify files outside your designated directory") — flagged explicitly in
this PR's description for a human/Infra decision. Recommendation: convert
this Lambda to a container image the same way the API Lambda already is
(DECISIONS.md "Containerization"), reusing `backend/Dockerfile`'s base
layer with a different `CMD`, since it needs the identical dependency set —
cheaper than inventing a second zip-with-a-vendored-`site-packages/`
convention for one function.

## System-initiated audit actor (first of its kind in this codebase)

Every other `audit_log` write in this app is attributed to a human caller
(`current_user.cognito_sub` / `.role`) — this is the first write with no
human in the loop at all. `actor_role="system"` extends the informal set
documented in `app/models/audit_log.py`'s comment ("owner" | "manager" |
"admin") without a migration (the column is a plain `String(16)`, not a DB
enum) — the alternative of reusing `"admin"` would misattribute an
automated action to a human administrator who did nothing, which is worse
for an audit trail's actual purpose (reconstructing who/what did this).
`actor_id="system:deal_expiry_lambda"` is a self-describing, stable string
rather than a Cognito sub (none exists for a Lambda invocation) — flagged
here for human confirmation of the convention, since every future
system-initiated write in this app should probably follow the same
`"system:<lambda_or_job_name>"` shape rather than each one inventing its
own.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import select

logger = logging.getLogger("app.lambda_handlers.deal_expiry")

SYSTEM_ACTOR_ID = "system:deal_expiry_lambda"
SYSTEM_ACTOR_ROLE = "system"


async def _expire_deals() -> int:
    # Imported lazily inside the coroutine, not at module scope — mirrors
    # this codebase's management-command style (app/scripts/management.py)
    # of only pulling in the DB stack when actually running DB work, and
    # keeps this module importable (for the count-only unit test) even in
    # an environment where the full sqlalchemy/asyncpg stack isn't
    # installed. See module docstring's packaging note for why deal_expiry
    # can't avoid this dependency chain the way resize_photo.py does.
    from app.db.session import dispose_engine, get_session_factory
    from app.models.deal import Deal
    from app.services import audit_service

    session_factory = get_session_factory()
    now = datetime.now(timezone.utc)
    expired_count = 0

    async with session_factory() as db:
        result = await db.execute(
            select(Deal).where(
                Deal.is_active == True,  # noqa: E712
                Deal.end_at.isnot(None),
                Deal.end_at <= now,
            )
        )
        expired = list(result.scalars().all())

        for deal in expired:
            old_val = {"is_active": True}
            deal.is_active = False
            await audit_service.log(
                db,
                table_name="deal",
                record_id=deal.id,
                action="update",
                actor_id=SYSTEM_ACTOR_ID,
                actor_role=SYSTEM_ACTOR_ROLE,
                old_val=old_val,
                new_val={"is_active": False},
            )

        await db.commit()
        expired_count = len(expired)

    # Same reasoning as app/db/session.py's management-command callers:
    # each Lambda invocation gets its own asyncio.run() loop below, and a
    # warm container's cached engine would otherwise be bound to a
    # previous invocation's now-closed loop.
    await dispose_engine()
    return expired_count


def handler(event, context):
    """EventBridge scheduled-event entry point. `event`/`context` are
    unused (the cron rule carries no meaningful payload) — accepted only
    because every Lambda handler must accept them."""
    count = asyncio.run(_expire_deals())
    logger.info("deal_expiry: flipped %d deal(s) to is_active=false", count)
    return {"expired": count}

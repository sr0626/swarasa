"""Dispatch table for one-off management commands, invoked directly via
`aws lambda invoke` -- bypassing API Gateway/Mangum entirely. See
`app/main.py`'s `handler` for the branch that routes here, and
`seed_dev_data.py`'s module docstring ("How to actually run this against
the real dev database") for *why* this exists: Aurora sits in private
subnets with no NAT Gateway, no bastion host, and the RDS Data API is not
enabled (checked against `infra/modules/networking` and
`infra/modules/aurora`, not assumed) -- the deployed Lambda's own VPC
route is the only thing on this side of the account that can reach it, so
a script that needs to write to Aurora has to run inside a Lambda
invocation.

Not an HTTP surface -- there is no API Gateway route in front of this, no
JWT/Cognito auth applies, and none should ever be added here. The trust
boundary is IAM: only a caller who already holds `lambda:InvokeFunction`
on this one function in the target AWS account can reach it at all, which
is the same "already has real AWS access" boundary as `terraform apply`
or any other direct AWS action elsewhere in this repo. Keep this dispatch
table tiny and strictly dev/ops-only -- never wire real application
business logic through it; that belongs behind the normal FastAPI/Mangum
path with normal auth.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable

logger = logging.getLogger("app.scripts.management")

_COMMANDS: dict[str, Callable[[dict], dict]] = {}


def _command(name: str):
    def decorator(fn: Callable[[dict], dict]) -> Callable[[dict], dict]:
        _COMMANDS[name] = fn
        return fn

    return decorator


@_command("seed_dev_data")
def _run_seed_dev_data(event: dict) -> dict:
    from app.scripts.seed_dev_data import SeedConfigError, run_seed

    identities_path = event.get("identities_path")
    try:
        counts = asyncio.run(run_seed(identities_path))
    except SeedConfigError as exc:
        return {"ok": False, "command": "seed_dev_data", "error": str(exc)}
    return {"ok": True, "command": "seed_dev_data", "counts": counts}


@_command("bulk_import_restaurants")
def _run_bulk_import_restaurants(event: dict) -> dict:
    """One-off/reusable restaurant basic-detail bulk import, run the same
    way `seed_dev_data` is (see this file's module docstring for why: no
    NAT/bastion/RDS Data API, so a script that writes to Aurora has to run
    inside a Lambda invocation).

    Two mutually exclusive input shapes on the same command (extends,
    doesn't fork -- docs/DECISIONS.md "CSV bulk restaurant import"):

    1. JSON list, one shared owner for the whole batch (original shape):
        {
          "_management_command": "bulk_import_restaurants",
          "owner_email": "owner@example.com",       # OR "owner_cognito_sub"
          "restaurants": [ {"name": ..., "address_line1": ..., ...}, ... ]
        }
       `owner_email`/`owner_cognito_sub` resolves an EXISTING local
       `owner_account` row -- this command does not create one (unlike
       `seed_dev_data`'s owner provisioning). The owner must already exist,
       e.g. from a prior `seed_dev_data` run; if resolution fails, this
       returns `ok: False` with a clear reason rather than silently
       provisioning a new owner_account for what might be a typo'd email.

    2. CSV text, per-row owner (added for the CSV bulk-import feature --
       see `app/services/restaurant_bulk_import_service.py`'s "CSV import
       path" docstring section for the full rationale, including why
       geocoding does NOT happen in this function):
        {
          "_management_command": "bulk_import_restaurants",
          "csv_content": "name,address_line1,...\\nNamaste Grill,...\\n"
        }
       Every row supplies its own `owner_email` column (resolved the same
       "must already exist" way as (1)) -- normally produced by
       `scripts/bulk_import_restaurants_csv.py`, which reads a local CSV
       file, geocodes rows missing lat/lon via Nominatim on the human's
       own machine (this Lambda has no internet route -- no NAT Gateway,
       see the service module's docstring), and invokes this command with
       the enriched CSV text.

    If both `restaurants` and `csv_content` are present, `csv_content`
    wins (CSV is the newer, per-row-owner path; silently ignoring one of
    two conflicting inputs would be more surprising than picking one).
    """
    from app.db.session import get_session_factory
    from app.services import auth_service, cognito_service
    from app.services.restaurant_bulk_import_service import BulkImportError, bulk_import_restaurants

    csv_content = event.get("csv_content")
    if csv_content:
        return asyncio.run(_run_csv_bulk_import(csv_content))

    restaurants = event.get("restaurants")
    if not restaurants:
        return {
            "ok": False,
            "command": "bulk_import_restaurants",
            "error": "Event payload is missing a non-empty 'restaurants' list (or 'csv_content').",
        }

    owner_cognito_sub = event.get("owner_cognito_sub")
    owner_email = event.get("owner_email")
    if not owner_cognito_sub and not owner_email:
        return {
            "ok": False,
            "command": "bulk_import_restaurants",
            "error": "Event payload needs either 'owner_cognito_sub' or 'owner_email'.",
        }

    async def _run() -> dict:
        sub = owner_cognito_sub
        if not sub:
            sub = cognito_service.find_sub_by_email(owner_email)
            if sub is None:
                return {
                    "ok": False,
                    "command": "bulk_import_restaurants",
                    "error": f"No Cognito user found for owner_email {owner_email!r}.",
                }

        session_factory = get_session_factory()
        async with session_factory() as db:
            owner = await auth_service.get_owner_account_by_sub(db, sub)
            if owner is None:
                return {
                    "ok": False,
                    "command": "bulk_import_restaurants",
                    "error": (
                        f"No local owner_account row for cognito_sub {sub!r} "
                        f"(owner_email={owner_email!r}). This command looks up "
                        f"an existing owner_account, it does not create one -- "
                        f"run the 'seed_dev_data' command first if this owner "
                        f"hasn't been seeded yet."
                    ),
                }

            try:
                result = await bulk_import_restaurants(
                    db,
                    restaurants,
                    owner_id=owner.id,
                    actor_id="system:bulk_import_restaurants",
                    actor_role="admin",
                )
            except BulkImportError as exc:
                return {"ok": False, "command": "bulk_import_restaurants", "error": str(exc)}

        return {
            "ok": True,
            "command": "bulk_import_restaurants",
            "owner_id": owner.id,
            "summary": {"created": result.created, "skipped": result.skipped, "errors": result.errors},
            "rows": [
                {
                    "index": row.index,
                    "name": row.name,
                    "status": row.status.value,
                    "brand_id": row.brand_id,
                    "location_id": row.location_id,
                    "detail": row.detail,
                }
                for row in result.rows
            ],
        }

    return asyncio.run(_run())


async def _run_csv_bulk_import(csv_content: str) -> dict:
    """CSV counterpart of `_run_bulk_import_restaurants`'s inner `_run()`
    above -- kept as its own top-level function (not nested) since it's
    reached from a different branch of that command, not called alongside
    it. See `app/services/restaurant_bulk_import_service.py`'s "CSV import
    path" docstring for why no geocoding happens here.
    """
    from app.db.session import get_session_factory
    from app.services.restaurant_bulk_import_service import (
        BulkImportError,
        bulk_import_restaurants_csv,
        parse_csv_rows,
    )

    try:
        rows = parse_csv_rows(csv_content)
    except BulkImportError as exc:
        return {"ok": False, "command": "bulk_import_restaurants", "error": str(exc)}

    session_factory = get_session_factory()
    async with session_factory() as db:
        try:
            result = await bulk_import_restaurants_csv(
                db,
                rows,
                actor_id="system:bulk_import_restaurants_csv",
                actor_role="admin",
            )
        except BulkImportError as exc:
            return {"ok": False, "command": "bulk_import_restaurants", "error": str(exc)}

    return {
        "ok": True,
        "command": "bulk_import_restaurants",
        "summary": {"created": result.created, "skipped": result.skipped, "errors": result.errors},
        "rows": [
            {
                "index": row.index,
                "name": row.name,
                "status": row.status.value,
                "brand_id": row.brand_id,
                "location_id": row.location_id,
                "detail": row.detail,
                "cuisine_type_input": row.cuisine_type_input,
                "cuisine_match": row.cuisine_match,
            }
            for row in result.rows
        ],
    }


@_command("alembic_upgrade")
def _run_alembic_upgrade(event: dict) -> dict:
    from app.scripts.run_migrations import run_upgrade

    revision = event.get("revision", "head")
    result = run_upgrade(revision)
    return {"ok": True, "command": "alembic_upgrade", **result}


@_command("delete_user_data")
def _run_delete_user_data(event: dict) -> dict:
    """Dev/test-only -- see app/scripts/delete_user_data.py's module
    docstring for what this does and does NOT do (not the CCPA flow).

    Event payload shape:
        {"_management_command": "delete_user_data", "email": "test@example.com"}
        # OR: {"_management_command": "delete_user_data", "cognito_sub": "..."}
    """
    from app.scripts.delete_user_data import DeleteUserDataError, delete_user_data

    email = event.get("email")
    cognito_sub = event.get("cognito_sub")
    try:
        result = asyncio.run(delete_user_data(email=email, cognito_sub=cognito_sub))
    except DeleteUserDataError as exc:
        return {"ok": False, "command": "delete_user_data", "error": str(exc)}
    return {"command": "delete_user_data", **result}


def run_management_command(event: dict, context: Any) -> dict:
    """Entry point called from `app.main.handler`. Never raises -- every
    outcome (including an unknown command or an unhandled exception from
    the command itself) comes back as a `{"ok": bool, ...}` dict in the
    Lambda invoke response payload, since there's no HTTP status code to
    carry it on this path.
    """
    command = event.get("_management_command")
    fn = _COMMANDS.get(command)
    if fn is None:
        return {
            "ok": False,
            "error": f"Unknown management command: {command!r}. "
            f"Known commands: {sorted(_COMMANDS)}",
        }
    try:
        return fn(event)
    except Exception as exc:  # noqa: BLE001 - top-level Lambda invoke boundary
        logger.exception("management command %r failed", command)
        return {"ok": False, "command": command, "error": str(exc)}
    finally:
        # Every command here runs `asyncio.run(...)` somewhere underneath
        # it (this file's own seed_dev_data call, or run_migrations.py's
        # alembic env.py) -- and asyncio.run()'s own cleanup explicitly
        # does `asyncio.set_event_loop(None)` when it finishes (confirmed
        # against cpython's asyncio/runners.py, not assumed). On a warm
        # Lambda execution environment, the *thread* survives between
        # invocations, so that None persists into whatever this container
        # handles next. Found live: a management-command invocation landed
        # on the same warm container as a later real HTTP request, and
        # Mangum's lifespan handling (`asyncio.get_event_loop()` in
        # mangum/protocols/lifespan.py) crashed with "There is no current
        # event loop in thread 'MainThread'" -- a management command had
        # silently broken the *next* unrelated HTTP request on that
        # container. Setting a fresh loop back before returning leaves the
        # thread in the state Mangum expects, whatever runs on this
        # container next.
        asyncio.set_event_loop(asyncio.new_event_loop())

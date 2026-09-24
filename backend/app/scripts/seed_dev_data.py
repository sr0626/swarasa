"""Idempotent dev/test seed data -- NOT the real content seed.

Scope note (do not confuse the two): `docs/PROJECT_PLAN.csv` separately
tracks "Data seeding: 500 DFW restaurants, admin-curated + verified" as
real business content for later. This script is unrelated to that task --
it creates a small, deterministic set of owner/brand/location/manager/claim
rows purely so the app is loggable-into and exercisable end-to-end as each
of the 4 roles during development and testing (docs/STATUS.md "Blocking
next steps" #2: "Write a seed script ... so the app is actually
loggable-into and testable end-to-end as owner/manager/admin/
registered_user"). Every seeded brand/location name is suffixed "(Dev
Seed)" so it's never mistaken for real content in a UI screenshot or demo.

-------------------------------------------------------------------------
Cognito prerequisite (read this before running)
-------------------------------------------------------------------------
`owner_account.cognito_sub`, `location_manager.user_id`,
`claim_request.claimant_user_id`, and `audit_log.actor_id` all key off a
REAL Cognito identity (docs/DATA_MODEL.md's identity note: Cognito is the
source of truth, this app never stores a password). This script cannot
create those Cognito users itself -- that's an `aws cognito-idp
admin-create-user` + `admin-add-user-to-group` call per user, which is an
AWS CLI command a human must run with explicit per-command approval (root
CLAUDE.md "NEVER run any AWS CLI or SDK command ... without explicit
permission"). Before running this script, a human needs to have created,
in the swarasa-dev Cognito user pool:

    2 users in the "owner" group
    2 users in the "manager" group
    1 user in the "admin" group        (not referenced by this script --
                                         admin has no local DB table, see
                                         docs/DATA_MODEL.md -- listed only
                                         so every role is covered)
    1 user in the "registered_user" group

Then: copy `seed_dev_identities.example.json` (same directory) to
`seed_dev_identities.json` (gitignored -- never commit real emails) and
replace each `REPLACE_ME_*` placeholder with the matching user's real
email. This script resolves email -> Cognito `sub` at run time via
`app.services.cognito_service.find_sub_by_email` -- the exact same
`cognito-idp:ListUsers` lookup `location_manager_service.assign_manager`
already uses in the live API (see that module), scoped to this one user
pool, already granted to the Lambda's execution role
(`infra/modules/iam/main.tf`, `CognitoListUsersForManagerAssignment`) --
no new IAM grant needed. If you already know a user's `sub` and want to
skip the lookup (e.g. local testing without Cognito network access), set
`"cognito_sub": "..."` on that identity's JSON entry instead of `"email"`.

-------------------------------------------------------------------------
Idempotency
-------------------------------------------------------------------------
Every write below is check-before-insert on a natural key (cognito_sub for
owner_account, slug for restaurant_brand, (brand_id, address_line1) for
restaurant_location, name for cuisine_tag, the unique/partial-unique
constraints already on restaurant_cuisine / location_manager / claim_request
for those, (location_id, day_of_week) for restaurant_hours via
`hours_service.replace_hours`, which is itself upsert-safe). Re-running
this script is always safe and creates zero duplicate rows; it prints a
per-entity created/skipped count either way.

-------------------------------------------------------------------------
How to actually run this against the real dev database
-------------------------------------------------------------------------
Aurora sits in private subnets with no NAT Gateway, no bastion host, and
the RDS Data API is not enabled (`infra/modules/networking`,
`infra/modules/aurora` -- checked, not assumed; the only inbound rule on
the Aurora security group is "from the Lambda security group, port 5432").
A plain local `psql`/asyncpg connection from a developer's laptop cannot
reach it, and neither can this script if invoked that way. Two options,
in the order this repo can support today:

1. RECOMMENDED, works today: invoke it as a Lambda management command,
   once the real backend image has been deployed (docs/STATUS.md: still
   pending -- `deploy-backend.yml` hasn't had its first real run). The
   deployed Lambda already sits inside the VPC with a route to Aurora --
   see `app/main.py`'s `handler` (branches on a `_management_command` key
   in the invoke event, bypassing API Gateway/Mangum entirely) and
   `app/scripts/management.py`. Once deployed, a human runs (each `aws`
   command needs its own explicit approval, same as any other AWS CLI use
   in this repo):
       aws lambda invoke \\
         --function-name swarasa-api-dev \\
         --cli-binary-format raw-in-base64-out \\
         --payload '{"_management_command": "seed_dev_data"}' \\
         /tmp/seed-result.json
   This is unauthenticated at the HTTP layer (there is no HTTP layer here
   at all -- it never goes through API Gateway), but it is NOT open to the
   public: only a caller who already holds `lambda:InvokeFunction` on this
   one function in the swarasa-dev AWS account can reach it, i.e. someone
   with real AWS console/CLI access already, same trust boundary as
   `terraform apply` or any other direct AWS action in this repo.

2. Local run against a real Postgres, if one becomes reachable (e.g. a
   future SSM Session Manager port-forward, or a local Postgres+PostGIS
   for pure app-layer testing): set `DATABASE_URL` (and
   `COGNITO_USER_POOL_ID` / `COGNITO_REGION` if resolving by email) and
   run directly:
       cd backend && python -m app.scripts.seed_dev_data

Not recommended and not built here: adding a bastion host or enabling the
RDS Data API is an Infra decision (new resource, new cost line) --
flagged in the PR/report for Infra to pick up if a lower-friction path
than (1) is wanted later. This script deliberately doesn't assume either
exists.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session_factory
from app.models.claim_request import ClaimRequest
from app.models.cuisine_tag import CuisineTag
from app.models.location_manager import LocationManager
from app.models.restaurant_brand import RestaurantBrand
from app.models.restaurant_cuisine import RestaurantCuisine
from app.models.restaurant_location import RestaurantLocation
from app.schemas.hours import HourEntryIn
from app.services import audit_service, auth_service, cognito_service, hours_service, location_slug
from app.services.location_manager_service import assert_can_add_active_manager

logger = logging.getLogger("app.scripts.seed_dev_data")

_DEFAULT_IDENTITIES_PATH = Path(__file__).with_name("seed_dev_identities.json")
_PLACEHOLDER_PREFIX = "REPLACE_ME"
_SEED_ACTOR_ID = "system:seed_dev_data"


class SeedConfigError(RuntimeError):
    """Raised for a missing/incomplete identities file -- always includes
    the exact human-readable checklist of what's needed, per this script's
    "Cognito prerequisite" docstring section, so the caller (CLI or Lambda
    management command) can surface it directly without re-deriving it.
    """


# ---------------------------------------------------------------------------
# Identity config loading
# ---------------------------------------------------------------------------


@dataclass
class Identity:
    role: str
    label: str
    cognito_sub: str
    email: str | None = None
    full_name: str | None = None


@dataclass
class SeedIdentities:
    owners: list[Identity] = field(default_factory=list)
    managers: list[Identity] = field(default_factory=list)
    registered_user: Identity | None = None


def _resolve_sub(role: str, label: str, entry: dict) -> str:
    sub = entry.get("cognito_sub")
    if sub and not sub.startswith(_PLACEHOLDER_PREFIX):
        return sub

    email = entry.get("email")
    if not email or email.startswith(_PLACEHOLDER_PREFIX):
        raise SeedConfigError(
            f"{role} '{label}' has no usable 'email' or 'cognito_sub' -- "
            f"fill in a real value in seed_dev_identities.json. See "
            f"seed_dev_data.py's 'Cognito prerequisite' docstring section."
        )

    sub = cognito_service.find_sub_by_email(email)
    if sub is None:
        raise SeedConfigError(
            f"No Cognito user found for {role} '{label}' email {email!r} in "
            f"this user pool. Create that user first "
            f"(aws cognito-idp admin-create-user + admin-add-user-to-group "
            f"'{role}' -- a human runs this, not this script) before "
            f"re-running the seed."
        )
    return sub


def load_identities(path: str | Path | None = None) -> SeedIdentities:
    config_path = Path(path) if path else Path(
        os.environ.get("SEED_IDENTITIES_PATH", _DEFAULT_IDENTITIES_PATH)
    )
    if not config_path.exists():
        example_path = config_path.with_name("seed_dev_identities.example.json")
        raise SeedConfigError(
            f"Identities file not found: {config_path}. Copy "
            f"{example_path.name} to {config_path.name} and fill in real "
            f"Cognito user emails first -- this script needs 2 owner, "
            f"2 manager, and 1 registered_user identity (plus 1 admin "
            f"identity that just needs to exist in Cognito, unused by "
            f"this script) to be usable. See this script's module "
            f"docstring 'Cognito prerequisite' section for the exact "
            f"steps."
        )

    raw = json.loads(config_path.read_text())

    owners_raw = raw.get("owners") or []
    managers_raw = raw.get("managers") or []
    registered_user_raw = raw.get("registered_user")

    if len(owners_raw) < 2:
        raise SeedConfigError(
            f"{config_path} needs at least 2 entries under 'owners' "
            f"(found {len(owners_raw)})."
        )
    if len(managers_raw) < 2:
        raise SeedConfigError(
            f"{config_path} needs at least 2 entries under 'managers' "
            f"(found {len(managers_raw)})."
        )
    if not registered_user_raw:
        raise SeedConfigError(f"{config_path} is missing 'registered_user'.")

    owners = [
        Identity(
            role="owner",
            label=f"owner{i + 1}",
            cognito_sub=_resolve_sub("owner", f"owner{i + 1}", entry),
            email=entry.get("email"),
            full_name=entry.get("full_name"),
        )
        for i, entry in enumerate(owners_raw)
    ]
    managers = [
        Identity(
            role="manager",
            label=f"manager{i + 1}",
            cognito_sub=_resolve_sub("manager", f"manager{i + 1}", entry),
            email=entry.get("email"),
        )
        for i, entry in enumerate(managers_raw)
    ]
    registered_user = Identity(
        role="registered_user",
        label="registered_user1",
        cognito_sub=_resolve_sub("registered_user", "registered_user1", registered_user_raw),
        email=registered_user_raw.get("email"),
    )

    return SeedIdentities(owners=owners, managers=managers, registered_user=registered_user)


# ---------------------------------------------------------------------------
# geom sync -- same pattern as app/services/location_service.py's private
# `_sync_geom` (not imported directly: that helper is module-private to
# location_service, and duplicating 3 lines here is cheaper than exporting
# it just for this script). Keep in sync if that pattern ever changes.
# ---------------------------------------------------------------------------


async def _sync_geom(db: AsyncSession, location_id: int, lat: float, lng: float) -> None:
    from geoalchemy2.functions import ST_MakePoint, ST_SetSRID

    await db.execute(
        update(RestaurantLocation)
        .where(RestaurantLocation.id == location_id)
        .values(geom=ST_SetSRID(ST_MakePoint(lng, lat), 4326))
    )


# ---------------------------------------------------------------------------
# check-before-insert helpers -- each returns (row, created: bool)
# ---------------------------------------------------------------------------


async def ensure_owner(db: AsyncSession, identity: Identity):
    existing = await auth_service.get_owner_account_by_sub(db, identity.cognito_sub)
    if existing is not None:
        return existing, False

    owner = await auth_service.get_or_create_owner_account(db, identity.cognito_sub, identity.email)
    if identity.full_name and not owner.full_name:
        owner.full_name = identity.full_name

    # root CLAUDE.md "ALWAYS write an audit_log entry for every write on
    # ... owner_account" -- auth_service.get_or_create_owner_account (the
    # function every real request path also uses) does not itself write
    # one; flagged separately as a pre-existing gap (see PR/report), but
    # this script's own write stays compliant regardless.
    #
    # actor_role is hardcoded "owner" (not `identity.role`, which is
    # "registered_user" for the claim-flow identity below): docs/
    # DATA_MODEL.md documents audit_log.actor_role's domain as exactly
    # owner|manager|admin, and the row being created here always *is* an
    # owner_account row regardless of the caller's current Cognito group
    # -- same "becomes owner-track upon claiming" nuance
    # app/services/claim_service.py's create_claim already has (its own
    # docstring judgment call).
    await audit_service.log(
        db,
        table_name="owner_account",
        record_id=owner.id,
        action="create",
        actor_id=identity.cognito_sub,
        actor_role="owner",
        old_val=None,
        new_val={"email": owner.email},
    )
    return owner, True


async def ensure_brand(
    db: AsyncSession,
    *,
    owner_id: int | None,
    name: str,
    slug: str,
    description: str | None,
    is_claimed: bool,
    claimed_at,
    actor_id: str,
    actor_role: str,
):
    result = await db.execute(select(RestaurantBrand).where(RestaurantBrand.slug == slug))
    brand = result.scalar_one_or_none()
    if brand is not None:
        return brand, False

    brand = RestaurantBrand(
        owner_id=owner_id,
        name=name,
        slug=slug,
        description=description,
        is_claimed=is_claimed,
        claimed_at=claimed_at,
    )
    db.add(brand)
    await db.flush()

    await audit_service.log(
        db,
        table_name="restaurant_brand",
        record_id=brand.id,
        action="create",
        actor_id=actor_id,
        actor_role=actor_role,
        old_val=None,
        new_val={"name": brand.name, "slug": brand.slug, "owner_id": brand.owner_id},
    )
    return brand, True


def _to_decimal(value: float | None):
    from decimal import Decimal

    # Same conversion app/services/location_service.py's `_to_decimal` uses
    # before assigning into the Numeric(9,6) lat/lng columns -- go through
    # `str()` first to avoid binary-float rounding surprises.
    return Decimal(str(value)) if value is not None else None


async def ensure_location(
    db: AsyncSession,
    *,
    brand_id: int,
    address_line1: str,
    actor_id: str,
    actor_role: str,
    **fields,
):
    result = await db.execute(
        select(RestaurantLocation).where(
            RestaurantLocation.brand_id == brand_id,
            RestaurantLocation.address_line1 == address_line1,
        )
    )
    location = result.scalar_one_or_none()
    if location is not None:
        return location, False

    lat, lng = fields.get("latitude"), fields.get("longitude")
    model_fields = {**fields, "latitude": _to_decimal(lat), "longitude": _to_decimal(lng)}

    slug = await location_slug.assign_location_slug(
        db, brand_id, str(fields.get("city") or ""), address_line1
    )
    location = RestaurantLocation(
        brand_id=brand_id, address_line1=address_line1, slug=slug, **model_fields
    )
    db.add(location)
    await db.flush()

    if lat is not None and lng is not None:
        await _sync_geom(db, location.id, float(lat), float(lng))

    await audit_service.log(
        db,
        table_name="restaurant_location",
        record_id=location.id,
        action="create",
        actor_id=actor_id,
        actor_role=actor_role,
        old_val=None,
        new_val={
            "brand_id": brand_id,
            "address_line1": address_line1,
            "city": fields.get("city"),
        },
    )
    return location, True


async def ensure_hours(db: AsyncSession, location_id: int, week: list[HourEntryIn]) -> bool:
    """`hours_service.replace_hours` is itself upsert-safe (see its own
    docstring), so calling it every run is harmless -- but we still skip
    entirely when rows already exist so a re-run never touches hours a
    tester may have since edited by hand through the app.
    """
    existing = await hours_service.get_hours_for_location(db, location_id)
    if existing:
        return False
    await hours_service.replace_hours(db, location_id, week)
    return True


async def ensure_cuisine_tag(db: AsyncSession, *, name: str, display_name: str, category: str):
    result = await db.execute(select(CuisineTag).where(CuisineTag.name == name))
    tag = result.scalar_one_or_none()
    if tag is not None:
        return tag, False
    tag = CuisineTag(name=name, display_name=display_name, category=category, is_active=True)
    db.add(tag)
    await db.flush()
    return tag, True


async def ensure_brand_cuisine_link(db: AsyncSession, brand_id: int, cuisine_tag_id: int) -> bool:
    result = await db.execute(
        select(RestaurantCuisine).where(
            RestaurantCuisine.brand_id == brand_id,
            RestaurantCuisine.cuisine_tag_id == cuisine_tag_id,
        )
    )
    if result.scalar_one_or_none() is not None:
        return False
    db.add(RestaurantCuisine(brand_id=brand_id, cuisine_tag_id=cuisine_tag_id))
    await db.flush()
    return True


async def ensure_manager(
    db: AsyncSession,
    *,
    location: RestaurantLocation,
    manager_sub: str,
    assigned_by_owner_id: int | None,
    actor_id: str,
    actor_role: str,
):
    result = await db.execute(
        select(LocationManager).where(
            LocationManager.location_id == location.id,
            LocationManager.user_id == manager_sub,
            LocationManager.is_active == True,  # noqa: E712
        )
    )
    existing = result.scalar_one_or_none()
    if existing is not None:
        return existing, False

    # Same paid-tier 2-active-manager cap real assignments go through
    # (backend/CLAUDE.md, DECISIONS.md "Assignable location managers
    # capped at 2") -- a no-op here since this script never assigns more
    # than one manager per seeded location, but keeps this call honest if
    # that ever changes.
    await assert_can_add_active_manager(db, location)

    manager = LocationManager(
        location_id=location.id,
        user_id=manager_sub,
        assigned_by_owner_id=assigned_by_owner_id,
        is_active=True,
    )
    db.add(manager)
    await db.flush()

    await audit_service.log(
        db,
        table_name="location_manager",
        record_id=manager.id,
        action="create",
        actor_id=actor_id,
        actor_role=actor_role,
        old_val=None,
        new_val={"location_id": manager.location_id, "user_id": manager.user_id, "is_active": True},
    )
    return manager, True


async def ensure_claim(
    db: AsyncSession,
    *,
    brand_id: int,
    claimant_sub: str,
    proof_method: str,
    google_business_profile_url: str | None,
):
    result = await db.execute(
        select(ClaimRequest).where(
            ClaimRequest.brand_id == brand_id,
            ClaimRequest.claimant_user_id == claimant_sub,
        )
    )
    existing = result.scalar_one_or_none()
    if existing is not None:
        return existing, False

    claim = ClaimRequest(
        brand_id=brand_id,
        claimant_user_id=claimant_sub,
        proof_method=proof_method,
        google_business_profile_url=google_business_profile_url,
        status="pending_review",
    )
    db.add(claim)
    await db.flush()
    # claim_request is not in root CLAUDE.md's audit_log-required table
    # list (restaurant_brand/restaurant_location/menu_item/deal/
    # owner_account/location_manager only) -- matches app/services/
    # claim_service.py's create_claim, which also doesn't audit-log this.
    return claim, True


# ---------------------------------------------------------------------------
# Seed data -- small and obviously-fake on purpose (see module docstring).
# Real DFW coordinates for realistic geo-search testing; every brand/
# location name carries a "(Dev Seed)" suffix.
# ---------------------------------------------------------------------------

_WEEKDAY_HOURS = [
    HourEntryIn(day_of_week=d, open_time="11:00:00", close_time="21:30:00", is_closed=False)
    for d in range(6)  # Mon-Sat
] + [HourEntryIn(day_of_week=6, is_closed=True)]  # Sun closed

_HOURS_UNKNOWN_ONE_DAY = [
    HourEntryIn(day_of_week=d, open_time="11:00:00", close_time="22:00:00", is_closed=False)
    for d in range(6)
] + [HourEntryIn(day_of_week=6, is_closed=None)]  # Sun: unknown, "call ahead"

_TAGS = [
    ("andhra", "Andhra", "regional"),
    ("hyderabadi", "Hyderabadi", "regional"),
    ("north_indian", "North Indian", "regional"),
    ("vegetarian", "Vegetarian", "dietary"),
    ("dine_in", "Dine-in", "type"),
    ("biryani", "Biryani", "signature"),
    ("dosa", "Dosa", "signature"),
    ("dinner", "Dinner", "dining_time"),
]
# Deliberately a small subset actually used below, not the full taxonomy in
# docs/TAXONOMY.md -- seeding the complete ~62-tag taxonomy is a separate,
# slightly larger follow-up (see PR/report: docs/TAXONOMY.md's own
# "Seed Script Notes" also flags a real name collision -- both the
# "signature" and "dining_time" categories define a tag literally named
# "breakfast", which the DB's global-unique `cuisine_tag.name` constraint
# can't hold twice -- worth fixing in that doc before that fuller seed is
# written).


async def run_seed(identities_path: str | Path | None = None) -> dict:
    identities = load_identities(identities_path)
    counts = {
        "owner_account": 0,
        "restaurant_brand": 0,
        "restaurant_location": 0,
        "restaurant_hours_sets": 0,
        "cuisine_tag": 0,
        "restaurant_cuisine": 0,
        "location_manager": 0,
        "claim_request": 0,
    }

    session_factory = get_session_factory()
    async with session_factory() as db:
        owner1, owner2 = identities.owners[0], identities.owners[1]
        manager1, manager2 = identities.managers[0], identities.managers[1]

        owner1_row, created = await ensure_owner(db, owner1)
        counts["owner_account"] += int(created)
        owner2_row, created = await ensure_owner(db, owner2)
        counts["owner_account"] += int(created)
        await db.commit()

        tags_by_name: dict[str, CuisineTag] = {}
        for name, display_name, category in _TAGS:
            tag, created = await ensure_cuisine_tag(db, name=name, display_name=display_name, category=category)
            counts["cuisine_tag"] += int(created)
            tags_by_name[name] = tag
        await db.commit()

        # --- Brand A: owner1, 2 locations, one paid one free ---------------
        brand_a, created = await ensure_brand(
            db,
            owner_id=owner1_row.id,
            name="Spice Route (Dev Seed)",
            slug="devseed-spice-route",
            description="Seeded dev/test data -- not a real restaurant.",
            is_claimed=True,
            claimed_at=datetime.now(timezone.utc),
            actor_id=owner1.cognito_sub,
            actor_role="owner",
        )
        counts["restaurant_brand"] += int(created)

        loc_plano, created = await ensure_location(
            db,
            brand_id=brand_a.id,
            address_line1="1200 Legacy Dr",
            city="Plano",
            state="TX",
            postal_code="75023",
            country="US",
            phone="+14695550101",
            timezone="America/Chicago",
            latitude=33.0198,
            longitude=-96.6989,
            is_paid=True,
            paid_until=datetime.now(timezone.utc) + timedelta(days=30),
            is_verified=True,
            is_active=True,
            actor_id=owner1.cognito_sub,
            actor_role="owner",
        )
        counts["restaurant_location"] += int(created)

        loc_irving, created = await ensure_location(
            db,
            brand_id=brand_a.id,
            address_line1="500 W Airport Fwy",
            city="Irving",
            state="TX",
            postal_code="75062",
            country="US",
            phone="+14695550102",
            timezone="America/Chicago",
            latitude=32.8140,
            longitude=-96.9489,
            is_paid=False,
            paid_until=None,
            is_verified=True,
            is_active=True,
            actor_id=owner1.cognito_sub,
            actor_role="owner",
        )
        counts["restaurant_location"] += int(created)
        await db.commit()

        for tag_name in ("andhra", "hyderabadi", "biryani"):
            created = await ensure_brand_cuisine_link(db, brand_a.id, tags_by_name[tag_name].id)
            counts["restaurant_cuisine"] += int(created)
        await db.commit()

        if await ensure_hours(db, loc_plano.id, _WEEKDAY_HOURS):
            counts["restaurant_hours_sets"] += 1
        # loc_irving intentionally left with no hours rows -- exercises the
        # "hours unknown, call ahead" no-rows-at-all display case.
        await db.commit()

        manager, created = await ensure_manager(
            db,
            location=loc_plano,
            manager_sub=manager1.cognito_sub,
            assigned_by_owner_id=owner1_row.id,
            actor_id=owner1.cognito_sub,
            actor_role="owner",
        )
        counts["location_manager"] += int(created)
        await db.commit()

        # --- Brand B: owner2, 2 free locations ------------------------------
        brand_b, created = await ensure_brand(
            db,
            owner_id=owner2_row.id,
            name="Curry Leaf Kitchen (Dev Seed)",
            slug="devseed-curry-leaf-kitchen",
            description="Seeded dev/test data -- not a real restaurant.",
            is_claimed=True,
            claimed_at=datetime.now(timezone.utc),
            actor_id=owner2.cognito_sub,
            actor_role="owner",
        )
        counts["restaurant_brand"] += int(created)

        loc_frisco, created = await ensure_location(
            db,
            brand_id=brand_b.id,
            address_line1="9450 Warren Pkwy",
            city="Frisco",
            state="TX",
            postal_code="75035",
            country="US",
            phone="+14695550201",
            timezone="America/Chicago",
            latitude=33.1507,
            longitude=-96.8236,
            is_paid=False,
            paid_until=None,
            is_verified=True,
            is_active=True,
            actor_id=owner2.cognito_sub,
            actor_role="owner",
        )
        counts["restaurant_location"] += int(created)

        loc_richardson, created = await ensure_location(
            db,
            brand_id=brand_b.id,
            address_line1="100 S Central Expy",
            city="Richardson",
            state="TX",
            postal_code="75080",
            country="US",
            phone="+14695550202",
            timezone="America/Chicago",
            latitude=32.9483,
            longitude=-96.7299,
            is_paid=False,
            paid_until=None,
            is_verified=False,  # exercises the "unverified" default-sort tail
            is_active=True,
            actor_id=owner2.cognito_sub,
            actor_role="owner",
        )
        counts["restaurant_location"] += int(created)
        await db.commit()

        for tag_name in ("north_indian", "vegetarian", "dine_in"):
            created = await ensure_brand_cuisine_link(db, brand_b.id, tags_by_name[tag_name].id)
            counts["restaurant_cuisine"] += int(created)
        await db.commit()

        if await ensure_hours(db, loc_frisco.id, _WEEKDAY_HOURS):
            counts["restaurant_hours_sets"] += 1
        if await ensure_hours(db, loc_richardson.id, _HOURS_UNKNOWN_ONE_DAY):
            counts["restaurant_hours_sets"] += 1
        await db.commit()

        manager, created = await ensure_manager(
            db,
            location=loc_frisco,
            manager_sub=manager2.cognito_sub,
            assigned_by_owner_id=owner2_row.id,
            actor_id=owner2.cognito_sub,
            actor_role="owner",
        )
        counts["location_manager"] += int(created)
        await db.commit()

        # --- Brand C: unclaimed listing, 2 locations, + a pending claim ----
        brand_c, created = await ensure_brand(
            db,
            owner_id=None,
            name="Deccan Spice House (Dev Seed)",
            slug="devseed-deccan-spice-house",
            description="Seeded dev/test data -- not a real restaurant. "
            "Admin-seeded and unclaimed, for exercising the claim flow.",
            is_claimed=False,
            claimed_at=None,
            actor_id=_SEED_ACTOR_ID,
            actor_role="admin",
        )
        counts["restaurant_brand"] += int(created)

        loc_arlington, created = await ensure_location(
            db,
            brand_id=brand_c.id,
            address_line1="2401 E Lamar Blvd",
            city="Arlington",
            state="TX",
            postal_code="76006",
            country="US",
            phone="+14695550301",
            timezone="America/Chicago",
            latitude=32.7357,
            longitude=-97.1081,
            is_paid=False,
            paid_until=None,
            is_verified=True,
            is_active=True,
            actor_id=_SEED_ACTOR_ID,
            actor_role="admin",
        )
        counts["restaurant_location"] += int(created)

        loc_garland, created = await ensure_location(
            db,
            brand_id=brand_c.id,
            address_line1="3302 Broadway Blvd",
            city="Garland",
            state="TX",
            postal_code="75043",
            country="US",
            phone="+14695550302",
            timezone="America/Chicago",
            latitude=32.9126,
            longitude=-96.6389,
            is_paid=False,
            paid_until=None,
            is_verified=True,
            is_active=True,
            actor_id=_SEED_ACTOR_ID,
            actor_role="admin",
        )
        counts["restaurant_location"] += int(created)
        await db.commit()

        for tag_name in ("north_indian", "dosa", "dinner"):
            created = await ensure_brand_cuisine_link(db, brand_c.id, tags_by_name[tag_name].id)
            counts["restaurant_cuisine"] += int(created)
        await db.commit()

        if await ensure_hours(db, loc_arlington.id, _WEEKDAY_HOURS):
            counts["restaurant_hours_sets"] += 1
        # loc_garland intentionally left with no hours rows too.
        await db.commit()

        # Claim flow example: the registered_user identity claims the
        # unclaimed brand -- mirrors app/services/claim_service.py's real
        # create_claim, which also eagerly provisions the claimant's
        # owner_account row at submission time (see that module's
        # docstring judgment call) rather than waiting for approval.
        reg_user = identities.registered_user
        claimant_owner_row, created = await ensure_owner(db, reg_user)
        counts["owner_account"] += int(created)
        await db.commit()

        claim, created = await ensure_claim(
            db,
            brand_id=brand_c.id,
            claimant_sub=reg_user.cognito_sub,
            proof_method="google_business_profile",
            google_business_profile_url="https://business.google.com/dev-seed-placeholder",
        )
        counts["claim_request"] += int(created)
        await db.commit()

    logger.info("seed_dev_data complete: %s", counts)
    return counts


def _print_summary(counts: dict) -> None:
    print("seed_dev_data -- rows created this run (0 = already existed, safe to re-run):")
    for key, value in counts.items():
        print(f"  {key}: {value}")


async def _main() -> None:
    logging.basicConfig(level=logging.INFO)
    try:
        counts = await run_seed()
    except SeedConfigError as exc:
        print(f"seed_dev_data: cannot run -- {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
    _print_summary(counts)


if __name__ == "__main__":
    asyncio.run(_main())

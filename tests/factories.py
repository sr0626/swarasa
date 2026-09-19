"""factory_boy factories for test data — tests/CLAUDE.md "Test Data
Principles": always use factories, never hardcode IDs/timestamps/UUIDs.

Two layers:
  - Plain `factory.Factory` subclasses build an in-memory ORM model instance
    with fake defaults (Faker-backed) WITHOUT touching a DB session — used by
    unit tests that only need an object with the right attributes (e.g.
    `LocationFactory(is_paid=False, paid_until=None)`, mirroring the exact
    pattern in tests/CLAUDE.md's "Key Test Patterns").
  - `create_*` async helpers add a factory-built instance to a real
    AsyncSession (flush, not commit — the caller's transaction/rollback
    owns cleanup) for integration tests. factory_boy has no first-class
    async-SQLAlchemy session support, so this thin wrapper is the standard
    workaround rather than reaching for the sync-only
    `factory.alchemy.SQLAlchemyModelFactory`.

No hardcoded ids/emails/slugs anywhere below — every identity-ish field is
Faker- or sequence-generated.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import factory
from factory.faker import Faker as FactoryFaker
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.claim_request import ClaimRequest
from app.models.cuisine_tag import CuisineTag
from app.models.data_deletion_request import DataDeletionRequest
from app.models.listing_report import ListingReport
from app.models.location_manager import LocationManager
from app.models.owner_account import OwnerAccount
from app.models.restaurant_brand import RestaurantBrand
from app.models.restaurant_location import RestaurantLocation
from app.models.restaurant_photo import RestaurantPhoto
from app.models.user_follow import UserFollow


def _cognito_sub() -> str:
    return str(uuid.uuid4())


class OwnerAccountFactory(factory.Factory):
    class Meta:
        model = OwnerAccount

    cognito_sub = factory.LazyFunction(_cognito_sub)
    # Not `FactoryFaker("unique.email")` — faker's dotted "unique.<provider>"
    # proxy isn't a registered formatter name you can pass as a plain
    # string to factory.Faker; a random-but-not-strictly-unique-across-runs
    # email is fine here since every test uses its own fresh in-memory DB
    # (no cross-test collision risk) and OwnerAccount.email has a real
    # unique constraint that would surface a genuine collision loudly if
    # one ever occurred.
    email = factory.LazyFunction(lambda: f"{uuid.uuid4().hex[:12]}@example.com")
    full_name = FactoryFaker("name")
    phone = None
    stripe_customer_id = None
    stripe_sub_id = None


class RestaurantBrandFactory(factory.Factory):
    class Meta:
        model = RestaurantBrand

    name = FactoryFaker("company")
    slug = factory.LazyAttribute(lambda o: f"{o.name.lower().replace(' ', '-')}-{uuid.uuid4().hex[:8]}")
    description = FactoryFaker("catch_phrase")
    is_claimed = False
    owner_id = None
    claimed_at = None


class RestaurantLocationFactory(factory.Factory):
    """Mirrors the tests/CLAUDE.md key pattern:
    `LocationFactory(is_paid=False, paid_until=None)`.

    `geom` is intentionally left unset here — it is a PostGIS-only concept
    synced by the service layer (`location_service._sync_geom`) or, in
    integration tests, set directly by the real-Postgres search fixtures.
    Plain unit tests never touch `geom`.
    """

    class Meta:
        model = RestaurantLocation

    brand_id = factory.Sequence(lambda n: n + 1)
    location_name = None
    address_line1 = FactoryFaker("street_address")
    address_line2 = None
    city = FactoryFaker("city")
    state = "TX"
    postal_code = FactoryFaker("postcode")
    country = "US"
    phone = FactoryFaker("numerify", text="+1214555####")
    timezone = "America/Chicago"
    latitude = None
    longitude = None
    is_paid = False
    paid_until = None
    stripe_sub_item_id = None
    is_verified = False
    is_active = True


class LocationManagerFactory(factory.Factory):
    class Meta:
        model = LocationManager

    location_id = factory.Sequence(lambda n: n + 1)
    user_id = factory.LazyFunction(_cognito_sub)
    assigned_by_owner_id = None
    is_active = True
    revoked_at = None


class UserFollowFactory(factory.Factory):
    class Meta:
        model = UserFollow

    user_id = factory.LazyFunction(_cognito_sub)
    brand_id = factory.Sequence(lambda n: n + 1)


class ClaimRequestFactory(factory.Factory):
    class Meta:
        model = ClaimRequest

    brand_id = factory.Sequence(lambda n: n + 1)
    location_id = None
    claimant_user_id = factory.LazyFunction(_cognito_sub)
    proof_method = "google_business_profile"
    google_business_profile_url = FactoryFaker("url")
    supporting_document_key = None
    status = "pending_review"
    reviewed_by = None
    reviewed_at = None
    reviewer_notes = None


class ListingReportFactory(factory.Factory):
    class Meta:
        model = ListingReport

    brand_id = factory.Sequence(lambda n: n + 1)
    location_id = None
    category = "address_incorrect"
    details = FactoryFaker("sentence")
    reporter_email = None
    reporter_user_id = None
    status = "new"
    reviewed_by = None
    reviewed_at = None
    reviewer_notes = None


class DataDeletionRequestFactory(factory.Factory):
    class Meta:
        model = DataDeletionRequest

    requester_user_id = factory.LazyFunction(_cognito_sub)
    requester_role = "registered_user"
    status = "pending_review"
    reason = None
    data_scope = None
    reviewed_by = None
    reviewed_at = None
    reviewer_notes = None
    completed_at = None


class CuisineTagFactory(factory.Factory):
    """Admin-seeded taxonomy row (app/models/cuisine_tag.py) — `name` is
    unique, so always sequence/uuid-suffixed, never hardcoded (tests/CLAUDE.md
    "NEVER hardcode IDs").
    """

    class Meta:
        model = CuisineTag

    name = factory.LazyFunction(lambda: f"tag-{uuid.uuid4().hex[:10]}")
    display_name = FactoryFaker("word")
    category = "regional"
    is_active = True


class RestaurantPhotoFactory(factory.Factory):
    class Meta:
        model = RestaurantPhoto

    location_id = factory.Sequence(lambda n: n + 1)
    s3_key = factory.LazyFunction(lambda: f"locations/test/photos/{uuid.uuid4().hex}.jpg")
    is_cover = False
    display_order = 0
    uploaded_by = factory.LazyFunction(_cognito_sub)


# ---------------------------------------------------------------------------
# Async DB-persisting helpers for integration tests. `flush`, not `commit` —
# tests/CLAUDE.md "ALWAYS clean up test data after each test (use
# transactions that roll back)"; the integration conftest's session fixture
# owns the rollback.
# ---------------------------------------------------------------------------


async def create_owner(db: AsyncSession, **overrides) -> OwnerAccount:
    owner = OwnerAccountFactory(**overrides)
    db.add(owner)
    await db.flush()
    return owner


async def create_brand(db: AsyncSession, **overrides) -> RestaurantBrand:
    brand = RestaurantBrandFactory(**overrides)
    db.add(brand)
    await db.flush()
    return brand


async def create_location(db: AsyncSession, **overrides) -> RestaurantLocation:
    location = RestaurantLocationFactory(**overrides)
    db.add(location)
    await db.flush()
    return location


async def create_location_manager(db: AsyncSession, **overrides) -> LocationManager:
    manager = LocationManagerFactory(**overrides)
    db.add(manager)
    await db.flush()
    return manager


async def create_follow(db: AsyncSession, **overrides) -> UserFollow:
    follow = UserFollowFactory(**overrides)
    db.add(follow)
    await db.flush()
    return follow


async def create_claim(db: AsyncSession, **overrides) -> ClaimRequest:
    claim = ClaimRequestFactory(**overrides)
    db.add(claim)
    await db.flush()
    return claim


async def create_listing_report(db: AsyncSession, **overrides) -> ListingReport:
    report = ListingReportFactory(**overrides)
    db.add(report)
    await db.flush()
    return report


async def create_photo(db: AsyncSession, **overrides) -> RestaurantPhoto:
    photo = RestaurantPhotoFactory(**overrides)
    db.add(photo)
    await db.flush()
    return photo


async def create_deletion_request(db: AsyncSession, **overrides) -> DataDeletionRequest:
    request = DataDeletionRequestFactory(**overrides)
    db.add(request)
    await db.flush()
    return request


async def create_cuisine_tag(db: AsyncSession, **overrides) -> CuisineTag:
    tag = CuisineTagFactory(**overrides)
    db.add(tag)
    await db.flush()
    return tag


def submitted_recently() -> datetime:
    """A `submitted_at`-like timestamp a few minutes in the past — never a
    hardcoded literal timestamp (tests/CLAUDE.md guardrail)."""
    return datetime.now(timezone.utc) - timedelta(minutes=5)

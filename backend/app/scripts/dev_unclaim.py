"""DEV-ONLY: un-assign chosen restaurants (owner_id NULL, is_claimed false)
so the public "Is this your restaurant? Claim it" flow can be tested on the
real dev site. Requested directly by the user 2026-09-19 ("keep a couple of
seeded restaurants unassigned so I can test that").

Reversible: an approved claim (POST /claim/{id}/approve) re-assigns a brand,
or re-run the bulk import for it. Writes an audit_log row per brand (root
CLAUDE.md requires one for every restaurant_brand write). Slugs that don't
exist are reported, not errors. Never run against production.

Run via the `dev_unclaim_restaurants` management command:
    aws lambda invoke --function-name <fn> \\
        --payload '{"_management_command": "dev_unclaim_restaurants"}' \\
        --cli-binary-format raw-in-base64-out out.json
Optional payload key `slugs` overrides the default two.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session_factory
from app.models.restaurant_brand import RestaurantBrand
from app.services import audit_service

# Two searchable (geocoded) restaurants, so the claim CTA is reachable from a
# homepage/search tile.
DEFAULT_SLUGS = ["dera-grill", "masala-wok-indian-asian-fare"]


async def unclaim_restaurants(db: AsyncSession, slugs: list[str]) -> dict:
    """Flushes but does not commit -- the caller owns the transaction."""
    result = {"unclaimed": [], "already_unclaimed": [], "not_found": []}
    for slug in slugs:
        brand = (await db.execute(select(RestaurantBrand).where(RestaurantBrand.slug == slug))).scalar_one_or_none()
        if brand is None:
            result["not_found"].append(slug)
            continue
        if brand.owner_id is None and not brand.is_claimed:
            result["already_unclaimed"].append(slug)
            continue
        old = {"owner_id": brand.owner_id, "is_claimed": brand.is_claimed}
        brand.owner_id = None
        brand.is_claimed = False
        brand.claimed_at = None
        await audit_service.log(
            db,
            table_name="restaurant_brand",
            record_id=brand.id,
            action="update",
            actor_id="system:dev_unclaim_restaurants",
            actor_role="admin",
            old_val=old,
            new_val={"owner_id": None, "is_claimed": False},
        )
        result["unclaimed"].append(slug)
    await db.flush()
    return result


async def run_dev_unclaim(slugs: list[str] | None = None) -> dict:
    session_factory = get_session_factory()
    async with session_factory() as db:
        result = await unclaim_restaurants(db, slugs or DEFAULT_SLUGS)
        await db.commit()
    return result

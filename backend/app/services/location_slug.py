"""`restaurant_location.slug` generation — the ONE helper every code path
that creates a location uses (`POST /locations`, the CSV bulk import, the
dev seed script).

Why locations have a slug (docs/DECISIONS.md, "Location pages"): every
location gets its own public profile page at
`/restaurant/{brand_slug}/{location_slug}` because hours, deals, menu and
address differ per branch. The slug is unique PER BRAND
(`uq_restaurant_location_brand_slug`), not globally.

Rule (deterministic, so the same inputs always give the same slug):

  1. base       = slugified city                       -> `irving`
  2. if `base` is already taken by another location of the SAME brand (or is
     a reserved word), city + street                   -> `irving-2234-w-walnut-hill`
     (a trailing street-type word — Ln, Dr, Blvd... — is dropped from the
     street part, and only the first address segment is used: no suite/unit)
  3. if that is also taken, append `-2`, `-3`, ...       -> `irving-2234-w-walnut-hill-2`

The slug is FIXED once assigned: editing the address later never changes it
(`location_service.update_location` does not touch `slug`), so a shared link
never breaks. A slug freed by a hard-deleted location may be reused by a
later location of the same brand — that is the only way a URL changes hands.

The alembic migration `0014_location_slug` carries its OWN copy of this
algorithm (a migration must stay self-contained and must not import app code
that can drift). `tests/unit/test_location_slug.py` loads the migration module
and asserts both copies agree — change one, change the other.
"""
from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.restaurant_location import RestaurantLocation

# Column is `String(100)`; longer candidates are cut (trailing `-` stripped).
MAX_SLUG_LENGTH = 100

# Slugs no location may take because they collide with a sibling static
# route under `/restaurant/{brand_slug}/...` (`report` today) or read as a
# different resource. A city literally named "Report" simply falls through to
# the city + street form.
RESERVED_LOCATION_SLUGS = frozenset(
    {
        "report",
        "reports",
        "new",
        "edit",
        "admin",
        "api",
        "menu",
        "deals",
        "locations",
        "location",
    }
)

# Trailing street-type words dropped from the street part (only when the
# street has at least 3 words, so "5 Way" is left alone).
_STREET_SUFFIXES = frozenset(
    {
        "st", "street", "ave", "avenue", "blvd", "boulevard", "rd", "road",
        "dr", "drive", "ln", "lane", "ct", "court", "pkwy", "parkway",
        "hwy", "highway", "way", "pl", "place", "cir", "circle", "trl",
        "trail", "ter", "terrace", "fwy", "freeway", "expy", "expressway",
    }
)


def slugify(text: str) -> str:
    """Lowercase ASCII, runs of anything else -> a single `-`, no leading or
    trailing `-`. Accents are folded (`é` -> `e`). May return `""`."""
    folded = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "-", folded.lower()).strip("-")


def _clip(slug: str, limit: int = MAX_SLUG_LENGTH) -> str:
    return slug[:limit].strip("-")


def street_part(address_line1: str) -> str:
    """Slug of the first address segment with the trailing street-type word
    dropped — `2234 W Walnut Hill Ln` -> `2234-w-walnut-hill`."""
    first_segment = re.split(r"[,#]", address_line1, maxsplit=1)[0]
    tokens = slugify(first_segment).split("-") if slugify(first_segment) else []
    if len(tokens) >= 3 and tokens[-1] in _STREET_SUFFIXES:
        tokens = tokens[:-1]
    return "-".join(tokens)


def pick_location_slug(city: str, address_line1: str, taken: Iterable[str]) -> str:
    """The slug for a new location, given the slugs already used by the SAME
    brand's other locations. Pure function — see the module docstring for the
    rule."""
    taken_set = set(taken)

    def available(candidate: str) -> bool:
        return candidate not in taken_set and candidate not in RESERVED_LOCATION_SLUGS

    city_slug = _clip(slugify(city)) or "branch"
    if available(city_slug):
        return city_slug

    street = street_part(address_line1)
    detailed = _clip(f"{city_slug}-{street}" if street else city_slug)
    if available(detailed):
        return detailed

    n = 2
    while True:
        suffix = f"-{n}"
        candidate = _clip(detailed, MAX_SLUG_LENGTH - len(suffix)) + suffix
        if available(candidate):
            return candidate
        n += 1


async def assign_location_slug(
    db: AsyncSession, brand_id: int, city: str, address_line1: str
) -> str:
    """Reads the brand's existing location slugs and picks a free one. Callers
    set the result on the new `RestaurantLocation` before `flush()`. Two
    concurrent creates in the same brand could pick the same slug; the
    `uq_restaurant_location_brand_slug` constraint then rejects the second
    insert (owner-only, low-volume path — accepted, not retried)."""
    result = await db.execute(
        select(RestaurantLocation.slug).where(RestaurantLocation.brand_id == brand_id)
    )
    return pick_location_slug(city, address_line1, result.scalars().all())

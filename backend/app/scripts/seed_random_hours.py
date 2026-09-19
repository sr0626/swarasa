"""DEV-ONLY: give locations that have no hours at all a plausible, randomly
generated weekly schedule, so the "Open today 11am-9pm" tile label and the
open/closed display can be seen on the real dev site.

THIS IS FABRICATED TEST DATA, not real restaurant hours -- BRD/DECISIONS.md
say real hours come from owners, never guessed ("no scraped menus/hours").
It exists only because the CSV-imported dev restaurants have no owner-entered
hours yet. Never run it against a production database. Requested directly by
the user 2026-09-18 ("add some default hours randomly and close some on
mondays, some on tuesdays").

Behaviour:
  * Only locations with ZERO `restaurant_hours` rows are touched -- real or
    previously-entered hours are never overwritten, so it is safe to re-run.
  * Deterministic per location id (`random.Random(location_id)`), so the same
    location always gets the same schedule if it is ever regenerated.
  * Roughly 35% of locations are closed all day Monday, 35% closed all day
    Tuesday, 30% open all seven days.
  * Open 10:00-11:30, close 21:00-22:00 Sun-Thu; Fri/Sat close an hour later.

Run via the `seed_random_hours` management command:
    aws lambda invoke --function-name <fn> \\
        --payload '{"_management_command": "seed_random_hours"}' \\
        --cli-binary-format raw-in-base64-out out.json
"""
from __future__ import annotations

import random
from datetime import time

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session_factory
from app.models.restaurant_hours import RestaurantHours
from app.models.restaurant_location import RestaurantLocation

MONDAY, TUESDAY = 0, 1  # day_of_week: 0=Monday .. 6=Sunday (DATA_MODEL.md)
_OPEN_CHOICES = [time(10, 0), time(10, 30), time(11, 0), time(11, 30)]
_CLOSE_CHOICES = [time(21, 0), time(21, 30), time(22, 0)]


def generate_weekly_hours(location_id: int) -> list[dict]:
    """Seven dicts (day_of_week 0..6) of open_time/close_time/is_closed."""
    rng = random.Random(location_id)
    roll = rng.random()
    closed_day = MONDAY if roll < 0.35 else TUESDAY if roll < 0.70 else None
    opens = rng.choice(_OPEN_CHOICES)
    closes = rng.choice(_CLOSE_CHOICES)
    late = time(closes.hour + 1, closes.minute)

    rows: list[dict] = []
    for day in range(7):
        if day == closed_day:
            rows.append({"day_of_week": day, "open_time": None, "close_time": None, "is_closed": True})
            continue
        close = late if day in (4, 5) else closes  # Fri, Sat run an hour later
        rows.append({"day_of_week": day, "open_time": opens, "close_time": close, "is_closed": False})
    return rows


async def seed_random_hours(db: AsyncSession) -> dict[str, int]:
    """Flushes but does not commit -- the caller owns the transaction."""
    location_ids = (await db.execute(select(RestaurantLocation.id))).scalars().all()
    with_hours = set((await db.execute(select(RestaurantHours.location_id).distinct())).scalars().all())

    counts = {"locations_seeded": 0, "skipped_already_had_hours": 0,
              "closed_mondays": 0, "closed_tuesdays": 0, "open_all_week": 0}
    for location_id in location_ids:
        if location_id in with_hours:
            counts["skipped_already_had_hours"] += 1
            continue
        rows = generate_weekly_hours(location_id)
        closed = [r["day_of_week"] for r in rows if r["is_closed"]]
        counts["closed_mondays"] += int(MONDAY in closed)
        counts["closed_tuesdays"] += int(TUESDAY in closed)
        counts["open_all_week"] += int(not closed)
        for row in rows:
            db.add(RestaurantHours(location_id=location_id, **row))
        counts["locations_seeded"] += 1
    await db.flush()
    return counts


async def run_seed_random_hours() -> dict[str, int]:
    session_factory = get_session_factory()
    async with session_factory() as db:
        counts = await seed_random_hours(db)
        await db.commit()
    return counts


# --- fabricated phone numbers ------------------------------------------------
# Same DEV-ONLY fabricated-data caveat as the hours above. The tile and detail
# page render the phone as a tap-to-call `tel:` link on the live dev site, so
# these use the NANP block reserved for fictional use (555-0100 .. 555-0199)
# behind real Dallas-Fort Worth area codes -- guaranteed not to ring a real
# person. Requested directly by the user 2026-09-19.
_DFW_AREA_CODES = ["214", "469", "972"]


def generate_phone(location_id: int) -> str:
    """E.164, e.g. +19725550142. Deterministic per location id; the last two
    digits are `location_id * 37 % 100`, so up to 100 consecutive ids are
    guaranteed distinct (37 is coprime with 100)."""
    area = random.Random(location_id).choice(_DFW_AREA_CODES)
    return f"+1{area}555{100 + (location_id * 37) % 100:04d}"


async def seed_random_phones(db: AsyncSession) -> dict[str, int]:
    """Fills `phone` only where it is NULL/empty -- never overwrites a number
    an owner entered. Flushes but does not commit."""
    rows = (await db.execute(
        select(RestaurantLocation).where(or_(RestaurantLocation.phone.is_(None), RestaurantLocation.phone == ""))
    )).scalars().all()
    total = (await db.execute(select(RestaurantLocation.id))).scalars().all()
    for location in rows:
        location.phone = generate_phone(location.id)
    await db.flush()
    return {"phones_seeded": len(rows), "skipped_already_had_phone": len(total) - len(rows)}


async def run_seed_random_phones() -> dict[str, int]:
    session_factory = get_session_factory()
    async with session_factory() as db:
        counts = await seed_random_phones(db)
        await db.commit()
    return counts

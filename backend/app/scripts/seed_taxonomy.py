"""Seed the full platform taxonomy (`docs/TAXONOMY.md`) into `cuisine_tag`.

Why this exists: the real dev database had zero `cuisine_tag` rows --
`seed_dev_data.py` only inserts the handful of tags its own sample
restaurants use, and has never run against real AWS. The homepage chips,
the owner "create brand" tag picker, the CSV importer's `type` matching,
and the tag filter all depend on this table being populated.

Data source: `taxonomy.json`, sitting next to this file. It is generated
from `docs/TAXONOMY.md` (docs/ is NOT copied into the Lambda container
image; `app/` is, wholesale -- see backend/Dockerfile) and a unit test
(`tests/unit/test_seed_taxonomy.py`) fails if the two drift apart.

Idempotent: insert-if-missing keyed on `name` (globally unique on
`cuisine_tag`). Existing rows are left untouched -- an admin who has
since renamed or deactivated a tag via the admin panel is never
overwritten by a re-run.

Run via the `seed_taxonomy` management command (app/scripts/management.py):
    aws lambda invoke --function-name <fn> \\
        --payload '{"_management_command": "seed_taxonomy"}' \\
        --cli-binary-format raw-in-base64-out out.json
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import get_args

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session_factory
from app.models.cuisine_tag import CuisineTag
from app.schemas.cuisine import CuisineCategory

TAXONOMY_PATH = Path(__file__).parent / "taxonomy.json"


class TaxonomyDataError(ValueError):
    """taxonomy.json is malformed (duplicate name, unknown category)."""


def load_taxonomy(path: Path = TAXONOMY_PATH) -> list[dict[str, str]]:
    tags: list[dict[str, str]] = json.loads(path.read_text(encoding="utf-8"))
    valid_categories = set(get_args(CuisineCategory))
    seen: set[str] = set()
    for tag in tags:
        if tag["category"] not in valid_categories:
            raise TaxonomyDataError(f"Unknown category {tag['category']!r} for tag {tag['name']!r}")
        # cuisine_tag.name is globally unique across categories.
        if tag["name"] in seen:
            raise TaxonomyDataError(f"Duplicate tag name {tag['name']!r}")
        seen.add(tag["name"])
    return tags


async def seed_taxonomy_tags(db: AsyncSession, tags: list[dict[str, str]]) -> dict[str, int]:
    """Insert every tag in `tags` that isn't already present (by `name`).
    Flushes but does not commit -- the caller owns the transaction."""
    existing = set((await db.execute(select(CuisineTag.name))).scalars().all())
    inserted = 0
    already_present = 0
    for tag in tags:
        if tag["name"] in existing:
            already_present += 1
            continue
        db.add(
            CuisineTag(
                name=tag["name"],
                display_name=tag["display_name"],
                category=tag["category"],
                is_active=True,
            )
        )
        existing.add(tag["name"])
        inserted += 1
    await db.flush()
    return {"inserted": inserted, "already_present": already_present}


async def run_seed_taxonomy() -> dict[str, int]:
    tags = load_taxonomy()
    session_factory = get_session_factory()
    async with session_factory() as db:
        counts = await seed_taxonomy_tags(db, tags)
        await db.commit()
    return counts

"""Admin taxonomy management: list / add / rename / deactivate-reactivate
`cuisine_tag` rows (docs/API_CONTRACTS.md "Admin taxonomy management").

Rules:
- NO delete. A tag is retired by deactivating it (`is_active=false`), which
  never touches `location_cuisine` rows. Deactivating stops the tag being
  OFFERED (`GET /cuisine-tags`, owner pickers, search filter options),
  stops it matching `GET /search` filters, and hides it from every public
  payload; owner/manager/admin editors of a location still see it (and can
  remove it) -- see `cuisine_service.get_location_cuisine_tags_bulk`.
- `name` (slug) and `category` are immutable; renaming changes
  `display_name` only.
- Uniqueness: slug is globally unique (DB constraint); display name is
  unique case-insensitively within a category. Any clash -> generic 409.
- Every write audits `cuisine_tag` with old/new values in the same
  transaction as the write.
"""
from __future__ import annotations

import re
from typing import get_args

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.models.cuisine_tag import CuisineTag
from app.models.location_cuisine import LocationCuisine
from app.schemas.admin_taxonomy import (
    AdminTagCreate,
    AdminTagOut,
    AdminTagUpdate,
    AdminTaxonomyResponse,
)
from app.schemas.cuisine import CuisineCategory
from app.services import audit_service

AUDIT_TABLE = "cuisine_tag"

_CONFLICT = "A tag with that name already exists."
_SLUG_RE = re.compile(r"[a-z0-9][a-z0-9_]{0,63}")


def slugify(display_name: str) -> str:
    """'Street Food!' -> 'street_food'. May return '' (caller rejects)."""
    return re.sub(r"[^a-z0-9]+", "_", display_name.lower()).strip("_")[:64].strip("_")


def _snapshot(tag: CuisineTag) -> dict[str, object]:
    return {
        "name": tag.name,
        "display_name": tag.display_name,
        "category": tag.category,
        "is_active": tag.is_active,
    }


async def _usage_counts(db: AsyncSession) -> dict[int, int]:
    rows = await db.execute(
        select(LocationCuisine.cuisine_tag_id, func.count(LocationCuisine.location_id)).group_by(
            LocationCuisine.cuisine_tag_id
        )
    )
    return {tag_id: count for tag_id, count in rows.all()}


def _to_out(tag: CuisineTag, usage: int) -> AdminTagOut:
    out = AdminTagOut.model_validate(tag)
    out.usage_count = usage
    return out


async def list_taxonomy(db: AsyncSession) -> AdminTaxonomyResponse:
    tags = (
        (
            await db.execute(
                select(CuisineTag).order_by(
                    CuisineTag.category, func.lower(CuisineTag.display_name)
                )
            )
        )
        .scalars()
        .all()
    )
    usage = await _usage_counts(db)
    return AdminTaxonomyResponse(
        results=[_to_out(t, usage.get(t.id, 0)) for t in tags],
        categories=list(get_args(CuisineCategory)),
    )


async def _display_name_taken(
    db: AsyncSession, category: str, display_name: str, exclude_id: int | None = None
) -> bool:
    stmt = select(CuisineTag.id).where(
        CuisineTag.category == category,
        func.lower(CuisineTag.display_name) == display_name.lower(),
    )
    if exclude_id is not None:
        stmt = stmt.where(CuisineTag.id != exclude_id)
    return (await db.execute(stmt.limit(1))).scalar_one_or_none() is not None


async def create_tag(db: AsyncSession, body: AdminTagCreate, current_user) -> AdminTagOut:
    slug = body.name or slugify(body.display_name)
    if not _SLUG_RE.fullmatch(slug):
        raise AppError(422, "Could not derive a valid tag name; supply one.", "validation_error")

    slug_taken = (
        await db.execute(select(CuisineTag.id).where(CuisineTag.name == slug).limit(1))
    ).scalar_one_or_none()
    if slug_taken is not None or await _display_name_taken(db, body.category, body.display_name):
        raise AppError(409, _CONFLICT, "conflict")

    tag = CuisineTag(
        name=slug, display_name=body.display_name, category=body.category, is_active=True
    )
    db.add(tag)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise AppError(409, _CONFLICT, "conflict") from None

    await audit_service.log(
        db,
        AUDIT_TABLE,
        tag.id,
        "create",
        actor_id=current_user.cognito_sub,
        actor_role=current_user.role,
        old_val=None,
        new_val=_snapshot(tag),
    )
    await db.commit()
    await db.refresh(tag)
    return _to_out(tag, 0)


async def update_tag(
    db: AsyncSession, tag_id: int, body: AdminTagUpdate, current_user
) -> AdminTagOut:
    tag = await db.get(CuisineTag, tag_id)
    if tag is None:
        raise AppError(404, "Tag not found.", "not_found")

    before = _snapshot(tag)
    if body.display_name is not None and body.display_name != tag.display_name:
        if await _display_name_taken(db, tag.category, body.display_name, exclude_id=tag.id):
            raise AppError(409, _CONFLICT, "conflict")
        tag.display_name = body.display_name
    if body.is_active is not None:
        tag.is_active = body.is_active

    after = _snapshot(tag)
    if after != before:
        try:
            await db.flush()
        except IntegrityError:
            await db.rollback()
            raise AppError(409, _CONFLICT, "conflict") from None
        await audit_service.log(
            db,
            AUDIT_TABLE,
            tag.id,
            "update",
            actor_id=current_user.cognito_sub,
            actor_role=current_user.role,
            old_val=before,
            new_val=after,
        )
        await db.commit()
        await db.refresh(tag)

    usage = (await _usage_counts(db)).get(tag.id, 0)
    return _to_out(tag, usage)

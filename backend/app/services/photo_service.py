"""restaurant_photo CRUD — cover photo + 2-free/10-paid gallery cap.

DECISIONS.md "Photo gallery: 2 photos free, 10 photos paid per location".
Enforcement is at the service layer (not a DB constraint), same pattern as
`location_manager`'s manager cap — see docs/DATA_MODEL.md
"restaurant_photo".
"""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.models.restaurant_photo import RestaurantPhoto
from app.schemas.photo import PhotoCreate, PhotoOut, PhotoUpdate
from app.services import s3_service

FREE_GALLERY_LIMIT = 2
PAID_GALLERY_LIMIT = 10


def gallery_limit_for(is_paid: bool) -> int:
    return PAID_GALLERY_LIMIT if is_paid else FREE_GALLERY_LIMIT


async def get_cover_photo(db: AsyncSession, location_id: int) -> RestaurantPhoto | None:
    result = await db.execute(
        select(RestaurantPhoto).where(
            RestaurantPhoto.location_id == location_id,
            RestaurantPhoto.is_cover == True,  # noqa: E712
        )
    )
    return result.scalar_one_or_none()


async def get_cover_photos_bulk(
    db: AsyncSession, location_ids: list[int]
) -> dict[int, RestaurantPhoto]:
    """`get_cover_photo` for many locations in ONE query (at most one cover
    row per location — partial-unique index on `is_cover`). Locations with no
    cover are simply absent from the result."""
    if not location_ids:
        return {}
    result = await db.execute(
        select(RestaurantPhoto).where(
            RestaurantPhoto.location_id.in_(location_ids),
            RestaurantPhoto.is_cover == True,  # noqa: E712
        )
    )
    return {photo.location_id: photo for photo in result.scalars().all()}


async def get_gallery_photos(
    db: AsyncSession, location_id: int, is_paid: bool
) -> list[RestaurantPhoto]:
    """Read-time enforcement of the same 2-free/10-paid cap `create_photo`/
    `update_photo` enforce on write — a downgraded (is_paid=false) location
    must stop returning photos beyond the free limit immediately, per root
    CLAUDE.md's paid-content rule and DECISIONS.md's immediate-downgrade
    rule, even if it uploaded up to the paid limit while still paid.
    """
    limit = gallery_limit_for(is_paid)
    result = await db.execute(
        select(RestaurantPhoto)
        .where(RestaurantPhoto.location_id == location_id, RestaurantPhoto.is_cover == False)  # noqa: E712
        .order_by(RestaurantPhoto.display_order)
        .limit(limit)
    )
    return list(result.scalars().all())


async def count_gallery_photos(db: AsyncSession, location_id: int) -> int:
    result = await db.execute(
        select(func.count())
        .select_from(RestaurantPhoto)
        .where(RestaurantPhoto.location_id == location_id, RestaurantPhoto.is_cover == False)  # noqa: E712
    )
    return result.scalar_one()


def to_photo_out(photo: RestaurantPhoto) -> PhotoOut:
    # thumbnail_s3_key is nullable at the DB layer (see the model's own
    # comment) purely for direct/legacy construction; every real write
    # path always sets it. Fall back to the main processed image rather
    # than crashing/returning a broken URL on the rare row that lacks one.
    thumbnail_key = photo.thumbnail_s3_key or photo.s3_key
    return PhotoOut(
        id=photo.id,
        location_id=photo.location_id,
        url=s3_service.resolve_media_url(photo.s3_key),
        thumbnail_url=s3_service.resolve_media_url(thumbnail_key),
        is_cover=photo.is_cover,
        display_order=photo.display_order,
    )


async def create_photo(
    db: AsyncSession,
    location,
    body: PhotoCreate,
    uploaded_by: str,
    *,
    thumbnail_s3_key: str | None = None,
) -> RestaurantPhoto:
    """`body.s3_key` must already be the predicted `processed/` key by the
    time it reaches here — the raw/ -> processed/ transform (and, for
    `thumbnail_s3_key`, the raw/ -> thumbnails/ transform) happens one
    layer up, in `location_service.create_location_photo`, via
    `s3_service.processed_key_for_upload`/`thumbnail_key_for_upload`. This
    function only stores whatever keys it's given — see
    docs/DECISIONS.md "S3 image resize pipeline" for why that split
    exists (keeps this function's cap-enforcement logic testable without
    needing real raw/-key validation in every test).
    """
    if body.is_cover:
        existing_cover = await get_cover_photo(db, location.id)
        if existing_cover is not None:
            # "Cover replace, not stack" — docs/API_CONTRACTS.md.
            await db.delete(existing_cover)
            await db.flush()
        photo = RestaurantPhoto(
            location_id=location.id,
            s3_key=body.s3_key,
            thumbnail_s3_key=thumbnail_s3_key,
            is_cover=True,
            display_order=0,
            uploaded_by=uploaded_by,
        )
    else:
        count = await count_gallery_photos(db, location.id)
        limit = gallery_limit_for(location.is_paid)
        if count >= limit:
            raise AppError(
                409,
                f"Gallery photo limit reached ({limit} photos for this location's tier)",
                "gallery_limit_reached",
            )
        photo = RestaurantPhoto(
            location_id=location.id,
            s3_key=body.s3_key,
            thumbnail_s3_key=thumbnail_s3_key,
            is_cover=False,
            display_order=count,
            uploaded_by=uploaded_by,
        )
    db.add(photo)
    await db.flush()
    await db.commit()
    await db.refresh(photo)
    return photo


async def _get_owned_photo(db: AsyncSession, location_id: int, photo_id: int) -> RestaurantPhoto:
    photo = await db.get(RestaurantPhoto, photo_id)
    if photo is None or photo.location_id != location_id:
        raise AppError(404, "Photo not found", "not_found")
    return photo


async def update_photo(
    db: AsyncSession, location, photo_id: int, body: PhotoUpdate
) -> RestaurantPhoto:
    photo = await _get_owned_photo(db, location.id, photo_id)

    if body.is_cover is True and not photo.is_cover:
        existing_cover = await get_cover_photo(db, location.id)
        if existing_cover is not None and existing_cover.id != photo.id:
            await db.delete(existing_cover)
            await db.flush()
        photo.is_cover = True
        photo.display_order = 0
    elif body.is_cover is False and photo.is_cover:
        # Demoting the cover photo into the gallery — subject to the same
        # cap as any other gallery photo.
        count = await count_gallery_photos(db, location.id)
        limit = gallery_limit_for(location.is_paid)
        if count >= limit:
            raise AppError(
                409,
                f"Gallery photo limit reached ({limit} photos for this location's tier)",
                "gallery_limit_reached",
            )
        photo.is_cover = False
        photo.display_order = count

    if body.display_order is not None:
        photo.display_order = body.display_order

    await db.commit()
    await db.refresh(photo)
    return photo


async def delete_photo(db: AsyncSession, location, photo_id: int) -> None:
    photo = await _get_owned_photo(db, location.id, photo_id)
    # Row delete, not soft-delete (docs/API_CONTRACTS.md "DELETE
    # /locations/{id}/photos/{photo_id}"). Removing the underlying S3
    # object is a service-layer nice-to-have, not documented as required —
    # left as a follow-up rather than adding an undocumented boto3 delete
    # call in the request path here.
    await db.delete(photo)
    await db.commit()

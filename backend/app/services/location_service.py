"""restaurant_location CRUD, the /hours sub-resource, and the /photos
sub-resource orchestration — see docs/API_CONTRACTS.md "Locations
(restaurant_location)".
"""
from __future__ import annotations

from decimal import Decimal

from geoalchemy2.functions import ST_MakePoint, ST_SetSRID
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.models.restaurant_brand import RestaurantBrand
from app.models.restaurant_location import RestaurantLocation
from app.schemas.hours import HourEntryIn, HoursResponse
from app.schemas.location import (
    GalleryPhotoOut,
    HoursOut,
    LocationCreate,
    LocationOut,
    LocationUpdate,
)
from app.schemas.photo import PhotoCreate, PhotoOut, PhotoUpdate, UploadUrlResponse
from app.schemas.restaurant import LocationListResponse, LocationSummaryOut
from app.services import audit_service, auth_service, hours_service, photo_service, s3_service


def _to_decimal(value: float | None) -> Decimal | None:
    return Decimal(str(value)) if value is not None else None


async def _sync_geom(db: AsyncSession, location_id: int, lat: float, lng: float) -> None:
    """Keep `geom` (the column `/search` actually queries) in sync with
    lat/lng on write — docs/DATA_MODEL.md judgment-call note: no DB
    trigger, so every writer path must remember to do this. `ST_MakePoint`
    takes (lng, lat) — PostGIS/GeoJSON x,y order, not (lat, lng).
    """
    await db.execute(
        update(RestaurantLocation)
        .where(RestaurantLocation.id == location_id)
        .values(geom=ST_SetSRID(ST_MakePoint(lng, lat), 4326))
    )


async def _location_to_out(db: AsyncSession, location: RestaurantLocation) -> LocationOut:
    # brand_name: the FK is ON DELETE RESTRICT while any location exists
    # (docs/API_CONTRACTS.md "Restaurants CRUD"), so the parent brand row
    # is always present here -- no None-guard needed.
    brand = await db.get(RestaurantBrand, location.brand_id)

    hours_rows = await hours_service.get_hours_for_location(db, location.id)
    hours_by_day = {row.day_of_week: row for row in hours_rows}
    today = hours_service.today_weekday(location.timezone)
    is_open_now = hours_service.compute_is_open_now(hours_by_day.get(today), location.timezone)

    cover = await photo_service.get_cover_photo(db, location.id)
    gallery = await photo_service.get_gallery_photos(db, location.id, location.is_paid)

    return LocationOut(
        id=location.id,
        brand_id=location.brand_id,
        brand_name=brand.name,
        location_name=location.location_name,
        address_line1=location.address_line1,
        address_line2=location.address_line2,
        city=location.city,
        state=location.state,
        postal_code=location.postal_code,
        country=location.country,
        phone=location.phone,
        timezone=location.timezone,
        latitude=float(location.latitude) if location.latitude is not None else None,
        longitude=float(location.longitude) if location.longitude is not None else None,
        is_verified=location.is_verified,
        is_paid=location.is_paid,
        paid_until=location.paid_until,
        is_active=location.is_active,
        is_open_now=is_open_now,
        hours=[
            HoursOut(
                day_of_week=row.day_of_week,
                open_time=row.open_time,
                close_time=row.close_time,
                is_closed=row.is_closed,
            )
            for row in hours_rows
        ],
        cover_photo_url=s3_service.resolve_media_url(cover.s3_key) if cover else None,
        cover_photo_thumbnail_url=(
            s3_service.resolve_media_url(cover.thumbnail_s3_key or cover.s3_key) if cover else None
        ),
        gallery_photos=[
            GalleryPhotoOut(
                id=photo.id,
                url=s3_service.resolve_media_url(photo.s3_key),
                thumbnail_url=s3_service.resolve_media_url(photo.thumbnail_s3_key or photo.s3_key),
                display_order=photo.display_order,
            )
            for photo in gallery
        ],
    )


async def get_location(db: AsyncSession, location_id: int) -> LocationOut:
    location = await db.get(RestaurantLocation, location_id)
    if location is None:
        raise AppError(404, "Location not found", "not_found")
    return await _location_to_out(db, location)


async def get_location_or_404(db: AsyncSession, location_id: int) -> RestaurantLocation:
    location = await db.get(RestaurantLocation, location_id)
    if location is None:
        raise AppError(404, "Location not found", "not_found")
    return location


async def create_location(db: AsyncSession, body: LocationCreate, current_user) -> LocationOut:
    brand = await db.get(RestaurantBrand, body.brand_id)
    if brand is None:
        raise AppError(404, "Restaurant not found", "not_found")

    owner = await auth_service.get_owner_account_by_sub(db, current_user.cognito_sub)
    if owner is None or brand.owner_id != owner.id:
        raise AppError(403, "Not authorized to add a location to this restaurant", "forbidden")

    location = RestaurantLocation(
        brand_id=body.brand_id,
        address_line1=body.address_line1,
        address_line2=body.address_line2,
        city=body.city,
        state=body.state.upper(),
        postal_code=body.postal_code,
        country=body.country.upper(),
        phone=body.phone,
        timezone=body.timezone,
        latitude=_to_decimal(body.latitude),
        longitude=_to_decimal(body.longitude),
        is_paid=False,
        is_verified=False,
        is_active=True,
    )
    db.add(location)
    await db.flush()

    if body.latitude is not None and body.longitude is not None:
        await _sync_geom(db, location.id, body.latitude, body.longitude)

    await audit_service.log(
        db,
        table_name="restaurant_location",
        record_id=location.id,
        action="create",
        actor_id=current_user.cognito_sub,
        actor_role=current_user.role,
        old_val=None,
        new_val={
            "brand_id": location.brand_id,
            "address_line1": location.address_line1,
            "city": location.city,
            "state": location.state,
        },
    )
    await db.commit()
    return await get_location(db, location.id)


_UPDATABLE_FIELDS = (
    "location_name",
    "address_line1",
    "address_line2",
    "city",
    "state",
    "postal_code",
    "country",
    "phone",
    "timezone",
)


async def update_location(
    db: AsyncSession, location_id: int, body: LocationUpdate, current_user
) -> LocationOut:
    location = await get_location_or_404(db, location_id)

    old_val = {field: getattr(location, field) for field in _UPDATABLE_FIELDS}
    old_val["latitude"] = float(location.latitude) if location.latitude is not None else None
    old_val["longitude"] = float(location.longitude) if location.longitude is not None else None

    data = body.model_dump(exclude_unset=True)
    for field in _UPDATABLE_FIELDS:
        if field in data and data[field] is not None:
            value = data[field]
            if field in ("state", "country"):
                value = value.upper()
            setattr(location, field, value)

    lat_changed = "latitude" in data and data["latitude"] is not None
    lng_changed = "longitude" in data and data["longitude"] is not None
    if lat_changed:
        location.latitude = _to_decimal(data["latitude"])
    if lng_changed:
        location.longitude = _to_decimal(data["longitude"])

    await db.flush()

    if lat_changed or lng_changed:
        lat = float(location.latitude) if location.latitude is not None else None
        lng = float(location.longitude) if location.longitude is not None else None
        if lat is not None and lng is not None:
            await _sync_geom(db, location.id, lat, lng)

    new_val = {field: getattr(location, field) for field in _UPDATABLE_FIELDS}
    new_val["latitude"] = float(location.latitude) if location.latitude is not None else None
    new_val["longitude"] = float(location.longitude) if location.longitude is not None else None

    await audit_service.log(
        db,
        table_name="restaurant_location",
        record_id=location.id,
        action="update",
        actor_id=current_user.cognito_sub,
        actor_role=current_user.role,
        old_val=old_val,
        new_val=new_val,
    )
    await db.commit()
    return await get_location(db, location.id)


async def delete_location(db: AsyncSession, location_id: int, current_user) -> None:
    """Soft delete — sets is_active=false (docs/API_CONTRACTS.md "DELETE
    /locations/{id}"). Nothing is actually removed.
    """
    location = await get_location_or_404(db, location_id)
    old_val = {"is_active": location.is_active}
    location.is_active = False
    new_val = {"is_active": location.is_active}
    await audit_service.log(
        db,
        table_name="restaurant_location",
        record_id=location.id,
        action="update",
        actor_id=current_user.cognito_sub,
        actor_role=current_user.role,
        old_val=old_val,
        new_val=new_val,
    )
    await db.commit()


async def list_locations_for_brand(
    db: AsyncSession, brand_id: int, pagination, current_user=None
) -> LocationListResponse:
    """`GET /restaurants/{id}/locations` — public by default (active-only,
    unchanged), but additionally surfaces a brand's own deactivated
    locations to the owning owner or an admin caller when `current_user`
    is passed (docs/PROJECT_PLAN.csv "Serialize paid_until/is_active on
    location endpoints + let owner see own deactivated locations"; see
    `_caller_may_see_inactive_locations` below). This is the SAME code
    path the public listing uses — deliberately, per that row's own
    framing ("if you find the two share a code path, add an explicit
    include_inactive-for-owner branch") — there is no separate
    owner-scoped locations-list endpoint today, so the filter branches
    inside this one function rather than forking into two.
    """
    brand = await db.get(RestaurantBrand, brand_id)
    if brand is None:
        raise AppError(404, "Restaurant not found", "not_found")

    include_inactive = await _caller_may_see_inactive_locations(db, brand, current_user)

    filters = [RestaurantLocation.brand_id == brand_id]
    if not include_inactive:
        filters.append(RestaurantLocation.is_active == True)  # noqa: E712

    total = (
        await db.execute(select(func.count()).select_from(RestaurantLocation).where(*filters))
    ).scalar_one()

    rows = (
        await db.execute(
            select(RestaurantLocation)
            .where(*filters)
            .order_by(RestaurantLocation.id)
            .offset(pagination.offset)
            .limit(pagination.page_size)
        )
    ).scalars().all()

    results = []
    for row in rows:
        is_open_now = await hours_service.is_open_now_for_location(db, row.id, row.timezone)
        results.append(
            LocationSummaryOut(
                id=row.id,
                location_name=row.location_name,
                address_line1=row.address_line1,
                city=row.city,
                state=row.state,
                postal_code=row.postal_code,
                phone=row.phone,
                is_verified=row.is_verified,
                is_paid=row.is_paid,
                paid_until=row.paid_until,
                is_active=row.is_active,
                is_open_now=is_open_now,
            )
        )

    return LocationListResponse(
        results=results, page=pagination.page, page_size=pagination.page_size, total=total
    )


async def _caller_may_see_inactive_locations(db: AsyncSession, brand, current_user) -> bool:
    """`current_user` is `None` for an anonymous caller (the common case —
    always active-only). For an authenticated caller: an admin always
    passes (root CLAUDE.md Permission model, "Admin: full platform
    access" — same admin-parity posture as
    `require_location_write_access`/`require_location_owner_or_admin` in
    `app/dependencies/auth.py`; not explicitly called for by the
    PROJECT_PLAN.csv row that tracks this gap, but consistent with this
    codebase's established pattern elsewhere and flagged here as a
    judgment call for review). An owner passes only if they own THIS
    brand — never trust the JWT role claim alone, re-resolve the local
    `owner_account` row and compare `owner_account.id` to
    `restaurant_brand.owner_id`, same pattern as
    `require_brand_write_access`. Every other role (manager,
    registered_user) still only sees active locations — no use case for
    a manager/registered_user to see a deactivated location here.
    """
    if current_user is None:
        return False
    if current_user.role == "admin":
        return True
    if current_user.role != "owner":
        return False
    owner = await auth_service.get_owner_account_by_sub(db, current_user.cognito_sub)
    return owner is not None and owner.id == brand.owner_id


# ---------------------------------------------------------------------------
# Hours sub-resource
# ---------------------------------------------------------------------------


async def replace_location_hours(
    db: AsyncSession, location_id: int, entries: list[HourEntryIn], current_user
) -> HoursResponse:
    location = await get_location_or_404(db, location_id)
    await hours_service.replace_hours(db, location.id, entries)

    await audit_service.log(
        db,
        table_name="restaurant_location",
        record_id=location.id,
        action="update",
        actor_id=current_user.cognito_sub,
        actor_role=current_user.role,
        old_val=None,
        new_val={"hours_updated_days": [e.day_of_week for e in entries]},
    )
    await db.commit()

    rows = await hours_service.get_hours_for_location(db, location.id)
    return HoursResponse(
        hours=[
            HoursOut(
                day_of_week=row.day_of_week,
                open_time=row.open_time,
                close_time=row.close_time,
                is_closed=row.is_closed,
            )
            for row in rows
        ]
    )


# ---------------------------------------------------------------------------
# Photos sub-resource — restaurant_photo is not in the audit-required
# table list (docs/API_CONTRACTS.md), so no audit_log write below.
# ---------------------------------------------------------------------------


async def create_photo_upload_url(
    db: AsyncSession, location_id: int, content_type: str
) -> UploadUrlResponse:
    await get_location_or_404(db, location_id)
    url, fields, key, expires_in = s3_service.generate_location_photo_upload_url(
        location_id, content_type
    )
    return UploadUrlResponse(upload_url=url, fields=fields, s3_key=key, expires_in=expires_in)


async def create_location_photo(
    db: AsyncSession, location_id: int, body: PhotoCreate, current_user
) -> PhotoOut:
    """`body.s3_key` (as received from the client) is the RAW upload key
    from `create_photo_upload_url` above — BRD 5.3's steps 3-5 (resize,
    write processed/thumbnails, delete raw/) run asynchronously off the S3
    event, so they will almost certainly NOT have finished by the time
    this call lands right after the client's direct-to-S3 upload
    completes. Rather than block/poll for that, this predicts the
    resize Lambda's eventual `processed/`/`thumbnails/` output keys from
    the raw key (`s3_service.processed_key_for_upload`/
    `thumbnail_key_for_upload` — pure string transforms, see
    app/media/key_transform.py) and stores THOSE immediately. The DB
    record — and the URLs this endpoint returns — are correct from the
    first response; the actual S3 objects typically appear a few seconds
    later (real eventual consistency: e.g. an image requested from
    CloudFront in that narrow window would 404 until the resize Lambda
    finishes). See docs/DECISIONS.md "S3 image resize pipeline:
    predictable key, not read-after-write" for the full reasoning and the
    tradeoffs considered (polling, a status field, synchronous resize in
    the request path — all rejected).
    """
    location = await get_location_or_404(db, location_id)
    processed_key = s3_service.processed_key_for_upload(body.s3_key, location_id)
    thumbnail_key = s3_service.thumbnail_key_for_upload(body.s3_key, location_id)
    stored_body = body.model_copy(update={"s3_key": processed_key})
    photo = await photo_service.create_photo(
        db, location, stored_body, current_user.cognito_sub, thumbnail_s3_key=thumbnail_key
    )
    return photo_service.to_photo_out(photo)


async def update_location_photo(
    db: AsyncSession, location_id: int, photo_id: int, body: PhotoUpdate
) -> PhotoOut:
    location = await get_location_or_404(db, location_id)
    photo = await photo_service.update_photo(db, location, photo_id, body)
    return photo_service.to_photo_out(photo)


async def delete_location_photo(db: AsyncSession, location_id: int, photo_id: int) -> None:
    location = await get_location_or_404(db, location_id)
    await photo_service.delete_photo(db, location, photo_id)

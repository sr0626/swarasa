"""Plausible-US coordinate check shared by the geocode backfill command and
the bulk-import row rules. Stdlib only (the helper scripts import it without
the backend's heavy dependencies)."""
from __future__ import annotations

# (min_lat, max_lat, min_lng, max_lng). Deliberately generous boxes: this is
# a sanity net against wildly wrong geocodes, not a border check.
US_BOUNDING_BOXES: tuple[tuple[float, float, float, float], ...] = (
    (24.0, 49.6, -125.5, -66.5),  # contiguous US
    (51.0, 71.9, -180.0, -129.0),  # Alaska (west of the antimeridian)
    (18.5, 22.5, -160.7, -154.5),  # Hawaii
)


def is_plausible_us_point(lat: float, lng: float) -> bool:
    return any(
        lo_lat <= lat <= hi_lat and lo_lng <= lng <= hi_lng
        for lo_lat, hi_lat, lo_lng, hi_lng in US_BOUNDING_BOXES
    )

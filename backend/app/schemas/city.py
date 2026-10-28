"""Response shapes for the public city endpoints (`GET /cities`,
`GET /cities/{slug}/restaurants`) — see docs/API_CONTRACTS.md "Cities"."""
from __future__ import annotations

from pydantic import BaseModel

from app.schemas.search import SearchResultOut


class CityOut(BaseModel):
    # URL slug of the city landing page (/indian-restaurants/{slug}).
    slug: str
    # Display name (the most common spelling among the city's locations).
    city: str
    state: str
    # Publicly visible (active, live-brand) locations in this city.
    location_count: int


class CityListResponse(BaseModel):
    results: list[CityOut]
    page: int
    page_size: int
    total: int


class CityRestaurantsResponse(BaseModel):
    city: CityOut
    # One tile per LOCATION (the same shape /search tiles use, so the frontend
    # reuses the shared tile): `nearest_location` is the location itself,
    # `distance_mi` is null, and `location_count_nearby` is the brand's TOTAL
    # active-location count (drives the "N locations" chip and the canonical
    # URL choice: 1 -> the short brand URL).
    results: list[SearchResultOut]
    page: int
    page_size: int
    total: int

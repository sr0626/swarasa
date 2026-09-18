from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

# cuisine_tag.category valid values (app/models/cuisine_tag.py) — also the
# `GET /cuisine-tags` `category` query param's valid values
# (docs/API_CONTRACTS.md "GET /cuisine-tags").
CuisineCategory = Literal["regional", "dietary", "type", "signature", "dining_time"]


class CuisineTagOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    # Added so `POST`/`PATCH /restaurants`'s `cuisine_tag_ids` picker (the
    # documented consumer of this endpoint, docs/API_CONTRACTS.md
    # "GET /cuisine-tags") has an id to submit — the response previously
    # had no id at all, so no caller could actually build a valid
    # `cuisine_tag_ids` array from this list.
    id: int
    name: str
    display_name: str
    category: str


class CuisineTagListResponse(BaseModel):
    """`GET /cuisine-tags` — no page/page_size/total: `cuisine_tag` is a
    small, effectively-static seeded taxonomy table, not a growing
    collection (docs/API_CONTRACTS.md "GET /cuisine-tags")."""

    results: list[CuisineTagOut]

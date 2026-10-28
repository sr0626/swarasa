"""Admin taxonomy management -- `GET/POST/PATCH /admin/taxonomy`. See
docs/API_CONTRACTS.md "Admin taxonomy management"."""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.cuisine import CuisineCategory
from app.schemas.utc import UtcDatetime

# `cuisine_tag.name` slug: lowercase snake_case, same shape as the seeded
# taxonomy (docs/TAXONOMY.md). Immutable after creation (it is the value
# `GET /search` filters on and may sit in saved URLs).
TAG_SLUG_PATTERN = r"^[a-z0-9][a-z0-9_]{0,63}$"


class AdminTagOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    display_name: str
    category: CuisineCategory
    is_active: bool
    # Number of locations currently carrying the tag (`location_cuisine`
    # rows), regardless of the location's own status.
    usage_count: int = 0
    created_at: UtcDatetime
    updated_at: UtcDatetime


class AdminTaxonomyResponse(BaseModel):
    """Every tag (active and inactive), ordered category then display name.
    No pagination: the taxonomy is a small, admin-curated table."""

    results: list[AdminTagOut]
    # The valid `category` values, in display order -- feeds the page's
    # grouping and the "Add tag" form's kind menu.
    categories: list[CuisineCategory]


class AdminTagCreate(BaseModel):
    display_name: str = Field(min_length=1, max_length=120)
    category: CuisineCategory
    # Optional: derived from `display_name` when omitted.
    name: str | None = Field(default=None, pattern=TAG_SLUG_PATTERN)

    @field_validator("display_name")
    @classmethod
    def _strip_display_name(cls, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise ValueError("display_name must not be blank")
        return value


class AdminTagUpdate(BaseModel):
    """Rename (`display_name`) and/or deactivate/reactivate (`is_active`).
    `name` (slug) and `category` are deliberately not editable."""

    display_name: str | None = Field(default=None, min_length=1, max_length=120)
    is_active: bool | None = None

    @field_validator("display_name")
    @classmethod
    def _strip_display_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = " ".join(value.split())
        if not value:
            raise ValueError("display_name must not be blank")
        return value

    @model_validator(mode="after")
    def _at_least_one_field(self) -> "AdminTagUpdate":
        if self.display_name is None and self.is_active is None:
            raise ValueError("Provide display_name and/or is_active")
        return self

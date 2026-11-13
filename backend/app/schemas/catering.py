"""Catering quote requests — see docs/API_CONTRACTS.md "Catering quote
requests". Requester (registered_user), restaurant-side inbox, per-location
settings, admin list and the admin manual-subscription flag."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.utc import UtcDatetime

ItemSize = Literal["full_tray", "medium_tray", "flat_tray", "other"]
Fulfillment = Literal["delivery", "pickup"]
RequestStatus = Literal["open", "closed", "cancelled"]
RecipientStatus = Literal["pending", "quoted", "declined", "expired"]

MAX_ITEMS = 30
MAX_HEADCOUNT = 5000
MAX_QUOTE_DOLLARS = Decimal("1000000")
NOTES_MAX = 2000
SEARCH_MAX = 100


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


# --- requester ------------------------------------------------------------
class CateringConfigOut(BaseModel):
    max_restaurants: int
    max_items: int = MAX_ITEMS
    max_headcount: int = MAX_HEADCOUNT


class EligibleRestaurantOut(BaseModel):
    location_id: int
    restaurant_name: str
    city: str
    state: str
    brand_slug: str
    location_slug: str


class EligibleRestaurantList(BaseModel):
    results: list[EligibleRestaurantOut]
    page: int
    page_size: int
    total: int
    max_restaurants: int


class EligibilityOut(BaseModel):
    location_id: int
    eligible: bool
    # Only when eligible: the same public fields as the picker list, so a
    # location page can pre-select it. null otherwise.
    restaurant: EligibleRestaurantOut | None = None


class CateringItemIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    item_name: str = Field(min_length=1, max_length=120)
    size: ItemSize
    quantity: int = Field(ge=1, le=100)
    note: str | None = Field(default=None, max_length=255)

    @field_validator("item_name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("item_name is required")
        return v

    @field_validator("note")
    @classmethod
    def _note(cls, v: str | None) -> str | None:
        return _clean(v)


class CateringRequestCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_date: date
    headcount: int = Field(ge=1, le=MAX_HEADCOUNT)
    delivery_or_pickup: Fulfillment
    delivery_city: str | None = Field(default=None, max_length=100)
    delivery_zip: str | None = Field(default=None, max_length=10)
    requester_phone: str | None = Field(default=None, max_length=20)
    notes: str | None = Field(default=None, max_length=NOTES_MAX)
    items: list[CateringItemIn] = Field(min_length=1, max_length=MAX_ITEMS)
    # The hard cap (20) is enforced here; the CONFIGURED max (default 5) in
    # the service, so changing the config needs no deploy.
    location_ids: list[int] = Field(min_length=1, max_length=20)

    @field_validator("delivery_city", "delivery_zip", "requester_phone", "notes")
    @classmethod
    def _opt(cls, v: str | None) -> str | None:
        return _clean(v)


class RequesterRecipientOut(BaseModel):
    location_id: int
    restaurant_name: str
    city: str
    brand_slug: str
    location_slug: str
    status: RecipientStatus
    quote_amount_cents: int | None = None
    quote_note: str | None = None
    quoted_at: UtcDatetime | None = None


class CateringItemOut(BaseModel):
    item_name: str
    size: ItemSize
    quantity: int
    note: str | None = None


class CateringRequestOut(BaseModel):
    id: int
    event_date: date
    headcount: int
    delivery_or_pickup: Fulfillment
    delivery_city: str | None = None
    delivery_zip: str | None = None
    requester_phone: str | None = None
    notes: str | None = None
    status: RequestStatus
    created_at: UtcDatetime
    expires_at: UtcDatetime
    items: list[CateringItemOut]
    recipients: list[RequesterRecipientOut]


class CateringRequestList(BaseModel):
    results: list[CateringRequestOut]
    page: int
    page_size: int
    total: int


# --- restaurant side -------------------------------------------------------
class InboxRowOut(BaseModel):
    recipient_id: int
    request_id: int
    location_id: int
    restaurant_name: str
    city: str
    requester_first_name: str | None
    event_date: date
    headcount: int
    delivery_or_pickup: Fulfillment
    item_count: int
    request_status: RequestStatus
    status: RecipientStatus
    quote_amount_cents: int | None = None
    is_unread: bool
    created_at: UtcDatetime
    expires_at: UtcDatetime


class InboxList(BaseModel):
    results: list[InboxRowOut]
    page: int
    page_size: int
    total: int
    unread_count: int


class InboxDetailOut(BaseModel):
    recipient_id: int
    request_id: int
    location_id: int
    restaurant_name: str
    city: str
    requester_first_name: str | None
    # Revealed only once THIS restaurant has submitted a quote (privacy rule,
    # docs/DECISIONS.md "Catering quote requests"); null before that / when declined.
    requester_email: str | None = None
    requester_phone: str | None = None
    event_date: date
    headcount: int
    delivery_or_pickup: Fulfillment
    delivery_city: str | None = None
    delivery_zip: str | None = None
    notes: str | None = None
    items: list[CateringItemOut]
    request_status: RequestStatus
    status: RecipientStatus
    quote_amount_cents: int | None = None
    quote_note: str | None = None
    quoted_at: UtcDatetime | None = None
    created_at: UtcDatetime
    expires_at: UtcDatetime
    # True while the request is open and not expired: a quote/decline (or an
    # edit of one) is still accepted.
    can_respond: bool


class CateringResponseIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision: Literal["quote", "decline"]
    # Dollars, at most 2 decimal places; 0 < amount <= 1,000,000. Required for "quote".
    amount: Decimal | None = None
    note: str | None = Field(default=None, max_length=NOTES_MAX)

    @field_validator("note")
    @classmethod
    def _note(cls, v: str | None) -> str | None:
        return _clean(v)


class CateringSettingsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    accepts_catering: bool


class CateringSettingsOut(BaseModel):
    location_id: int
    accepts_catering: bool
    # Whether the location is currently subscribed (the other half of the
    # eligibility rule) and until when (null = open-ended).
    subscribed: bool
    paid_until: UtcDatetime | None = None


# --- admin -----------------------------------------------------------------
class AdminCateringRowOut(BaseModel):
    id: int
    requester_email: str
    requester_name: str | None
    event_date: date
    headcount: int
    status: RequestStatus
    created_at: UtcDatetime
    expires_at: UtcDatetime
    recipient_count: int
    pending_count: int
    quoted_count: int
    declined_count: int
    expired_count: int


class AdminCateringList(BaseModel):
    results: list[AdminCateringRowOut]
    page: int
    page_size: int
    total: int
    open_count: int


class SubscriptionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    is_paid: bool
    paid_until: date | None = None


class SubscriptionOut(BaseModel):
    location_id: int
    is_paid: bool
    paid_until: datetime | None = None
    subscribed: bool

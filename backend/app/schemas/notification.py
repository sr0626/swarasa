"""In-app notifications (`GET /notifications`, `POST /notifications/{id}/read`,
`POST /notifications/read-all`) — see docs/API_CONTRACTS.md "Notifications"."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

NotificationKind = Literal["deal_new"]


class NotificationOut(BaseModel):
    id: int
    kind: NotificationKind
    # Snapshot of the deal title at the time the alert was created.
    title: str
    location_id: int
    # Ready-to-render context for the restaurant location the alert is about:
    # `restaurant_name` is the location's own name when set, else the brand's.
    restaurant_name: str
    city: str
    # Link target is `/restaurant/{brand_slug}/{location_slug}`.
    brand_slug: str
    location_slug: str
    created_at: datetime
    # null = unread.
    read_at: datetime | None


class NotificationListResponse(BaseModel):
    results: list[NotificationOut]
    page: int
    page_size: int
    total: int
    # Unread alerts across ALL pages — drives the bell badge.
    unread_count: int


class NotificationsReadAllOut(BaseModel):
    marked_read: int

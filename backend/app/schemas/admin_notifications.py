"""Admin notifications bell (`GET /admin/notifications`) — see
docs/API_CONTRACTS.md "Admin notifications"."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class ClaimNotificationItem(BaseModel):
    claim_id: int
    brand_id: int
    brand_name: str
    submitted_at: datetime


class ReportNotificationItem(BaseModel):
    report_id: int
    brand_id: int
    brand_name: str
    category: str
    submitted_at: datetime


class NewUserNotificationItem(BaseModel):
    owner_id: int
    # `full_name` when set, else `email` — a ready-to-render label.
    display: str
    email: str
    role: str
    created_at: datetime


class ClaimNotifications(BaseModel):
    count: int
    items: list[ClaimNotificationItem]


class ReportNotifications(BaseModel):
    count: int
    items: list[ReportNotificationItem]


class NewUserNotifications(BaseModel):
    count: int
    items: list[NewUserNotificationItem]


class AdminNotificationsResponse(BaseModel):
    claims: ClaimNotifications
    reports: ReportNotifications
    new_users: NewUserNotifications
    # Badge total: actionable queues only (claims + reports).
    total: int
    new_users_window_days: int

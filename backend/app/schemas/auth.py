"""/auth — see docs/API_CONTRACTS.md "Auth (/auth)"."""
from __future__ import annotations

from pydantic import BaseModel


class OwnerAccountOut(BaseModel):
    id: int
    full_name: str | None
    phone: str | None
    stripe_customer_id: str | None


class MeResponse(BaseModel):
    cognito_sub: str
    role: str
    email: str | None
    owner_account: OwnerAccountOut | None


class MeUpdateRequest(BaseModel):
    full_name: str | None = None
    phone: str | None = None

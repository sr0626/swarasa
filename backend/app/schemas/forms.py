"""Form guard request/response schemas -- docs/API_CONTRACTS.md "Form guard"."""
from __future__ import annotations

from typing import Literal, get_args

from pydantic import BaseModel, Field

# Mirrors `form_guard_service.TOKEN_FORMS` (asserted equal in tests).
FormName = Literal[
    "report",
    "claim",
    "contact_admin",
    "catering_request",
    "brand_create",
    "signup",
    "forgot",
    "reset",
    "confirm",
    "login",
]
FORM_NAMES: tuple[str, ...] = get_args(FormName)


class FormTokenRequest(BaseModel):
    form: FormName


class FormTokenOut(BaseModel):
    token: str
    # Seconds the token must age before a submission carrying it is accepted
    # (the page waits this out silently; see frontend useFormGuard).
    min_seconds: int


class FormVerifyRequest(BaseModel):
    form: FormName
    token: str = Field(max_length=200)
    # Honeypot value (empty / absent for humans).
    trap: str | None = Field(default=None, max_length=500)

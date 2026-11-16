"""Signed form tokens -- the stateless half of the form guard
(docs/API_CONTRACTS.md "Form guard").

A token proves "the backend handed this out for THIS form at time T", which
lets the backend enforce a minimum time-to-submit (a bot that posts the
instant it loads the page is too fast) and a maximum age, with no store:

    token = "<issued_at>.<nonce>.<signature>"
    signature = base64url(HMAC-SHA256(key, "v1|<form>|<issued_at>|<nonce>"))

The form name is bound by the signature, not carried in the token, so a token
issued for one form fails verification for any other. The nonce makes every
token unique (the guard service uses it for single-use enforcement). Tokens
carry no user identity.

Pure: stdlib only, no DB, no clock of its own -- every function takes `now`
(epoch seconds) so tests never sleep. All failure reasons collapse to one
generic 400 at the API boundary (`form_check_failed`); `reason` exists only
for server-side logging and tests.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from dataclasses import dataclass

TOKEN_VERSION = "v1"
MAX_TOKEN_LENGTH = 200
# Tolerance for the issuing and verifying instances' clocks disagreeing: a
# token that looks issued slightly in the future is treated as too fast, a
# token more than this far in the future is forged.
CLOCK_SKEW_SECONDS = 30

REASON_MISSING = "missing"
REASON_MALFORMED = "malformed"
REASON_BAD_SIGNATURE = "bad_signature"
REASON_TOO_FAST = "too_fast"
REASON_EXPIRED = "expired"
REASON_FUTURE = "future"


@dataclass(frozen=True)
class VerifyResult:
    ok: bool
    reason: str | None = None
    nonce: str | None = None
    issued_at: int | None = None


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _sign(key: bytes, form: str, issued_at: int, nonce: str) -> str:
    message = f"{TOKEN_VERSION}|{form}|{issued_at}|{nonce}".encode("utf-8")
    return _b64(hmac.new(key, message, hashlib.sha256).digest())


def new_nonce() -> str:
    return secrets.token_urlsafe(16)


def issue_token(form: str, now: int, key: bytes, nonce: str | None = None) -> str:
    nonce = nonce or new_nonce()
    return f"{int(now)}.{nonce}.{_sign(key, form, int(now), nonce)}"


def verify_token(
    token: str | None,
    form: str,
    now: int,
    key: bytes,
    *,
    min_age: int,
    max_age: int,
) -> VerifyResult:
    """Check signature (constant-time), form binding and the age window
    `min_age <= now - issued_at <= max_age`."""
    if not token:
        return VerifyResult(False, REASON_MISSING)
    if len(token) > MAX_TOKEN_LENGTH:
        return VerifyResult(False, REASON_MALFORMED)
    parts = token.split(".")
    if len(parts) != 3:
        return VerifyResult(False, REASON_MALFORMED)
    issued_raw, nonce, signature = parts
    if not issued_raw.isascii() or not issued_raw.isdigit() or not nonce or not signature:
        return VerifyResult(False, REASON_MALFORMED)
    issued_at = int(issued_raw)

    expected = _sign(key, form, issued_at, nonce)
    if not hmac.compare_digest(expected.encode("ascii"), signature.encode("utf-8", "replace")):
        return VerifyResult(False, REASON_BAD_SIGNATURE)

    age = now - issued_at
    if age < -CLOCK_SKEW_SECONDS:
        return VerifyResult(False, REASON_FUTURE, nonce, issued_at)
    if age < min_age:
        return VerifyResult(False, REASON_TOO_FAST, nonce, issued_at)
    if age > max_age:
        return VerifyResult(False, REASON_EXPIRED, nonce, issued_at)
    return VerifyResult(True, None, nonce, issued_at)


def derive_key(material: str, purpose: str) -> bytes:
    """Domain-separated sub-key from server-side secret material, so the
    token key and the client-hash salt are different values."""
    return hmac.new(
        material.encode("utf-8"), f"swarasa.form_guard.{purpose}.v1".encode("utf-8"), hashlib.sha256
    ).digest()

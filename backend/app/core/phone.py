"""ONE shared US phone rule for every phone input on the platform.

Keep this in lock-step with `frontend/src/lib/phone.ts` (`normalizePhone`) —
both are covered by the same case table (tests/unit/test_phone_normalization.py
and frontend/src/lib/phone.test.ts), so a number one layer accepts the other
accepts too, and both produce the same stored value.

The rule (docs/DECISIONS.md "US phone validation"):
  - accepted formatting: digits plus spaces, dashes, dots and parentheses,
    with an optional single leading `+1` or bare leading `1` country code;
  - after stripping formatting and a leading country code, EXACTLY 10 digits
    must remain (an 11-digit number that doesn't start with the `1` country
    code is rejected — the bug this rule closes);
  - the area code and the exchange must each start with 2-9 (NANP);
  - anything else — letters, extensions, other country codes, a `+` anywhere
    but the front — is rejected.

Stored/canonical form: E.164, `+1XXXXXXXXXX` (12 chars). That is what
`POST/PATCH /locations` has always stored and what the display formatter
(`frontend/src/lib/formatPhone.ts`, `+19725550142` -> `(972) 555-0142`)
expects, so nothing about existing rows changes; legacy rows that don't fit
(non-US, free text) are simply left alone (no backfill).
"""
from __future__ import annotations

import re

US_PHONE_ERROR = "Enter a valid 10-digit US phone number"

# Only these characters may appear; a `+` only as the very first character.
_ALLOWED = re.compile(r"^\+?[0-9 \t().\-]+$")
_NANP = re.compile(r"^[2-9][0-9]{2}[2-9][0-9]{6}$")


def normalize_us_phone(value: str) -> str | None:
    """Return the canonical `+1XXXXXXXXXX` form, or `None` when `value` is
    not a valid US phone number under the rule in this module's docstring."""
    trimmed = value.strip()
    if not trimmed or not _ALLOWED.match(trimmed):
        return None

    has_plus = trimmed.startswith("+")
    digits = re.sub(r"[^0-9]", "", trimmed)

    if has_plus:
        # "+" is only meaningful as the +1 country code.
        if len(digits) != 11 or not digits.startswith("1"):
            return None
        national = digits[1:]
    elif len(digits) == 11 and digits.startswith("1"):
        national = digits[1:]
    else:
        national = digits

    return f"+1{national}" if _NANP.match(national) else None

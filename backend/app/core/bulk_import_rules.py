"""Field-level rules for ONE bulk-import row, shared by the admin import UI
(`app/services/admin_bulk_import_service.py`) and the human-run helper script
(`scripts/bulk_import_restaurants_csv.py`). Pure: stdlib + `app.core.phone` +
`app.core.geo_bounds` only (no DB, no network), so the script can import it
without the backend's heavy dependencies and both callers apply the same
rules.

Rules (docs/SCRIPTS.md "Bulk import", docs/API_CONTRACTS.md "Admin bulk
listing import"):
  * required: name, address_line1, city, state, postal_code
  * state = 2 letters; postal_code = ZIP or ZIP+4; country (if given) = US
  * phone = the shared US rule (`app.core.phone`), stored `+1XXXXXXXXXX`
  * website must be an http(s) URL; lengths capped to the column sizes
  * latitude/longitude: both or neither, in range, inside the US
  * no control characters in any cell (a hostile/garbled file is rejected
    per row, never stored)
  * `hours` (optional, appended last in the template) is parsed by
    `app.core.bulk_import_hours`; a problem is a WARNING-severity issue
    (`bad_hours`) that never blocks the row and never changes its status --
    the row is simply imported without hours (imported listings are always
    created hidden; missing hours just stay on its "still needed" list).
`type` (cuisine tag) matching needs the taxonomy, so it is NOT checked here.
"""
from __future__ import annotations

import math
import re
import unicodedata
from collections.abc import Mapping
from dataclasses import dataclass, field

from app.core.bulk_import_hours import MAX_HOURS_CELL_LENGTH, parse_hours
from app.core.geo_bounds import is_plausible_us_point
from app.core.phone import US_PHONE_ERROR, normalize_us_phone

BASE_REQUIRED: tuple[str, ...] = ("name", "address_line1", "city", "state", "postal_code")

# Column caps (match restaurant_brand / restaurant_location columns).
MAX_LENGTHS: dict[str, int] = {
    "name": 255,
    "address_line1": 255,
    "address_line2": 255,
    "city": 120,
    "website": 500,
    "type": 100,
    "description": 1000,
}

_ZIP_RE = re.compile(r"^\d{5}(-\d{4})?$")
_URL_RE = re.compile(r"^https?://[^\s/$.?#][^\s]*$", re.IGNORECASE)
_MULTILINE_FIELDS = frozenset({"description"})


@dataclass(frozen=True)
class RuleIssue:
    field: str | None
    severity: str  # "error" | "warning" | "info"
    code: str
    message: str


@dataclass
class RowCheck:
    """Result of `check_row_fields`: the cleaned values (only meaningful for
    fields that passed) and every problem found."""

    values: dict[str, object] = field(default_factory=dict)
    issues: list[RuleIssue] = field(default_factory=list)

    @property
    def has_errors(self) -> bool:
        return any(i.severity == "error" for i in self.issues)


def _has_control_chars(text: str) -> bool:
    return any(unicodedata.category(c) == "Cc" and c not in "\n\r\t" for c in text)


def clean_cell(field_name: str, value: object) -> str | None:
    """Strip; blank -> None; single-line fields get whitespace (incl. line
    breaks) collapsed to single spaces. Never raises."""
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if field_name not in _MULTILINE_FIELDS:
        text = re.sub(r"\s+", " ", text)
    return text


def _parse_coordinate(raw: str, limit: float) -> float | None:
    try:
        number = float(raw)
    except ValueError:
        return None
    if not math.isfinite(number) or abs(number) > limit:
        return None
    return number


def _check_hours(raw: object, out: RowCheck) -> None:
    """Parse the optional `hours` cell into `out.values["hours"]` (a tuple of
    `HoursDay`). Any problem -- including control characters or an over-long
    cell -- is a warning, never an error: the row imports without hours."""
    if raw is None:
        return
    text = str(raw)
    if not text.strip():
        return
    if len(text) > MAX_HOURS_CELL_LENGTH or _has_control_chars(text):
        error_text = "the text is too long or has characters that are not allowed"
        parsed = None
    else:
        parsed = parse_hours(text)
        error_text = parsed.error
    if parsed is None or parsed.error is not None:
        out.issues.append(
            RuleIssue(
                "hours",
                "warning",
                "bad_hours",
                f"Hours not understood ({error_text}); the row is imported without hours. "
                "Use the format: Mon-Fri 11:00-22:00; Sat 11:00-23:00; Sun closed.",
            )
        )
        return
    out.values["hours"] = tuple(parsed.days)
    if not parsed.covers_all_days:
        out.issues.append(
            RuleIssue(
                "hours",
                "warning",
                "partial_hours",
                f"Hours cover {len({d.day_of_week for d in parsed.days})} of 7 days; "
                "the remaining days must be filled in before the listing can be activated.",
            )
        )


def check_row_fields(
    row: Mapping[str, object],
    *,
    required: tuple[str, ...] = BASE_REQUIRED,
) -> RowCheck:
    """Apply the field rules to one raw row (cells may be str/None/number)."""
    out = RowCheck()

    def error(field_name: str | None, code: str, message: str) -> None:
        out.issues.append(RuleIssue(field_name, "error", code, message))

    cleaned: dict[str, str | None] = {}
    for key in (
        "name", "address_line1", "address_line2", "city", "state", "postal_code",
        "country", "phone", "website", "type", "description", "latitude", "longitude",
    ):
        raw = row.get(key)
        if isinstance(raw, str) and _has_control_chars(raw):
            error(key, "bad_characters", f"{key} contains characters that are not allowed.")
            cleaned[key] = None
            continue
        cleaned[key] = clean_cell(key, raw)

    for key in required:
        # Required cells are read from `row` directly too, so a script that
        # requires extra columns (owner_email) gets the same blank check.
        value = cleaned[key] if key in cleaned else clean_cell(key, row.get(key))
        if not value and not any(i.field == key for i in out.issues):
            error(key, "missing", f"'{key}' is blank (required).")

    for key, limit in MAX_LENGTHS.items():
        value = cleaned.get(key)
        if value is not None and len(value) > limit:
            error(key, "too_long", f"{key} is too long ({len(value)} characters; the limit is {limit}).")
            cleaned[key] = None

    state = cleaned["state"]
    if state is not None:
        if len(state) == 2 and state.isalpha():
            out.values["state"] = state.upper()
        else:
            error("state", "bad_state", f"state {state!r} must be a 2-letter code.")

    postal = cleaned["postal_code"]
    if postal is not None:
        if _ZIP_RE.match(postal):
            out.values["postal_code"] = postal
        else:
            error("postal_code", "bad_zip", f"postal_code {postal!r} must be a 5-digit ZIP (or ZIP+4).")

    country = cleaned["country"]
    if country is not None and country.upper() != "US":
        error("country", "bad_country", f"country {country!r} is not supported; only US addresses can be imported.")

    phone = cleaned["phone"]
    if phone is not None:
        normalized = normalize_us_phone(phone)
        if normalized is None:
            error("phone", "bad_phone", f"Invalid phone {phone!r}: {US_PHONE_ERROR}.")
        else:
            out.values["phone"] = normalized

    website = cleaned["website"]
    if website is not None:
        if _URL_RE.match(website):
            out.values["website"] = website
        else:
            error("website", "bad_website", "website must be a full http:// or https:// address.")

    lat_raw, lng_raw = cleaned["latitude"], cleaned["longitude"]
    if (lat_raw is None) != (lng_raw is None):
        error("latitude", "half_coordinates", "Give both latitude and longitude, or neither.")
    elif lat_raw is not None and lng_raw is not None:
        lat = _parse_coordinate(lat_raw, 90)
        lng = _parse_coordinate(lng_raw, 180)
        if lat is None:
            error("latitude", "bad_latitude", f"latitude {lat_raw!r} is not a number within +/-90.")
        if lng is None:
            error("longitude", "bad_longitude", f"longitude {lng_raw!r} is not a number within +/-180.")
        if lat is not None and lng is not None:
            if is_plausible_us_point(lat, lng):
                out.values["latitude"], out.values["longitude"] = lat, lng
            else:
                error("latitude", "outside_us", "The coordinates are outside the United States.")

    _check_hours(row.get("hours"), out)

    for key in ("name", "address_line1", "address_line2", "city", "description", "type"):
        if cleaned.get(key) is not None and not any(i.field == key for i in out.issues):
            out.values[key] = cleaned[key]
    return out

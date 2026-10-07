"""Pure old_val/new_val -> "what changed" diff for the activity feed
(`GET /auth/me/activity`, `app/services/audit_query_service.py`).

Turns one `audit_log` row into a list of `Change(field, label, old, new)` with
FRIENDLY labels and values ("Status: Live -> Hidden", never the raw
`owner_deactivated`). No DB, no I/O — the caller resolves names/emails in one
batched lookup and passes what this module needs (`manager_label`).

Grouping decisions (one row per *thing the reader would call a change*):
  - the five address columns -> ONE "Address" change, old/new composed from the
    full snapshot (an update row carries every audited field, changed or not);
  - latitude + longitude -> ONE "Map position" change;
  - hours -> one change per day whose hours differ ("Hours (Monday)");
  - everything else -> one change per differing key.
Internal ids (`owner_id`, `user_id`, `brand_id`, ...) never surface as changes.
A create/delete row yields no changes: the caller falls back to `summary`
("Location added"), which already says everything.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

_DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

# Location lifecycle -> the words the console itself uses (LocationStatusMenu).
STATUS_LABELS = {
    "active": "Live",
    "owner_deactivated": "Hidden",
    "coming_soon": "Coming soon",
    "closed_pending_reopen": "Closed",
}

FIELD_LABELS = {
    "name": "Restaurant name",
    "description": "Description",
    "website": "Website",
    "location_name": "Location name",
    "about": "About text",
    "specialties": "Specialties",
    "cuisine_tags": "Cuisine tags",
    "phone": "Phone",
    "timezone": "Timezone",
    "country": "Country",
    "status": "Status",
    "is_active": "Status",
    "is_verified": "Verified",
    "is_paid": "Paid plan",
    "is_claimed": "Claimed",
    "deals_hidden": "Deals hidden",
    "menu_hidden": "Menu hidden",
}

# Keys that are ids / bookkeeping, never a reader-facing "change".
_SKIP_KEYS = frozenset(
    {
        "id",
        "owner_id",
        "brand_id",
        "location_id",
        "user_id",
        "slug",
        "revoked_at",
        "hours_updated_days",
        "hours",
        "deleted_at",
    }
)
_ADDRESS_KEYS = ("address_line1", "address_line2", "city", "state", "postal_code")
_GEO_KEYS = ("latitude", "longitude")

_TEXT_LIMIT = 120


@dataclass(frozen=True)
class Change:
    field: str
    label: str
    old: str | None
    new: str | None


def format_phone(value: str) -> str:
    """`+19725550142` / bare 10-digit -> `(972) 555-0142`; anything else as-is."""
    digits = re.sub(r"\D", "", value)
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) == 10 and re.fullmatch(r"\+?[0-9 ().\-]+", value.strip()):
        return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"
    return value


def _short(text: str) -> str:
    text = text.strip()
    return text if len(text) <= _TEXT_LIMIT else text[: _TEXT_LIMIT - 1].rstrip() + "…"


def _titleize(slug: str) -> str:
    return slug.replace("_", " ").replace("-", " ").strip().title()


def format_value(key: str, value: Any) -> str | None:
    """Friendly display string for one stored value. `None` = nothing (rendered
    as a dash by the UI)."""
    if value is None or value == "" or value == []:
        return None
    if key == "status":
        return STATUS_LABELS.get(str(value), _titleize(str(value)))
    if key == "is_active":
        return "Live" if value else "Hidden"
    if key == "phone":
        return format_phone(str(value))
    if key == "cuisine_tags" and isinstance(value, list):
        return ", ".join(_titleize(str(v)) for v in value)
    if key == "specialties" and isinstance(value, list):
        return ", ".join(str(v) for v in value)
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, list):
        return ", ".join(str(v) for v in value)
    return _short(str(value))


def _compose_address(snapshot: dict) -> str | None:
    line1 = (snapshot.get("address_line1") or "").strip()
    line2 = (snapshot.get("address_line2") or "").strip()
    city = (snapshot.get("city") or "").strip()
    state = (snapshot.get("state") or "").strip()
    zip_code = (snapshot.get("postal_code") or "").strip()
    state_zip = " ".join(part for part in (state, zip_code) if part)
    parts = [p for p in (line1, line2, city, state_zip) if p]
    return ", ".join(parts) or None


def _compose_position(snapshot: dict) -> str | None:
    lat, lng = snapshot.get("latitude"), snapshot.get("longitude")
    if lat is None or lng is None:
        return None
    try:
        return f"{float(lat):.4f}, {float(lng):.4f}"
    except (TypeError, ValueError):
        return None


def _format_hours_value(raw: Any) -> str | None:
    """`"10:00-22:00"` -> `10am–10pm`; `"closed"` -> `Closed`; else None."""
    if raw is None or raw == "unknown":
        return None
    if raw == "closed":
        return "Closed"
    match = re.fullmatch(r"(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})", str(raw))
    if not match:
        return str(raw)

    def one(hour: str, minute: str) -> str:
        h, m = int(hour), int(minute)
        suffix = "pm" if 12 <= h < 24 else "am"
        display = h % 12 or 12
        return f"{display}{suffix}" if m == 0 else f"{display}:{m:02d}{suffix}"

    return f"{one(match.group(1), match.group(2))}–{one(match.group(3), match.group(4))}"


def _hours_changes(old: dict, new: dict) -> list[Change]:
    old_hours = old.get("hours") if isinstance(old.get("hours"), dict) else {}
    new_hours = new.get("hours") if isinstance(new.get("hours"), dict) else {}
    changes: list[Change] = []
    for day_key in sorted(set(old_hours) | set(new_hours), key=lambda k: int(k)):
        before, after = old_hours.get(day_key), new_hours.get(day_key)
        if before == after:
            continue
        day = _DAY_NAMES[int(day_key)] if 0 <= int(day_key) < 7 else f"Day {day_key}"
        changes.append(
            Change(
                field=f"hours.{day_key}",
                label=f"Hours ({day})",
                old=_format_hours_value(before),
                new=_format_hours_value(after),
            )
        )
    if not changes and "hours_updated_days" in new and not new_hours:
        # Legacy rows (before hours snapshots were audited): only the days
        # that were saved are known, not their old/new values.
        days = [
            _DAY_NAMES[d][:3]
            for d in new.get("hours_updated_days") or []
            if isinstance(d, int) and 0 <= d < 7
        ]
        if days:
            changes.append(
                Change("hours", "Hours", None, f"Updated: {', '.join(days)}")
            )
    return changes


def _manager_changes(action: str, old: dict, new: dict, manager_label: str | None) -> list[Change]:
    who = manager_label or "a manager"
    label = f"Manager access ({who})"
    if action == "create":
        return [Change("manager", label, None, "Assigned")]
    if action == "delete":
        return [Change("manager", label, "Assigned", "Removed")]
    if new.get("is_active") is False and old.get("is_active") is not False:
        return [Change("manager", label, "Assigned", "Revoked")]
    if new.get("is_active") is True and old.get("is_active") is not True:
        return [Change("manager", label, "Revoked", "Assigned")]
    return []


def _brand_lifecycle_changes(old: dict, new: dict) -> list[Change]:
    if "deleted_at" not in new:
        return []
    if new["deleted_at"]:
        return [Change("deleted_at", "Restaurant", "Live", "Deleted by an administrator")]
    return [Change("deleted_at", "Restaurant", "Deleted", "Restored")]


def diff_changes(
    table_name: str,
    action: str,
    old_val: dict | None,
    new_val: dict | None,
    *,
    manager_label: str | None = None,
) -> list[Change]:
    """The reader-facing changes for one audit row (see module docstring)."""
    old = old_val or {}
    new = new_val or {}

    if table_name == "location_manager":
        return _manager_changes(action, old, new, manager_label)
    if action in ("create", "delete"):
        return []

    changes: list[Change] = []

    if table_name == "restaurant_brand":
        changes.extend(_brand_lifecycle_changes(old, new))

    keys = [k for k in new if k not in _SKIP_KEYS] + [
        k for k in old if k not in new and k not in _SKIP_KEYS
    ]
    seen_groups: set[str] = set()
    for key in keys:
        if old.get(key) == new.get(key):
            continue
        if key in _ADDRESS_KEYS:
            if "address" in seen_groups:
                continue
            seen_groups.add("address")
            changes.append(
                Change("address", "Address", _compose_address(old), _compose_address(new))
            )
            continue
        if key in _GEO_KEYS:
            if "geo" in seen_groups:
                continue
            seen_groups.add("geo")
            changes.append(
                Change("map_position", "Map position", _compose_position(old), _compose_position(new))
            )
            continue
        changes.append(
            Change(
                field=key,
                label=FIELD_LABELS.get(key, _titleize(key)),
                old=format_value(key, old.get(key)),
                new=format_value(key, new.get(key)),
            )
        )

    if table_name == "restaurant_location":
        changes.extend(_hours_changes(old, new))

    return changes

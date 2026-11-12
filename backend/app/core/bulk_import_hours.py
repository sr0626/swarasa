"""Strict, simple parser for the optional `hours` cell of a bulk-import row
(admin import page, `scripts/bulk_import_restaurants_csv.py`, the
`bulk_import_restaurants` management command). Pure: stdlib only, so the
human-run script can import it without the backend's heavy dependencies.

Format -- `;`-separated parts, each `<days> <hours>`:

    Mon-Fri 11:00-22:00; Sat 11:00-23:00; Sun closed
    daily 11:00-22:00

  * <days>   one day (`Mon` .. `Sun`, or the full name), a range
             (`Mon-Fri`; a range may wrap the week: `Sat-Mon` = Sat, Sun,
             Mon), or `daily` / `everyday` / `every day` = all 7 days.
  * <hours>  `closed`, or ONE window `HH:MM-HH:MM` in 24-hour time. A close
             time earlier than the open time means the restaurant closes
             after midnight (`Fri 17:00-02:00`, the same overnight rule
             `hours_service` applies). `24:00` is accepted as a close time and
             stored as 00:00. Split shifts, AM/PM and free text are NOT
             understood.

Everything is case- and spacing-insensitive (`MON - FRI 11:00 - 22:00`,
en/em dashes, `:` after the day). A day mentioned twice (overlap) is a
problem. ANY problem makes the WHOLE cell unusable -- the parser never
returns partial hours -- and the caller turns the message into a row WARNING
and imports the row without hours (docs/DECISIONS.md "Bulk import respects
listing readiness"). The cell's text is never stored or echoed: only integers
and `datetime.time` values come out, so spreadsheet-formula text such as
`=cmd|...` is simply "not understood".
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import time

MAX_HOURS_CELL_LENGTH = 300

_DAY_NAMES: dict[str, int] = {}
for _index, _names in enumerate(
    (
        ("mon", "monday"),
        ("tue", "tues", "tuesday"),
        ("wed", "weds", "wednesday"),
        ("thu", "thur", "thurs", "thursday"),
        ("fri", "friday"),
        ("sat", "saturday"),
        ("sun", "sunday"),
    )
):
    for _name in _names:
        _DAY_NAMES[_name] = _index

_DAY = r"[a-z]+"
_DASH = r"\s*[-–—]\s*"
_DAYS_RE = re.compile(
    rf"^(?:(?P<daily>daily|everyday|every\s+day)|(?P<d1>{_DAY})(?:(?:{_DASH}|\s+to\s+)(?P<d2>{_DAY}))?)"
    r"\s*:?\s+(?P<spec>\S.*)$",
    re.ASCII,
)
_RANGE_RE = re.compile(rf"^(?P<h1>\d{{1,2}}):(?P<m1>\d{{2}}){_DASH}(?P<h2>\d{{1,2}}):(?P<m2>\d{{2}})$", re.ASCII)


@dataclass(frozen=True)
class HoursDay:
    """One day's answer, ready to become a `restaurant_hours` row
    (`day_of_week` 0 = Monday .. 6 = Sunday)."""

    day_of_week: int
    is_closed: bool
    open_time: time | None = None
    close_time: time | None = None


@dataclass
class HoursParse:
    """`days` is empty when the cell was blank OR had a problem; `error` is
    set (plain language, no echo of the cell) only for a problem."""

    days: list[HoursDay] = field(default_factory=list)
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.error is None

    @property
    def covers_all_days(self) -> bool:
        return len({d.day_of_week for d in self.days}) == 7


def _fail(part_number: int, message: str) -> HoursParse:
    return HoursParse(days=[], error=f"part {part_number}: {message}")


def _to_time(hour: str, minute: str, *, allow_24: bool) -> time | None:
    h, m = int(hour), int(minute)
    if m > 59:
        return None
    if h == 24 and m == 0 and allow_24:
        return time(0, 0)
    if h > 23:
        return None
    return time(h, m)


def _expand(first: int, last: int) -> list[int]:
    """Days from `first` to `last` inclusive, wrapping past Sunday."""
    out = [first]
    while out[-1] != last:
        out.append((out[-1] + 1) % 7)
    return out


def parse_hours(text: str | None) -> HoursParse:
    """Parse one `hours` cell. Blank -> no days, no error. Never raises."""
    if text is None or not text.strip():
        return HoursParse()
    if len(text) > MAX_HOURS_CELL_LENGTH:
        return HoursParse(error=f"the text is too long (limit {MAX_HOURS_CELL_LENGTH} characters)")

    parts = [p.strip() for p in text.split(";")]
    while parts and parts[-1] == "":  # tolerate a trailing ";"
        parts.pop()
    if not parts or any(p == "" for p in parts):
        return HoursParse(error="empty part between semicolons")

    seen: dict[int, HoursDay] = {}
    for number, part in enumerate(parts, start=1):
        match = _DAYS_RE.match(part.lower())
        if match is None:
            return _fail(number, "expected a day (Mon-Sun or daily) followed by hours")

        if match.group("daily"):
            days = list(range(7))
        else:
            first = _DAY_NAMES.get(match.group("d1"))
            if first is None:
                return _fail(number, "unrecognised day name")
            if match.group("d2") is None:
                days = [first]
            else:
                last = _DAY_NAMES.get(match.group("d2"))
                if last is None:
                    return _fail(number, "unrecognised day name")
                days = _expand(first, last)

        spec = re.sub(r"\s+", " ", match.group("spec")).strip()
        if spec == "closed":
            template = HoursDay(day_of_week=0, is_closed=True)
        else:
            window = _RANGE_RE.match(spec)
            if window is None:
                return _fail(number, "hours must be HH:MM-HH:MM (24-hour) or closed")
            opens = _to_time(window.group("h1"), window.group("m1"), allow_24=False)
            closes = _to_time(window.group("h2"), window.group("m2"), allow_24=True)
            if opens is None or closes is None:
                return _fail(number, "a time is not a valid 24-hour time")
            if opens == closes:
                return _fail(number, "opening and closing times are the same")
            template = HoursDay(day_of_week=0, is_closed=False, open_time=opens, close_time=closes)

        for day in days:
            if day in seen:
                return _fail(number, "a day is listed more than once")
            seen[day] = HoursDay(
                day_of_week=day,
                is_closed=template.is_closed,
                open_time=template.open_time,
                close_time=template.close_time,
            )

    return HoursParse(days=[seen[d] for d in sorted(seen)])

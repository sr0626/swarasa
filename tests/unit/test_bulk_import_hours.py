"""Unit tests: app.core.bulk_import_hours -- the strict `hours` cell parser,
and its hookup in `check_row_fields` (a problem is a warning, never an error)."""
from __future__ import annotations

from datetime import time

import pytest

from app.core.bulk_import_hours import MAX_HOURS_CELL_LENGTH, parse_hours
from app.core.bulk_import_rules import check_row_fields

BASE_ROW = {
    "name": "Spice Hut",
    "address_line1": "1 Main St",
    "city": "Plano",
    "state": "TX",
    "postal_code": "75024",
}


def by_day(parse):
    return {d.day_of_week: d for d in parse.days}


def test_blank_is_no_hours_and_no_error():
    for text in (None, "", "   ", "\t"):
        result = parse_hours(text)
        assert result.ok and result.days == []


def test_range_with_closed_day_covers_the_week():
    result = parse_hours("Mon-Fri 11:00-22:00; Sat 11:00-23:00; Sun closed")
    assert result.ok and result.covers_all_days
    days = by_day(result)
    assert days[0].open_time == time(11) and days[0].close_time == time(22) and not days[0].is_closed
    assert days[4].close_time == time(22)
    assert days[5].close_time == time(23)
    assert days[6].is_closed and days[6].open_time is None and days[6].close_time is None


@pytest.mark.parametrize("text", ["daily 11:00-22:00", "Daily 11:00-22:00", "everyday 11:00-22:00", "Every Day 11:00 - 22:00"])
def test_daily_covers_all_seven_days(text):
    result = parse_hours(text)
    assert result.ok and result.covers_all_days
    assert {d.open_time for d in result.days} == {time(11)}


def test_range_wrapping_the_week_sat_to_mon():
    result = parse_hours("Sat-Mon 10:00-23:00; Tue-Fri 11:00-22:00")
    assert result.ok and result.covers_all_days
    assert {d.day_of_week for d in result.days if d.open_time == time(10)} == {5, 6, 0}


def test_single_day_range_and_full_names():
    result = parse_hours("Monday-Friday 9:00-17:30; Saturday closed; Sunday closed")
    assert result.ok and result.covers_all_days
    assert by_day(result)[0].open_time == time(9) and by_day(result)[0].close_time == time(17, 30)
    assert parse_hours("Mon-Mon 09:00-10:00").days[0].day_of_week == 0


@pytest.mark.parametrize(
    "text",
    [
        "  MON - FRI   11:00 - 22:00 ;  sat 11:00-23:00;SUN   CLOSED  ",
        "mon-fri: 11:00-22:00; sat: 11:00-23:00; sun: closed",
        "Mon–Fri 11:00–22:00; Sat 11:00—23:00; Sun Closed",
        "Mon-Fri 11:00-22:00; Sat 11:00-23:00; Sun closed;",
        "Mon to Fri 11:00 to 22:00".replace(" to 22", "-22"),
    ],
)
def test_case_spacing_and_dash_variants(text):
    result = parse_hours(text)
    assert result.ok, result.error
    assert by_day(result)[0].open_time == time(11)


def test_overnight_close_and_midnight_24_00():
    result = parse_hours("Fri 17:00-02:00; Sat 12:00-24:00")
    assert result.ok
    days = by_day(result)
    assert days[4].open_time == time(17) and days[4].close_time == time(2)
    assert days[5].close_time == time(0, 0)
    assert not result.covers_all_days


def test_partial_week_parses_but_does_not_cover_all_days():
    result = parse_hours("Mon-Fri 11:00-22:00")
    assert result.ok and len(result.days) == 5 and not result.covers_all_days


@pytest.mark.parametrize(
    "text",
    [
        "Mon 25:00-26:00",  # not a time
        "Mon 11:60-22:00",  # bad minutes
        "Mon 24:00-22:00",  # 24:00 only valid as a close time
        "Mon 11:00-22:00 AM",
        "Mon 11am-10pm",  # AM/PM not understood
        "Mon 11:00",  # no range
        "Mon 11:00-22:00, 17:00-23:00",  # split shift
        "Mon 9:00-9:00",  # zero length
        "Mon opens late",
        "Funday 11:00-22:00",  # unknown day
        "Mon-Fun 11:00-22:00",
        "11:00-22:00",  # no day
        "Mon-Fri",  # no hours
        "Mon-Fri 11:00-22:00;; Sat closed",  # empty part
        ";",
        "closed",
    ],
)
def test_bad_input_is_an_error_with_no_partial_days(text):
    result = parse_hours(text)
    assert not result.ok and result.days == []


@pytest.mark.parametrize(
    "text",
    [
        "Mon-Fri 11:00-22:00; Wed 10:00-12:00",  # Wed twice
        "daily 11:00-22:00; Sun closed",
        "Sat-Mon 11:00-22:00; Mon closed",
        "Mon 11:00-12:00; Mon 13:00-14:00",
    ],
)
def test_overlap_is_an_error_and_never_partial(text):
    result = parse_hours(text)
    assert not result.ok and result.days == []
    assert "more than once" in result.error


def test_one_bad_part_poisons_the_whole_cell():
    result = parse_hours("Mon-Fri 11:00-22:00; Sat 99:00-23:00; Sun closed")
    assert not result.ok and result.days == [] and result.error.startswith("part 2")


def test_too_long_is_an_error():
    assert not parse_hours("Mon 11:00-12:00;" * 100).ok
    assert MAX_HOURS_CELL_LENGTH == 300


@pytest.mark.parametrize(
    "text",
    ["=cmd|' /C calc'!A0", "+1-555-1234", "-2+3", "@SUM(A1)", "=1+1; Mon closed", "Mon =HYPERLINK(\"x\")", "\tMon closed;\r"],
)
def test_formula_like_text_is_just_not_understood_and_never_echoed(text):
    result = parse_hours(text)
    if result.ok:  # only the whitespace-tolerant case may parse, and then yields plain ints/times
        assert all(isinstance(d.day_of_week, int) for d in result.days)
    else:
        assert result.days == []
        assert text.strip()[:6] not in (result.error or "")


def test_non_ascii_digits_are_rejected():
    assert not parse_hours("Mon ١١:00-22:00").ok


# --- hookup in check_row_fields ------------------------------------------------


def test_row_with_good_hours_has_them_in_values_and_no_issue():
    check = check_row_fields({**BASE_ROW, "hours": "daily 11:00-22:00"})
    assert not check.has_errors and len(check.values["hours"]) == 7
    assert not [i for i in check.issues if i.field == "hours"]


def test_row_with_bad_hours_is_a_warning_not_an_error():
    check = check_row_fields({**BASE_ROW, "hours": "Mon 11am-10pm"})
    assert not check.has_errors
    assert "hours" not in check.values
    issue = next(i for i in check.issues if i.field == "hours")
    assert issue.severity == "warning" and issue.code == "bad_hours"
    assert "imported without hours" in issue.message


def test_row_with_partial_hours_keeps_them_and_warns():
    check = check_row_fields({**BASE_ROW, "hours": "Mon-Fri 11:00-22:00"})
    assert not check.has_errors and len(check.values["hours"]) == 5
    assert [i.code for i in check.issues if i.field == "hours"] == ["partial_hours"]


def test_control_characters_or_length_in_hours_never_block_the_row():
    for bad in ("Mon closed\x00", "x" * 5000):
        check = check_row_fields({**BASE_ROW, "hours": bad})
        assert not check.has_errors
        assert "hours" not in check.values
        assert any(i.code == "bad_hours" for i in check.issues)


def test_missing_hours_cell_is_silent():
    check = check_row_fields({**BASE_ROW, "hours": None})
    assert not check.issues and "hours" not in check.values

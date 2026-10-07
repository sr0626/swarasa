"""`audit_diff.diff_changes` — friendly labels/values for the activity feed's
"What changed / Previous / New" table. Pure, no DB."""
from __future__ import annotations

from app.services import audit_diff
from app.services.audit_diff import Change, diff_changes, format_phone, format_value


def _one(changes: list[Change]) -> Change:
    assert len(changes) == 1, changes
    return changes[0]


def test_status_values_use_console_wording():
    c = _one(
        diff_changes(
            "restaurant_location",
            "update",
            {"status": "active"},
            {"status": "owner_deactivated"},
        )
    )
    assert (c.label, c.old, c.new) == ("Status", "Live", "Hidden")


def test_every_status_maps_to_a_friendly_word():
    assert audit_diff.STATUS_LABELS == {
        "active": "Live",
        "owner_deactivated": "Hidden",
        "coming_soon": "Coming soon",
        "closed_pending_reopen": "Closed",
    }
    for raw, friendly in audit_diff.STATUS_LABELS.items():
        assert format_value("status", raw) == friendly


def test_legacy_is_active_boolean_reads_live_hidden():
    c = _one(diff_changes("restaurant_location", "update", {"is_active": True}, {"is_active": False}))
    assert (c.label, c.old, c.new) == ("Status", "Live", "Hidden")


def test_booleans_read_yes_no_with_friendly_labels():
    c = _one(
        diff_changes("restaurant_location", "update", {"deals_hidden": False}, {"deals_hidden": True})
    )
    assert (c.label, c.old, c.new) == ("Deals hidden", "No", "Yes")
    c = _one(diff_changes("restaurant_location", "update", {"menu_hidden": None}, {"menu_hidden": True}))
    assert (c.label, c.old, c.new) == ("Menu hidden", None, "Yes")


def test_unchanged_keys_in_a_full_snapshot_are_not_reported():
    old = {"phone": "+19725550142", "city": "Plano", "status": "active"}
    new = {"phone": "+19725550199", "city": "Plano", "status": "active"}
    c = _one(diff_changes("restaurant_location", "update", old, new))
    assert (c.label, c.old, c.new) == ("Phone", "(972) 555-0142", "(972) 555-0199")


def test_address_columns_collapse_into_one_address_change():
    old = {
        "address_line1": "500 Legacy Dr",
        "address_line2": None,
        "city": "Plano",
        "state": "TX",
        "postal_code": "75024",
    }
    new = {**old, "address_line1": "12 Main St", "city": "Frisco", "postal_code": "75034"}
    c = _one(diff_changes("restaurant_location", "update", old, new))
    assert c.label == "Address"
    assert c.old == "500 Legacy Dr, Plano, TX 75024"
    assert c.new == "12 Main St, Frisco, TX 75034"


def test_lat_lng_collapse_into_one_map_position_change():
    old = {"latitude": 32.85, "longitude": -96.97}
    new = {"latitude": 33.1, "longitude": -96.7}
    c = _one(diff_changes("restaurant_location", "update", old, new))
    assert (c.label, c.old, c.new) == ("Map position", "32.8500, -96.9700", "33.1000, -96.7000")


def test_hours_snapshots_diff_per_day_with_friendly_times():
    old = {"hours": {"0": "11:00-21:00", "1": "closed", "2": "unknown"}}
    new = {
        "hours_updated_days": [0, 1, 2],
        "hours": {"0": "10:00-22:00", "1": "closed", "2": "18:00-02:30"},
    }
    changes = diff_changes("restaurant_location", "update", old, new)
    assert [(c.label, c.old, c.new) for c in changes] == [
        ("Hours (Monday)", "11am–9pm", "10am–10pm"),
        ("Hours (Wednesday)", None, "6pm–2:30am"),
    ]


def test_legacy_hours_row_without_snapshots_lists_saved_days():
    c = _one(
        diff_changes("restaurant_location", "update", None, {"hours_updated_days": [0, 4]})
    )
    assert (c.label, c.old, c.new) == ("Hours", None, "Updated: Mon, Fri")


def test_lists_and_text_are_readable_and_bounded():
    c = _one(
        diff_changes(
            "restaurant_location",
            "update",
            {"cuisine_tags": ["hyderabadi"]},
            {"cuisine_tags": ["hyderabadi", "south_indian"]},
        )
    )
    assert (c.label, c.old, c.new) == ("Cuisine tags", "Hyderabadi", "Hyderabadi, South Indian")
    long_about = "x" * 500
    c = _one(diff_changes("restaurant_location", "update", {"about": None}, {"about": long_about}))
    assert c.old is None and c.new is not None and len(c.new) <= 120 and c.new.endswith("…")


def test_internal_ids_never_surface():
    changes = diff_changes(
        "restaurant_brand",
        "update",
        {"owner_id": 1, "is_claimed": False},
        {"owner_id": 2, "is_claimed": True},
    )
    assert [(c.label, c.old, c.new) for c in changes] == [("Claimed", "No", "Yes")]


def test_brand_soft_delete_and_restore():
    c = _one(diff_changes("restaurant_brand", "update", {"deleted_at": None}, {"deleted_at": "2026-09-24"}))
    assert (c.old, c.new) == ("Live", "Deleted by an administrator")
    c = _one(diff_changes("restaurant_brand", "update", {"deleted_at": "x"}, {"deleted_at": None}))
    assert (c.old, c.new) == ("Deleted", "Restored")


def test_create_and_delete_have_no_field_changes():
    assert diff_changes("restaurant_location", "create", None, {"status": "active"}) == []
    assert diff_changes("restaurant_location", "delete", {"status": "active"}, None) == []


def test_manager_assignment_rows_name_the_manager():
    label = "Manager access (jane@example.com)"
    assert _one(
        diff_changes("location_manager", "create", None, {"is_active": True}, manager_label="jane@example.com")
    ) == Change("manager", label, None, "Assigned")
    assert _one(
        diff_changes(
            "location_manager",
            "update",
            {"is_active": True},
            {"is_active": False},
            manager_label="jane@example.com",
        )
    ) == Change("manager", label, "Assigned", "Revoked")
    # Unresolvable manager -> honest fallback, no id.
    assert "a manager" in _one(diff_changes("location_manager", "create", None, {}, manager_label=None)).label


def test_phone_formatting_helper():
    assert format_phone("+19725550142") == "(972) 555-0142"
    assert format_phone("9725550142") == "(972) 555-0142"
    assert format_phone("111") == "111"
    assert format_phone("call us") == "call us"

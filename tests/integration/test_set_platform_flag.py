"""Integration test: the `set_platform_flag` management command
(backend/app/scripts/set_platform_flag.py) — how the human flips
`menu_item_photos_enabled` on later — plus the flag reader it drives and its
registration in the management dispatch table."""
from __future__ import annotations

import pytest

from app.models.platform_config import PlatformConfig
from app.scripts.management import _COMMANDS
from app.scripts.set_platform_flag import SetPlatformFlagError, set_platform_flag
from app.services import menu_service, platform_config_service


def test_command_is_registered():
    assert "set_platform_flag" in _COMMANDS


@pytest.mark.asyncio
async def test_flag_defaults_off_then_flips_on_and_off(db_session):
    assert await menu_service.photos_enabled(db_session) is False

    # Read without writing.
    assert await set_platform_flag("menu_item_photos_enabled", None, db=db_session) == {
        "key": "menu_item_photos_enabled",
        "value": False,
        "changed": False,
    }
    assert await db_session.get(PlatformConfig, "menu_item_photos_enabled") is None

    # ON — creates the row when the seed row is absent (e.g. a fresh test DB).
    on = await set_platform_flag("menu_item_photos_enabled", True, db=db_session)
    assert on == {"key": "menu_item_photos_enabled", "value": True, "previous": False, "changed": True}
    assert await menu_service.photos_enabled(db_session) is True
    assert (await db_session.get(PlatformConfig, "menu_item_photos_enabled")).value == "true"

    # Idempotent.
    again = await set_platform_flag("menu_item_photos_enabled", "true", db=db_session)
    assert again["changed"] is False

    off = await set_platform_flag("menu_item_photos_enabled", "off", db=db_session)
    assert off["value"] is False and off["previous"] is True and off["changed"] is True
    assert await menu_service.photos_enabled(db_session) is False


@pytest.mark.asyncio
@pytest.mark.parametrize("bad_key", [None, "", "menu_photos", "max_active_managers_per_location", 5])
async def test_rejects_unknown_keys(db_session, bad_key):
    with pytest.raises(SetPlatformFlagError):
        await set_platform_flag(bad_key, True, db=db_session)


@pytest.mark.asyncio
@pytest.mark.parametrize("bad_value", ["maybe", "", 2, [], {}])
async def test_rejects_non_boolean_values(db_session, bad_value):
    with pytest.raises(SetPlatformFlagError):
        await set_platform_flag("menu_item_photos_enabled", bad_value, db=db_session)


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("true", True),
        (" TRUE ", True),
        ("1", True),
        ("yes", True),
        ("on", True),
        ("false", False),
        ("0", False),
        ("off", False),
        ("garbage", False),
        ("", False),
        (None, False),
    ],
)
def test_parse_bool_defaults_off(raw, expected):
    assert platform_config_service.parse_bool(raw, default=False) is expected


def test_parse_bool_honours_the_supplied_default_for_garbage():
    assert platform_config_service.parse_bool("garbage", default=True) is True
    assert platform_config_service.parse_bool(None, default=True) is True

"""Guards against parallel migration branches leaving Alembic with more
than one head — `alembic upgrade head` refuses to run then ("Multiple head
revisions"), so no migration could be applied to the real database.
Happened for real when 0009_deal and 0009_user_profile_last_seen_at were
both authored off 0008 (fixed by 0010_merge_0009_heads).
"""
from __future__ import annotations

from pathlib import Path

import pytest

alembic_script = pytest.importorskip("alembic.script")


def test_alembic_has_a_single_head():
    ini = Path(__file__).resolve().parents[2] / "backend" / "migrations" / "alembic.ini"
    from alembic.config import Config

    cfg = Config(str(ini))
    script = alembic_script.ScriptDirectory.from_config(cfg)
    assert len(script.get_heads()) == 1, script.get_heads()

"""Unit tests: `app/scripts/taxonomy.json` (the seed data baked into the
Lambda image) must not drift from `docs/TAXONOMY.md` (the human-edited
source of truth), plus the `seed_taxonomy` management command's dispatch.

No real database: the DB-touching coroutine is stubbed, mirroring
tests/unit/test_run_migrations.py.
"""
from __future__ import annotations

import re
from collections import Counter
from pathlib import Path

import pytest

from app.scripts import management, seed_taxonomy

TAXONOMY_DOC = Path(__file__).resolve().parents[2] / "docs" / "TAXONOMY.md"


def _parse_taxonomy_doc(text: str) -> list[dict[str, str]]:
    """Independent parse of TAXONOMY.md's markdown tables: a
    `category = "x"` line opens a section; every following table row whose
    first cell isn't the header/separator is one tag."""
    tags: list[dict[str, str]] = []
    category: str | None = None
    for line in text.splitlines():
        m = re.match(r'^`category = "(\w+)"`', line)
        if m:
            category = m.group(1)
            continue
        if category and line.startswith("|"):
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if cells[0] == "Tag Name" or set(cells[0]) <= set("-"):
                continue
            tags.append({"name": cells[0], "display_name": cells[1], "category": category})
    return tags


def test_taxonomy_json_is_valid_and_has_no_duplicate_names():
    tags = seed_taxonomy.load_taxonomy()  # raises on unknown category / duplicate name
    assert len(tags) > 0
    assert all(t["display_name"] for t in tags)


def test_taxonomy_json_matches_taxonomy_md():
    if not TAXONOMY_DOC.exists():
        pytest.skip("docs/TAXONOMY.md not present (e.g. running inside a container image)")

    from_doc = _parse_taxonomy_doc(TAXONOMY_DOC.read_text(encoding="utf-8"))
    from_json = seed_taxonomy.load_taxonomy()

    assert Counter(t["category"] for t in from_doc) == Counter(t["category"] for t in from_json)
    assert from_doc == from_json, (
        "backend/app/scripts/taxonomy.json has drifted from docs/TAXONOMY.md -- "
        "regenerate it from the doc's tables (do not hand-edit)."
    )


def test_seed_taxonomy_command_returns_counts_and_disposes_engine(monkeypatch: pytest.MonkeyPatch):
    import app.db.session as session_module

    calls: list[str] = []

    async def fake_run_seed_taxonomy() -> dict:
        calls.append("seed")
        return {"inserted": 63, "already_present": 0}

    async def fake_dispose_engine() -> None:
        calls.append("dispose")

    monkeypatch.setattr(seed_taxonomy, "run_seed_taxonomy", fake_run_seed_taxonomy)
    monkeypatch.setattr(session_module, "dispose_engine", fake_dispose_engine)

    result = management.run_management_command({"_management_command": "seed_taxonomy"}, None)

    assert result == {"ok": True, "command": "seed_taxonomy", "inserted": 63, "already_present": 0}
    assert calls == ["seed", "dispose"]


def test_seed_taxonomy_command_reports_bad_data_as_not_ok(monkeypatch: pytest.MonkeyPatch):
    import app.db.session as session_module

    async def fake_run_seed_taxonomy() -> dict:
        raise seed_taxonomy.TaxonomyDataError("Duplicate tag name 'x'")

    async def fake_dispose_engine() -> None:
        pass

    monkeypatch.setattr(seed_taxonomy, "run_seed_taxonomy", fake_run_seed_taxonomy)
    monkeypatch.setattr(session_module, "dispose_engine", fake_dispose_engine)

    result = management.run_management_command({"_management_command": "seed_taxonomy"}, None)

    assert result["ok"] is False
    assert result["command"] == "seed_taxonomy"
    assert "Duplicate" in result["error"]

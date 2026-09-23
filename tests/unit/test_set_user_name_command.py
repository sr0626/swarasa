"""Unit tests for the `set_user_name` management-command wrapper in
app/scripts/management.py -- registration, payload pass-through, generic
error handling and dispose_engine, with the DB-touching function faked."""
from __future__ import annotations

import pytest

import app.db.session as session_mod
import app.scripts.set_user_name as sun
from app.scripts.management import _COMMANDS, run_management_command


@pytest.fixture
def disposed(monkeypatch):
    calls = []

    async def _dispose():
        calls.append(1)

    monkeypatch.setattr(session_mod, "dispose_engine", _dispose)
    return calls


def test_command_is_registered():
    assert "set_user_name" in _COMMANDS


def test_command_passes_payload_and_disposes_engine(monkeypatch, disposed):
    seen = {}

    async def _fake(full_name, email, cognito_sub):
        seen.update(full_name=full_name, email=email, cognito_sub=cognito_sub)
        return {"ok": True, "changed": True, "target": "owner_account", "full_name": full_name}

    monkeypatch.setattr(sun, "run_set_user_name", _fake)
    out = run_management_command(
        {"_management_command": "set_user_name", "email": "a@b.co", "full_name": "New Name"}, None
    )
    assert out == {
        "command": "set_user_name",
        "ok": True,
        "changed": True,
        "target": "owner_account",
        "full_name": "New Name",
    }
    assert seen == {"full_name": "New Name", "email": "a@b.co", "cognito_sub": None}
    assert disposed == [1]


def test_command_returns_ok_false_on_expected_error(monkeypatch, disposed):
    async def _fake(full_name, email, cognito_sub):
        raise sun.SetUserNameError("That user has no name set yet")

    monkeypatch.setattr(sun, "run_set_user_name", _fake)
    out = run_management_command({"_management_command": "set_user_name", "email": "a@b.co", "full_name": "X"}, None)
    assert out == {"ok": False, "command": "set_user_name", "error": "That user has no name set yet"}
    assert disposed == [1]

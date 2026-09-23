"""Unit test: `app/lambda_handlers/deal_expiry.py::handler` wiring —
verifies the EventBridge entry point calls the async DB-touching coroutine
via `asyncio.run` and shapes its return value correctly, WITHOUT touching
any real (or even in-memory) database. `_expire_deals` itself (the real
`is_active`/`end_at` matching + audit_log-writing logic) is exercised
against a real SQLite DB instead, in
tests/integration/test_deal_expiry.py — see that file's docstring for why
`handler()` can't be called directly from an async pytest test
(`asyncio.run` cannot be nested inside pytest-asyncio's own running loop).

This mirrors tests/unit/test_resize_photo_handler.py's approach of
monkeypatching the handler's own internals rather than exercising the real
heavy dependency (Pillow there; the full sqlalchemy/asyncpg DB stack here)
in a pure unit test.
"""
from __future__ import annotations

from app.lambda_handlers import deal_expiry


def test_handler_returns_expired_count_from_expire_deals(monkeypatch):
    async def _fake_expire_deals() -> int:
        return 3

    monkeypatch.setattr(deal_expiry, "_expire_deals", _fake_expire_deals)

    result = deal_expiry.handler({}, None)

    assert result == {"expired": 3}


def test_handler_returns_zero_when_nothing_expired(monkeypatch):
    async def _fake_expire_deals() -> int:
        return 0

    monkeypatch.setattr(deal_expiry, "_expire_deals", _fake_expire_deals)

    assert deal_expiry.handler({}, None) == {"expired": 0}


def test_system_actor_constants_are_self_describing():
    """Sanity check on the documented convention (docs/DECISIONS.md
    "System-initiated audit_log writes") — a future reader grepping
    audit_log.actor_id for "system:" should find this Lambda's rows."""
    assert deal_expiry.SYSTEM_ACTOR_ROLE == "system"
    assert deal_expiry.SYSTEM_ACTOR_ID.startswith("system:")

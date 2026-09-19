"""Unit test: `app/db/session.py`'s DATABASE_URL / DB_SECRET_NAME fallback.

Bug context (found during Architect review of PR #46): Terraform's Lambda
module (`infra/modules/lambda/main.tf`) only sets `DB_SECRET_NAME` on the
real deployed Lambda — never `DATABASE_URL` — but `session.py` used to read
`DATABASE_URL` directly and raise if unset, so the real deployed backend
would fail on its very first DB-touching request. Fixed per
`infra/CLAUDE.md` "Secrets Management": fetch the secret via boto3
`get_secret_value` at cold start and build the connection URL from it.

No real AWS call is ever made here (tests/CLAUDE.md "ALWAYS mock AWS calls
... instead of hitting real Secrets Manager") — `app.db.session.boto3` is
monkeypatched to a stub module, mirroring `tests/unit/test_s3_service.py`'s
approach of stubbing the boto3 client rather than hitting the network.
"""
from __future__ import annotations

import json

import pytest

from app.db import session as db_session


class _FakeSecretsManagerClient:
    """Stub replacing the real boto3 Secrets Manager client. Records what
    it was asked to fetch and returns a fixed fake secret — never talks to
    AWS.
    """

    def __init__(self, secret_string: str):
        self._secret_string = secret_string
        self.get_secret_value_calls: list[dict] = []

    def get_secret_value(self, SecretId: str) -> dict:
        self.get_secret_value_calls.append({"SecretId": SecretId})
        return {"SecretString": self._secret_string}


class _FakeBoto3Module:
    """Stub replacing the `boto3` module reference `session.py` calls
    `boto3.client("secretsmanager")` on.
    """

    def __init__(self, client: _FakeSecretsManagerClient):
        self._client = client
        self.client_calls: list[str] = []

    def client(self, service_name: str):
        self.client_calls.append(service_name)
        return self._client


_FAKE_SECRET_JSON = json.dumps(
    {
        "username": "app_user",
        "password": "s3cr3t/pass+word",  # deliberately URL-unsafe chars
        "host": "swarasa-dev.cluster-xyz.us-east-1.rds.amazonaws.com",
        "port": 5432,
        "dbname": "restaurantdb",
        "engine": "aurora-postgresql",
    }
)


@pytest.fixture(autouse=True)
def _reset_cached_secret_url(monkeypatch: pytest.MonkeyPatch):
    """The fetched URL is cached at module scope (cold-start-only fetch) —
    reset it before/after every test so tests don't leak state into each
    other, same reasoning as resetting `_engine`/`_session_factory` would
    need if a test touched those.
    """
    monkeypatch.setattr(db_session, "_database_url_from_secret", None)
    yield
    monkeypatch.setattr(db_session, "_database_url_from_secret", None)


def test_uses_database_url_directly_when_set(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://u:p@localhost:5432/db")
    monkeypatch.delenv("DB_SECRET_NAME", raising=False)

    url = db_session._get_database_url()

    assert url == "postgresql+asyncpg://u:p@localhost:5432/db"


def test_falls_back_to_secrets_manager_when_database_url_unset(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("DB_SECRET_NAME", "swarasa/dev/db")

    fake_client = _FakeSecretsManagerClient(_FAKE_SECRET_JSON)
    fake_boto3 = _FakeBoto3Module(fake_client)
    monkeypatch.setattr(db_session, "boto3", fake_boto3)

    url = db_session._get_database_url()

    assert url == (
        "postgresql+asyncpg://app_user:s3cr3t%2Fpass%2Bword@"
        "swarasa-dev.cluster-xyz.us-east-1.rds.amazonaws.com:5432/restaurantdb"
    )
    # Fetched the exact secret named by DB_SECRET_NAME, via Secrets Manager
    assert fake_boto3.client_calls == ["secretsmanager"]
    assert fake_client.get_secret_value_calls == [{"SecretId": "swarasa/dev/db"}]


def test_secret_is_fetched_only_once_across_repeated_calls(
    monkeypatch: pytest.MonkeyPatch,
):
    """Cold-start-only caching — must not re-fetch the secret on every
    request/call (root CLAUDE.md AWS Best Practices; same reasoning as the
    connection pool being sized for Aurora Serverless v2 scale-to-zero)."""
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("DB_SECRET_NAME", "swarasa/dev/db")

    fake_client = _FakeSecretsManagerClient(_FAKE_SECRET_JSON)
    fake_boto3 = _FakeBoto3Module(fake_client)
    monkeypatch.setattr(db_session, "boto3", fake_boto3)

    first = db_session._get_database_url()
    second = db_session._get_database_url()

    assert first == second
    assert len(fake_client.get_secret_value_calls) == 1


def test_raises_clear_error_when_neither_is_set(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("DB_SECRET_NAME", raising=False)

    with pytest.raises(RuntimeError, match="DATABASE_URL is not set"):
        db_session._get_database_url()


def test_database_url_takes_precedence_over_db_secret_name(
    monkeypatch: pytest.MonkeyPatch,
):
    """Local dev via .env (DATABASE_URL) must keep working exactly as
    before, even if DB_SECRET_NAME also happens to be present."""
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://local:local@localhost:5432/dev_db")
    monkeypatch.setenv("DB_SECRET_NAME", "swarasa/dev/db")

    def _fail_if_called(service_name: str):
        raise AssertionError("boto3.client should not be called when DATABASE_URL is set")

    fake_boto3 = _FakeBoto3Module(_FakeSecretsManagerClient(_FAKE_SECRET_JSON))
    monkeypatch.setattr(fake_boto3, "client", _fail_if_called)
    monkeypatch.setattr(db_session, "boto3", fake_boto3)

    url = db_session._get_database_url()

    assert url == "postgresql+asyncpg://local:local@localhost:5432/dev_db"


class _FakeAsyncEngine:
    """Stub replacing a real `AsyncEngine` — just needs an async
    `dispose()` that records it was called."""

    def __init__(self):
        self.dispose_calls = 0

    async def dispose(self):
        self.dispose_calls += 1


@pytest.mark.asyncio
async def test_dispose_engine_disposes_and_resets_cache(monkeypatch: pytest.MonkeyPatch):
    """Real bug (2026-09-18, CSV bulk import, see dispose_engine's own
    docstring): a cached `_engine`'s asyncpg connection pool is bound to
    whatever event loop first used it. Each management-command invocation
    runs its own `asyncio.run()` — its own fresh loop — so a warm
    container reusing the cached engine across invocations hit "Task ...
    got Future ... attached to a different loop" on the batch's first DB
    call. dispose_engine() must actually dispose the engine AND null out
    both module globals so the next get_engine() call builds a fresh one.
    """
    fake_engine = _FakeAsyncEngine()
    monkeypatch.setattr(db_session, "_engine", fake_engine)
    monkeypatch.setattr(db_session, "_session_factory", object())

    await db_session.dispose_engine()

    assert fake_engine.dispose_calls == 1
    assert db_session._engine is None
    assert db_session._session_factory is None


@pytest.mark.asyncio
async def test_dispose_engine_is_a_no_op_when_never_created(monkeypatch: pytest.MonkeyPatch):
    """An early-return command path (e.g. no Cognito user found for the
    given email) can call dispose_engine() before get_engine() was ever
    reached — must not raise just because there's nothing to dispose."""
    monkeypatch.setattr(db_session, "_engine", None)
    monkeypatch.setattr(db_session, "_session_factory", None)

    await db_session.dispose_engine()  # must not raise

    assert db_session._engine is None
    assert db_session._session_factory is None


def test_discard_engine_cache_forgets_engine_without_disposing(monkeypatch: pytest.MonkeyPatch):
    """A warm container may hold an engine cached on another event loop
    (e.g. from an HTTP request); management commands must not inherit it.
    Must NOT dispose -- the owning loop is unreachable from here."""
    fake_engine = _FakeAsyncEngine()
    monkeypatch.setattr(db_session, "_engine", fake_engine)
    monkeypatch.setattr(db_session, "_session_factory", object())

    db_session.discard_engine_cache()

    assert db_session._engine is None
    assert db_session._session_factory is None
    assert fake_engine.dispose_calls == 0


def test_run_management_command_starts_with_no_inherited_engine(monkeypatch: pytest.MonkeyPatch):
    from app.scripts import management

    seen: dict = {}

    def _probe(event: dict) -> dict:
        seen["engine"] = db_session._engine
        seen["factory"] = db_session._session_factory
        return {"ok": True}

    monkeypatch.setitem(management._COMMANDS, "probe", _probe)
    monkeypatch.setattr(db_session, "_engine", _FakeAsyncEngine())
    monkeypatch.setattr(db_session, "_session_factory", object())

    result = management.run_management_command({"_management_command": "probe"}, None)

    assert result == {"ok": True}
    assert seen == {"engine": None, "factory": None}

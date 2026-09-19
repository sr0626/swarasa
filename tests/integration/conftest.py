"""Integration test fixtures — real app (`app.main.app`) wired to a real
async SQLAlchemy session and driven over HTTP via `httpx.AsyncClient` +
`ASGITransport` (in-process — no real socket, no real server process).

Database: a fresh **SQLite** (aiosqlite) in-memory database per test
function — see the `db_session` fixture docstring below for exactly why
SQLite (not a real Postgres) is used here, and what that does and doesn't
prove. Short version: `restaurant_location.geom` is a PostGIS `Geography`
column and `search_service.search()` calls real PostGIS SQL functions
(`ST_DWithin`, `ST_MakePoint`, `ST_SetSRID`, `ST_Distance`) that simply
don't exist on SQLite — so geo-radius search integration tests
(`test_search_api.py`) require a *real* Postgres+PostGIS database and are
guarded/skipped here accordingly. Every other Phase 1 integration flow
(claim flow, manager permissions, owner portal, public read access) touches
no PostGIS function at all, so a real relational DB (SQLite, in this
sandbox) exercises the real ORM/service/router code faithfully.

Auth: Cognito JWT verification itself is unit-tested in
`tests/unit/test_auth_jwt.py` against a mocked JWKS client. Here, at the
HTTP/integration layer, `app.dependencies.auth.get_current_user` is
overridden per-test via FastAPI's `dependency_overrides` with a fake
`CurrentUser` — this is a deliberate choice, not a shortcut: it lets these
tests exercise the REAL downstream permission logic
(`require_owner`/`require_brand_write_access`/`require_location_write_access`/
`require_location_owner_or_admin`, all unchanged, all still doing their own
real DB queries) while never making a real network call to Cognito's JWKS
endpoint (root CLAUDE.md AWS Best Practices / tests/CLAUDE.md "ALWAYS mock
AWS calls instead of hitting real AWS").
"""
from __future__ import annotations

import uuid
from collections.abc import AsyncIterator, Callable

import pytest
import pytest_asyncio
from geoalchemy2.types import Geography
from httpx import ASGITransport, AsyncClient
from sqlalchemy import BigInteger, event
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.pool import StaticPool
from sqlalchemy.schema import CreateIndex

import app.main as app_main
from app.db.base import Base
from app.dependencies.auth import CurrentUser, get_current_user
from app.dependencies.db import get_db

# Import app.models (not otherwise referenced) so every model class is
# registered on Base.metadata before create_all runs below.
import app.models  # noqa: F401


# ---------------------------------------------------------------------------
# Test-only SQLite DDL compatibility shim. Lives entirely in tests/ — never
# touches backend/app. Renders the PostGIS `Geography` column as plain TEXT
# so `CREATE TABLE restaurant_location (...)` succeeds on SQLite; the
# *content* of that column is never read via a SQL geo function in any test
# that uses this fixture (search/radius tests use a real Postgres instead).
# ---------------------------------------------------------------------------
@compiles(Geography, "sqlite")
def _compile_geography_as_text_on_sqlite(type_, compiler, **kw):  # pragma: no cover - DDL glue
    return "TEXT"


# Same reasoning, for audit_log.old_val/new_val (JSONB — Postgres-only).
# SQLite has a plain JSON type; JSONB's astext_type wrapper isn't relevant
# outside Postgres, so this is a lossless-enough substitution for DDL/test
# purposes (SQLAlchemy still (de)serializes Python dicts through it).
@compiles(JSONB, "sqlite")
def _compile_jsonb_as_json_on_sqlite(type_, compiler, **kw):  # pragma: no cover - DDL glue
    return "JSON"


# SQLite only aliases a primary-key column to its fast, auto-incrementing
# internal `rowid` when the column's declared type is the exact literal
# string "INTEGER" (SQLite docs, CREATE TABLE / rowid section) — "BIGINT"
# does not qualify, so every `BigInteger` primary key in this schema would
# otherwise insert as a required, caller-supplied NOT NULL value on SQLite
# only (works correctly on real Postgres, where BIGINT + SERIAL/IDENTITY
# always auto-generates). Test-only DDL rendering fix so factory-built rows
# never need a hardcoded id (tests/CLAUDE.md "NEVER hardcode IDs").
@compiles(BigInteger, "sqlite")
def _compile_biginteger_as_integer_on_sqlite(type_, compiler, **kw):  # pragma: no cover - DDL glue
    return "INTEGER"


# The schema has three partial unique indexes (postgresql_where=...):
# `restaurant_photo.uq_restaurant_photo_one_cover_per_location`,
# `location_manager.uq_location_manager_active_user`,
# `claim_request.uq_claim_request_pending_brand`. SQLAlchemy silently drops
# dialect-specific DDL kwargs (postgresql_where included) when compiling for
# a different dialect — so on SQLite these would otherwise become PLAIN
# (unconditional) unique indexes. That's actively wrong in both directions,
# not just "slightly less strict than Postgres": e.g. `restaurant_photo`
# would allow at most ONE row per location TOTAL (not one *cover* photo),
# breaking any test with more than one gallery photo per location; and
# `claim_service.create_claim` relies entirely on catching the DB's
# IntegrityError to detect a duplicate PENDING claim (no separate
# application-level pre-check) — dropping the index's WHERE entirely (an
# earlier version of this shim did that) silently removed the constraint,
# so a duplicate claim for an already-*resolved* brand would incorrectly
# still 409 on Postgres... no: the opposite direction (no constraint at all
# on SQLite) let a duplicate PENDING claim through with 201, which is wrong.
#
# SQLite has supported partial indexes (`CREATE INDEX ... WHERE ...`) since
# 3.8.0 (2015) — the same feature Postgres has, just expressed through a
# different SQLAlchemy dialect kwarg. So the faithful fix is to translate
# `postgresql_where`'s condition into a real SQLite partial index, not to
# drop it or leave it plain. This preserves the exact intended semantics
# (unique only among matching rows) on both dialects.
@compiles(CreateIndex, "sqlite")
def _translate_postgres_partial_index_to_sqlite(create, compiler, **kw):  # pragma: no cover - DDL glue
    index = create.element
    pg_where = index.dialect_options.get("postgresql", {}).get("where")
    if pg_where is None:
        return compiler.visit_create_index(create, **kw)

    preparer = compiler.preparer
    table_name = preparer.format_table(index.table)
    index_name = preparer.quote(index.name)
    columns = ", ".join(preparer.quote(col.name) for col in index.columns)
    unique = "UNIQUE " if index.unique else ""
    where_sql = compiler.sql_compiler.process(pg_where, literal_binds=True)
    return f"CREATE {unique}INDEX {index_name} ON {table_name} ({columns}) WHERE {where_sql}"


@pytest_asyncio.fixture
async def db_session(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[AsyncSession]:
    """Fresh in-memory SQLite DB per test function.

    Per-test (not per-session/module) database, deliberately: tests/CLAUDE.md
    "NEVER write tests that depend on test execution order" — a shared DB
    across tests invites exactly that. In-memory SQLite table creation is
    cheap enough that per-test isolation costs nothing meaningful here.

    Caveat (documented, not worked around): three of the schema's
    partial-unique indexes use `postgresql_where=...`
    (`restaurant_photo.uq_restaurant_photo_one_cover_per_location`,
    `location_manager.uq_location_manager_active_user`,
    `claim_request.uq_claim_request_pending_brand`). SQLAlchemy silently
    drops dialect-specific DDL kwargs on other dialects, so on SQLite these
    become PLAIN (non-partial) unique indexes — e.g. a location could not
    have a revoked (`is_active=False`) location_manager row *and* a new
    active one for the same user, even though Postgres explicitly allows
    that. Every fixture/test in this suite is written to never rely on the
    partial (Postgres-only) half of that behavior; see inline comments
    where it matters.
    """
    # geoalchemy2's Geography/Geometry types unconditionally wrap every bind
    # parameter (including NULL) in `ST_GeogFromText(...)` on INSERT/UPDATE
    # and every SELECTed column in `AsBinary(...)` (`_GISType.bind_expression`
    # / `column_expression`), regardless of dialect — correct and necessary
    # on real Postgres+PostGIS, but SQLite has neither function. None of the
    # tests using this fixture ever assign a real geo value or query through
    # the geo function pipeline (radius search requires real Postgres — see
    # test_search_api.py), so disabling this wrapping here is a no-op for
    # what's actually tested. Reverted automatically after each test by
    # `monkeypatch` — never applied to test_search_api.py's real Postgres
    # fixtures.
    from geoalchemy2.types import _GISType

    monkeypatch.setattr(_GISType, "bind_expression", lambda self, bindvalue: bindvalue)
    monkeypatch.setattr(_GISType, "column_expression", lambda self, col: col)

    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )

    @event.listens_for(engine.sync_engine, "connect")
    def _enable_sqlite_fk(dbapi_connection, _connection_record):  # pragma: no cover - DDL glue
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session

    await engine.dispose()


AsUserFn = Callable[..., CurrentUser]


@pytest_asyncio.fixture
async def client(db_session: AsyncSession) -> AsyncIterator[AsyncClient]:
    """Real FastAPI app, real router/dependency/service code, DB swapped for
    the per-test SQLite session above. No real server process, no real
    socket — `ASGITransport` calls the ASGI app in-process.
    """

    async def _override_get_db():
        yield db_session

    app_main.app.dependency_overrides[get_db] = _override_get_db
    transport = ASGITransport(app=app_main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app_main.app.dependency_overrides.clear()


@pytest.fixture
def as_user(client: AsyncClient) -> AsUserFn:
    """Returns a callable that overrides `get_current_user` for the rest of
    the test with a fake, already-"verified" identity — see module
    docstring for why this is the right mock boundary (never a real JWKS
    call; the real permission-check dependencies downstream are untouched).

    Usage: `owner = as_user("owner", sub=owner_account.cognito_sub)`.
    """

    def _as_user(role: str, *, sub: str | None = None, email: str | None = None) -> CurrentUser:
        user = CurrentUser(
            cognito_sub=sub or str(uuid.uuid4()),
            email=email if email is not None else f"{uuid.uuid4().hex[:10]}@example.com",
            role=role,
        )

        async def _override():
            return user

        app_main.app.dependency_overrides[get_current_user] = _override
        return user

    return _as_user


@pytest.fixture
def as_anonymous(client: AsyncClient) -> None:
    """Explicitly ensure no auth override is installed — for public-route
    tests where we want the REAL `get_current_user` (which, given no
    Authorization header, fails closed with 401 without ever calling the
    JWKS client — see app/dependencies/auth.py::get_current_user).
    """
    app_main.app.dependency_overrides.pop(get_current_user, None)


@pytest.fixture(autouse=True)
def _block_real_cognito_group_calls(monkeypatch):
    """Claim approval calls `cognito_service.add_user_to_group` (best-effort,
    after commit). Tests set COGNITO_USER_POOL_ID, so without this an approve
    test would build a real boto3 client. Default it to a no-op; tests that
    care re-patch it or the boto3 client."""
    from app.services import cognito_service

    monkeypatch.setattr(cognito_service, "add_user_to_group", lambda username, group_name: None)

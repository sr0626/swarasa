"""Alembic environment — async SQLAlchemy, autogenerate against app models.

Reads `DATABASE_URL` from the environment rather than `alembic.ini`
(root CLAUDE.md "NEVER hardcode secrets, keys, tokens, or passwords in
any file"). Never run `alembic upgrade` from here against a real
database — Architect and every other agent only ever generates
migration files (root CLAUDE.md "NEVER run Alembic migrations —
generate migration files only").
"""
import asyncio
import os
import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

# Make `app` importable when Alembic is invoked from `backend/migrations/`.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db.base import Base  # noqa: E402
import app.models  # noqa: E402  (registers every model on Base.metadata)

# this is the Alembic Config object, which provides access to values
# within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Pull the connection string from the environment, not from alembic.ini.
database_url = os.environ.get("DATABASE_URL")
if database_url:
    # Config.set_main_option() goes through configparser, which treats a
    # bare "%" as the start of an interpolation sequence like "%(name)s".
    # A URL-encoded password (app/db/session.py's quote_plus) legitimately
    # contains literal "%XX" escapes, which configparser then tries to
    # interpolate and fails on ("invalid interpolation syntax"). "%%" is
    # configparser's own documented escape for a literal "%" -- this does
    # not change the URL's actual value, only how it survives this one
    # config layer.
    config.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))

# add your model's MetaData object here for 'autogenerate' support
target_metadata = Base.metadata


def include_object(object, name, type_, reflected, compare_to):
    """Exclude PostGIS's own internal bookkeeping table from autogenerate."""
    if type_ == "table" and name == "spatial_ref_sys":
        return False
    return True


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode (emits SQL without a live DB)."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        include_object=include_object,
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        include_object=include_object,
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """Run migrations in 'online' mode using an async engine."""
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()

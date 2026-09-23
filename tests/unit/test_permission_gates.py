"""Unit test: owner/manager/admin permission-gate logic in
`app/dependencies/auth.py` — tests/CLAUDE.md "Key Test Patterns" ("Integration
test: manager permission boundary") exercised here at the *unit* level: the
real dependency functions are called directly with a fake AsyncSession and a
fake `CurrentUser`, so no real DB/HTTP is needed to prove the permission
logic itself is correct (root CLAUDE.md "Permission model": owner full
access to own brands/locations, manager only assigned locations checked
server-side every write, admin full platform access per the documented API
contracts, never trust JWT claims alone).

The equivalent boundary is exercised again at the HTTP/integration level in
tests/integration/test_manager_permissions.py and test_owner_portal.py
against a real (SQLite-backed) app + DB — this file isolates the pure
decision logic so a permission regression fails fast without needing the
DB/app wiring at all.
"""
from __future__ import annotations

import uuid

import pytest

from app.core.errors import AppError
from app.dependencies import auth as auth_deps
from app.dependencies.auth import CurrentUser
from app.models.location_manager import LocationManager
from app.models.owner_account import OwnerAccount
from app.models.restaurant_brand import RestaurantBrand
from app.models.restaurant_location import RestaurantLocation


class _FakeResult:
    def __init__(self, scalar=None):
        self._scalar = scalar

    def scalar_one_or_none(self):
        return self._scalar


class _FakeSession:
    """Minimal AsyncSession stand-in: `.get(Model, id)` keyed by (Model, id),
    `.execute(stmt)` returns a pre-baked `_FakeResult`. Enough surface for
    the permission-gate dependencies under test — nothing here talks to a
    real database.
    """

    def __init__(self, get_map: dict | None = None, execute_result: _FakeResult | None = None):
        self._get_map = get_map or {}
        self._execute_result = execute_result or _FakeResult(None)

    async def get(self, model, id_):
        return self._get_map.get((model, id_))

    async def execute(self, _stmt):
        return self._execute_result

    async def commit(self):
        return None


def _user(role: str, sub: str | None = None) -> CurrentUser:
    return CurrentUser(cognito_sub=sub or str(uuid.uuid4()), email="u@example.com", role=role)


# ---------------------------------------------------------------------------
# require_admin
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_require_admin_allows_admin():
    user = _user("admin")
    result = await auth_deps.require_admin(current_user=user)
    assert result is user


@pytest.mark.asyncio
async def test_require_admin_rejects_non_admin():
    with pytest.raises(AppError) as exc_info:
        await auth_deps.require_admin(current_user=_user("owner"))
    assert exc_info.value.status_code == 403


# ---------------------------------------------------------------------------
# require_owner
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_require_owner_rejects_manager(monkeypatch: pytest.MonkeyPatch):
    with pytest.raises(AppError) as exc_info:
        await auth_deps.require_owner(current_user=_user("manager"), db=_FakeSession())
    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_require_owner_provisions_owner_account_id(monkeypatch: pytest.MonkeyPatch):
    fake_owner = OwnerAccount(id=42, cognito_sub="sub-1", email="o@example.com")

    async def _fake_get_or_create(db, sub, email):
        return fake_owner

    monkeypatch.setattr(auth_deps.auth_service, "get_or_create_owner_account", _fake_get_or_create)

    user = _user("owner")
    result = await auth_deps.require_owner(current_user=user, db=_FakeSession())
    assert result.owner_account_id == 42


# ---------------------------------------------------------------------------
# require_brand_write_access — PATCH /restaurants/{id}: owner (owns brand) or
# admin, per docs/API_CONTRACTS.md.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_require_brand_write_access_admin_bypasses_ownership_check():
    user = _user("admin")
    result = await auth_deps.require_brand_write_access(
        brand_id=999, db=_FakeSession(), current_user=user
    )
    assert result is user


@pytest.mark.asyncio
async def test_require_brand_write_access_rejects_non_owner_non_admin_role():
    with pytest.raises(AppError) as exc_info:
        await auth_deps.require_brand_write_access(
            brand_id=1, db=_FakeSession(), current_user=_user("registered_user")
        )
    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_require_brand_write_access_404_when_brand_missing():
    db = _FakeSession()  # no brand row at all
    with pytest.raises(AppError) as exc_info:
        await auth_deps.require_brand_write_access(brand_id=1, db=db, current_user=_user("owner"))
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_require_brand_write_access_404_when_brand_soft_deleted():
    """A soft-deleted brand (`deleted_at` set) 404s for its own owner, same
    as a nonexistent one."""
    from datetime import datetime, timezone

    brand = RestaurantBrand(id=1, owner_id=1, name="x", slug="x", deleted_at=datetime.now(timezone.utc))
    db = _FakeSession(get_map={(RestaurantBrand, 1): brand})
    with pytest.raises(AppError) as exc_info:
        await auth_deps.require_brand_write_access(brand_id=1, db=db, current_user=_user("owner"))
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_require_brand_write_access_403_for_non_owning_owner(monkeypatch: pytest.MonkeyPatch):
    other_owner = OwnerAccount(id=7, cognito_sub="not-me", email="other@example.com")

    async def _fake_get_owner_by_sub(db, sub):
        return other_owner

    monkeypatch.setattr(auth_deps.auth_service, "get_owner_account_by_sub", _fake_get_owner_by_sub)

    # Brand is owned by owner id 1, but the resolved caller is owner id 7.
    db = _FakeSession(get_map={(RestaurantBrand, 1): RestaurantBrand(id=1, owner_id=1, name="x", slug="x")})
    with pytest.raises(AppError) as exc_info:
        await auth_deps.require_brand_write_access(
            brand_id=1, db=db, current_user=_user("owner", sub="not-me")
        )
    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_require_brand_write_access_200_for_owning_owner(monkeypatch: pytest.MonkeyPatch):
    the_owner = OwnerAccount(id=1, cognito_sub="me", email="me@example.com")

    async def _fake_get_owner_by_sub(db, sub):
        return the_owner

    monkeypatch.setattr(auth_deps.auth_service, "get_owner_account_by_sub", _fake_get_owner_by_sub)

    db = _FakeSession(get_map={(RestaurantBrand, 1): RestaurantBrand(id=1, owner_id=1, name="x", slug="x")})
    user = _user("owner", sub="me")
    result = await auth_deps.require_brand_write_access(brand_id=1, db=db, current_user=user)
    assert result.owner_account_id == 1


# ---------------------------------------------------------------------------
# require_location_write_access — the manager permission boundary itself
# (PATCH /locations/{id}, /hours, /photos*): owner (owns brand) or manager
# with an ACTIVE location_manager row — never the JWT role claim alone.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_require_location_write_access_404_when_location_missing():
    db = _FakeSession(get_map={})
    with pytest.raises(AppError) as exc_info:
        await auth_deps.require_location_write_access(
            location_id=1, db=db, current_user=_user("owner")
        )
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_require_location_write_access_owner_success(monkeypatch: pytest.MonkeyPatch):
    location = RestaurantLocation(id=1, brand_id=10, address_line1="x", city="Plano", state="TX",
                                   postal_code="75024")
    brand = RestaurantBrand(id=10, name="B", slug="b", owner_id=5)
    owner = OwnerAccount(id=5, cognito_sub="me", email="me@example.com")

    async def _fake_get_owner_by_sub(db, sub):
        return owner

    monkeypatch.setattr(auth_deps.auth_service, "get_owner_account_by_sub", _fake_get_owner_by_sub)

    db = _FakeSession(get_map={
        (RestaurantLocation, 1): location,
        (RestaurantBrand, 10): brand,
    })
    result = await auth_deps.require_location_write_access(
        location_id=1, db=db, current_user=_user("owner", sub="me")
    )
    assert result.owner_account_id == 5


@pytest.mark.asyncio
async def test_require_location_write_access_owner_of_different_brand_is_403(
    monkeypatch: pytest.MonkeyPatch,
):
    location = RestaurantLocation(id=1, brand_id=10, address_line1="x", city="Plano", state="TX",
                                   postal_code="75024")
    brand = RestaurantBrand(id=10, name="B", slug="b", owner_id=999)  # someone else's brand
    caller_owner = OwnerAccount(id=5, cognito_sub="me", email="me@example.com")

    async def _fake_get_owner_by_sub(db, sub):
        return caller_owner

    monkeypatch.setattr(auth_deps.auth_service, "get_owner_account_by_sub", _fake_get_owner_by_sub)

    db = _FakeSession(get_map={
        (RestaurantLocation, 1): location,
        (RestaurantBrand, 10): brand,
    })
    with pytest.raises(AppError) as exc_info:
        await auth_deps.require_location_write_access(
            location_id=1, db=db, current_user=_user("owner", sub="me")
        )
    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_require_location_write_access_manager_with_active_assignment_succeeds():
    location = RestaurantLocation(id=1, brand_id=10, address_line1="x", city="Plano", state="TX",
                                   postal_code="75024")
    manager_row = LocationManager(id=1, location_id=1, user_id="mgr-sub", is_active=True)
    db = _FakeSession(
        get_map={(RestaurantLocation, 1): location},
        execute_result=_FakeResult(scalar=manager_row),
    )
    result = await auth_deps.require_location_write_access(
        location_id=1, db=db, current_user=_user("manager", sub="mgr-sub")
    )
    assert result.role == "manager"


@pytest.mark.asyncio
async def test_require_location_write_access_manager_without_assignment_is_403():
    """The core "manager permission boundary" case from tests/CLAUDE.md:
    an unassigned manager must get 403, checked fresh against
    `location_manager` (never inferred from the JWT `manager` group claim
    alone).
    """
    location = RestaurantLocation(id=1, brand_id=10, address_line1="x", city="Plano", state="TX",
                                   postal_code="75024")
    db = _FakeSession(
        get_map={(RestaurantLocation, 1): location},
        execute_result=_FakeResult(scalar=None),  # no active LocationManager row
    )
    with pytest.raises(AppError) as exc_info:
        await auth_deps.require_location_write_access(
            location_id=1, db=db, current_user=_user("manager", sub="unassigned-mgr")
        )
    assert exc_info.value.status_code == 403


# ---------------------------------------------------------------------------
# require_location_owner_or_admin — DELETE /locations/{id}: owner or admin
# only, NO manager path (docs/API_CONTRACTS.md explicit).
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_require_location_owner_or_admin_allows_admin_without_lookup():
    user = _user("admin")
    result = await auth_deps.require_location_owner_or_admin(
        location_id=123, db=_FakeSession(), current_user=user
    )
    assert result is user


@pytest.mark.asyncio
async def test_require_location_owner_or_admin_rejects_manager_role():
    """Managers can PATCH an assigned location but per the documented
    contract cannot DELETE it — only owner/admin. A manager role must be
    rejected here even with no location_manager row consulted at all.
    """
    location = RestaurantLocation(id=1, brand_id=10, address_line1="x", city="Plano", state="TX",
                                   postal_code="75024")
    db = _FakeSession(get_map={(RestaurantLocation, 1): location})
    with pytest.raises(AppError) as exc_info:
        await auth_deps.require_location_owner_or_admin(
            location_id=1, db=db, current_user=_user("manager")
        )
    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_require_location_owner_or_admin_success_for_owning_owner(
    monkeypatch: pytest.MonkeyPatch,
):
    location = RestaurantLocation(id=1, brand_id=10, address_line1="x", city="Plano", state="TX",
                                   postal_code="75024")
    brand = RestaurantBrand(id=10, name="B", slug="b", owner_id=5)
    owner = OwnerAccount(id=5, cognito_sub="me", email="me@example.com")

    async def _fake_get_owner_by_sub(db, sub):
        return owner

    monkeypatch.setattr(auth_deps.auth_service, "get_owner_account_by_sub", _fake_get_owner_by_sub)

    db = _FakeSession(get_map={
        (RestaurantLocation, 1): location,
        (RestaurantBrand, 10): brand,
    })
    result = await auth_deps.require_location_owner_or_admin(
        location_id=1, db=db, current_user=_user("owner", sub="me")
    )
    assert result.owner_account_id == 5

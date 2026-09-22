"""Unit test: `UserProfile` model shape (app/models/user_profile.py) —
docs/PROJECT_PLAN.csv "Generic user display name for registered_user/
manager". Pure model/column inspection, no DB, no HTTP — the DB round-trip
itself (insert/upsert/read-back through the real router+service) is
covered in tests/integration/test_update_me_role_scope.py.
"""
from __future__ import annotations

from app.models.user_profile import UserProfile


def test_table_name():
    assert UserProfile.__tablename__ == "user_profile"


def test_cognito_sub_is_the_primary_key():
    columns = UserProfile.__table__.c
    assert columns["cognito_sub"].primary_key is True
    assert columns["cognito_sub"].nullable is False
    # No surrogate `id` column -- see the model's docstring for why.
    assert "id" not in columns


def test_full_name_is_nullable():
    columns = UserProfile.__table__.c
    assert columns["full_name"].nullable is True


def test_updated_at_is_not_nullable_and_has_a_default():
    column = UserProfile.__table__.c["updated_at"]
    assert column.nullable is False
    assert column.server_default is not None


def test_repr_includes_cognito_sub():
    profile = UserProfile(cognito_sub="abc-123", full_name="Asha Verma")
    assert "abc-123" in repr(profile)

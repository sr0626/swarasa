"""Integration test: catering quote requests, RESTAURANT side — inbox scoping
(owner / assigned manager / admin), privacy reveal rule, respond (quote /
decline / edit / expiry), requester notification, and the per-location opt-in
setting. docs/API_CONTRACTS.md "Catering quote requests"."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models.audit_log import AuditLog
from app.models.catering import CateringRequestRecipient
from app.models.user_notification import UserNotification
from factories import (
    create_brand,
    create_catering_location,
    create_catering_request,
    create_location,
    create_location_manager,
    create_owner,
)


async def _setup(db_session):
    """owner + eligible location + one open request addressed to it."""
    owner = await create_owner(db_session)
    location = await create_catering_location(db_session, owner=owner)
    requester_sub = str(uuid.uuid4())
    request = await create_catering_request(
        db_session, location_ids=[location.id], requester_sub=requester_sub
    )
    await db_session.commit()
    return owner, location, request, requester_sub


def _recipient_id(request, location):
    return next(r.id for r in request.recipients if r.location_id == location.id)


QUOTE = {"decision": "quote", "amount": "450.50", "note": "Includes delivery"}


# ---------------------------------------------------------------------------
# inbox listing + scoping
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_inbox_requires_staff_role(client, db_session, as_user, as_anonymous):
    assert (await client.get("/catering/inbox")).status_code == 401
    as_user("registered_user")
    assert (await client.get("/catering/inbox")).status_code == 403


@pytest.mark.asyncio
async def test_owner_sees_only_requests_for_own_locations_newest_first(client, db_session, as_user):
    owner, location, request, _ = await _setup(db_session)
    now = datetime.now(timezone.utc)
    newer = await create_catering_request(
        db_session, location_ids=[location.id], created_at=now + timedelta(minutes=1)
    )
    other_loc = await create_catering_location(db_session)  # someone else's
    foreign = await create_catering_request(db_session, location_ids=[other_loc.id])
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    resp = await client.get("/catering/inbox")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert [r["request_id"] for r in body["results"]] == [newer.id, request.id]
    assert foreign.id not in [r["request_id"] for r in body["results"]]
    assert body["total"] == 2
    assert body["unread_count"] == 2
    row = body["results"][1]
    assert row["requester_first_name"] == "Priya"
    assert row["item_count"] == 1
    assert row["is_unread"] is True
    assert "requester_email" not in row


@pytest.mark.asyncio
async def test_inbox_location_filter_cannot_widen_scope(client, db_session, as_user):
    owner, location, _request, _ = await _setup(db_session)
    other_loc = await create_catering_location(db_session)
    await create_catering_request(db_session, location_ids=[other_loc.id])
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    resp = await client.get("/catering/inbox", params={"location_id": other_loc.id})
    assert resp.status_code == 200
    assert resp.json()["results"] == []


@pytest.mark.asyncio
async def test_deleted_brand_requests_hidden_from_owner(client, db_session, as_user):
    owner, location, request, _ = await _setup(db_session)
    from app.models.restaurant_brand import RestaurantBrand

    brand = await db_session.get(RestaurantBrand, location.brand_id)
    brand.deleted_at = datetime.now(timezone.utc)
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    assert (await client.get("/catering/inbox")).json()["results"] == []
    rid = _recipient_id(request, location)
    assert (await client.get(f"/catering/inbox/{rid}")).status_code == 404


@pytest.mark.asyncio
async def test_manager_sees_only_assigned_active_locations(client, db_session, as_user):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    assigned = await create_location(db_session, brand_id=brand.id, is_paid=True, accepts_catering=True)
    unassigned = await create_location(db_session, brand_id=brand.id, is_paid=True, accepts_catering=True)
    revoked = await create_location(db_session, brand_id=brand.id, is_paid=True, accepts_catering=True)
    manager_sub = str(uuid.uuid4())
    await create_location_manager(db_session, location_id=assigned.id, user_id=manager_sub)
    await create_location_manager(
        db_session, location_id=revoked.id, user_id=manager_sub, is_active=False
    )
    r_assigned = await create_catering_request(db_session, location_ids=[assigned.id])
    r_unassigned = await create_catering_request(db_session, location_ids=[unassigned.id])
    r_revoked = await create_catering_request(db_session, location_ids=[revoked.id])
    await db_session.commit()
    as_user("manager", sub=manager_sub)

    ids = [r["request_id"] for r in (await client.get("/catering/inbox")).json()["results"]]
    assert ids == [r_assigned.id]
    assert r_unassigned.id not in ids and r_revoked.id not in ids

    # Detail / respond on an unassigned location: plain 404.
    for req, loc in ((r_unassigned, unassigned), (r_revoked, revoked)):
        rid = _recipient_id(req, loc)
        assert (await client.get(f"/catering/inbox/{rid}")).status_code == 404
        assert (
            await client.put(f"/catering/inbox/{rid}/response", json=QUOTE)
        ).status_code == 404


@pytest.mark.asyncio
async def test_admin_sees_every_request(client, db_session, as_user):
    _o, location, request, _ = await _setup(db_session)
    other_loc = await create_catering_location(db_session)
    other = await create_catering_request(db_session, location_ids=[other_loc.id])
    await db_session.commit()
    as_user("admin")
    ids = {r["request_id"] for r in (await client.get("/catering/inbox")).json()["results"]}
    assert ids == {request.id, other.id}


# ---------------------------------------------------------------------------
# detail + privacy
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_detail_marks_viewed_and_hides_contact_until_quote(client, db_session, as_user):
    owner, location, request, _ = await _setup(db_session)
    rid = _recipient_id(request, location)
    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    resp = await client.get(f"/catering/inbox/{rid}")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["requester_first_name"] == "Priya"
    assert body["requester_email"] is None
    assert body["requester_phone"] is None
    assert "Nair" not in resp.text
    assert request.requester_email not in resp.text
    assert body["items"] == [
        {"item_name": "Paneer tikka", "size": "full_tray", "quantity": 2, "note": None}
    ]
    assert body["headcount"] == 40
    assert body["can_respond"] is True

    recipient = await db_session.get(CateringRequestRecipient, rid)
    await db_session.refresh(recipient)
    assert recipient.viewed_at is not None
    assert (await client.get("/catering/inbox")).json()["unread_count"] == 0


@pytest.mark.asyncio
async def test_admin_viewing_does_not_mark_viewed(client, db_session, as_user):
    _o, location, request, _ = await _setup(db_session)
    rid = _recipient_id(request, location)
    as_user("admin")
    assert (await client.get(f"/catering/inbox/{rid}")).status_code == 200
    recipient = await db_session.get(CateringRequestRecipient, rid)
    await db_session.refresh(recipient)
    assert recipient.viewed_at is None


@pytest.mark.asyncio
async def test_other_owner_cannot_read_or_answer(client, db_session, as_user):
    _owner, location, request, _ = await _setup(db_session)
    rid = _recipient_id(request, location)
    stranger = await create_owner(db_session)
    await db_session.commit()
    as_user("owner", sub=stranger.cognito_sub, email=stranger.email)

    assert (await client.get(f"/catering/inbox/{rid}")).status_code == 404
    assert (await client.put(f"/catering/inbox/{rid}/response", json=QUOTE)).status_code == 404
    recipient = await db_session.get(CateringRequestRecipient, rid)
    await db_session.refresh(recipient)
    assert recipient.status == "pending"
    assert recipient.viewed_at is None


@pytest.mark.asyncio
async def test_contact_revealed_only_to_the_quoting_restaurant(client, db_session, as_user):
    owner, location, request, _ = await _setup(db_session)
    rival_owner = await create_owner(db_session)
    rival = await create_catering_location(db_session, owner=rival_owner)
    # Same request also addressed to a rival restaurant.
    db_session.add(CateringRequestRecipient(request_id=request.id, location_id=rival.id))
    await db_session.commit()
    await db_session.refresh(request, attribute_names=["recipients"])
    rid, rival_rid = _recipient_id(request, location), _recipient_id(request, rival)

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    resp = await client.put(f"/catering/inbox/{rid}/response", json=QUOTE)
    assert resp.status_code == 200, resp.text
    assert resp.json()["requester_email"] == request.requester_email
    assert resp.json()["requester_phone"] == "2145550142"
    # Reading it again keeps the reveal for this restaurant...
    assert (await client.get(f"/catering/inbox/{rid}")).json()["requester_email"] == request.requester_email

    # ...but the rival, who has not quoted, still sees nothing.
    as_user("owner", sub=rival_owner.cognito_sub, email=rival_owner.email)
    rival_view = (await client.get(f"/catering/inbox/{rival_rid}")).json()
    assert rival_view["requester_email"] is None
    assert rival_view["requester_phone"] is None


@pytest.mark.asyncio
async def test_decline_does_not_reveal_contact(client, db_session, as_user):
    owner, location, request, _ = await _setup(db_session)
    rid = _recipient_id(request, location)
    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    resp = await client.put(
        f"/catering/inbox/{rid}/response", json={"decision": "decline", "note": "Booked that day"}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "declined"
    assert body["requester_email"] is None
    assert body["quote_amount_cents"] is None
    assert body["quote_note"] == "Booked that day"


# ---------------------------------------------------------------------------
# respond
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_quote_stores_cents_audits_and_notifies_requester(client, db_session, as_user):
    owner, location, request, requester_sub = await _setup(db_session)
    rid = _recipient_id(request, location)
    user = as_user("owner", sub=owner.cognito_sub, email=owner.email)

    resp = await client.put(f"/catering/inbox/{rid}/response", json=QUOTE)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "quoted"
    assert body["quote_amount_cents"] == 45050
    assert body["quote_note"] == "Includes delivery"
    assert body["quoted_at"] is not None

    recipient = await db_session.get(CateringRequestRecipient, rid)
    await db_session.refresh(recipient)
    assert recipient.quoted_by_user_sub == user.cognito_sub

    audit = (
        await db_session.execute(
            select(AuditLog).where(AuditLog.table_name == "catering_request_recipient")
        )
    ).scalar_one()
    assert audit.actor_id == user.cognito_sub
    assert audit.old_val["status"] == "pending"
    assert audit.new_val == {"status": "quoted", "quote_amount_cents": 45050}

    note = (await db_session.execute(select(UserNotification))).scalar_one()
    assert note.user_sub == requester_sub
    assert note.kind == "catering_quote"
    assert note.location_id == location.id
    assert "$450.50" in note.title

    # ...and the requester sees it in My requests AND in the bell.
    as_user("registered_user", sub=requester_sub)
    mine = (await client.get("/catering/requests")).json()["results"][0]
    assert mine["recipients"][0]["status"] == "quoted"
    assert mine["recipients"][0]["quote_amount_cents"] == 45050
    assert mine["recipients"][0]["quote_note"] == "Includes delivery"
    bell = (await client.get("/notifications")).json()
    assert bell["unread_count"] == 1
    assert bell["results"][0]["kind"] == "catering_quote"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "amount",
    [None, "0", "-5", "0.00", "1000000.01", "12.345", "abc", "NaN", "Infinity"],
)
async def test_invalid_quote_amounts_rejected(client, db_session, as_user, amount):
    owner, location, request, _ = await _setup(db_session)
    rid = _recipient_id(request, location)
    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    resp = await client.put(
        f"/catering/inbox/{rid}/response", json={"decision": "quote", "amount": amount}
    )
    assert resp.status_code == 422, resp.text
    recipient = await db_session.get(CateringRequestRecipient, rid)
    await db_session.refresh(recipient)
    assert recipient.status == "pending"
    assert (await db_session.execute(select(UserNotification))).first() is None


@pytest.mark.asyncio
async def test_quote_boundaries_accepted(client, db_session, as_user):
    owner, location, request, _ = await _setup(db_session)
    rid = _recipient_id(request, location)
    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    for amount, cents in (("0.01", 1), ("1000000", 100_000_000), (250, 25000)):
        resp = await client.put(
            f"/catering/inbox/{rid}/response", json={"decision": "quote", "amount": amount}
        )
        assert resp.status_code == 200, (amount, resp.text)
        assert resp.json()["quote_amount_cents"] == cents


@pytest.mark.asyncio
async def test_note_cap_and_unknown_decision(client, db_session, as_user):
    owner, location, request, _ = await _setup(db_session)
    rid = _recipient_id(request, location)
    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    long_note = {"decision": "quote", "amount": "10", "note": "n" * 2001}
    assert (await client.put(f"/catering/inbox/{rid}/response", json=long_note)).status_code == 422
    assert (
        await client.put(f"/catering/inbox/{rid}/response", json={"decision": "maybe"})
    ).status_code == 422


@pytest.mark.asyncio
async def test_response_is_editable_until_expiry(client, db_session, as_user):
    owner, location, request, _ = await _setup(db_session)
    rid = _recipient_id(request, location)
    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    assert (await client.put(f"/catering/inbox/{rid}/response", json=QUOTE)).status_code == 200
    edited = await client.put(
        f"/catering/inbox/{rid}/response", json={"decision": "quote", "amount": "399"}
    )
    assert edited.json()["quote_amount_cents"] == 39900
    declined = await client.put(f"/catering/inbox/{rid}/response", json={"decision": "decline"})
    assert declined.json()["status"] == "declined"
    assert declined.json()["quote_amount_cents"] is None
    # Still one row per recipient, never duplicated.
    rows = (await db_session.execute(select(CateringRequestRecipient))).scalars().all()
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_cannot_respond_after_expiry_or_cancel(client, db_session, as_user):
    owner = await create_owner(db_session)
    location = await create_catering_location(db_session, owner=owner)
    now = datetime.now(timezone.utc)
    expired = await create_catering_request(
        db_session,
        location_ids=[location.id],
        created_at=now - timedelta(days=15),
        expires_at=now - timedelta(minutes=1),
    )
    cancelled = await create_catering_request(
        db_session, location_ids=[location.id], status="cancelled"
    )
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    for req in (expired, cancelled):
        rid = _recipient_id(req, location)
        resp = await client.put(f"/catering/inbox/{rid}/response", json=QUOTE)
        assert resp.status_code == 409, resp.text
        assert resp.json()["code"] == "request_not_open"
        detail = await client.get(f"/catering/inbox/{rid}")
        assert detail.json()["can_respond"] is False


@pytest.mark.asyncio
async def test_requester_cancel_blocks_later_quote(client, db_session, as_user):
    owner, location, request, requester_sub = await _setup(db_session)
    rid = _recipient_id(request, location)
    as_user("registered_user", sub=requester_sub)
    assert (await client.post(f"/catering/requests/{request.id}/cancel")).status_code == 200
    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    assert (await client.put(f"/catering/inbox/{rid}/response", json=QUOTE)).status_code == 409


@pytest.mark.asyncio
async def test_assigned_manager_can_quote(client, db_session, as_user):
    owner, location, request, _ = await _setup(db_session)
    manager_sub = str(uuid.uuid4())
    await create_location_manager(db_session, location_id=location.id, user_id=manager_sub)
    await db_session.commit()
    rid = _recipient_id(request, location)
    as_user("manager", sub=manager_sub)
    assert (await client.put(f"/catering/inbox/{rid}/response", json=QUOTE)).status_code == 200


@pytest.mark.asyncio
async def test_registered_user_cannot_use_restaurant_endpoints(client, db_session, as_user):
    _o, location, request, _ = await _setup(db_session)
    rid = _recipient_id(request, location)
    as_user("registered_user")
    assert (await client.get(f"/catering/inbox/{rid}")).status_code == 403
    assert (await client.put(f"/catering/inbox/{rid}/response", json=QUOTE)).status_code == 403


# ---------------------------------------------------------------------------
# per-location opt-in
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_owner_toggles_opt_in_audited_and_idempotent(client, db_session, as_user):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id, is_paid=True)
    await db_session.commit()
    user = as_user("owner", sub=owner.cognito_sub, email=owner.email)

    got = await client.get(f"/locations/{location.id}/catering-settings")
    assert got.json() == {
        "location_id": location.id,
        "accepts_catering": False,
        "subscribed": True,
        "paid_until": None,
    }
    resp = await client.put(
        f"/locations/{location.id}/catering-settings", json={"accepts_catering": True}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["accepts_catering"] is True
    # Idempotent: same value, no second audit row.
    await client.put(f"/locations/{location.id}/catering-settings", json={"accepts_catering": True})
    audits = (
        await db_session.execute(
            select(AuditLog).where(AuditLog.table_name == "restaurant_location")
        )
    ).scalars().all()
    assert len(audits) == 1
    assert audits[0].actor_id == user.cognito_sub
    assert audits[0].old_val == {"accepts_catering": False}
    assert audits[0].new_val == {"accepts_catering": True}


@pytest.mark.asyncio
async def test_opt_in_reports_not_subscribed_for_free_location(client, db_session, as_user):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id, is_paid=False)
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    resp = await client.put(
        f"/locations/{location.id}/catering-settings", json={"accepts_catering": True}
    )
    assert resp.json()["subscribed"] is False


@pytest.mark.asyncio
async def test_opt_in_permission_boundaries(client, db_session, as_user):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id)
    other_loc = await create_location(db_session, brand_id=brand.id)
    manager_sub = str(uuid.uuid4())
    await create_location_manager(db_session, location_id=location.id, user_id=manager_sub)
    stranger = await create_owner(db_session)
    await db_session.commit()
    url = f"/locations/{location.id}/catering-settings"
    on = {"accepts_catering": True}

    as_user("owner", sub=stranger.cognito_sub, email=stranger.email)
    assert (await client.put(url, json=on)).status_code == 403
    as_user("registered_user")
    assert (await client.put(url, json=on)).status_code == 403
    as_user("manager", sub=manager_sub)
    assert (await client.put(f"/locations/{other_loc.id}/catering-settings", json=on)).status_code == 403
    assert (await client.put(url, json=on)).status_code == 200
    as_user("admin")
    assert (await client.put(url, json={"accepts_catering": False})).status_code == 200
    assert (await client.put("/locations/999999/catering-settings", json=on)).status_code == 404

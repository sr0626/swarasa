"""Integration test: CCPA export + approved-deletion coverage of the catering
tables (catering_request / _item / _recipient)."""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import func, select

from app.models.catering import (
    CateringRequest,
    CateringRequestItem,
    CateringRequestRecipient,
)
from factories import (
    create_catering_location,
    create_catering_request,
    create_deletion_request,
    create_owner,
)


async def _count(db_session, model) -> int:
    return (await db_session.execute(select(func.count()).select_from(model))).scalar_one()


@pytest.mark.asyncio
async def test_export_includes_own_catering_requests_only(client, db_session, as_user):
    location = await create_catering_location(db_session)
    sub = str(uuid.uuid4())
    mine = await create_catering_request(db_session, location_ids=[location.id], requester_sub=sub)
    mine.recipients[0].status = "quoted"
    mine.recipients[0].quote_amount_cents = 12345
    mine.recipients[0].quote_note = "Two trays"
    await create_catering_request(db_session, location_ids=[location.id])  # someone else's
    await db_session.commit()

    as_user("registered_user", sub=sub)
    resp = await client.get("/auth/me/data-export")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert [c["request_id"] for c in body["catering_requests"]] == [mine.id]
    exported = body["catering_requests"][0]
    assert exported["items"][0]["item_name"] == "Paneer tikka"
    assert exported["recipients"] == [
        {
            "location_id": location.id,
            "status": "quoted",
            "quote_amount_cents": 12345,
            "quote_note": "Two trays",
            "quoted_at": None,
        }
    ]
    assert body["catering_quotes_submitted"] == []


@pytest.mark.asyncio
async def test_export_includes_quotes_submitted_as_restaurant(client, db_session, as_user):
    owner = await create_owner(db_session)
    location = await create_catering_location(db_session, owner=owner)
    request = await create_catering_request(db_session, location_ids=[location.id])
    request.recipients[0].status = "quoted"
    request.recipients[0].quote_amount_cents = 5000
    request.recipients[0].quoted_by_user_sub = owner.cognito_sub
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    body = (await client.get("/auth/me/data-export")).json()
    assert [q["request_id"] for q in body["catering_quotes_submitted"]] == [request.id]
    assert body["catering_requests"] == []


@pytest.mark.asyncio
async def test_deletion_request_data_scope_counts_catering(client, db_session, as_user):
    location = await create_catering_location(db_session)
    sub = str(uuid.uuid4())
    await create_catering_request(db_session, location_ids=[location.id], requester_sub=sub)
    await create_catering_request(db_session, location_ids=[location.id], requester_sub=sub)
    await db_session.commit()
    as_user("registered_user", sub=sub)
    resp = await client.post("/auth/me/data-deletion", json={})
    assert resp.status_code == 201, resp.text
    assert resp.json()["data_scope"]["catering_requests"] == 2


@pytest.mark.asyncio
async def test_approve_hard_deletes_requests_items_and_quotes_not_others(client, db_session, as_user):
    location = await create_catering_location(db_session)
    sub = str(uuid.uuid4())
    mine = await create_catering_request(db_session, location_ids=[location.id], requester_sub=sub)
    mine.recipients[0].status = "quoted"
    mine.recipients[0].quote_amount_cents = 9900
    mine.recipients[0].quote_note = "Quote text that must go"
    keep = await create_catering_request(db_session, location_ids=[location.id])
    deletion = await create_deletion_request(
        db_session, requester_user_id=sub, requester_role="registered_user"
    )
    await db_session.commit()

    as_user("admin")
    resp = await client.post(f"/data-deletion/{deletion.id}/approve", json={})
    assert resp.status_code == 200, resp.text

    db_session.expire_all()
    remaining = (await db_session.execute(select(CateringRequest))).scalars().all()
    assert [r.id for r in remaining] == [keep.id]
    # Children went with the request (FK cascade); the kept request's are intact.
    assert await _count(db_session, CateringRequestItem) == 1
    recipients = (await db_session.execute(select(CateringRequestRecipient))).scalars().all()
    assert [r.request_id for r in recipients] == [keep.id]


@pytest.mark.asyncio
async def test_approve_redacts_quote_author_on_other_peoples_requests(client, db_session, as_user):
    owner = await create_owner(db_session)
    location = await create_catering_location(db_session, owner=owner)
    request = await create_catering_request(db_session, location_ids=[location.id])
    request.recipients[0].status = "quoted"
    request.recipients[0].quote_amount_cents = 4200
    request.recipients[0].quoted_by_user_sub = owner.cognito_sub
    deletion = await create_deletion_request(
        db_session, requester_user_id=owner.cognito_sub, requester_role="owner"
    )
    await db_session.commit()

    as_user("admin")
    resp = await client.post(f"/data-deletion/{deletion.id}/approve", json={})
    assert resp.status_code == 200, resp.text

    db_session.expire_all()
    recipient = (await db_session.execute(select(CateringRequestRecipient))).scalar_one()
    assert recipient.quoted_by_user_sub == "deleted-user"
    assert recipient.quote_amount_cents == 4200  # the request's own record is kept

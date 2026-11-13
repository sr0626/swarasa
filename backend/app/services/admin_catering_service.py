"""`GET /admin/catering` — read-only list of recent catering requests with
per-status recipient counts; searchable by requester email (or name)."""
from __future__ import annotations

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies.pagination import Pagination
from app.models.catering import REQUEST_OPEN, CateringRequest, CateringRequestRecipient
from app.schemas.catering import AdminCateringList, AdminCateringRowOut
from app.services.catering_service import expire_due_requests


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _count_status(status: str):
    return func.coalesce(func.sum(case((CateringRequestRecipient.status == status, 1), else_=0)), 0)


async def list_requests(
    db: AsyncSession, pagination: Pagination, *, q: str | None, status: str | None
) -> AdminCateringList:
    await expire_due_requests(db)
    conds = []
    if q and q.strip():
        like = f"%{_escape_like(q.strip().lower())}%"
        conds.append(
            func.lower(CateringRequest.requester_email).like(like, escape="\\")
            | func.lower(func.coalesce(CateringRequest.requester_name, "")).like(like, escape="\\")
        )
    if status:
        conds.append(CateringRequest.status == status)

    total = (
        await db.execute(select(func.count()).select_from(CateringRequest).where(*conds))
    ).scalar_one()
    open_count = (
        await db.execute(
            select(func.count())
            .select_from(CateringRequest)
            .where(CateringRequest.status == REQUEST_OPEN)
        )
    ).scalar_one()
    rows = (
        await db.execute(
            select(
                CateringRequest,
                func.count(CateringRequestRecipient.id),
                _count_status("pending"),
                _count_status("quoted"),
                _count_status("declined"),
                _count_status("expired"),
            )
            .outerjoin(
                CateringRequestRecipient, CateringRequestRecipient.request_id == CateringRequest.id
            )
            .where(*conds)
            .group_by(CateringRequest.id)
            .order_by(CateringRequest.created_at.desc(), CateringRequest.id.desc())
            .offset(pagination.offset)
            .limit(pagination.page_size)
        )
    ).all()
    return AdminCateringList(
        results=[
            AdminCateringRowOut(
                id=req.id,
                requester_email=req.requester_email,
                requester_name=req.requester_name,
                event_date=req.event_date,
                headcount=req.headcount,
                status=req.status,  # type: ignore[arg-type]
                created_at=req.created_at,
                expires_at=req.expires_at,
                recipient_count=total_recipients,
                pending_count=int(pending),
                quoted_count=int(quoted),
                declined_count=int(declined),
                expired_count=int(expired),
            )
            for req, total_recipients, pending, quoted, declined, expired in rows
        ],
        page=pagination.page,
        page_size=pagination.page_size,
        total=total,
        open_count=open_count,
    )

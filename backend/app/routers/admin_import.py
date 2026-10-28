"""Admin bulk listing import -- `/admin/import/validate` (dry run) and
`/admin/import/commit` (write one small chunk). Admin only. See
`app/services/admin_bulk_import_service.py` for the design and
docs/API_CONTRACTS.md "Admin bulk listing import" for the contract."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies.auth import CurrentUser, require_admin
from app.dependencies.db import get_db
from app.schemas.admin_import import (
    ImportCommitRequest,
    ImportCommitResponse,
    ImportValidateRequest,
    ImportValidateResponse,
)
from app.services import admin_bulk_import_service

router = APIRouter(prefix="/admin/import", tags=["admin"])


@router.post("/validate", response_model=ImportValidateResponse)
async def validate_import_endpoint(
    body: ImportValidateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_admin),
) -> ImportValidateResponse:
    """Auth: admin only. Dry run over up to 500 rows -- per-row
    valid / warning / error / duplicate report. Writes nothing."""
    return await admin_bulk_import_service.validate_rows(db, body.rows)


@router.post("/commit", response_model=ImportCommitResponse)
async def commit_import_endpoint(
    body: ImportCommitRequest,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_admin),
) -> ImportCommitResponse:
    """Auth: admin only. Re-validates and writes up to 50 rows (unclaimed,
    verified, audited with provenance 'bulk_import'). Idempotent: rows that
    duplicate an existing listing -- including ones created by an earlier
    chunk or an earlier upload of the same file -- are skipped."""
    return await admin_bulk_import_service.commit_rows(
        db, body.rows, include_warnings=body.include_warnings, current_user=current_user
    )

"""Form guard endpoints -- docs/API_CONTRACTS.md "Form guard".

- `POST /forms/token`   PUBLIC. Issue a signed, form-bound token.
- `POST /forms/verify`  PUBLIC. Check + consume a token (used by the Next
  server before the browser calls Cognito for sign-up / sign-in flows, which
  this API never sees).

Both answer generic errors only; see `services/form_guard_service.py`.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies.db import get_db
from app.schemas.forms import FormTokenOut, FormTokenRequest, FormVerifyRequest
from app.services import form_guard_service

router = APIRouter(prefix="/forms", tags=["forms"])


@router.post("/token", response_model=FormTokenOut)
async def issue_form_token(
    body: FormTokenRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> FormTokenOut:
    response.headers["Cache-Control"] = "no-store"
    await form_guard_service.enforce(db, request, "token")
    token, min_seconds = form_guard_service.issue_token(body.form)
    return FormTokenOut(token=token, min_seconds=min_seconds)


@router.post("/verify", status_code=204)
async def verify_form_token(
    body: FormVerifyRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> Response:
    outcome = await form_guard_service.enforce(
        db, request, body.form, token=body.token, trap=body.trap or ""
    )
    if outcome is form_guard_service.Outcome.DROP:
        # A filled honeypot cannot be given a fake success here: the caller
        # would go on to talk to Cognito. Same generic 400 as every failure.
        raise form_guard_service.check_failed()
    return Response(status_code=204)

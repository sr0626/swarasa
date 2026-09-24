"""Consistent error responses.

root CLAUDE.md "NEVER expose internal stack details in API error responses"
and backend/CLAUDE.md "ALWAYS return consistent error shapes:
`{"detail": "...", "code": "..."}`" — every error path in this app, whether
raised deliberately (`AppError`), a plain FastAPI `HTTPException`, a request
validation failure, or a genuinely unexpected exception, is normalized to
that one shape here. Unexpected exceptions are logged server-side (for
CloudWatch) but never surface their message or traceback to the caller.
"""
from __future__ import annotations

import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

logger = logging.getLogger("app.errors")

_STATUS_CODES = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    422: "validation_error",
    500: "internal_error",
}


class AppError(Exception):
    """Raised by services/dependencies for any expected, user-facing error.

    Prefer this over a bare `HTTPException` in service/dependency code so
    the `code` field is always explicit and meaningful (not derived only
    from the HTTP status).
    """

    def __init__(
        self,
        status_code: int,
        detail: str,
        code: str,
        extra: dict[str, object] | None = None,
    ) -> None:
        self.status_code = status_code
        self.detail = detail
        self.code = code
        # Optional machine-readable extras merged into the error body next to
        # `detail`/`code` (e.g. `missing` on `listing_incomplete`). Must never
        # carry internal details — same rule as `detail`.
        self.extra = extra or {}
        super().__init__(detail)


def _code_for_status(status_code: int) -> str:
    return _STATUS_CODES.get(status_code, "error")


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _handle_app_error(request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={**exc.extra, "detail": exc.detail, "code": exc.code},
        )

    @app.exception_handler(RequestValidationError)
    async def _handle_validation_error(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={"detail": "Invalid request parameters", "code": "validation_error"},
        )

    @app.exception_handler(HTTPException)
    async def _handle_http_exception(
        request: Request, exc: HTTPException
    ) -> JSONResponse:
        detail = exc.detail if isinstance(exc.detail, str) else "Request failed"
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": detail, "code": _code_for_status(exc.status_code)},
        )

    @app.exception_handler(Exception)
    async def _handle_unexpected(request: Request, exc: Exception) -> JSONResponse:
        # Log full detail server-side only (CloudWatch) — never in the response.
        logger.exception(
            "Unhandled exception processing %s %s", request.method, request.url.path
        )
        return JSONResponse(
            status_code=500,
            content={"detail": "Internal server error", "code": "internal_error"},
        )

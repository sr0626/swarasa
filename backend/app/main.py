"""FastAPI app entry point + Mangum Lambda handler.

Deployed as a Lambda container image (root CLAUDE.md "Containerization") —
`backend/Dockerfile`'s `CMD ["app.main.handler"]` points here. Locally,
run with `uvicorn app.main:app --reload` from `backend/` instead of
invoking `handler` directly.
"""
from __future__ import annotations

from fastapi import FastAPI
from mangum import Mangum

from app.core.errors import register_exception_handlers
from app.routers import (
    admin,
    auth,
    claim,
    cuisine,
    data_deletion,
    health,
    listing_report,
    locations,
    restaurants,
    search,
)

app = FastAPI(title="Restaurant Discovery Platform API")

register_exception_handlers(app)

app.include_router(health.router)
app.include_router(search.router)
app.include_router(restaurants.router)
app.include_router(locations.router)
app.include_router(claim.router)
app.include_router(listing_report.router)
app.include_router(auth.router)
app.include_router(cuisine.router)
app.include_router(data_deletion.router)
app.include_router(admin.router)

# package_type = "Image" Lambda functions have no separate "handler" config
# — the Dockerfile's CMD *is* the handler, in "<module>.<callable>" form
# (infra/CLAUDE.md "Lambda + API Gateway"). `handler` below is that
# callable; `_mangum_handler` is the actual Mangum-wrapped ASGI app.
_mangum_handler = Mangum(app)


def handler(event, context):
    """Lambda entry point.

    Branches on event shape: a normal API Gateway HTTP API (payload format
    2.0) proxy event goes to Mangum exactly as before. A direct
    `aws lambda invoke` carrying a `_management_command` key instead runs a
    one-off management script in this same container/VPC context, bypassing
    API Gateway/Mangum entirely — see `app/scripts/management.py` for the
    dispatch table and why this exists (Aurora has no network path reachable
    from outside this Lambda's VPC — no NAT Gateway, no bastion, no RDS Data
    API; see `app/scripts/seed_dev_data.py`'s module docstring). API Gateway
    proxy events never carry that key, so this branch never fires for real
    HTTP traffic.
    """
    if isinstance(event, dict) and "_management_command" in event:
        from app.scripts.management import run_management_command

        return run_management_command(event, context)
    return _mangum_handler(event, context)

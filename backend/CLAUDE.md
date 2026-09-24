# Backend Dev Agent

> First read the root `/CLAUDE.md` — it contains shared context, stack, and
> universal guardrails that apply to this agent too.

## Role
You are the Backend Dev agent for the Restaurant Discovery Platform.
You own everything in `/backend` EXCEPT schema design: FastAPI application,
routers, services, dependencies, Stripe webhook handlers, and Lambda handlers.
You do NOT touch `/frontend`, `/infra`, or `/tests` unless explicitly told to.

**Schema ownership moved to the Architect agent (2026-09-12):** `/backend/app/models`
and the initial Alembic migration for each new entity are owned by Architect, not
you. You implement business logic against the schema Architect defines and
consume `/docs/DATA_MODEL.md` + `/docs/API_CONTRACTS.md` as source of truth.
You may still write migrations for changes that don't touch schema design
(e.g. adding an index) — ask if unsure whether a change counts as design.

## Directory Structure
```
/backend
  /app
    main.py               ← FastAPI app entry point + Mangum handler
    /routers              ← one file per resource (restaurants.py, search.py, etc.)
    /models               ← SQLAlchemy models — owned by Architect, not you
    /schemas              ← Pydantic v2 request/response schemas
    /services             ← business logic (one file per domain)
    /dependencies         ← FastAPI deps (auth, db session, is_paid check)
    /db
      session.py          ← async SQLAlchemy engine + session factory
      base.py             ← declarative base
  /migrations             ← Alembic migration files — initial migration per
                             entity owned by Architect; you add non-schema migrations
    alembic.ini
    /versions
  requirements.txt
  requirements-dev.txt
  Dockerfile              ← used for BOTH local dev AND as the Lambda deployment
                             artifact (container image via ECR — see DECISIONS.md
                             "Containerization"). You own its contents; DevOps
                             agent builds/pushes/deploys it, doesn't edit it.
```

## Stack
- Python 3.12
- FastAPI 0.111+
- SQLAlchemy 2.x (async, with asyncpg driver)
- Alembic 1.13+
- Pydantic v2
- Mangum 0.17+ (wraps FastAPI for Lambda)
- boto3 (S3 presigned URLs, SES)
- stripe 8.x
- GeoAlchemy2 (PostGIS types for SQLAlchemy)
- pytest + pytest-asyncio (tests go in /tests, not here)

## Key Patterns

### Endpoint structure
```python
# /backend/app/routers/restaurants.py
from fastapi import APIRouter, Depends, HTTPException
from app.dependencies.auth import get_current_user, require_owner
from app.dependencies.db import get_db
from app.services.restaurant_service import RestaurantService
from app.schemas.restaurant import RestaurantCreate, RestaurantResponse

router = APIRouter(prefix="/restaurants", tags=["restaurants"])

@router.post("/", response_model=RestaurantResponse, status_code=201)
async def create_restaurant(
    body: RestaurantCreate,
    db=Depends(get_db),
    current_user=Depends(require_owner),
):
    return await RestaurantService(db).create(body, owner_id=current_user.id)
```

### is_paid() check — ALWAYS use this before returning paid content
```python
# /backend/app/dependencies/tier.py
async def require_paid_location(location_id: int, db=Depends(get_db)):
    result = await db.execute(
        select(RestaurantLocation.is_paid)
        .where(RestaurantLocation.id == location_id)
    )
    is_paid = result.scalar_one_or_none()
    if not is_paid:
        raise HTTPException(status_code=403, detail="Paid tier required")
    return True
```

### Manager permission check — ALWAYS validate server-side
```python
# /backend/app/dependencies/auth.py
async def require_location_access(
    location_id: int,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    # Owners have implicit access to all their locations
    if current_user.role == "owner":
        location = await db.get(RestaurantLocation, location_id)
        brand = await db.get(RestaurantBrand, location.brand_id)
        if brand.owner_id != current_user.id:
            raise HTTPException(status_code=403)
        return True
    # Managers must have explicit assignment
    result = await db.execute(
        select(LocationManager)
        .where(
            LocationManager.user_id == current_user.id,
            LocationManager.location_id == location_id,
            LocationManager.is_active == True,
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="Not assigned to this location")
    return True
```

### Audit log — ALWAYS write for mutations on core entities
```python
# /backend/app/services/audit_service.py
async def log(db, table_name, record_id, action, actor_id, actor_role, old_val=None, new_val=None):
    entry = AuditLog(
        table_name=table_name,
        record_id=record_id,
        action=action,          # "create" | "update" | "delete"
        actor_id=actor_id,
        actor_role=actor_role,
        old_val=old_val,        # JSON dict or None
        new_val=new_val,        # JSON dict or None
    )
    db.add(entry)
    # Do not commit here — caller commits as part of the same transaction
```

### Geo search pattern (PostGIS)
```python
from geoalchemy2.functions import ST_DWithin, ST_MakePoint, ST_SetSRID

# Find locations within 15 miles (24140 metres) of a point
results = await db.execute(
    select(RestaurantLocation)
    .where(
        ST_DWithin(
            RestaurantLocation.geom,
            ST_SetSRID(ST_MakePoint(lng, lat), 4326),
            24140,  # 15 miles in metres
        )
    )
    .where(RestaurantLocation.is_active == True)
    .order_by(RestaurantLocation.geom.distance_centroid(
        ST_SetSRID(ST_MakePoint(lng, lat), 4326)
    ))
)
```

### Stripe webhook handler
```python
# /backend/app/routers/webhooks.py
@router.post("/stripe/webhook")
async def stripe_webhook(request: Request, db=Depends(get_db)):
    payload = await request.body()
    sig = request.headers.get("stripe-signature")
    try:
        event = stripe.Webhook.construct_event(payload, sig, settings.STRIPE_WEBHOOK_SECRET)
    except stripe.error.SignatureVerificationError:
        raise HTTPException(status_code=400)

    if event["type"] == "invoice.paid":
        await handle_invoice_paid(event["data"]["object"], db)
    elif event["type"] == "invoice.payment_failed":
        await handle_invoice_failed(event["data"]["object"], db)
    return {"status": "ok"}

async def handle_invoice_failed(invoice, db):
    # Set is_paid=false for ALL locations on this owner's subscription
    sub_id = invoice["subscription"]
    owner = await db.execute(select(OwnerAccount).where(OwnerAccount.stripe_sub_id == sub_id))
    owner = owner.scalar_one()
    await db.execute(
        update(RestaurantLocation)
        .where(RestaurantLocation.brand_id.in_(
            select(RestaurantBrand.id).where(RestaurantBrand.owner_id == owner.id)
        ))
        .values(is_paid=False, paid_until=None)
    )
    await db.commit()
    # TODO: send email via SES (Phase 2)
```

### S3 presigned URL generation
```python
import boto3
from botocore.config import Config

s3 = boto3.client("s3", config=Config(signature_version="s3v4"))

def generate_upload_url(bucket: str, key: str, content_type: str) -> str:
    return s3.generate_presigned_url(
        "put_object",
        Params={"Bucket": bucket, "Key": key, "ContentType": content_type},
        ExpiresIn=600,  # 10 minutes
    )
# Never accept file uploads directly through Lambda — always presigned URL
```

## Public Routes (no Cognito authorizer required)
These routes are explicitly public — all others require auth:
- `GET /health`
- `GET /search`
- `GET /restaurants/{id}`
- `GET /restaurants/{id}/locations`
- `GET /locations/{id}`
- `GET /cuisine-tags`
- `POST /reports` (anonymous "report a problem"; uses `get_current_user_optional`
  to attribute a signed-in caller — honeypot + length limits are its only
  anti-abuse controls, see `services/listing_report_service.py`)

## Environment Variables (never hardcode these)
```
DATABASE_URL          Aurora connection string (from Secrets Manager)
STRIPE_SECRET_KEY     Stripe API key
STRIPE_WEBHOOK_SECRET Stripe webhook signing secret
S3_MEDIA_BUCKET       Media bucket name
SES_FROM_ADDRESS      Platform from email
JWT_SECRET            Cognito JWT public key (fetched from Cognito endpoint)
```

## Phase 1 Scope — What to Build Now
- DB models are Architect's deliverable, not yours (see `/architect/CLAUDE.md`) —
  build against `/docs/DATA_MODEL.md` and the models Architect commits to
  `/backend/app/models` once available
- Endpoints: /search, /restaurants (CRUD), /locations (CRUD), /claim, /auth
- PostGIS geo search with filters (cuisine, dietary, type)
- Claim flow backend (submit, admin review, approve/reject — see DECISIONS.md "Claim flow")
- Owner portal endpoints (free tier: edit basic info, hours, up to 2 gallery photos)
- Hours captured via CRUD, AND open/closed status computed for display on the
  listing page (per-row lookup using restaurant_hours + timezone — this is in
  scope for Phase 1; see DECISIONS.md "Restaurant hours")

## Phase 1 — Do NOT Build Yet
- Stripe checkout, webhooks, subscription management (Phase 2)
- Menu CRUD, deal alerts (Phase 2) — full menu + prices is a FREE feature,
  only dish photos are paid-gated (see DECISIONS.md "Full menu with prices
  moved to free tier"). **Menu CRUD (groups, items, size options, reorder,
  public read) was pulled forward 2026-09-24 by direct user instruction**:
  free-tier and public, never `is_paid`-gated; the optional item photo is
  built but OFF behind the `menu_item_photos_enabled` platform flag
  (docs/API_CONTRACTS.md "Menu"). **The deals engine itself was pulled forward and
  built 2026-09-23** by direct user instruction (deals stayed in scope while
  Stripe/billing/subscriptions/refunds remained deferred) — see
  DECISIONS.md "Deals engine: free-tier, public-signal + registered-user-content
  visibility". Deals are a FREE-tier feature, not paid-gated, per that decision.
- Analytics endpoints (Phase 2)
- `open_now` as a `/search` query filter (Phase 3 — see DECISIONS.md
  "Restaurant hours"; grouped with map view / NLS search). Display-only
  open/closed status is NOT deferred — that's Phase 1, see above.
- Natural language search, Claude API integration (Phase 3)

## Guardrails (Backend-Specific)

### NEVER
- NEVER return paid-only content (dish photos beyond the free gallery limit,
  custom landing page, full analytics, promoted placement) without
  checking `is_paid`. Full menu with prices is FREE — do not gate it. Deals
  are ALSO free-tier (see DECISIONS.md "Deals engine: free-tier,
  public-signal + registered-user-content visibility") — never add an
  `is_paid` check to deal creation or visibility.
- NEVER trust JWT claims for manager location access — always query `location_manager` table
- NEVER allow more than 2 active `location_manager` assignments per location on
  a paid tier (see DECISIONS.md "Assignable location managers capped at 2")
- NEVER run raw `ALTER TABLE` SQL — always use Alembic migrations
- NEVER expose stack traces or internal error details in API responses
- NEVER store passwords — Cognito handles all auth
- NEVER call the Stripe API in the request path (use webhooks + async jobs)
- NEVER skip the audit_log for writes on: restaurant_brand, restaurant_location,
  menu_item, deal, owner_account, location_manager

### ALWAYS
- ALWAYS create a feature branch before making changes and open a PR when
  done — never commit/push to `main`, never merge your own PR (see root
  `CLAUDE.md` "Git Workflow")
- ALWAYS validate that the authenticated user has rights to the resource being modified
- ALWAYS return consistent error shapes: `{"detail": "...", "code": "..."}`
- ALWAYS use database transactions for multi-step writes
- ALWAYS include pagination on list endpoints (default: 20, max: 100)
- ALWAYS call AWS SDKs (boto3 — S3, SES, Secrets Manager) with the minimum
  action/resource scope the task needs (see root `CLAUDE.md` "AWS Best
  Practices") — e.g. a presigned upload URL should be scoped to one
  key/prefix, not the whole bucket. If the Lambda's execution role doesn't
  have a permission you need, that's a signal to ask Infra to grant exactly
  that permission — never a reason to request a broader role "to be safe"

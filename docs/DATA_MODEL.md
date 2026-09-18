# Data Model — Phase 1

Owned by the Architect agent (see `architect/CLAUDE.md`). This is the
source of truth for Backend Dev's models consumption and Frontend
Dev's typed API client. Backed by:
- Models: `backend/app/models/`
- Migrations:
  - `backend/migrations/versions/20260912_0001_initial_phase1_schema.py`
    — the original 11 Phase 1 entities
  - `backend/migrations/versions/20260912_0002_photo_gallery_and_claim_schema.py`
    — follow-up adding `restaurant_photo` and `claim_request` (see
    those sections below and "Open items" at the bottom, which this
    migration closes)
  - `backend/migrations/versions/20260916_0004_data_deletion_request.py`
    — CCPA follow-up: new `data_deletion_request` table (see below) plus
    a nullable `owner_account.personal_data_deleted_at` column (see the
    `owner_account` section below). Backend Dev-authored per
    docs/DECISIONS.md "CCPA data export/deletion" — flagged there since
    schema changes are normally Architect's territory, judged as a
    non-design addition (one small tracking table following the existing
    `claim_request` shape, one nullable timestamp column) rather than
    escalated.

Ownership hierarchy (root `CLAUDE.md`):
```
owner_account (1) -> restaurant_brand (N) -> restaurant_location (N) -> location_manager (N)
```

Tier is **not** a stored enum anywhere in this schema — `is_paid` +
`paid_until` on `restaurant_location` only (root `CLAUDE.md` "Tier
model").

Identity note that applies across several tables below: Cognito (user
pool groups `owner`, `manager`, `admin`, `registered_user`) is the
source of truth for user identity and credentials. Only `owner_account`
gets a full local business record (it needs Stripe linkage and is a
real FK target for brands/locations/free-offers). `manager` and
`registered_user` identities are referenced by their Cognito `sub`
string directly (`location_manager.user_id`, `user_follow.user_id`,
`claim_request.claimant_user_id`) — there is no local "manager
account" or "registered user" table in the Phase 1 entity list. **This
is a judgment call, not something decided in root `CLAUDE.md` /
`DECISIONS.md` — flagged for review.**

---

## owner_account

| Column | Type | Notes |
|---|---|---|
| id | bigint PK | |
| cognito_sub | varchar(36) unique, not null | Cognito user pool "owner" group sub — identity join key |
| email | varchar(255) unique, not null | |
| full_name | varchar(255) nullable | |
| phone | varchar(20) nullable | |
| stripe_customer_id | varchar(255) unique, nullable | |
| stripe_sub_id | varchar(255) unique, nullable | One Stripe Subscription per owner (root CLAUDE.md "Billing model") |
| personal_data_deleted_at | timestamptz nullable | Added `20260916_0004_data_deletion_request.py`. Set by `privacy_service.execute_deletion` when a CCPA `data_deletion_request` for this owner is approved — `full_name`/`phone` are nulled and `email` replaced with a synthetic placeholder at that point, but the row itself is kept (never hard-deleted); see `data_deletion_request` below and DECISIONS.md "CCPA data export/deletion" |
| created_at | timestamptz, not null | |
| updated_at | timestamptz, not null | |

Referenced by: `restaurant_brand.owner_id`, `location_manager.assigned_by_owner_id`, `admin_free_offer.owner_id`.

---

## restaurant_brand

| Column | Type | Notes |
|---|---|---|
| id | bigint PK | |
| owner_id | bigint FK -> owner_account, nullable | Nullable = unclaimed listing (DECISIONS.md "owner_id nullable on restaurant_brand"). `ON DELETE SET NULL`. |
| name | varchar(255), not null | |
| slug | varchar(255) unique, not null | |
| description | text, nullable | |
| website | varchar(500), nullable | Added in `20260917_0005_restaurant_brand_website.py` -- see judgment call below |
| is_claimed | boolean default false, not null | See DECISIONS.md "Claim flow" |
| claimed_at | timestamptz, nullable | Set when claim is approved |
| created_at | timestamptz, not null | |
| updated_at | timestamptz, not null | |

Indexes: `owner_id`.

**Judgment call:** `website` is on `restaurant_brand`, not
`restaurant_location`, added alongside the CSV bulk-import feature
(docs/PROJECT_PLAN.csv "CSV bulk restaurant import"). A restaurant's
website describes the concept as a whole, not a specific address --
same brand-vs-location rationale `restaurant_cuisine` already uses (see
that table's own judgment call below): if a real multi-location brand
ever needs a distinct URL per location, this would need to move to (or
add) a location-level column instead. `varchar(500)` matches
`claim_request.google_business_profile_url`'s existing sizing
convention for a URL column in this schema.

---

## restaurant_location

| Column | Type | Notes |
|---|---|---|
| id | bigint PK | |
| brand_id | bigint FK -> restaurant_brand, not null | `ON DELETE RESTRICT` — a brand with locations can't be silently deleted |
| location_name | varchar(255), nullable | Overrides brand name for this location if set; NULL = display brand name |
| address_line1 | varchar(255), not null | |
| address_line2 | varchar(255), nullable | |
| city | varchar(120), not null | |
| state | varchar(2), not null | |
| postal_code | varchar(10), not null | |
| country | varchar(2) default 'US', not null | |
| phone | varchar(20), nullable | |
| timezone | varchar(64) default 'America/Chicago', not null | IANA tz name — needed to compute open/closed display status from `restaurant_hours` (DECISIONS.md "Restaurant hours") |
| latitude | numeric(9,6), nullable | Plain value for display/serialization |
| longitude | numeric(9,6), nullable | Plain value for display/serialization |
| geom | geography(Point, 4326), nullable, **GIST-indexed** | Canonical column for `ST_DWithin` radius search. Kept in sync with lat/lng by the service layer (judgment call — see note below) |
| is_paid | boolean default false, not null | Tier flag — root CLAUDE.md "Tier model", NOT a stored enum |
| paid_until | timestamptz, nullable | NULL when free |
| stripe_sub_item_id | varchar(255) unique, nullable | One Stripe Subscription Item per paid location (root CLAUDE.md "Billing model") |
| is_verified | boolean default false, not null | Admin-reviewed at seed/claim time (DECISIONS.md "Data seeding"). Drives search default sort ("verified first") |
| is_active | boolean default true, not null | Soft-hide (e.g. permanently closed) without deleting the row |
| created_at | timestamptz, not null | |
| updated_at | timestamptz, not null | |

Indexes: `brand_id`; `geom` (GIST, `ix_restaurant_location_geom`).

**Judgment call:** `geom` is not populated by a DB trigger. Keeping
`lat`/`lng` -> `geom` sync as an application-layer concern (Backend
Dev, on create/update) avoids introducing procedural SQL (a trigger
function) outside Alembic-managed column/table DDL. Flagged for
review — an alternative is a `BEFORE INSERT OR UPDATE` trigger that
derives `geom` from `latitude`/`longitude` server-side, which would
make sync a schema-level guarantee (Postgres/PostGIS enforced) instead
of something every writer path must remember to do.

---

## restaurant_photo

*(Added in a follow-up migration, `20260912_0002_photo_gallery_and_claim_schema.py`
— closes the "Gallery photo storage" open item below. `thumbnail_s3_key`
added in `20260916_0003_photo_thumbnail_key.py` — see "S3 image resize
pipeline" below.)*

| Column | Type | Notes |
|---|---|---|
| id | bigint PK | |
| location_id | bigint FK -> restaurant_location, not null | `ON DELETE CASCADE` |
| s3_key | varchar(512), not null | S3 object key only (root CLAUDE.md media pattern) — service layer resolves to a CloudFront URL. Despite the plain name, always the resize pipeline's `processed/` key, never the client's original `raw/` upload key |
| thumbnail_s3_key | varchar(512), nullable | Added 2026-09-16, S3 image resize pipeline's thumbnail variant (`thumbnails/` key) — see below. Nullable only for direct/legacy construction; every real write path always sets it |
| is_cover | boolean default false, not null | `true` = the single cover photo (allowed regardless of tier). `false` = a counted gallery photo. See judgment call below |
| display_order | smallint default 0, not null | Order within the gallery; meaningless for the cover row |
| uploaded_by | varchar(64), nullable | Cognito `sub` of the uploader (owner or assigned manager) |
| created_at | timestamptz, not null | |
| updated_at | timestamptz, not null | |

**S3 image resize pipeline** (`docs/PROJECT_PLAN.csv` "S3 image resize
pipeline", `docs/DECISIONS.md` "S3 image resize pipeline" / "Resize
Lambda: thumbnail variant"): the client uploads to a `raw/` key; an S3
event triggers a resize Lambda that writes a 1200px/quality-85 JPEG to
`processed/` (stored in `s3_key`) and a 400px/quality-80 JPEG to
`thumbnails/` (stored in `thumbnail_s3_key`), then deletes the `raw/`
original. Both stored keys are the API's **predicted** transform of the
raw key, computed and written synchronously at `POST
/locations/{id}/photos` time — not read back from S3 after the
asynchronous resize actually completes (see `docs/DECISIONS.md` for the
eventual-consistency tradeoff this implies).

Indexes:
- `ix_restaurant_photo_location_cover` on (`location_id`, `is_cover`) — makes the gallery-count check cheap: `SELECT count(*) FROM restaurant_photo WHERE location_id = :id AND is_cover = false`
- `uq_restaurant_photo_one_cover_per_location`: **partial unique index** on `location_id` `WHERE is_cover = true` — at most one cover photo per location

**Judgment call — flagged for review:** `restaurant_location` has no
existing `cover_photo`-style column to avoid duplicating (checked
before adding this table), and the original Phase 1 pass explicitly
left `cover_photo_url` unbacked (see "Open items" below and
`docs/API_CONTRACTS.md`). Rather than leave that gap open *and* add a
third "cover photo" concept, this single table stores both the cover
photo and the 2-free/10-paid gallery via `is_cover`, instead of adding
a column to `restaurant_location` itself (out of scope — that model is
one of the original 11, not to be modified by this follow-up). Count
enforcement (2 free / 10 paid) stays Backend Dev's job at the service
layer, same pattern as `location_manager`'s manager cap.

---

## cuisine_tag

| Column | Type | Notes |
|---|---|---|
| id | bigint PK | |
| name | varchar(64) unique, not null | Tag slug, e.g. `andhra`, `vegetarian` — see `docs/TAXONOMY.md` |
| display_name | varchar(120), not null | |
| category | varchar(32), not null | `regional` \| `dietary` \| `type` \| `signature` \| `dining_time` |
| is_active | boolean default true, not null | Admin can deactivate without deleting (preserves existing tag links) |
| created_at | timestamptz, not null | |
| updated_at | timestamptz, not null | |

Indexes: `category`. Seeded from `docs/TAXONOMY.md` — no public write API (admin panel only).

---

## restaurant_cuisine (join table)

| Column | Type | Notes |
|---|---|---|
| id | bigint PK | |
| brand_id | bigint FK -> restaurant_brand, not null | `ON DELETE CASCADE` |
| cuisine_tag_id | bigint FK -> cuisine_tag, not null | `ON DELETE CASCADE` |
| created_at | timestamptz, not null | |

Unique: (`brand_id`, `cuisine_tag_id`). Indexes: `brand_id`, `cuisine_tag_id`.

**Judgment call — flagged for review:** tags are joined at the
**brand** level, not per-location. Not settled in root `CLAUDE.md` or
`DECISIONS.md`. Rationale: a brand's regional/dietary/type/signature
tags describe the restaurant concept as a whole, and this matches
DECISIONS.md "Brand-level search results (not flat location results)"
— the search card and its filters operate on the brand, with the
location-level geo query happening underneath. If a real chain ever
needs per-location cuisine variance (e.g. one location adds a
buffet-only variant), this join would need a `location_id` instead of
(or in addition to) `brand_id`.

---

## location_manager

| Column | Type | Notes |
|---|---|---|
| id | bigint PK | |
| location_id | bigint FK -> restaurant_location, not null | `ON DELETE CASCADE` |
| user_id | varchar(36), not null | Cognito `sub` of the manager — no local manager table (judgment call, see top of doc) |
| assigned_by_owner_id | bigint FK -> owner_account, nullable | `ON DELETE SET NULL` — who made the assignment |
| is_active | boolean default true, not null | Drives the "max 2 active per location on paid tier" cap |
| assigned_at | timestamptz, not null | |
| revoked_at | timestamptz, nullable | |
| created_at | timestamptz, not null | |
| updated_at | timestamptz, not null | |

Indexes:
- `ix_location_manager_location_active` on (`location_id`, `is_active`) — makes the per-location active-manager count cheap
- `uq_location_manager_active_user`: **partial unique index** on (`location_id`, `user_id`) `WHERE is_active = true` — stops the same user holding two simultaneous active assignment rows on one location
- `user_id`

**Enforcement note (DECISIONS.md "Assignable location managers capped
at 2"):** the cap itself — no more than 2 active managers per location
on the paid tier — is a *count* check, not a uniqueness rule, so it is
NOT enforced by a DB constraint here. Per `architect/CLAUDE.md`, that
enforcement is Backend Dev's job at the service layer, checked on every
assignment write:
```sql
SELECT count(*) FROM location_manager
WHERE location_id = :id AND is_active = true;
```
The composite index above exists specifically to make that check cheap.

---

## user_follow

| Column | Type | Notes |
|---|---|---|
| id | bigint PK | |
| user_id | varchar(36), not null | Cognito `sub` of the registered_user (judgment call, see top of doc) |
| brand_id | bigint FK -> restaurant_brand, not null | `ON DELETE CASCADE` |
| created_at | timestamptz, not null | |

Unique: (`user_id`, `brand_id`). Indexes: `user_id`, `brand_id`. No follow cap (DECISIONS.md "No follow cap for registered users").

**Judgment call — flagged for review:** follow target is the brand,
not a specific location, for the same brand-level-presentation
reasoning as `restaurant_cuisine` above. Not settled in the source
docs.

---

## claim_request

*(Added in a follow-up migration, `20260912_0002_photo_gallery_and_claim_schema.py`
— backs `docs/API_CONTRACTS.md` "Claim flow (`/claim`)", previously
documented with no backing table.)*

| Column | Type | Notes |
|---|---|---|
| id | bigint PK | |
| brand_id | bigint FK -> restaurant_brand, not null | `ON DELETE CASCADE`. The brand being claimed |
| location_id | bigint FK -> restaurant_location, nullable | `ON DELETE SET NULL`. Which location's public phone backs the `phone_verification` proof path — see judgment call below |
| claimant_user_id | varchar(36), not null | Cognito `sub` of the claimant — same pattern as `location_manager.user_id` |
| proof_method | varchar(32), not null | `google_business_profile` \| `phone_verification` \| `document_upload` |
| google_business_profile_url | varchar(500), nullable | Set when `proof_method = google_business_profile` |
| supporting_document_key | varchar(512), nullable | S3 object key for the document-upload fallback. Maps to the API's `supporting_document_url` field name — see field-naming note below |
| status | varchar(16) default 'pending_review', not null | `pending_review` \| `approved` \| `rejected` |
| submitted_at | timestamptz, not null | |
| reviewed_by | varchar(64), nullable | Admin Cognito `sub` |
| reviewed_at | timestamptz, nullable | |
| reviewer_notes | text, nullable | Notes on resolution (approve or reject) |
| created_at | timestamptz, not null | |
| updated_at | timestamptz, not null | |

Indexes:
- `ix_claim_request_brand_id` on `brand_id`
- `ix_claim_request_claimant_user_id` on `claimant_user_id`
- `ix_claim_request_status_submitted` on (`status`, `submitted_at`) — cheap ordered scan for the single admin review queue (2-business-day SLA)
- `uq_claim_request_pending_brand`: **partial unique index** on `brand_id` `WHERE status = 'pending_review'` — at most one pending claim per brand at a time

**Field-naming note:** `status` values and `reviewer_notes` match
`docs/API_CONTRACTS.md` exactly, rather than the looser `pending` /
`rejection_reason` names used in this follow-up task's own
instructions — architect/CLAUDE.md says never re-decide/rev a contract
Backend Dev may already be building against without flagging it, and
this doc already had the real names. `supporting_document_key` stores
the S3 key; `docs/API_CONTRACTS.md`'s `supporting_document_url` field
name predates this table and is what Backend Dev's Pydantic schema
should map onto this column.

**Judgment call — flagged for review:** `location_id` is a new field,
not in the previously-documented `/claim` request body. The claim
target is `restaurant_brand`, but DECISIONS.md's `phone_verification`
path calls "the phone number already on the public listing," and phone
lives on `restaurant_location`, not `restaurant_brand` — for a
multi-location brand there is no single "the" phone number without
picking one. `location_id` records which location's public phone was
(or will be) used. `docs/API_CONTRACTS.md`'s `/claim` section is
updated alongside this to add it as an optional request field. Confirm
this before Backend Dev implements the `phone_verification` path.

---

## data_deletion_request

Added `20260916_0004_data_deletion_request.py`, closing the tracked
Phase 1 gap in `docs/PROJECT_PLAN.csv` ("CCPA data export / deletion
flow"). See DECISIONS.md "CCPA data export/deletion" for the full
reasoning; short version: a CCPA "right to delete" request against a
caller's own personal data in this app's database, modeled directly on
`claim_request`'s shape (submit -> `pending_review` -> admin
`approve`/`reject`) — same single-admin-review-queue pattern, reused
rather than inventing a new one.

| Column | Type | Notes |
|---|---|---|
| id | bigint PK | |
| requester_user_id | varchar(36), not null | Cognito `sub` of the requester — same "no local identity table" pattern as `location_manager.user_id` / `user_follow.user_id` / `claim_request.claimant_user_id` |
| requester_role | varchar(16), not null | Role claim at submission time — informational only; the actual deletion in `privacy_service.execute_deletion` is keyed off the Cognito `sub` across every table that stores it, not this field (see DECISIONS.md) |
| status | varchar(16), not null, default `pending_review` | `pending_review` \| `completed` \| `rejected` |
| reason | text, nullable | Optional caller-supplied reason, never required |
| data_scope | jsonb, nullable | Row-count snapshot per affected table, computed at submission time — for the admin reviewer's visibility only; NOT re-read at approval time (`approve_deletion_request` recomputes live counts, since the snapshot can go stale between submission and review) |
| submitted_at | timestamptz, not null | |
| reviewed_by | varchar(64), nullable | Admin Cognito sub who resolved the request |
| reviewed_at | timestamptz, nullable | |
| reviewer_notes | text, nullable | |
| completed_at | timestamptz, nullable | Set only once the redaction/deletion has actually executed — distinct from `reviewed_at` so "reviewed" and "executed" stay separately inspectable even though `approve_deletion_request` currently always sets both together |
| created_at | timestamptz, not null | |
| updated_at | timestamptz, not null | |

Indexes:
- `ix_data_deletion_request_requester_user_id` on `requester_user_id`
- `ix_data_deletion_request_status_submitted` on (`status`, `submitted_at`) — cheap ordered scan for the single admin review queue, same reasoning as `claim_request`'s equivalent index
- `uq_data_deletion_request_pending_user`: **partial unique index** on `requester_user_id` `WHERE status = 'pending_review'` — at most one pending deletion request per identity at a time

**What "approve" actually does** (`app/services/privacy_service.py::approve_deletion_request`, see DECISIONS.md for the full reasoning behind each):
- `user_follow` rows for this identity: hard-deleted.
- `location_manager` rows: `user_id` redacted to a shared literal marker (`"deleted-user"`); any still-`is_active` row is also deactivated (`is_active=false`, `revoked_at=now()`). On root CLAUDE.md's audit-required table list, so each changed row gets an `audit_log` entry.
- `claim_request` rows: `claimant_user_id` redacted to the same marker. Not audit-required (same treatment `claim_request`'s own status transitions already get). **Blocked** (`409 pending_claim_blocks_deletion`) if any row is still `status = pending_review` — admin must resolve it via `/claim/{id}/approve`/`reject` first.
- `owner_account` row (if any): `full_name`/`phone` nulled, `email` replaced with a synthetic unique placeholder, `personal_data_deleted_at` set — never hard-deleted. Audit-required, gets an `audit_log` entry. `restaurant_brand`/`restaurant_location` rows this owner owns are untouched (see DECISIONS.md — business-directory content, not the owner's personal information).
- `audit_log` rows where this identity is the *actor*: untouched — retained for legitimate business/legal record-keeping (DECISIONS.md).

---

## audit_log

| Column | Type | Notes |
|---|---|---|
| id | bigint PK | |
| table_name | varchar(64), not null | Name of the audited table (e.g. `restaurant_location`) |
| record_id | bigint, not null | PK of the audited row. **Not a real FK** — polymorphic across every audited table, so no single FK target applies |
| action | varchar(16), not null | `create` \| `update` \| `delete` |
| actor_id | varchar(64), not null | Cognito `sub` (or admin identifier) of whoever made the write |
| actor_role | varchar(16), not null | `owner` \| `manager` \| `admin` |
| old_val | jsonb, nullable | Pre-write snapshot |
| new_val | jsonb, nullable | Post-write snapshot |
| created_at | timestamptz, not null | |

Index: (`table_name`, `record_id`). Append-only — never updated or deleted (root CLAUDE.md "NEVER delete or truncate any DB table"). Column names/shape match `backend/CLAUDE.md`'s `audit_service.py::log()` exactly — this table is that function's write target. Required on writes to: `restaurant_brand`, `restaurant_location`, `menu_item`, `deal`, `owner_account`, `location_manager` (root CLAUDE.md "ALWAYS — Quality"; `menu_item`/`deal` don't exist until Phase 2, but the generic `table_name`/`record_id` shape already supports them without a migration then).

---

## platform_pricing

| Column | Type | Notes |
|---|---|---|
| id | bigint PK | |
| monthly_price | numeric(10,2), not null | Current: $100.00 |
| yearly_price | numeric(10,2), not null | Current: $1,000.00 |
| currency | varchar(3) default 'USD', not null | |
| effective_date | date, not null | Row becomes effective on this date |
| created_by | varchar(64), nullable | Admin Cognito `sub` |
| created_at | timestamptz, not null | |

Index: `effective_date`. Current price = the row with the latest `effective_date <= today` (DECISIONS.md "Pricing stored in platform_pricing table with effective dates"). No `updated_at` — rows are immutable snapshots; a price change is a new row, not an edit.

---

## admin_free_offer

| Column | Type | Notes |
|---|---|---|
| id | bigint PK | |
| owner_id | bigint FK -> owner_account, not null | `ON DELETE CASCADE`. Offer is owner-scoped, not location-scoped (DECISIONS.md "Owner-scoped free offer covers all their locations including new ones added during the offer") |
| granted_by | varchar(64), not null | Admin Cognito `sub` |
| start_date | date, not null | |
| end_date | date, not null | |
| reason | text, nullable | |
| is_active | boolean default true, not null | Lets admin revoke early without deleting the historical grant row |
| created_at | timestamptz, not null | |
| updated_at | timestamptz, not null | |

Index: `owner_id`. This table is the record of the *grant* only — the resulting `is_paid=true` / `paid_until=end_date` writes on each of the owner's `restaurant_location` rows are Backend Dev's service-layer job (DECISIONS.md "Admin free offer sets is_paid=true + paid_until directly"), not modeled again here.

---

## restaurant_hours

| Column | Type | Notes |
|---|---|---|
| id | bigint PK | |
| location_id | bigint FK -> restaurant_location, not null | `ON DELETE CASCADE` |
| day_of_week | smallint, not null | **0 = Monday .. 6 = Sunday** — judgment call, see below |
| open_time | time, nullable | |
| close_time | time, nullable | |
| is_closed | boolean, nullable | `true` = closed all day; `false` = open per open/close time; **NULL = hours unknown** ("call ahead") |
| created_at | timestamptz, not null | |
| updated_at | timestamptz, not null | |

Unique: (`location_id`, `day_of_week`). Index: `location_id`.

Captured at seed time so it isn't a later migration (DECISIONS.md
"Restaurant hours"). `is_closed=NULL` is intentional for locations
without confirmed hours at seed time, rather than guessing. Backend
Dev's service layer computes true open/closed *display* status from
this table + `restaurant_location.timezone`; the `open_now` **search
filter** is deferred to Phase 3 and is out of scope here.

**Judgment call — flagged for review:** the `day_of_week` numbering
convention (0=Monday..6=Sunday, matching Python's `date.weekday()`)
is not specified in `DECISIONS.md`. Backend Dev should confirm this
convention before writing the seed script or the open/closed
computation — the alternative common convention (0=Sunday) would
silently shift every lookup by a day if assumed differently on the two
sides.

---

## Open items not covered by this schema (flagged, not silently assumed)

- **Gallery photo storage — CLOSED (follow-up migration `0002`).**
  `backend/CLAUDE.md`'s Phase 1 scope includes "up to 2 gallery
  photos" in the owner portal, and DECISIONS.md fixes the
  2-free/10-paid gating rule. The original Phase 1 pass deliberately
  did not add a photo table (task scope was exactly 11 entities). The
  `restaurant_photo` table above closes this gap. Still open per
  `docs/BRD_OPEN_ITEMS.md` #4: "who uploads / size limits / CDN
  strategy" beyond what's modeled here — that's upload-endpoint and
  Infra/CloudFront configuration, not schema.
- **Claim flow backing table — CLOSED (follow-up migration `0002`).**
  `docs/API_CONTRACTS.md`'s "Claim flow" section previously flagged
  that no `claim` entity existed yet. The `claim_request` table above
  closes this gap.

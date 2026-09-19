# API Contracts — Phase 1

Owned by the Architect agent (see `architect/CLAUDE.md`). Backend Dev
implements exactly these shapes; Frontend Dev's typed API client
(`frontend/src/lib/api/`) is generated against them. Covers exactly the
Phase 1 endpoint families listed in `backend/CLAUDE.md`'s Phase 1
Scope: `/search`, `/restaurants` (CRUD), `/locations` (CRUD), `/claim`,
`/auth`, plus `/cuisine-tags` (added 2026-09-13 — see below).

**Auth model reference** (backend/CLAUDE.md "Public Routes"): only
`GET /health`, `GET /search`, `GET /restaurants/{id}`,
`GET /restaurants/{id}/locations`, and `GET /locations/{id}` are
public (plus `POST /reports`, the anonymous report-a-problem
submission — see "Listing reports" below). Every other route below requires a valid Cognito JWT
(`owner` / `manager` / `admin` / `registered_user` pool group), and
every write additionally re-validates ownership/assignment server-side
per root CLAUDE.md "Permission model" — never trust the JWT claims
alone for manager access (`location_manager` table check).

**Full menu vs. photos (DECISIONS.md "Full menu with prices moved to
free tier", "Photo gallery: 2 photos free, 10 photos paid"):** no menu
endpoint exists in Phase 1 — menu CRUD is Phase 2 (`backend/CLAUDE.md`
"Do NOT Build Yet"), so no response below returns menu/price data.
Photo *response fields* are modeled below (`cover_photo_url`,
`gallery_photos`) because the gating behavior is a Phase 1 concern for
the owner portal (`backend/CLAUDE.md` "up to 2 gallery photos").

**Backing table CLOSED** in a follow-up migration
(`20260912_0002_photo_gallery_and_claim_schema.py`, see
`docs/DATA_MODEL.md` "restaurant_photo"): both fields are now sourced
from the `restaurant_photo` table, keyed by `location_id`. `s3_key` is
stored; every URL below is the service layer's CloudFront resolution
of that key, never a stored full URL. `cover_photo_url` is the row
with `is_cover=true` (at most one per location, allowed regardless of
tier — it does not count toward the gallery cap); `gallery_photos` is
the `is_cover=false` rows ordered by `display_order`. Gating is by
omission, not a boolean flag: a free-tier location's `gallery_photos`
simply contains at most 2 entries; a paid location's contains up to
10 — enforced by Backend Dev's service layer on write (see the new
`Photos` endpoints under `Locations` below), consistent with root
CLAUDE.md "is_paid=false locations: ... are NOT returned by API." Still
open per `docs/BRD_OPEN_ITEMS.md` #4: upload size limits and the
CDN/CloudFront configuration itself (Infra's, not a schema concern).

---

## GET /search

Auth: none (public)

Query params:
| Param | Type | Notes |
|---|---|---|
| lat | float, optional | Omit + `lng` omit -> falls back to the admin-configured DFW city bounding box (DECISIONS.md "Default search radius") |
| lng | float, optional | |
| radius | float, optional, default 15 | Miles |
| cuisine[] | string[], optional | `cuisine_tag.name` values, category=`regional` (also usable for `signature`/`dining_time` slugs) |
| dietary[] | string[], optional | `cuisine_tag.name` values, category=`dietary` |
| type[] | string[], optional | `cuisine_tag.name` values, category=`type` |
| q | string, optional, max 100 | Free-text search: case-insensitive substring match on the restaurant (brand) **name** or a cuisine tag's name/display name. **Added 2026-09-19** (user request: search should match restaurant names). When `q` is present the radius and coordinates are NOT required -- a name search finds the restaurant wherever it is, including locations that failed geocoding; those come back with `nearest_location.distance_mi: null` and sort after located results. Still combinable with `cuisine[]`/`dietary[]`/`type[]` (AND). |
| page | int, optional, default 1 | |
| page_size | int, optional, default 20, max 100 | |

Note: `open_now` is deliberately **not** a query param here — deferred
to Phase 3 (DECISIONS.md "Restaurant hours").

Response:
```json
{
  "results": [
    {
      "brand_id": 123,
      "name": "Spice Route",
      "slug": "spice-route",
      "is_claimed": true,
      "cuisine_tags": [
        { "id": 7, "name": "hyderabadi", "display_name": "Hyderabadi", "category": "regional" }
      ],
      "nearest_location": {
        "location_id": 456,
        "distance_mi": 3.2,  // null only for a `q` text-search hit with no coordinates
        "address_line1": "4900 W Park Blvd",
        "city": "Plano",
        "state": "TX",
        "postal_code": "75093",
        "phone": "+14695551234",
        "is_verified": true,
        "is_paid": true,
        "is_open_now": true,
        "open_time": "11:00:00",
        "close_time": "21:00:00",
        "is_closed": false
      },
      "location_count_nearby": 3,
      "cover_photo_url": null,
      "cover_photo_thumbnail_url": null
    }
  ],
  "page": 1,
  "page_size": 20,
  "total": 47
}
```
Notes:
- Results are brand-level cards, not flat locations (DECISIONS.md
  "Brand-level search results") — `location_count_nearby` is how many
  of the brand's locations fall within the search radius; the frontend
  expands this into "3 locations near you."
- `nearest_location.is_open_now` is `true` / `false` / `null` (hours
  unknown) — a per-row display lookup against `restaurant_hours` +
  `restaurant_location.timezone`, not a filter (root/DECISIONS.md
  "Restaurant hours").
- `nearest_location.open_time` / `close_time` / `is_closed` (added
  2026-09-18) are today's hours in the location's own timezone, for the
  card's "Open today 11am–9pm" / "Closed today" label. All `null` =
  hours unknown for today (the card shows no label). `is_closed: true`
  => `open_time`/`close_time` are `null`. Times are `HH:MM:SS`.
- Default sort: `is_paid` desc, then `is_verified` desc, then
  `distance_mi` asc, then `name` asc (DECISIONS.md "Search default sort").
  Paid results carry `nearest_location.is_paid: true`, which the client
  MUST label (the card's "Featured" badge) — promoted placement has to be
  clearly labeled.
- `cover_photo_url` — see the photo note at the top of this doc.
  `cover_photo_thumbnail_url` (added 2026-09-16, S3 image resize
  pipeline — `docs/DECISIONS.md` "Resize Lambda: thumbnail variant") is
  the smaller 400px variant, for exactly this card-style-listing use
  case; `null` whenever `cover_photo_url` is `null`.
  **Cross-reference note (flagged for review):** `restaurant_photo` is
  keyed by `location_id`, not `brand_id` (a brand card here is really
  a rollup of its locations — DECISIONS.md "Brand-level search
  results"). This field resolves to the **`nearest_location`'s** cover
  photo, not some brand-wide concept — there isn't one. A brand with
  multiple locations and no cover photo on the nearest one shows
  `null` even if a farther location of the same brand has one.

---

## GET /cuisine-tags

Auth: none (public)

**Added 2026-09-13, closing a gap flagged during PR #17 review** (see
`docs/DECISIONS.md` "Cuisine tags: public read endpoint, no
pagination"): the homepage's cuisine filter chips were a hardcoded
frontend constant with no backend source of truth, risking silent
drift from the real `cuisine_tag` table (`docs/DATA_MODEL.md`
"cuisine_tag"). This is a new top-level family, not a sub-resource of
`/restaurants` or `/search` — `cuisine_tag` isn't owned by a brand or
location, it's a standalone admin-seeded taxonomy table that both
`/search`'s `cuisine[]`/`dietary[]`/`type[]` params and the owner
portal's tag picker (`POST`/`PATCH /restaurants` `cuisine_tag_ids`)
need to resolve against.

Query params:
| Param | Type | Notes |
|---|---|---|
| category | string, optional | One of `regional` \| `dietary` \| `type` \| `signature` \| `dining_time` (`cuisine_tag.category` values). Omitted returns all categories. |

Response:
```json
{
  "results": [
    { "id": 7, "name": "hyderabadi", "display_name": "Hyderabadi", "category": "regional" }
  ]
}
```
`is_active=true` rows only — a deactivated tag (admin can deactivate
without deleting, per `docs/DATA_MODEL.md`) drops out of this list but
stays intact for any brand still linked to it via `restaurant_cuisine`.

No `page`/`page_size`/`total` — same reasoning as
`GET /locations/{id}/managers` above: `cuisine_tag` is a small,
effectively-static seeded taxonomy table (`docs/TAXONOMY.md`), not a
growing collection, so pagination would add shape without solving a
real problem.

---

## Restaurants (`restaurant_brand`)

### GET /restaurants

Auth: owner or admin

**Added 2026-09-13, closing a gap flagged while unblocking the owner
portal dashboard** (see `docs/DECISIONS.md` "Owner-scoped restaurant
list: bare GET /restaurants, not /restaurants/mine or a /search
variant"): there was previously no way for an authenticated owner to
discover their own brands — `GET /restaurants` only supported the
single id-or-slug lookup below. This is deliberately **not** a new
`/restaurants/mine` route: `GET /restaurants/{id}` already overloads
on caller intent (id vs. slug) rather than spawning a new top-level
route for a variant lookup, and this follows the same pattern —
`GET /restaurants` (no path param) now means "list what I can see,"
scoped by caller role.

Owner caller: implicitly filtered to `owner_id = current_user.id`.
**No query param can widen this** — never trust a client-supplied
owner filter for a non-admin caller, same posture as
`PATCH /auth/me` (self-scoped writes, identity always taken from the
validated JWT, never the request body/query string).

Admin caller: optional `owner_id` query param.

Query params:
| Param | Type | Notes |
|---|---|---|
| owner_id | int, optional | **Admin only** — ignored (never applied) for an owner caller, who is always filtered to their own `owner_id` regardless of this param. Omitted for an admin caller returns all brands. |
| page | int, optional, default 1 | |
| page_size | int, optional, default 20, max 100 | |

Response:
```json
{
  "results": [
    {
      "id": 123,
      "name": "Spice Route",
      "slug": "spice-route",
      "description": "Hyderabadi biryani specialists since 2010.",
      "website": "https://spiceroute.example.com",
      "is_claimed": true,
      "owner_id": 55,
      "cuisine_tags": [
        { "id": 7, "name": "hyderabadi", "display_name": "Hyderabadi", "category": "regional" }
      ],
      "location_count": 3
    }
  ],
  "page": 1,
  "page_size": 20,
  "total": 2
}
```
Same per-row shape as `GET /restaurants/{id}` below (not a
summary/list-trimmed variant) — the owner portal dashboard needs the
same fields the single-brand detail page shows, and keeping one shape
avoids Frontend Dev maintaining two brand card types.

This is **not** a duplicate of `GET /search`: `/search` is the public
geo/filter discovery endpoint (radius, cuisine/dietary/type filters,
brand-level rollup of nearby locations) with no auth and no ownership
concept. `GET /restaurants` here is "what do I own" — auth-gated, no
geo component, no `nearest_location`/`distance_mi` fields at all.

### GET /restaurants/{id}

Auth: none (public)

**`{id}` accepts either the numeric `restaurant_brand.id` or the brand's
`slug` (added 2026-09-13, closing a gap flagged in PR #8's review — see
`docs/DECISIONS.md` "Restaurant lookup by id or slug").** Resolution
order: if the path segment is all-digits, look up by `id`; otherwise look
up by `slug`. `slug` is `unique, not null` (`docs/DATA_MODEL.md`
"restaurant_brand"), and server-generated from `name` on create (see
`POST /restaurants` below), so a collision between a real numeric `id`
and an all-digit `slug` is not expected in practice — server-generated
slugs are name-derived, not numeric. 404 if neither lookup matches.
This is a single overloaded path param, not a second route — Backend
Dev's existing `GET /restaurants/{id}` handler resolves both, it isn't a
new endpoint.

Response:
```json
{
  "id": 123,
  "name": "Spice Route",
  "slug": "spice-route",
  "description": "Hyderabadi biryani specialists since 2010.",
  "website": "https://spiceroute.example.com",
  "is_claimed": true,
  "owner_id": 55,
  "cuisine_tags": [
    { "id": 7, "name": "hyderabadi", "display_name": "Hyderabadi", "category": "regional" }
  ],
  "location_count": 3
}
```
`website` is `null` when not set -- added alongside the CSV bulk-import
feature (docs/DATA_MODEL.md "restaurant_brand" judgment call: brand-level,
not location-level). `owner_id` is `null` for unclaimed listings (still visible, per
DECISIONS.md "Claim flow" — the frontend renders a "Claim this
listing" CTA when `is_claimed` is `false`).

### GET /restaurants/{id}/locations

Auth: none (public) — but see the owner/admin note below.

Query params: `page` (default 1), `page_size` (default 20, max 100).

Response:
```json
{
  "results": [
    {
      "id": 456,
      "location_name": null,
      "address_line1": "123 Main St",
      "city": "Plano",
      "state": "TX",
      "postal_code": "75024",
      "phone": "+14695551234",
      "is_verified": true,
      "is_paid": true,
      "paid_until": "2027-03-01T00:00:00Z",
      "is_active": true,
      "is_open_now": true
    }
  ],
  "page": 1,
  "page_size": 20,
  "total": 3
}
```
Summary shape only (no hours breakdown, no photos) — see
`GET /locations/{id}` for the full location detail.

`paid_until` and `is_active` added 2026-09-17 (`docs/PROJECT_PLAN.csv`
"Serialize paid_until/is_active on location endpoints + let owner see own
deactivated locations") — same fields/semantics as `GET /locations/{id}`
above.

**Owner/admin see their own deactivated locations here too (added
2026-09-17, same row):** this endpoint stays public by default and
filters to `is_active=true` only for an anonymous caller (or any
authenticated caller who is not this brand's owner and not an admin) —
that behavior is unchanged. If the request carries a valid bearer token
AND the caller is either an admin, or an owner who owns `restaurant_brand
{id}`, the `is_active` filter is dropped entirely and the response also
includes that brand's deactivated (`is_active=false`) locations — there is
no separate owner-scoped locations-list endpoint, so this is the one
place an owner (via the dashboard) or admin can see a location they
soft-deleted, as a first step toward eventually reactivating it (no
reactivate endpoint exists yet — out of scope for this row). A manager or
`registered_user` caller, and an owner who does not own this brand, still
only sees active locations, same as a public caller.

### POST /restaurants

Auth: owner

Body:
```json
{
  "name": "Spice Route",
  "description": "Hyderabadi biryani specialists since 2010.",
  "website": "https://spiceroute.example.com",
  "cuisine_tag_ids": [7, 12]
}
```
`website` is optional. Creates a brand owned by the authenticated owner (`is_claimed=true`,
`owner_id=<self>`, `slug` server-generated from `name`). This is
distinct from the claim flow, which attaches an *existing*,
admin-seeded, unclaimed brand to an owner instead of creating a new
row — see `POST /claim`.

Response: `201`, same shape as `GET /restaurants/{id}`.

Audit: writes an `audit_log` row (`table_name="restaurant_brand"`,
`action="create"`) per root CLAUDE.md "ALWAYS — Quality".

### PATCH /restaurants/{id}

Auth: owner (must own the brand) or admin

Body: any subset of `{ name, description, website, cuisine_tag_ids }`.

Response: `200`, same shape as `GET /restaurants/{id}`.

Audit: `audit_log` row (`action="update"`, `old_val`/`new_val`
populated).

### DELETE /restaurants/{id}

Auth: admin only

`restaurant_location.brand_id` has `ON DELETE RESTRICT` — the database
itself refuses this delete while any location rows still reference the
brand. Backend Dev's service layer should catch that and return `409
Conflict` with a clear message rather than letting a DB integrity
error surface (root CLAUDE.md "NEVER expose internal stack details in
API error responses"). Callers must remove/reassign all of the brand's
locations first.

**Flagged gap:** `restaurant_brand` has no `is_active`/soft-delete
column in this schema (unlike `restaurant_location`), so there is no
"unlist without deleting" option for a whole brand today — only a hard
delete gated by the FK. Worth a product decision if "temporarily hide
a brand" turns out to be a real need.

Response: `204 No Content`. Audit: `audit_log` row (`action="delete"`).

---

## Locations (`restaurant_location`)

### GET /locations/{id}

Auth: none (public)

Response:
```json
{
  "id": 456,
  "brand_id": 123,
  "location_name": null,
  "address_line1": "123 Main St",
  "address_line2": null,
  "city": "Plano",
  "state": "TX",
  "postal_code": "75024",
  "country": "US",
  "phone": "+14695551234",
  "about": "Family-run kitchen specializing in Hyderabadi biryani.",
  "specialties": ["Hyderabadi biryani", "Dum cooking"],
  "timezone": "America/Chicago",
  "latitude": 33.0198,
  "longitude": -96.6989,
  "is_verified": true,
  "is_paid": true,
  "paid_until": "2027-03-01T00:00:00Z",
  "is_active": true,
  "is_open_now": true,
  "hours": [
    { "day_of_week": 0, "open_time": "11:00:00", "close_time": "22:00:00", "is_closed": false },
    { "day_of_week": 1, "open_time": "11:00:00", "close_time": "22:00:00", "is_closed": false }
  ],
  "cover_photo_url": null,
  "cover_photo_thumbnail_url": null,
  "gallery_photos": []
}
```
Notes:
- `paid_until` and `is_active` (added 2026-09-17 — `docs/PROJECT_PLAN.csv`
  "Serialize paid_until/is_active on location endpoints + let owner see
  own deactivated locations") are real `restaurant_location` columns
  that were already stored but not previously serialized on this
  response. `paid_until` is `null` on the free tier (root CLAUDE.md "Tier
  model (is_paid)"). Unlike the list endpoint below, this single-location
  lookup does **not** filter by `is_active` at all — a deactivated
  location's detail is still returned here to any caller, unchanged by
  this fix (pre-existing behavior; flagged, not in this change's scope).
- `hours` is all 7 `restaurant_hours` rows for this location, `day_of_week`
  0=Monday..6=Sunday (see `docs/DATA_MODEL.md` judgment-call note — a
  day with no seeded row yet is simply absent from the array, which the
  frontend should treat the same as `is_closed: null`).
- `is_open_now` is the computed display status (see `/search` notes) —
  `null` when the current day's `is_closed` is `null` (hours unknown).
- Full menu with prices is **not** in this response — no menu endpoint
  exists in Phase 1 (see the note at the top of this doc).
- `cover_photo_url` — the `restaurant_photo` row for this location with
  `is_cover=true` (at most one), resolved to a CloudFront URL from its
  `s3_key`. `null` if no cover photo has been uploaded yet. See
  `docs/DATA_MODEL.md` "restaurant_photo". `cover_photo_thumbnail_url`
  (added 2026-09-16 — `docs/DECISIONS.md` "Resize Lambda: thumbnail
  variant") is the 400px variant, `null` under the same condition.
- `gallery_photos` — up to 2 entries if `is_paid=false`, up to 10 if
  `is_paid=true`, each `{ id, url, thumbnail_url, display_order }` (an
  array of objects, not bare URL strings — the `id` is needed for the
  `PATCH`/`DELETE` photo endpoints below), ordered by `display_order`, sourced
  from `restaurant_photo` rows with `is_cover=false`.

### POST /locations

Auth: owner (must own the parent brand — `restaurant_brand.owner_id == current_user.id`)

Body:
```json
{
  "brand_id": 123,
  "address_line1": "123 Main St",
  "address_line2": null,
  "city": "Plano",
  "state": "TX",
  "postal_code": "75024",
  "country": "US",
  "phone": "+14695551234",
  "timezone": "America/Chicago",
  "latitude": 33.0198,
  "longitude": -96.6989
}
```
New locations start `is_paid=false`, `is_verified=false`, `is_active=true`.
`latitude`/`longitude` are geocoded client- or service-side before this
call; the service layer derives `geom` from them on write (see
`docs/DATA_MODEL.md` judgment-call note on `restaurant_location.geom`).

Response: `201`, same shape as `GET /locations/{id}` (with an empty `hours` array).

Audit: `audit_log` row (`table_name="restaurant_location"`, `action="create"`).

### PATCH /locations/{id}

Auth: owner (owns parent brand), manager with an active `location_manager` row for this location, or admin (root CLAUDE.md "Permission model" — checked server-side on every write, never from the JWT alone). Admin added 2026-09-17 — see "Platform admin full-access parity" below.

Body: any subset of the address/contact/timezone fields from `POST
/locations`, plus two optional public-profile fields (added 2026-09-19,
free tier, owner/manager/admin may all set them):
- `about` — string, max 1000 chars (trimmed; empty string -> `null`;
  over-length -> `422`). Free text, e.g. "We specialize in ...".
- `specialties` — array of strings, max 8 items, each 1-40 chars after
  trimming (blank entries dropped, case-insensitive duplicates removed;
  over-limit -> `422`; empty array -> `null`).

Unlike the other fields (where an explicit `null` is ignored), sending
`null`, `""` or `[]` for `about` / `specialties` **clears** the stored
value; omitting the key leaves it untouched. Both fields are also returned
by `GET /locations/{id}` (and this PATCH's response) as `about: string |
null` and `specialties: string[] | null`. Does **not** accept `is_paid`, `paid_until`, or
`stripe_sub_item_id` — those are Stripe-webhook/admin-only writes
(root CLAUDE.md "Stripe webhook sets is_paid... on payment
success/failure"; not a field an owner or manager can set directly).

Response: `200`, same shape as `GET /locations/{id}`.

Audit: `audit_log` row (`action="update"`).

### PUT /locations/{id}/hours

Auth: owner (owns parent brand), manager with active assignment for this location, or admin (added 2026-09-17 — see "Platform admin full-access parity" below)

Body: full week replacement (`backend/CLAUDE.md` "Hours captured via
CRUD" — modeled as a sub-resource of `/locations`, not a separate
top-level endpoint family, to stay within the Phase 1 endpoint list):
```json
{
  "hours": [
    { "day_of_week": 0, "open_time": "11:00:00", "close_time": "22:00:00", "is_closed": false },
    { "day_of_week": 1, "open_time": "11:00:00", "close_time": "22:00:00", "is_closed": false },
    { "day_of_week": 2, "is_closed": true }
  ]
}
```
A day omitted from the array is left as `is_closed: null` ("hours
unknown") rather than being guessed. Upserts by (`location_id`,
`day_of_week`) — matches the table's unique constraint.

Response: `200`, `{ "hours": [ ...same 7-row shape as GET /locations/{id}.hours... ] }`.

Audit: `audit_log` row (`table_name="restaurant_location"`,
`record_id=<location_id>`, `action="update"`) — hours changes are
tracked against the location, not a separate audited table, since
`restaurant_hours` is not in the root CLAUDE.md audit-required list.

### Photos (`restaurant_photo`, sub-resource of `/locations/{id}`)

**Added alongside `restaurant_photo`'s follow-up migration** — closes
the gap noted at the top of this doc and in `docs/DATA_MODEL.md` "Open
items." Modeled as a sub-resource of `/locations`, same reasoning as
`/locations/{id}/hours`: stays within the Phase 1 endpoint families
already listed in `backend/CLAUDE.md` (`/locations` CRUD covers this,
same as it covers hours) rather than introducing a new top-level
`/photos` family. Uploads follow root CLAUDE.md's S3 presigned-URL
pattern exactly — never through Lambda.

**Full pipeline completed 2026-09-16** (see `docs/PROJECT_PLAN.csv` "S3
image resize pipeline" and `docs/DECISIONS.md` "S3 image resize
pipeline" / "Resize Lambda: thumbnail variant" for the full design
writeup). BRD 5.3's 6-step flow, end to end:
1. Client calls `POST /locations/{id}/photos/upload-url` below → gets a
   presigned upload target for a `raw/` key.
2. Client uploads directly to S3.
3. An S3 `ObjectCreated` event (filtered to the `raw/` prefix) triggers
   the resize Lambda.
4. Resize Lambda writes a 1200px JPEG (quality 85) to `processed/...`
   and a 400px JPEG (quality 80) to `thumbnails/...`.
5. Resize Lambda deletes the original from `raw/...`.
6. `POST /locations/{id}/photos` below stores the **predicted**
   `processed/`/`thumbnails/` keys immediately — it does not wait for
   steps 3-5 to finish (see that endpoint's own note below).

Auth for all four routes below: owner (owns parent brand), manager
with an active `location_manager` row for this location, or admin
(added 2026-09-17 — see "Platform admin full-access parity" below) —
same as `PATCH /locations/{id}` and `PUT /locations/{id}/hours`.

#### POST /locations/{id}/photos/upload-url

Body: `{ "content_type": "image/jpeg" }` — JPEG or PNG only (BRD 5.3);
any other `content_type` is rejected with `400 unsupported_content_type`.

Response: `200`
```json
{
  "upload_url": "https://<bucket>.s3.amazonaws.com/",
  "fields": {
    "Content-Type": "image/jpeg",
    "key": "raw/locations/456/photos/8f14e-....jpg",
    "...": "additional S3-generated presigned-POST fields (policy, signature, etc.)"
  },
  "s3_key": "raw/locations/456/photos/8f14e-....jpg",
  "expires_in": 600
}
```
**Presigned S3 `POST`, not `PUT`** — a deliberate, documented deviation
from `backend/CLAUDE.md`'s general "S3 presigned URL generation"
pattern (still the plain-`PUT` pattern for every other upload in this
app, e.g. claim documents). Reason: BRD 5.3 requires the 5MB cap to be
"enforced by S3 ... before the upload completes." S3's
`content-length-range` condition — the only mechanism S3 itself
enforces before accepting an object — only exists for presigned POST
policies; it cannot be expressed as a bucket policy `Condition` on a
plain presigned `PUT`, and `PUT`'s SigV4 query-string signing has no way
to pin a Content-Length either (verified against AWS's own
bucket-policy-condition-key documentation and multiple corroborating
sources — see `docs/DECISIONS.md` for citations). The client uploads by
POSTing a multipart form to `upload_url`: every entry in `fields` as a
form field, plus the file itself under the field name `file` (S3's own
presigned-POST convention) — then calls `POST /locations/{id}/photos`
below with the same `s3_key` to record it.

**Key convention:** `raw/locations/{id}/photos/{uuid}.<ext>`. The `raw/`
prefix is what the resize Lambda's S3 event notification is scoped to.

**This is a contract change** from the previously-documented shape
(`upload_url` + `s3_key` + `expires_in`, a plain `PUT` target, no
`fields`, no `raw/` prefix) — flagged explicitly per root CLAUDE.md's
"never change an API contract silently" rule. No frontend consumer of
this endpoint existed yet (this pipeline was "Not Started" end to end
per `docs/PROJECT_PLAN.csv` before this change).

#### POST /locations/{id}/photos

Body: `{ "s3_key": "raw/locations/456/photos/8f14e-....jpg", "is_cover": false }`
— `s3_key` is the **raw** key echoed back from the `upload-url` call
above, not a processed one.

Creates the `restaurant_photo` row. **Does not wait for the resize
Lambda.** BRD 5.3's steps 3-5 (resize, write `processed/`+`thumbnails/`,
delete `raw/`) run asynchronously off the S3 event and will almost
certainly not have finished by the time this call lands right after the
client's direct-to-S3 upload completes. Instead, the server predicts the
resize Lambda's eventual output keys via a pure transform of the raw key
(`raw/locations/{id}/photos/{uuid}.<ext>` →
`processed/locations/{id}/photos/{uuid}.jpg` and
`thumbnails/locations/{id}/photos/{uuid}.jpg` — always `.jpg`,
regardless of the original extension, since the resize Lambda always
outputs JPEG) and stores those predicted keys immediately. The response
below is correct from the first call; the actual S3 objects typically
appear a few seconds later (e.g. a client requesting the URL from
CloudFront in that narrow window sees a 404 until the resize Lambda
finishes — see `docs/DECISIONS.md` for the alternatives considered and
rejected: polling, a `status` field, synchronous resize in the request
path).

Also validates that `s3_key` actually matches this location's own
upload-url convention (`raw/locations/{id}/photos/...`) — `400
invalid_s3_key` if it doesn't (e.g. a foreign/crafted key, or a key
that's already a `processed/`/`thumbnails/` one).

Server-assigned `display_order` (appended to the end) when
`is_cover=false`. Enforcement, all at the service layer (not a DB
constraint, same pattern as `location_manager`'s manager cap):
- **Gallery cap:** rejects with `409 Conflict` if the location already
  has 2 (`is_paid=false`) or 10 (`is_paid=true`) `is_cover=false` rows.
- **Cover replace, not stack:** if `is_cover=true` and a cover row
  already exists for this location, the existing one is deleted (or
  demoted) as part of the same write — there is only ever one.

Response: `201`
```json
{
  "id": 12,
  "location_id": 456,
  "url": "https://<cloudfront-domain>/processed/locations/456/photos/8f14e-....jpg",
  "thumbnail_url": "https://<cloudfront-domain>/thumbnails/locations/456/photos/8f14e-....jpg",
  "is_cover": false,
  "display_order": 2
}
```
`thumbnail_url` added 2026-09-16 alongside `url` — user-requested
beyond BRD 5.3's own documented spec (a single processed image); see
`docs/DECISIONS.md` "Resize Lambda: thumbnail variant." The same
predicted-key/eventual-consistency note above applies to it too.

`restaurant_photo` is not in root CLAUDE.md's audit-required table
list, so no `audit_log` row is required here (consistent with
`restaurant_hours` above).

**Also affects, additively (no field removed, `thumbnail_url`/
`cover_photo_thumbnail_url` added alongside the existing `url`/
`cover_photo_url`):** `GET /locations/{id}`'s `cover_photo_url` /
`gallery_photos[].url` and `GET /search`'s `cover_photo_url` — see
those endpoints' own entries.

#### PATCH /locations/{id}/photos/{photo_id}

Body: any subset of `{ "display_order": 0, "is_cover": true }`.
Setting `is_cover=true` demotes/removes whichever row currently holds
the cover slot for this location, same rule as the `POST` above.

Response: `200`, same shape as the `POST` response.

#### DELETE /locations/{id}/photos/{photo_id}

Row delete (not soft-delete — unlike `restaurant_location` itself,
there's no "hidden but kept" state that makes sense for an individual
gallery photo; the S3 object removal, if any, is Backend Dev's
service-layer concern, not documented here).

Response: `204 No Content`.

### DELETE /locations/{id}

Auth: owner (owns parent brand) or admin

**Soft delete, not a row delete:** sets `is_active=false`. The row,
its `restaurant_hours`, and its `location_manager` history are kept
(root CLAUDE.md "NEVER delete or truncate any DB table" — this applies
to what an agent runs directly, but the same discipline is the right
default for the product's own delete endpoints too). A relisted
location is `PATCH`-reactivated by an admin, not recreated.

Response: `204 No Content`. Audit: `audit_log` row (`action="update"`,
noting the `is_active` transition — not `action="delete"`, since
nothing is actually deleted).

**Platform admin full-access parity (2026-09-17, `docs/PROJECT_PLAN.csv`
"Platform admin full-access parity", `docs/DECISIONS.md` "Authentication
& Permissions"):** root CLAUDE.md's Permission model already states
"Admin: full platform access" as a principle, and this note above ("A
relisted location is `PATCH`-reactivated by an admin") already assumed
`PATCH /locations/{id}` was admin-reachable — but it wasn't: `PATCH
/locations/{id}`, `PUT /locations/{id}/hours`, and all four
`/locations/{id}/photos*` routes previously excluded admin entirely
(`require_location_write_access` had no admin branch). Closed by adding
an admin short-circuit directly to `require_location_write_access`
(`backend/app/dependencies/auth.py`), so admin can now edit a location's
basic info/hours/photos on an owner's behalf for support — same
audit-logged write path, `audit_log.actor_id`/`actor_role` correctly
attributing the write to the admin's own identity, never mislabeled as
the owner. `GET /locations/{id}/managers` and `DELETE
/locations/{id}/managers/{manager_id}` already had admin parity before
this change (unchanged here).

**Deliberately left owner-only:** `POST /locations` and `POST
/locations/{id}/managers` — see those endpoints' own Auth lines. Both are
an owner declaring/vouching for something new under their own brand
(a new location; a specific named person as a location's manager), not
administering an existing resource — the same reasoning `POST
/restaurants` (also owner-only, no admin path) already follows. Support
access to an *existing* problematic manager assignment is already
covered by the admin-parity `DELETE` above.

---

## Location Managers (`location_manager`)

Closes the gap flagged in `backend/app/services/location_manager_service.py`'s
module docstring: the paid-tier 2-active-manager cap (DECISIONS.md
"Assignable location managers capped at 2 per location") already has its
cap-check helper (`assert_can_add_active_manager`) implemented and ready,
but no contract existed for Backend Dev to wire it to. This section is that
contract. All three endpoints are sub-resources of `/locations/{id}`, same
reasoning as `/locations/{id}/hours` and `/locations/{id}/photos` above —
they stay within the Phase 1 `/locations` (CRUD) endpoint family rather than
introducing a new top-level `/managers` family.

**Identifier judgment call (flagged for review):** the request below
identifies the manager being assigned by **email**, not by Cognito `sub`,
even though `location_manager.user_id` stores the `sub`
(`docs/DATA_MODEL.md` "location_manager"). An owner assigning a manager
knows that person's email, not their opaque Cognito subject id — nothing
elsewhere in this API surfaces a raw `sub` to an owner for them to reference
(compare `GET /auth/me`, which returns `email` to the caller about
*themselves*, never a `sub` for someone else). The service layer resolves
`manager_email` to a Cognito `sub` via a Cognito Admin API lookup
(`list_users` filtered on the pool's `email` attribute, since username and
email aren't guaranteed to be the same value) before writing
`location_manager.user_id`. This is new Cognito-side surface for Backend
Dev — it will need a narrowly-scoped IAM permission (`cognito-idp:ListUsers`
on this one user pool, not a broader Cognito grant — root CLAUDE.md "AWS
Best Practices") from Infra to make that call. If the lookup finds no
matching user (nobody has signed up with that email yet), the endpoint
returns `404` — this contract does not define an invite-by-email flow for a
not-yet-registered user; the manager must already exist as a Cognito user
before an owner can assign them.

Response rows below include a **read-time-resolved** `email` field for
display — the same "resolve the external identifier back to something
human-readable on the way out" pattern `cover_photo_url` uses for `s3_key`
— not a stored column. This is cheap here regardless of caller: the
paid-tier cap bounds active rows to 2, and even the historical (inactive)
rows for a single location are never a large set. If the lookup fails for a
since-deleted Cognito user, `email` is `null` rather than surfacing an
internal error (root CLAUDE.md "NEVER expose internal stack details in API
error responses").

### POST /locations/{id}/managers

Auth: owner only (must own the parent brand) — **no admin, no manager
path**, matching `POST /locations` and `POST /restaurants` above (owner
creates resources under their own brand) rather than the owner-or-admin
pattern used for the soft-deactivate action below. Per root CLAUDE.md's
Key Domain Concepts ("a manager can manage multiple locations, assigned by
owner"), assigning a manager is exclusively an owner action.
**Implementation note:** none of the existing auth dependencies in
`backend/app/dependencies/auth.py` match this shape exactly
(`require_location_write_access` also admits an already-assigned manager,
which is wrong here) — Backend Dev will need a new owner-only, no-manager-
path dependency for this route.

Body:
```json
{ "manager_email": "manager@example.com" }
```

Response: `201`
```json
{
  "id": 12,
  "location_id": 456,
  "user_id": "us-east-1:9f2b3c1a-...",
  "email": "manager@example.com",
  "is_active": true,
  "assigned_by_owner_id": 55,
  "assigned_at": "2026-09-12T10:00:00Z",
  "revoked_at": null
}
```

Errors:
| Status | Code | When |
|---|---|---|
| 404 | `not_found` | Location doesn't exist |
| 403 | `forbidden` | Caller doesn't own the location's parent brand |
| 404 | `manager_not_found` | No Cognito user exists with `manager_email` |
| 409 | `manager_cap_reached` | Location is `is_paid=true` and already has 2 active managers — from the existing `assert_can_add_active_manager` check in `location_manager_service.py`, unchanged |
| 409 | `already_active_manager` | This user already has an active assignment on this location — `uq_location_manager_active_user` (`docs/DATA_MODEL.md`) would otherwise raise a raw DB integrity error; service layer catches it the same way `DELETE /restaurants/{id}` catches its `ON DELETE RESTRICT` case above |

Audit: `audit_log` row (`table_name="location_manager"`, `action="create"`) — `location_manager` is in root CLAUDE.md's audit-required table list.

**Re-assigning a previously-removed manager to the same location**
(verified 2026-09-17, `docs/PROJECT_PLAN.csv` "Manager reassignment /
reactivation across restaurants"): this endpoint always inserts a **new**
`location_manager` row rather than flipping an existing inactive one back
to active — history-preserving, and it already works correctly for this
case with no fix needed. `uq_location_manager_active_user` is a *partial*
unique index (`postgresql_where="is_active = true"`,
`docs/DATA_MODEL.md`), so a prior soft-removed row for the same
`(location_id, user_id)` — `is_active=false` — never participates in the
uniqueness check at all; only active rows are constrained. A location can
therefore have any number of historical inactive rows for the same
manager plus exactly one current active one, and re-assigning after a
soft-removal (`DELETE /locations/{id}/managers/{manager_id}`) hits the
plain "no existing active row" path, not `already_active_manager`.

### GET /locations/{id}/managers

Auth: owner (owns parent brand), admin, or a manager with an active
assignment on this location — the general read-permission pattern already
used for owner/manager-shared access (`require_location_write_access`'s
check, applied here for a read instead of a write).

Query params:
| Param | Type | Notes |
|---|---|---|
| active_only | bool, optional, default false | Forced `true` server-side when the caller is a manager (not owner/admin) — a manager sees who else currently manages this location, not the full removal history. Owner/admin get the full history (including deactivated rows) by default, or can pass `true` to narrow to active only. |

Response: `200`
```json
{
  "results": [
    {
      "id": 12,
      "location_id": 456,
      "user_id": "us-east-1:9f2b3c1a-...",
      "email": "manager@example.com",
      "is_active": true,
      "assigned_by_owner_id": 55,
      "assigned_at": "2026-09-12T10:00:00Z",
      "revoked_at": null
    }
  ]
}
```
No `page`/`page_size`/`total` — unlike `/search` and the other list
endpoints above, this list is bounded by the 2-active-per-location cap plus
a small history, never large enough to need paging.

### DELETE /locations/{id}/managers/{manager_id}

Auth: owner (owns parent brand) or admin — same auth pattern as
`DELETE /locations/{id}` above (`require_location_owner_or_admin` in
`backend/app/dependencies/auth.py` already matches this shape exactly, no
new dependency needed). **No self-removal by the assigned manager** — see
`docs/DECISIONS.md` "Location manager removal is owner/admin-only, no
self-removal" for the reasoning.

`manager_id` is `location_manager.id` (the assignment row's own PK), not
the manager's `user_id` — a location can have multiple historical rows for
the same `user_id` (revoked, then reassigned later), so the assignment id
is the unambiguous target.

**Soft-deactivate, not a row delete** — sets `is_active=false`,
`revoked_at=now()` (the column already exists on `location_manager`,
`docs/DATA_MODEL.md`), same "kept, not deleted" discipline as
`DELETE /locations/{id}`. Idempotent: calling this again on an
already-inactive row returns `204` without error rather than a `409` or
`404` — plain REST-delete idempotency, no cap-check or other side effect
fires on a no-op.

Response: `204 No Content`.

Audit: `audit_log` row (`table_name="location_manager"`, `action="update"`,
noting the `is_active` transition — not `action="delete"`, same phrasing
convention as `DELETE /locations/{id}` above, since nothing is actually
deleted).

### GET /auth/me/managed-locations

**Added 2026-09-17** — closes the gap flagged in the "Owner portal
dashboard" and "User profile / account details page" rows of
`docs/PROJECT_PLAN.csv`: no endpoint let a manager discover which
locations they're assigned to. `GET /locations/{id}/managers` needs a
location id up front, which is exactly the missing piece — this is that
discovery endpoint, modeled as a sub-resource of `/auth/me` (same family
as `GET /auth/me/follows`) rather than of `/locations`, since it's scoped
to the caller, not to a specific location.

Auth: any authenticated user — no role restriction beyond being logged
in. Inherently scoped to "my own" assignments (`location_manager.user_id
== caller's cognito_sub`), so an owner/admin/registered_user caller with
no manager assignments just gets an empty page, not a `403`.

Query params: standard pagination (`page`, default `1`; `page_size`,
default `20`, max `100` — `backend/CLAUDE.md` pagination convention).

Response: `200`
```json
{
  "results": [
    {
      "id": 456,
      "location_name": null,
      "address_line1": "123 Main St",
      "city": "Plano",
      "state": "TX",
      "postal_code": "75024",
      "phone": "+14695551234",
      "is_verified": true,
      "is_paid": true,
      "is_open_now": true
    }
  ],
  "page": 1,
  "page_size": 20,
  "total": 1
}
```
Same per-row shape as `GET /restaurants/{id}/locations`'s
`LocationSummaryOut` (deliberately duplicated as its own
`ManagedLocationOut` schema, not imported — see
`backend/app/schemas/location_manager.py`). Only `is_active=true`
assignment rows on `is_active=true` locations are included — a
soft-removed assignment or a soft-deleted location doesn't appear here
(unlike the owner/admin-facing `GET /locations/{id}/managers`, which
shows full history by default).

---

## Follows (`user_follow`)

Closes the Phase 1 gap tracked in `docs/PROJECT_PLAN.csv` ("User follow /
unfollow API") — the `user_follow` table has existed since the initial
schema migration, but no endpoint was ever added. Follow target is the
**brand**, not a specific location (`docs/DATA_MODEL.md` "user_follow" —
already a settled judgment call, not re-litigated here).

**Route shape judgment call (flagged for review):** `POST`/`DELETE
/restaurants/{id}/follow`, nested under the existing `/restaurants`
resource, rather than a separate top-level `/follows` resource. Same
reasoning as `/locations/{id}/hours`, `/locations/{id}/photos`, and
`/locations/{id}/managers` above — a follow is an action on a specific
restaurant, not an independently addressable resource with its own
identity that any endpoint needs to reference (nothing ever looks up a
follow by its own `user_follow.id`; both routes below are addressed by
`brand_id`). The one exception is the read side: "what do I follow" is a
property of the *caller*, not of any one restaurant, so it lives at
`GET /auth/me/follows` — the same "me"-scoped convention `GET /auth/me`
already established — rather than as a third `/restaurants/{id}/...`
route (there is no single `{id}` to nest it under) or a new `/users`
resource introduced for this one endpoint alone.

Auth: `registered_user` only, all three routes below (root CLAUDE.md
"Permission model" — "Registered user: read-only + follow + deals"; no
owner/manager/admin use case exists for following a brand). New
`require_registered_user` dependency in `backend/app/dependencies/auth.py`,
same shape as `require_admin`/`require_owner` — none of the existing
dependencies gate to this one role.

### POST /restaurants/{id}/follow

Auth: registered_user

**Idempotent**: following a brand the caller already follows returns the
existing follow (its original `followed_at`, not a refreshed one) rather
than erroring or creating a duplicate row — `uq_user_follow_user_brand`
(`docs/DATA_MODEL.md`) is the last line of defense against a concurrent
duplicate, caught the same way `location_manager_service.assign_manager`
catches its own unique-constraint race, but the common case never reaches
the DB constraint at all: it's checked first and short-circuited.

Response: `200` (same shape whether this created a new follow or the
caller already followed this brand — no separate "already following"
signal, since the caller doesn't need to distinguish the two to decide
what to do next):
```json
{ "brand_id": 123, "followed_at": "2026-09-16T10:00:00Z" }
```

Errors:
| Status | Code | When |
|---|---|---|
| 404 | `not_found` | `brand_id` doesn't exist |
| 403 | `forbidden` | Caller is not a `registered_user` |

Audit: none — `user_follow` is not on root CLAUDE.md's audit-required
table list (restaurant_brand, restaurant_location, menu_item, deal,
owner_account, location_manager).

### DELETE /restaurants/{id}/follow

Auth: registered_user

**Idempotent**, same posture as `DELETE /locations/{id}/managers/{id}`
above: unfollowing a brand the caller doesn't currently follow (or that
doesn't exist) is a no-op `204`, not a `404`/`409` — plain REST-delete
idempotency, no side effect on a no-op.

Response: `204 No Content`.

### GET /auth/me/follows

Auth: registered_user

Query params: `page`, `page_size` (default 20, max 100 — backend/CLAUDE.md
"ALWAYS include pagination on list endpoints"; unlike
`GET /locations/{id}/managers`, this list has no small natural cap —
DECISIONS.md "No follow cap for registered users" — so it needs real
paging, not a bounded single page).

Response: `200`, brand summaries only (not the full `RestaurantOut` shape
— this is "what do I follow", not a restaurant detail page):
```json
{
  "results": [
    { "brand_id": 123, "name": "Spice Garden", "slug": "spice-garden-irving", "is_claimed": true, "followed_at": "2026-09-16T10:00:00Z" }
  ],
  "page": 1,
  "page_size": 20,
  "total": 1
}
```
Ordered most-recently-followed first.

---

## Claim flow (`/claim`)

Implements DECISIONS.md "Claim flow": Google Business Profile match OR
phone verification as primary proof, document upload + admin review as
fallback; single admin queue, 2-business-day SLA. This flow attaches
an *existing* unclaimed `restaurant_brand` (seeded with `owner_id=NULL`,
`is_claimed=false`) to the authenticated user — it does not create a
new brand (see `POST /restaurants` for that).

### POST /claim

Auth: any authenticated Cognito user (the claimant — elevated to the
`owner` pool group by Backend Dev's approval handling once the claim is
approved; the request itself does not require the user to already be
in the `owner` group)

Body:
```json
{
  "brand_id": 123,
  "location_id": 456,
  "proof_method": "google_business_profile",
  "google_business_profile_url": "https://business.google.com/...",
  "supporting_document_url": null
}
```
`proof_method` is one of `google_business_profile` | `phone_verification`
| `document_upload`. For `phone_verification`, no body proof field is
needed — the outbound call target is the phone number already on the
public listing (`restaurant_location.phone`), never a number the
claimant supplies (DECISIONS.md: "Rejected: Phone number claimant
supplies — spoofable"). For `document_upload`, `supporting_document_url`
is an S3 key from a presigned upload (root CLAUDE.md media pattern),
required only as the fallback when neither of the other two methods
passes.

`location_id` **(added alongside the `claim_request` follow-up
migration — flagged judgment call, see `docs/DATA_MODEL.md`
"claim_request"):** optional, but required in practice when
`proof_method = phone_verification` and the brand has more than one
location — it identifies *which* location's public
`restaurant_location.phone` is being called, since the claim target
(`brand_id`) can have several. Omit it for a single-location brand or
for the other two proof methods.

Response: `201`
```json
{
  "claim_id": 789,
  "brand_id": 123,
  "status": "pending_review",
  "proof_method": "google_business_profile",
  "submitted_at": "2026-09-12T10:00:00Z",
  "sla_due_at": "2026-09-16T10:00:00Z"
}
```
All claims land in the single admin review queue regardless of
`proof_method` — a Google Business Profile match is treated as
*pre-verified* evidence for the admin reviewing it, not an
auto-approval path (DECISIONS.md doesn't describe an auto-approve
branch). `sla_due_at` is computed (`submitted_at` + 2 business days),
not a stored column — same pattern as `is_open_now` being computed
rather than stored.

**Backing table CLOSED** in a follow-up migration
(`20260912_0002_photo_gallery_and_claim_schema.py` — see
`docs/DATA_MODEL.md` "claim_request"). `claim_id` above is
`claim_request.id`. At most one `pending_review` claim can exist per
brand at a time (partial unique index) — a second `POST /claim` for
the same `brand_id` while one is already pending should return `409
Conflict`, not create a competing row.

### GET /claim/{id}

Auth: the claimant (own claim only) or admin (any claim)

Response: same shape as the `POST /claim` response, with `status` one
of `pending_review` | `approved` | `rejected`, plus `reviewed_at` /
`reviewer_notes` once resolved.

### POST /claim/{id}/approve

Auth: admin

Body: `{}`, or optionally `{ "reviewer_notes": "GBP listing matched exactly." }`
— no field is required, approval is a state transition, but
`reviewer_notes` isn't reject-only (see `docs/DATA_MODEL.md`
"claim_request" field-naming note).

Effect: sets `restaurant_brand.owner_id = <claimant>`,
`is_claimed = true`, `claimed_at = now()`. Audit: `audit_log` row
(`table_name="restaurant_brand"`, `action="update"`).

Response: `200`, updated claim shape (`status: "approved"`).

### POST /claim/{id}/reject

Auth: admin

Body: `{ "reviewer_notes": "Document did not match listing address." }`

Response: `200`, updated claim shape (`status: "rejected"`).

---

## Listing reports (`/reports`)

A public "Report a problem / suggest an update" flow so any visitor can
flag wrong listing info (wrong address, closed, wrong hours, ...). Backed
by `listing_report` (`docs/DATA_MODEL.md` "listing_report", migration
`20260918_0006_listing_report.py`). A report never edits listing data —
it lands in an admin triage queue and an admin fixes the listing through
the normal, audited endpoints.

### POST /reports

Auth: **PUBLIC** — no token required (one of the few public routes; see
`backend/CLAUDE.md` "Public Routes"). If a valid Cognito token is sent,
the report is attributed to that `sub` (`reporter_user_id`); a
present-but-invalid token still returns `401`, same as every other
optional-auth route.

Body:
```json
{
  "brand_id": 123,
  "location_id": 456,
  "category": "address_incorrect",
  "details": "They moved across the street to 123 Main St.",
  "reporter_email": "visitor@example.com",
  "website": ""
}
```
- `category`: `address_incorrect` | `hours_incorrect` | `phone_incorrect`
  | `price_incorrect` | `menu_incorrect` | `permanently_closed` | `other`.
- `details`: required, trimmed, 1-2000 chars.
- `location_id`: optional; must belong to `brand_id` (else `400`
  `invalid_location`).
- `reporter_email`: optional, max 254 chars, simple `a@b.c` shape check
  (blank string is treated as omitted). Used only for a manual admin
  follow-up; never shown publicly.
- `website`: **honeypot** — the UI renders it hidden; real users leave it
  empty. Any non-empty value returns the normal `201` below but stores
  nothing.

Response: `201`
```json
{ "status": "received" }
```
Deliberately minimal and identical for a stored report and a discarded
honeypot hit (no id, no echo). Errors: `404 not_found` (unknown
`brand_id`), `400 invalid_location`, `422 validation_error` (bad
category, blank/oversized `details`, malformed email).

**Anti-abuse — what exists and what does not:** honeypot + strict
length limits only, on top of API Gateway's stage-level throttling.
Per-IP rate limiting and CAPTCHA are **not built** (flagged decision —
add if spam appears; the blast radius is admin-queue noise, not
corrupted listings).

### GET /reports

Auth: admin only. Query: `status` (optional; `new` | `resolved` |
`dismissed`, else `422`), `page`, `page_size` (default 20, max 100).

Ordering: `status=new` is **oldest-first** (triage queue); every other
view (no filter, `resolved`, `dismissed`) is newest-first.

Response: `200`
```json
{
  "results": [
    {
      "report_id": 1,
      "brand_id": 123,
      "brand_name": "Spice Route",
      "brand_slug": "spice-route",
      "location_id": 456,
      "location_address": "100 Main St, Irving, TX 75038",
      "category": "address_incorrect",
      "details": "They moved across the street.",
      "reporter_email": "visitor@example.com",
      "reporter_user_id": null,
      "status": "new",
      "submitted_at": "2026-09-18T10:00:00Z",
      "reviewed_by": null,
      "reviewed_at": null,
      "reviewer_notes": null
    }
  ],
  "page": 1,
  "page_size": 20,
  "total": 1
}
```

### PATCH /reports/{id}

Auth: admin only.

Body: `{ "status": "resolved", "reviewer_notes": "Updated the address." }`
— `status` required (`new` | `resolved` | `dismissed`), `reviewer_notes`
optional (max 2000; omitted = unchanged). Moving to `resolved`/`dismissed`
stamps `reviewed_by`/`reviewed_at`; moving back to `new` clears them.

Response: `200`, the report shape above. `404` for an unknown id.

---

## Auth (`/auth`)

Cognito itself issues and refreshes JWTs directly to the frontend
(Hosted UI or SDK) — root CLAUDE.md "Auth: AWS Cognito"; this backend
never issues, stores, or validates passwords (root CLAUDE.md "NEVER
store passwords — Cognito handles all auth"). The two routes below
cover only what the backend itself needs: reading the caller's
identity off a validated JWT, and lazily provisioning the local
`owner_account` row the first time a Cognito "owner" group user is
seen (Cognito has no concept of our `owner_account` table).

### GET /auth/me

Auth: any authenticated user

Response:
```json
{
  "cognito_sub": "us-east-1:abc-123",
  "role": "owner",
  "email": "owner@example.com",
  "owner_account": {
    "id": 55,
    "full_name": "Priya Rao",
    "phone": null,
    "stripe_customer_id": null
  }
}
```
`phone` added 2026-09-17 (was previously accepted by `PATCH /auth/me` but
never returned by `GET /auth/me`, so the account page's edit form could
never pre-fill it — a real, fixed gap, not a deliberate omission).
`owner_account` is `null` for `manager`/`admin`/`registered_user` roles
(they have no local business record in this schema — see
`docs/DATA_MODEL.md`'s identity note). For an `owner`-group user with
no existing `owner_account` row yet, the service layer creates one on
first call (`cognito_sub` + `email` from the JWT claims) rather than
requiring a separate signup-sync step.

### PATCH /auth/me

Auth: any authenticated user (changed — was `owner`-only; see
docs/PROJECT_PLAN.csv "Broaden PATCH /auth/me beyond owner-only". The
owner-only gate was an oversight from when this route was first built with
only owner accounts in mind, not a deliberate restriction — `GET /auth/me`
already worked for every role.)

Body: `{ "full_name": "Priya Rao", "phone": "+14695559876" }`

Updates the caller's own `owner_account` row only — no `owner_id` in
the body, it's always the authenticated caller (root CLAUDE.md
"Permission model" — never trust a client-supplied identity for a
write that should be self-scoped). Same lazy-provisioning as `GET
/auth/me`: an `owner`-role caller's first-ever write creates their
`owner_account` row rather than 404ing.

Response for an `owner` caller: `200`, `owner_account` shape from `GET
/auth/me`.

Response for `manager` / `admin` / `registered_user`: `404`,
`{"detail": "...", "code": "no_editable_profile"}` — deliberately NOT the
old `403`. It is not a permissions problem (every authenticated role may
call this route); those three roles simply have no local profile record
in this schema to write to today (only `owner_account` has
`full_name`/`phone` — see `docs/DATA_MODEL.md`'s identity note and
`backend/app/models/` — there is no manager/admin/registered_user profile
table). If those roles ever need editable name/phone, the honest home for
it is Cognito attributes (`given_name`/`family_name`/`phone_number`) via a
frontend Amplify/Cognito `updateUserAttributes` call, not a write through
this endpoint — out of scope for this fix; adding a new Postgres table for
it is a schema decision for Architect, not something invented here
unilaterally.

---

## Privacy (CCPA data export / deletion)

Closes the tracked Phase 1 gap in `docs/PROJECT_PLAN.csv` ("CCPA data
export / deletion flow") — BRD v3.6 sections 7/12 require "CCPA
compliant. Users can request data export and deletion," with no further
detail. See `docs/DECISIONS.md` "CCPA data export/deletion" for the full
reasoning behind every choice below (scope, sync vs. async, review queue
vs. instant execution, what's redacted vs. retained vs. hard-deleted) —
summarized here only as much as the contract itself needs.

Scope: this app's own database only. Cognito's own account (login email,
password, MFA, the account itself) is a separate system and explicitly
out of scope — see DECISIONS.md for why. "Your data" means every row
across the schema keyed to your Cognito `sub`, not just the table(s)
matching your current role.

### GET /auth/me/data-export

Auth: any authenticated user (own data only — there is no `user_id`
parameter; the caller is always resolved from their own JWT, same
posture as `PATCH /auth/me`)

Synchronous — returns the full export directly as JSON, `200`. No async
job, no email delivery (see DECISIONS.md for why this is the right call
for Phase 1). Read-only: unlike `GET /auth/me`, this never lazily
provisions an `owner_account` row as a side effect of the request.

Response: `200`
```json
{
  "cognito_sub": "us-east-1:abc-123",
  "role": "owner",
  "email": "owner@example.com",
  "generated_at": "2026-09-16T10:00:00Z",
  "owner_account": {
    "id": 55,
    "cognito_sub": "us-east-1:abc-123",
    "email": "owner@example.com",
    "full_name": "Priya Rao",
    "phone": "+14695551234",
    "stripe_customer_id": null,
    "created_at": "2026-09-01T10:00:00Z",
    "personal_data_deleted_at": null
  },
  "location_manager_assignments": [
    { "location_id": 42, "is_active": true, "assigned_at": "2026-09-01T10:00:00Z", "revoked_at": null }
  ],
  "follows": [
    { "brand_id": 123, "followed_at": "2026-09-05T10:00:00Z" }
  ],
  "claim_requests": [
    { "claim_id": 789, "brand_id": 123, "status": "approved", "proof_method": "google_business_profile", "submitted_at": "2026-09-01T10:00:00Z", "reviewed_at": "2026-09-02T10:00:00Z" }
  ],
  "audit_log_entries": [
    { "table_name": "restaurant_brand", "record_id": 123, "action": "update", "actor_role": "owner", "created_at": "2026-09-10T10:00:00Z" }
  ],
  "notice": "This export covers personal data held directly by this app ... audit_log_entries are retained even after a data-deletion request, for legitimate business and legal record-keeping purposes."
}
```
`owner_account` is `null` if the caller has no local business record
(same condition as `GET /auth/me`). `audit_log_entries` covers actions
the caller themselves performed (`actor_id` match) — included for
transparency, but per `notice` and DECISIONS.md, these are NOT touched
by a data-deletion request.

### POST /auth/me/data-deletion

Auth: any authenticated user (own data only)

Body: `{ "reason": "no longer using the app" }` — `reason` is optional,
never required.

Creates a **request**, not an immediate deletion — see DECISIONS.md for
why Phase 1 uses an admin-reviewed queue (modeled on the existing
`/claim` flow) rather than instant self-service execution. At most one
`pending_review` request per identity at a time (partial unique index,
same pattern as `claim_request`) — a second `POST` while one is already
pending returns `409 deletion_already_pending`.

Response: `201`
```json
{
  "request_id": 12,
  "status": "pending_review",
  "requester_role": "registered_user",
  "reason": "no longer using the app",
  "data_scope": { "owner_account": 0, "location_manager_assignments": 0, "follows": 3, "claim_requests": 0, "claim_requests_pending": 0, "audit_log_entries": 0 },
  "submitted_at": "2026-09-16T10:00:00Z",
  "reviewed_at": null,
  "reviewer_notes": null,
  "completed_at": null
}
```
`data_scope` is a row-count snapshot at submission time, for the admin
reviewer's visibility — not re-read at approval time (approval
recomputes live counts).

### GET /auth/me/data-deletion

Auth: any authenticated user (own requests only)

Query params: `page`, `page_size` (default 20, max 100 — backend/
CLAUDE.md "ALWAYS include pagination on list endpoints").

Response: `200`, same paginated shape as `GET /auth/me/follows`:
```json
{ "results": [ { "request_id": 12, "status": "pending_review", "...": "..." } ], "page": 1, "page_size": 20, "total": 1 }
```

### GET /data-deletion/{id}

Auth: the requester (own request only) or admin (any request) — same
permission shape as `GET /claim/{id}`.

Response: same shape as `POST /auth/me/data-deletion`'s response.

Errors: `404 not_found` (unknown id), `403 forbidden` (not the requester
and not admin).

### POST /data-deletion/{id}/approve

Auth: admin

Body: `{}`, or optionally `{ "reviewer_notes": "verified, executing" }`.

Effect: executes the actual redaction/deletion in one transaction (see
`docs/DATA_MODEL.md` "data_deletion_request" for exactly what happens to
each table), then sets `status: "completed"`, `reviewed_by`,
`reviewed_at`, `completed_at`. Writes `audit_log` entries for the
`location_manager`/`owner_account` rows it changes (both on root
CLAUDE.md's audit-required table list) — not for `user_follow` (hard-
deleted) or `claim_request` (redacted only), neither of which is on that
list.

Response: `200`, updated request shape (`status: "completed"`).

Errors:
| Status | Code | When |
|---|---|---|
| 404 | `not_found` | unknown id |
| 409 | `request_not_pending` | request is not `pending_review` (already completed/rejected) |
| 409 | `pending_claim_blocks_deletion` | this identity has a `pending_review` `claim_request` — resolve it via `/claim/{id}/approve` or `/claim/{id}/reject` first |

### POST /data-deletion/{id}/reject

Auth: admin

Body: `{ "reviewer_notes": "Active fraud investigation — legal hold." }`
— `reviewer_notes` required (same posture as `POST /claim/{id}/reject`).

Effect: `status: "rejected"`. No data is touched.

Response: `200`, updated request shape (`status: "rejected"`).

## Admin (bulk operations)

Added alongside PR #74 (`app/routers/admin.py`) — the first endpoint under
a dedicated `/admin` prefix rather than living inside another resource's
own router, since it doesn't act on one existing `restaurant_brand`/
`restaurant_location` id the way the admin-gated actions elsewhere in this
doc do (`DELETE /restaurants/{id}`, `POST /claim/{id}/approve`, etc.) —
it creates many new brand/location rows in one call instead.

### POST /admin/restaurants/bulk-import

Auth: admin

Body:
```json
{
  "owner_id": 42,
  "restaurants": [
    {
      "name": "Namaste Grill & Sports Bar",
      "description": null,
      "address_line1": "2234 W Walnut Hill Ln",
      "address_line2": null,
      "city": "Irving",
      "state": "TX",
      "postal_code": "75038",
      "country": "US",
      "phone": null,
      "timezone": "America/Chicago",
      "latitude": 32.8651921,
      "longitude": -96.9763165,
      "is_verified": true
    }
  ]
}
```
`restaurants`: 1–500 rows per call. `owner_id` names the local
`owner_account.id` every row in the batch is created under — every row
shares the same owner (this endpoint does not accept a per-row owner).

Effect: creates one `restaurant_brand` + one `restaurant_location` per
row (see `app/services/restaurant_bulk_import_service.py` for the exact
idempotent create-or-skip logic: slug natural key for the brand,
`(brand_id, address_line1)` for the location — re-running the same batch
creates zero duplicates). One malformed/conflicting row does not abort
the rest of the batch; it's reported as a per-row `error` instead.
`audit_log` entries are written for every created brand/location.

Response: `200`
```json
{
  "created": 1,
  "skipped": 0,
  "errors": 0,
  "rows": [
    { "index": 0, "name": "Namaste Grill & Sports Bar", "status": "created", "brand_id": 101, "location_id": 501, "detail": null }
  ]
}
```
`rows[].status` is one of `created` | `skipped` | `error`. `detail` is
null for `created`, a short human-readable reason for `skipped` (already
existed) or `error` (validation failure, or a slug collision with a
different owner's existing brand).

Errors:
| Status | Code | When |
|---|---|---|
| 403 | `forbidden` | caller is not admin |
| 404 | `not_found` | `owner_id` does not match any `owner_account` row |
| 400 | `bulk_import_failed` | batch-level problem (empty `restaurants` list, or over the 500-row cap) — distinct from a per-row `error` entry in a 200 response |
| 422 | `validation_error` | request body itself fails schema validation (e.g. `restaurants` missing) |

### CSV bulk restaurant import (management command, not HTTP)

Added for the CSV bulk-import feature (docs/PROJECT_PLAN.csv "CSV bulk
restaurant import", docs/DECISIONS.md same title). Unlike everything else
in this document, this is **not** a FastAPI/HTTP route — it's a second
input shape on the existing `bulk_import_restaurants` **management
command** (`app/scripts/management.py`, invoked directly via `aws lambda
invoke`, bypassing API Gateway entirely — see that file's own module
docstring for why this dispatch style exists and its IAM-only trust
boundary). Human-run via `scripts/bulk_import_restaurants_csv.py`
(`backend`/`app/scripts` vs. top-level `scripts/` distinction: see
`scripts/README.md`).

**Why this is a management command, not a new HTTP endpoint:** the JSON
path already lives at `POST /admin/restaurants/bulk-import`, but the CSV
path's actual admin-facing tool is a local file plus a human running a
script — there's no browser/frontend caller for it (unlike the JSON
path's implied "admin panel" shape), and keeping it off HTTP entirely
avoids API Gateway payload-size limits for a large CSV. Extends the same
underlying command/service rather than forking a new one — see
`app/services/restaurant_bulk_import_service.py`'s "CSV import path"
docstring section for the full reasoning, including why geocoding does
NOT happen inside this Lambda (no NAT Gateway -- no route to the public
internet at all).

Invoke payload:
```json
{
  "_management_command": "bulk_import_restaurants",
  "csv_content": "name,description,website,address_line1,address_line2,city,state,postal_code,country,phone,type,owner_email,latitude,longitude\nNamaste Grill,,https://example.com,2234 W Walnut Hill Ln,,Irving,TX,75038,US,+12145550100,south indian,owner@example.com,32.8651921,-96.9763165\n"
}
```
`csv_content` on the same `bulk_import_restaurants` command wins over
`restaurants` if both are present (see `management.py`'s docstring).

**CSV column headers** (human-facing file `scripts/bulk_import_restaurants_csv.py`
reads, before it geocodes and adds `latitude`/`longitude` itself):

| Column | Required | Notes |
|---|---|---|
| name | yes | |
| address_line1 | yes | |
| city | yes | |
| state | yes | 2-letter |
| postal_code | yes | |
| owner_email | yes | Resolves an EXISTING `owner_account` — a typo'd email is a per-row error, never auto-provisioned |
| address_line2 | no | |
| country | no | Defaults `US` |
| phone | no | |
| website | no | See docs/DATA_MODEL.md "restaurant_brand" |
| description | no | |
| type | no | Free-text cuisine, e.g. "south indian" — matched case-insensitively against `cuisine_tag.name`/`display_name`; no match is reported per-row, not a failure |
| latitude / longitude | no | Added by `scripts/bulk_import_restaurants_csv.py` after geocoding via Nominatim — left blank in the file a human authors by hand |

Effect: same idempotent create-or-skip brand/location logic as the JSON
path (slug natural key for the brand, `(brand_id, address_line1)` for the
location), but `owner_id` is resolved **per row** from `owner_email`
instead of once for the whole batch, and a matched `type` links a
`restaurant_cuisine` row (also idempotent — re-running doesn't duplicate
the link).

Response (Lambda invoke result payload):
```json
{
  "ok": true,
  "command": "bulk_import_restaurants",
  "summary": { "created": 1, "skipped": 0, "errors": 0 },
  "rows": [
    {
      "index": 0,
      "name": "Namaste Grill",
      "status": "created",
      "brand_id": 101,
      "location_id": 501,
      "detail": null,
      "cuisine_type_input": "south indian",
      "cuisine_match": "south_indian"
    }
  ]
}
```
`cuisine_type_input` is the raw `type` cell (`null` if the row didn't
supply one). `cuisine_match` is the matched `cuisine_tag.name`, or `null`
if `cuisine_type_input` was supplied but nothing matched — the row still
imports (`status: "created"`), just without a cuisine tag.

Errors: `{"ok": false, "command": "bulk_import_restaurants", "error": "..."}`
for a batch-level problem (no header row, a required column entirely
missing, zero data rows, or over the 500-row cap) — same
per-row-vs-batch-level split as the JSON path.

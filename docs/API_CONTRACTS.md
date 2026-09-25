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
free tier", "Photo gallery: 2 photos free, 10 photos paid"):** the menu
(with prices) is a free-tier feature served by its own public endpoint,
`GET /locations/{id}/menu` (see "Menu (`menu_section`, `menu_item`)"
below, added 2026-09-24) — it is deliberately NOT embedded in `GET
/locations/{id}`. Photo *response fields* are modeled below (`cover_photo_url`,
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
| cuisine[] | string[], optional | `cuisine_tag.name` values, category=`regional` (also usable for `signature`/`dining_time` slugs). **Tags are per location** (2026-09-24): every `cuisine[]`/`dietary[]`/`type[]` facet is evaluated against each candidate LOCATION's own tags — only locations that themselves carry a matching tag are candidates, so a sibling branch without the tag is never the card's `nearest_location` (nor counted in `location_count_nearby`) for that filter. |
| dietary[] | string[], optional | `cuisine_tag.name` values, category=`dietary` |
| type[] | string[], optional | `cuisine_tag.name` values, category=`type` |
| q | string, optional, max 100 | Free-text search: case-insensitive substring match on the restaurant (brand) **name** (all of that brand's locations match), or a cuisine tag whose name/display name **exactly** equals the text (only the LOCATIONS carrying that tag match) (case-insensitive; never a tag substring, to keep results precise). **Added 2026-09-19** (user request: search should match restaurant names). When `q` is present the radius and coordinates are NOT required -- a name search finds the restaurant wherever it is, including locations that failed geocoding; those come back with `nearest_location.distance_mi: null` and sort after located results. Still combinable with `cuisine[]`/`dietary[]`/`type[]` (AND). |
| page | int, optional, default 1 | |
| page_size | int, optional, default 20, max 100 | |
| loc | string, optional | **Added 2026-09-23** (activity tracking). The location text the user typed (city/ZIP), used ONLY for a signed-in `registered_user`'s search-history entry (clipped to 100 chars there); never affects results (`lat`/`lng` do). Deliberately no `max_length` — an over-long value is truncated when recorded rather than turning a public search into a 422. |
| has_deals_today | bool, optional | **Added 2026-09-23** (deals engine). When `true`, only brands with **at least one candidate location** (within the current radius/cuisine/dietary/type/q filter set — not just the nearest one shown on the card) that has an active deal matching today are returned. See `docs/DECISIONS.md` "Deals: public boolean signal, gated content". |

Note: `open_now` is deliberately **not** a query param here — deferred
to Phase 3 (DECISIONS.md "Restaurant hours").

**Auth / activity recording (added 2026-09-23):** the endpoint stays public
and its response never depends on the caller. If a valid bearer token for a
`registered_user` is presented, the search is additionally recorded in that
user's activity history (see "Activity tracking (`/activity`)" below) —
**page 1 only**, and only when the search carried at least one criterion
(`q`, a tag filter, `loc` or `has_deals_today`). Anonymous, owner, manager
and admin callers record nothing. An invalid/expired token is treated as
anonymous (never a 401 here), and any failure while recording is swallowed:
recording can never fail or change the search response.

Response:
```json
{
  "results": [
    {
      "brand_id": 123,
      "name": "Spice Route",
      "slug": "spice-route",
      "is_claimed": true,
      // The NEAREST location's own tags (tags are per location, 2026-09-24).
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
        "is_closed": false,
        "has_deal_today": false
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
- `nearest_location.has_deal_today` (added 2026-09-23) — public,
  content-free "badge" signal for the **nearest** location shown on this
  card only (not "any location of this brand" — that broader condition
  is what `has_deals_today` filters on above). `true`/`false` for every
  caller, including anonymous; never accompanied by deal title/
  description here — see `GET /locations/{id}`'s `deals_today` for the
  content-gated array. `docs/DECISIONS.md` "Deals: public boolean
  signal, gated content".

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
portal's tag pickers (`POST /locations` `cuisine_tag_ids`,
`PUT /locations/{id}/cuisine-tags`) need to resolve against.

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
stays intact for any location still linked to it via `location_cuisine`.

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

**Filters added 2026-09-22 for the admin listings management page
(`/admin/listings`)** — `owner_email`, `name`, `status`, `is_paid`,
`city`, `is_claimed`. Every one of these follows the exact same
admin-only, silently-ignored-for-an-owner-caller rule as `owner_id`
above: an owner caller's result stays "my own brands," full stop, no
matter what any of these params say. All provided filters (including
`owner_id`) combine with **AND** — same independent-facets convention as
`GET /search`'s `cuisine[]`/`dietary[]`/`type[]` (see that section
above); there is no OR-within-a-filter case here since every param below
is single-valued, unlike `/search`'s array facets.

Query params:
| Param | Type | Notes |
|---|---|---|
| owner_id | int, optional | **Admin only** — ignored (never applied) for an owner caller, who is always filtered to their own `owner_id` regardless of this param. Omitted for an admin caller returns all brands. |
| owner_email | string, optional, max 255 | **Admin only.** Case-insensitive substring match against the brand owner's `owner_account.email`. A brand with no owner (unclaimed, `owner_id IS NULL`) never matches a non-empty `owner_email`. |
| name | string, optional, max 255 | **Admin only.** Case-insensitive substring match against `restaurant_brand.name`. |
| status | string, optional | **Admin only.** One of `active` / `owner_deactivated` / `coming_soon` / `closed_pending_reopen` (`restaurant_location.status`, see app/models/restaurant_location.py "Location status lifecycle") or the pseudo-value `deleted`; 422 on any other value. **Matches a brand if ANY of its locations currently has this status** — a brand with one `active` and one `coming_soon` location matches `status=coming_soon`. **`status=deleted`** (added 2026-09-23) returns ONLY soft-deleted brands (`restaurant_brand.deleted_at IS NOT NULL`); every other request — every owner request, and an admin request with any other/no `status` — **excludes** soft-deleted brands. |
| is_paid | bool, optional | **Admin only.** JUDGMENT CALL: **matches a brand if ANY of its locations has this `is_paid` value** — same "any location" rule as `status`/`city` here, chosen for consistency rather than requiring every location to match (a multi-location brand with one paid and one free location matches both `is_paid=true` and `is_paid=false`). |
| city | string, optional, max 120 | **Admin only.** Case-insensitive **exact** match (not substring — deliberately stricter than `name`/`owner_email`, since city names are short, well-known values an admin types precisely, not a fuzzy search) against `restaurant_location.city`. JUDGMENT CALL: **matches a brand if ANY of its locations is in that city** — a brand can have locations in multiple cities (e.g. Plano and Dallas); filtering by `city=plano` returns it, and so does `city=dallas`, same as `status`/`is_paid` above. |
| is_claimed | bool, optional | **Admin only.** Exact match against `restaurant_brand.is_claimed` (brand-level field, no "any location" ambiguity). |
| sort | string, optional | **Not admin-only** (unlike every filter above) — available to any caller of this endpoint. Added 2026-09-22 for the admin listings "Most followed" sort control. Omitted keeps the existing default order (`id` ascending, unchanged). `followers` orders by `follower_count` descending, ties broken by `id` ascending; 422 on any other value. |
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
      "location_count": 3,
      "follower_count": 12,
      "deleted_at": null
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
avoids Frontend Dev maintaining two brand card types. **One deliberate
exception: `follower_count`.** Added 2026-09-22 (dashboard-only stat —
"show the number of followers ... on their dashboard only ... not
visible to diners or other owners"): a real, non-null count of
`user_follow` rows for the brand here, but always `null` on the public
`GET /restaurants/{id}` below, regardless of who's asking (including the
owning owner themselves — the public detail endpoint has no
current-caller awareness at all). See
`backend/app/services/restaurant_service._caller_may_view_follower_count`
for the exact gating: `current_user is not None and current_user.role in
("owner", "admin")`, and every call site that passes a real
`current_user` has already been through an ownership check upstream
(this list's own `owner_id` filter, or `require_owner`/
`require_brand_write_access` on the create/update endpoints below) —
there is no separate per-brand re-check here.

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
  "has_pending_claim": false,
  "owner_id": 55,
  "cuisine_tags": [
    { "id": 7, "name": "hyderabadi", "display_name": "Hyderabadi", "category": "regional" }
  ],
  "location_count": 3,
  "follower_count": null
}
```
**`cuisine_tags` is a derived summary (2026-09-24 — tags are per location):** a
brand has no tags of its own; this is the distinct UNION of its locations'
tags. Public callers (`GET /restaurants/{id}`, `/by-slug/{slug}`, the location
page's `restaurant`) see the union over ACTIVE locations only — a hidden or
still-in-setup branch never advertises its tags; the owner-scoped and admin
`GET /restaurants` list and the owner's own create/update responses take the
union over ALL the brand's locations. For a specific branch use that location's
own `cuisine_tags` (`GET /locations/{id}`, the by-slug landing cards,
`GET /restaurants/{id}/locations`).
`website` is `null` when not set -- added alongside the CSV bulk-import
feature (docs/DATA_MODEL.md "restaurant_brand" judgment call: brand-level,
not location-level). `owner_id` is `null` for unclaimed listings (still visible, per
DECISIONS.md "Claim flow" — the frontend renders a "Claim this
listing" CTA when `is_claimed` is `false`).
`has_pending_claim` is `true` while a `claim_request` for the brand is in
`pending_review` (boolean only, no claimant detail). The frontend then hides the
claim CTA from everyone and shows admins a "Claim pending review" marker.
`follower_count` is **always `null` on this public route** — see the
dashboard-only note on `GET /restaurants` above. This route has no auth
dependency at all, so there's no caller identity to gate on even in
principle; the real count is only ever exposed via `GET /restaurants`.

### Location slugs and by-slug lookups (added 2026-09-24 — "Location pages")

Every `restaurant_location` has its own public page slug, **unique per brand**
(`unique (brand_id, slug)`), so a location's page is
`/restaurant/{brand_slug}/{location_slug}` (hours, deals, menu and address
differ per branch). Additive: every location payload below gained `slug`
(and, where it has no brand object next to it, `brand_slug`):

- `slug` — **server-generated at create time, read-only, never changes**
  (an address edit does not touch it, so shared links never break).
  Rule: slugified city (`irving`); if that is taken within the brand (or is a
  reserved word: `report`, `new`, `edit`, `admin`, `api`, `menu`, `deals`,
  `locations`, `location`, `reports`), city + street without the trailing
  street-type word (`irving-2234-w-walnut-hill`); if still taken, `-2`, `-3`…
  URL-safe lowercase ASCII, max 100 chars. Not accepted on `POST`/`PATCH`
  (unknown body fields are ignored). Generated by `POST /locations`, the CSV
  bulk import and the dev seed script; existing rows were backfilled by
  migration `0014_location_slug` with the same rule.
- Where it appears: `LocationOut` (`GET /locations/{id}`, `POST`/`PATCH
  /locations`, status changes: `slug` + `brand_slug`), `LocationSummary`
  (`GET /restaurants/{id}/locations`: `slug`), search results and follow
  items' `nearest_location` (`slug`), `GET /auth/me/managed-locations`
  (`slug` + `brand_slug`), reopen-request queue rows and report rows
  (`location_slug`).

#### GET /restaurants/by-slug/{brand_slug}

Auth: none (public). The brand plus its **ACTIVE** locations in one round trip
(what `/restaurant/{brand_slug}` renders from). 404 for an unknown or
soft-deleted brand (admins included — same as `GET /restaurants/{id}`).
A brand with no active location still returns 200 with `locations: []`.

Response: every `GET /restaurants/{id}` field (`follower_count` always `null`;
`location_count` = number of active locations) plus:
```json
{
  "locations": [
    {
      "location_id": 41, "slug": "irving", "location_name": null,
      "distance_mi": null,
      "address_line1": "2234 W Walnut Hill Ln", "city": "Irving", "state": "TX", "postal_code": "75038",
      "phone": "+19725550142", "is_verified": true, "is_paid": false,
      "is_open_now": true, "open_time": "11:00:00", "close_time": "22:00:00", "is_closed": false,
      "has_deal_today": true,
      "cover_photo_url": "https://.../c.jpg", "cover_photo_thumbnail_url": "https://.../t.jpg",
      "cuisine_tags": [ { "id": 7, "name": "hyderabadi", "display_name": "Hyderabadi", "category": "regional" } ]
    }
  ]
}
```
`cuisine_tags` (additive, 2026-09-24) is THAT location's own tags — each branch
shows its own on the landing page. Each card is the `/search` `nearest_location` shape (today's hours inputs in
the location's own timezone, `has_deal_today` from the same predicate as
`/search` — boolean only, no deal titles) plus `location_name` and the cover
photo. Hidden locations (any non-`active` status) never appear. Ordered by
city (case-insensitive), then id. Batched: constant query count regardless of
how many locations.

#### GET /restaurants/by-slug/{brand_slug}/locations/{location_slug}

Auth: optional (`Authorization: Bearer` when signed in). One round trip for a
location profile page: `{ "restaurant": <GET /restaurants/{id} payload>,
"location": <GET /locations/{id} payload> }`. **Exactly the visibility and
deal-content gating of `GET /locations/{id}`** (it is the same code path once
the slug pair is resolved): 404 for an unknown pair, a location slug that
belongs to a different brand, a soft-deleted brand (admin excepted), or a
hidden location for a caller who is not its owner/admin/assigned manager.
`restaurant.location_count` is the ACTIVE-location count — the page uses it to
pick its canonical URL (1 active location -> the short brand URL).

Both routes are registered before `GET /restaurants/{id}` so the literal
`by-slug` segment is never read as an id or slug.

#### GET /sitemap/locations

Auth: none (public). Paginated (default 20, max 100) index of every ACTIVE
location of every live brand, ordered by (brand id, location id), for
`sitemap.xml`:
```json
{ "results": [ { "brand_slug": "namaste-grill", "location_slug": "irving",
                 "active_location_count": 2, "updated_at": "2026-09-24T12:00:00Z" } ],
  "page": 1, "page_size": 20, "total": 1 }
```
`active_location_count` = the brand's active locations (window count — correct
across page boundaries): `1` -> the canonical URL is `/restaurant/{brand_slug}`;
`2+` -> `/restaurant/{brand_slug}` (landing) and
`/restaurant/{brand_slug}/{location_slug}`.

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
      "status": "active",
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

`status` added 2026-09-22 alongside the location status lifecycle (see
`app/models/restaurant_location.py` "Location status lifecycle" and
`docs/DECISIONS.md` "Location status lifecycle") — one of `active` |
`owner_deactivated` | `coming_soon` | `closed_pending_reopen`. `is_active`
stays on this response too, unchanged in meaning: it's now a derived
`true` only when `status == "active"`, so existing callers reading the
boolean keep working without a code change.

**Owner/admin see their own non-active locations here too (added
2026-09-17, extended 2026-09-22 from the single `is_active=false` state to
all three hidden statuses):** this endpoint stays public by default and
filters to `status="active"` only for an anonymous caller (or any
authenticated caller who is not this brand's owner and not an admin) —
that behavior is unchanged. If the request carries a valid bearer token
AND the caller is either an admin, or an owner who owns `restaurant_brand
{id}`, the `status` filter is dropped entirely and the response also
includes that brand's `owner_deactivated`/`coming_soon`/
`closed_pending_reopen` locations. A manager or `registered_user` caller,
and an owner who does not own this brand, still only sees active
locations, same as a public caller — a manager's own visibility into a
*specific* hidden location they're assigned to is instead handled by
`GET /locations/{id}` below, not this list.

### POST /restaurants

Auth: owner

Body:
```json
{
  "name": "Spice Route",
  "description": "Hyderabadi biryani specialists since 2010.",
  "website": "https://spiceroute.example.com"
}
```
`website` is optional. (`cuisine_tag_ids` was removed 2026-09-24: tags are per
location — set them on `POST /locations` / `PUT /locations/{id}/cuisine-tags`.
A client still sending the key is ignored, not rejected.) Creates a brand owned by the authenticated owner (`is_claimed=true`,
`owner_id=<self>`, `slug` server-generated from `name`). This is
distinct from the claim flow, which attaches an *existing*,
admin-seeded, unclaimed brand to an owner instead of creating a new
row — see `POST /claim`.

Response: `201`, same shape as `GET /restaurants/{id}` — **except**
`follower_count`: this response is `POST`ed by the owner who just
created their own brand, so it comes back a real number (`0`, for a
brand-new brand) rather than the `null` the public detail endpoint
always returns, same dashboard-caller gating as `GET /restaurants`.

Audit: writes an `audit_log` row (`table_name="restaurant_brand"`,
`action="create"`) per root CLAUDE.md "ALWAYS — Quality".

### PATCH /restaurants/{id}

Auth: owner (must own the brand) or admin

Body: any subset of `{ name, description, website }` (`cuisine_tag_ids` removed
2026-09-24 — tags are per location; see `PUT /locations/{id}/cuisine-tags`).

Response: `200`, same shape as `GET /restaurants/{id}` — same
`follower_count` exception as `POST /restaurants` above: a real count,
not `null`, since the caller has already proven ownership (or admin) of
this exact brand via `require_brand_write_access`.

Audit: `audit_log` row (`action="update"`, `old_val`/`new_val`
populated).

### DELETE /restaurants/{id}

Auth: admin only

**SOFT delete (changed 2026-09-23 — was a hard delete that 409'd while any
location row existed).** Stamps the nullable `restaurant_brand.deleted_at`
(migration `0011_brand_deleted_at`) and, **in the same transaction**, sets
every `active` location of the brand to `owner_deactivated` (the freely
reversible self-service hidden status — `app/models/restaurant_location.py`
"Location status lifecycle"). Locations already hidden (`coming_soon`,
`owner_deactivated`, `closed_pending_reopen`) are left as they are — in
particular `closed_pending_reopen` must keep requiring an admin-approved
reopen. The `restaurant_brand` row is **kept**, so its slug stays reserved
and its audit/follower/claim history is intact. There is no 409
"locations attached" path anymore.

A soft-deleted brand and all its locations disappear from every public,
owner and manager read path:

| Surface | Behaviour once `deleted_at` is set |
|---|---|
| `GET /restaurants/{id}` (id or slug) | `404 not_found` |
| `GET /restaurants/{id}/locations` | `404` for everyone except an admin |
| `GET /locations/{id}` and every owner/manager location write (`PATCH`, hours, photos, status, managers, deals…) | `404` for owner/manager/anonymous; admin keeps access |
| `PATCH /restaurants/{id}` by the owner, `POST /locations` onto the brand | `404` |
| `GET /search` (geo + text) | excluded |
| `POST /restaurants/{id}/follow` | `404` |
| `GET /auth/me/follows` (favourites) | excluded from `results` **and** `total` (the follow row is kept, so a restore brings it back) |
| Owner `GET /restaurants`, manager `GET /auth/me/managed-locations` | excluded |
| Admin `GET /restaurants` | excluded by default; `status=deleted` lists only deleted brands (see above) |
| `POST /claim`, `POST /reports` | `404` |
| `GET /admin/overview` counts | excluded |
| Bulk import | a row whose slug matches a deleted brand is a per-row error (slug stays reserved) |
| Sitemap | drops out automatically (built from `GET /search`) |

**Idempotent:** deleting an already-deleted brand is a no-op `204` (no
second audit row, `deleted_at` is not re-stamped). `404` only for an id that
does not exist.

Response: `204 No Content`.

Audit (root CLAUDE.md "ALWAYS write an audit_log entry", actor = the
admin): one `restaurant_brand` row (`action="update"`, `old_val
{"deleted_at": null}`, `new_val {"deleted_at": <iso>, "locations_deactivated":
[<ids>]}`) plus one `restaurant_location` row per location actually changed
(`old_val {"status": "active"}`, `new_val {"status": "owner_deactivated",
"reason": "brand_deleted"}`).

`DELETE /locations/{id}/permanent` (below) is unchanged — it remains the
only real, irreversible row delete, and is still how an admin removes an
individual location for good.

### POST /restaurants/{id}/restore

Auth: admin only

Clears `restaurant_brand.deleted_at` (`204`-style idempotent: restoring a
live brand is a no-op that still returns `200` with the brand). The brand's
locations are **not** reactivated — they stay `owner_deactivated` (or
whatever they were) until re-enabled through their normal path
(`POST /locations/{id}/status`), so a restore never silently republishes
locations nobody has looked at. The slug is unchanged.

Response: `200`, same shape as `GET /restaurants/{id}` (with `follower_count`
populated, as for other admin/owner-scoped responses). `404` for an unknown
id. Audit: one `restaurant_brand` row (`action="update"`, `old_val
{"deleted_at": <iso>}`, `new_val {"deleted_at": null}`), only when the
brand was actually deleted.

---

## Locations (`restaurant_location`)

### GET /locations/{id}

Auth: none (public by default) — but caller-aware, see "Status-aware
visibility" below.

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
  "status": "active",
  "is_active": true,
  "cuisine_tags": [
    { "id": 7, "name": "hyderabadi", "display_name": "Hyderabadi", "category": "regional" }
  ],
  "is_open_now": true,
  "hours": [
    { "day_of_week": 0, "open_time": "11:00:00", "close_time": "22:00:00", "is_closed": false },
    { "day_of_week": 1, "open_time": "11:00:00", "close_time": "22:00:00", "is_closed": false }
  ],
  "cover_photo_url": null,
  "cover_photo_thumbnail_url": null,
  "gallery_photos": [],
  "has_deal_today": true,
  "deals_today": null,
  "upcoming_deals": null
}
```
Notes:
- `paid_until` and `is_active` (added 2026-09-17 — `docs/PROJECT_PLAN.csv`
  "Serialize paid_until/is_active on location endpoints + let owner see
  own deactivated locations") are real `restaurant_location` columns
  that were already stored but not previously serialized on this
  response. `paid_until` is `null` on the free tier (root CLAUDE.md "Tier
  model (is_paid)").
- `status` (added 2026-09-22, `docs/DECISIONS.md` "Location status
  lifecycle") — one of `active` | `owner_deactivated` | `coming_soon` |
  `closed_pending_reopen`. `is_active` is now a derived `true` only when
  `status == "active"` (a `hybrid_property` on the model, not a second
  stored column — see `app/models/restaurant_location.py`).
- `setup_missing` (added 2026-09-24 — "New manual listings start in setup"):
  `string[]`, what is still missing before this listing can be moved from
  `coming_soon` to `active` — any of `"name"` | `"address"` | `"phone"` |
  `"hours"`, in that order; `[]` when it's ready, and always `[]` for any
  status other than `coming_soon` (a listing not in setup never advertises
  gaps). Always present, computed from data already loaded (no extra
  query). Display-only: the same rules
  are re-checked by `POST /locations/{id}/status` (below), which is the
  enforcement. Rules (`backend/app/services/listing_readiness.py`): `name`
  = the brand has a non-blank name; `address` = street, city, state and ZIP
  non-blank; `phone` = the stored phone is a valid US number (a legacy
  non-US / free-text value counts as missing); `hours` = all 7 days have an
  explicit answer — closed, or open with both an open and a close time (a
  day with no row or `is_closed: null` counts as missing). Photos, About
  text and the menu are NOT required.

**Status-aware visibility (added 2026-09-22, closing a gap from the
2026-09-17 row above — this endpoint used to return a hidden location's
full detail to ANY caller regardless of status):** a non-`active`
location 404s (never 403 — a caller without rights can't distinguish
"doesn't exist" from "exists but hidden") UNLESS the caller is, per a
valid bearer token: the owning owner, an admin, or a manager with an
active `location_manager` assignment on this specific location. An
`active` location is visible to everyone, as before. Pass the caller's
access token whenever they might legitimately need their own hidden
location (see `frontend/src/lib/api/locations.ts` `getLocationById`'s
`accessToken` param) — omit it for a genuinely public/anonymous read.
- `hours` is all 7 `restaurant_hours` rows for this location, `day_of_week`
  0=Monday..6=Sunday (see `docs/DATA_MODEL.md` judgment-call note — a
  day with no seeded row yet is simply absent from the array, which the
  frontend should treat the same as `is_closed: null`).
- `is_open_now` is the computed display status (see `/search` notes) —
  `null` when the current day's `is_closed` is `null` (hours unknown).
- The menu is **not** in this response — read it from the separate public
  `GET /locations/{id}/menu` (see "Menu (`menu_section`, `menu_item`)").
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
- **Deals (added 2026-09-23 — deals engine, `docs/DECISIONS.md` "Deals:
  public boolean signal, gated content"):**
  - `has_deal_today` — `bool`, always populated for every caller
    including anonymous. `true` when this location has at least one
    active deal whose day pattern/date window matches today (in the
    location's own timezone). This is a "fact," never deal content.
  - `deals_today` — `null` when the caller may not view deal CONTENT
    (anonymous, public, or an authenticated caller with no relationship
    to this location); an array (possibly `[]`, exactly when
    `has_deal_today` is `false`) when they may — a signed-in
    `registered_user`, `admin`, or this location's own `owner`/an
    actively-assigned `manager`. Each entry is
    `{ id, deal_type, title, description }` — `deal_type` is `"deal"` or
    `"special"`, derived from `end_at` (no end date -> `"special"`, else
    `"deal"`; see "Deals (`deal`)" below). Distinguish "no deals
    today" (`[]`) from "content withheld" (`null`) — show the
    registration/sign-in prompt only for the `null` case when
    `has_deal_today` is `true`.
    **JUDGMENT CALL, unresolved (flagged for human confirmation):** this
    gate is caller-role-based only — it does NOT check
    `restaurant_location.is_paid`, which appears to conflict with root
    CLAUDE.md's "is_paid=false locations: ... deals ... are NOT returned
    by API" line. See `docs/DECISIONS.md`'s dedicated flagged entry for
    the full reasoning; not silently resolved either way.
  - `upcoming_deals` (added 2026-09-23, owner feedback — "show other
    active deals to the registered user") — the location's OTHER active
    deals: `is_active`, NOT applicable today, and NOT expired. That is
    recurring deals on other weekdays plus deals whose `start_at` is still
    in the future; a deal that will never occur again (e.g. Friday-only,
    `end_at` on Thursday) or whose `end_at` has passed is excluded. Exactly
    the same content gate as `deals_today`: **`null`** (never `[]`, never a
    count, no titles anywhere in the body) for anonymous/public callers, a
    different owner, or an unassigned manager; an array (possibly `[]`) for
    a signed-in `registered_user`, `admin`, the owning owner or an
    actively-assigned manager. `has_deal_today` and the sign-in CTA
    behaviour are unchanged. Each entry:
    `{ id, deal_type, title, description, applicable_days, start_at,
    end_at, next_occurrence }` — `applicable_days` `null` = every day
    (0=Monday..6=Sunday otherwise); `end_at` `null` = ongoing;
    `next_occurrence` is a `YYYY-MM-DD` date in the **location's**
    timezone, the next day the deal is offered. **Sorted** by
    `next_occurrence` ascending, then title (case-insensitive), then `id`
    ("what can I get next"). Computed from the same single deal query as
    `deals_today` (no extra round trip, no N+1). No `is_active` /
    `location_id` on entries (not a management view).

### POST /locations

Auth: owner (must own the parent brand — `restaurant_brand.owner_id == current_user.id`)
**or admin** (any non-deleted brand — opened to admin 2026-09-24 for the
"Add location" UI; this supersedes the 2026-09-17 "deliberately left
owner-only" note under "Platform admin full-access parity" below for this
route only — `POST /locations/{id}/managers` is still owner-only). A
manager gets `403`; an owner of a different brand gets `403`; a missing or
soft-deleted brand is `404`.

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
  "longitude": -96.6989,
  "cuisine_tag_ids": [7, 12]
}
```
`cuisine_tag_ids` (optional, added 2026-09-24 — tags are per location):
omitted/`null` -> the new location starts with a **copy of the tags of the
brand's first existing location** (lowest id; empty when it is the brand's
first location) so an owner adding a branch doesn't retype them; `[]` -> no
tags; a list -> exactly those (unknown/inactive ids ignored). The tag names go
into the create audit row's `new_val.cuisine_tags`.

New locations start `is_paid=false`, `is_verified=false` and — changed
2026-09-24, `docs/DECISIONS.md` "New manual listings start in setup" —
**`status="coming_soon"`** (hidden from the public everywhere; only
`active` is public), NOT `active`. This endpoint backs the Add-restaurant
and Add-location UI flows only: bulk import (`POST
/admin/restaurants/bulk-import`, the CSV command), the seed scripts and
claim approval build `RestaurantLocation` rows directly and keep their own
defaults (`active`). The owner/admin enters the required info (hours,
phone, address) and then activates the listing with `POST
/locations/{id}/status` — see below. The response carries
`setup_missing` (see `GET /locations/{id}`). The `create` audit row's
`new_val` includes `"status": "coming_soon"`.
`latitude`/`longitude` are geocoded client- or service-side before this
call; the service layer derives `geom` from them on write (see
`docs/DATA_MODEL.md` judgment-call note on `restaurant_location.geom`).

`phone` is **required** (added 2026-09-22, docs/PROJECT_PLAN.csv "Make
location phone required") — same standing as `address_line1`/`city`:
missing or blank -> `422`. It follows the ONE shared **US phone rule**
(`backend/app/core/phone.py normalize_us_phone`, mirrored by
`frontend/src/lib/phone.ts normalizePhone`; same case table in both test
suites — tightened 2026-09-24, see "US phone rule" under `PATCH /auth/me`):
formatting characters (spaces, dashes, dots, parentheses) and an optional
leading `+1` / `1` country code are accepted (`"(972) 555-0142"`,
`"9725550142"`, `"1 972 555 0142"`, `"+14695551234"`), exactly 10 digits
must remain and the area code and exchange must start with 2-9; anything
else — 11 digits without the `1`, another country code, letters,
extensions — is `422`. Stored normalised as `+1XXXXXXXXXX`. The DB column
(`restaurant_location.phone`) is **not** getting a `NOT NULL` migration —
it stays nullable so existing/imported rows with `phone IS NULL` (e.g. the
CSV bulk-import path, which builds `RestaurantLocation` directly and
never goes through this schema) are untouched; "required" is enforced
purely at this Pydantic layer, the standard lower-risk choice absent a
backfill.

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
value; omitting the key leaves it untouched. `phone` is the opposite kind
of exception: it's optional to *omit* (omitting leaves the stored phone
untouched, like every other address field), but if the key IS sent, `null`
or `""` is rejected with `422` rather than silently clearing it — phone is
required going forward (see `POST /locations` above), so there is no way
to PATCH it back to empty/missing. Both fields are also returned
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

### PUT /locations/{id}/cuisine-tags

Auth: owner (owns parent brand), manager with an active assignment for this
location, or admin (`require_location_write_access`, re-validated server-side).
Anonymous `401`; another owner / an unassigned manager / a registered user
`403`; unknown location `404`.

Added 2026-09-24 — cuisine/dietary/type/signature/dining-time tags are **per
location** (`docs/DECISIONS.md` "Cuisine/dietary tags are per location"). Full
replace of THIS location's tag set only; its siblings are untouched:
```json
{ "cuisine_tag_ids": [7, 12] }
```
Unknown or inactive ids are ignored, duplicates collapse, `[]` clears.
Works on a hidden (setup) location too. Response `200`:
```json
{ "results": [ { "id": 7, "name": "hyderabadi", "display_name": "Hyderabadi", "category": "regional" } ] }
```
Audit: one `restaurant_location` `update` row with
`old_val: {"cuisine_tags": [...slugs]}` / `new_val: {"cuisine_tags": [...slugs]}`.

`GET /restaurants/{id}/locations` items also carry `cuisine_tags` (that
location's own tags, one batched query for the page).

**Deals-button state — `active_deals_count` / `deals_hidden` (added
2026-09-24, no migration; counts are computed).** Each
`GET /restaurants/{id}/locations` item also carries:

| field | type | meaning |
|---|---|---|
| `active_deals_count` | int \| null | Live deals at this location: `is_active = true` AND (`end_at` IS NULL OR `end_at` > now). Inactive and expired deals are not counted; a deal with a future `start_at` or restricted `applicable_days` IS counted (the owner has set it up). Independent of `deals_hidden`. |
| `deals_hidden` | bool \| null | The location-level "Hide all deals" switch (`restaurant_location.deals_hidden`). |

These are deal **content metadata**, so they are populated ONLY for a caller
with write access — the brand's owning owner or an admin (the same callers
that see non-active locations here). For an anonymous caller, another owner,
a manager or a registered user, both are `null`; the public only ever learns
the boolean `has_deal_today` (unchanged). Computed with ONE grouped query
for the whole page (no per-location queries). They drive the owner business
page's Deals button (`Deals · N` / `Add a deal` / `Deals hidden`).

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

**Deliberately left owner-only:** `POST /locations/{id}/managers` (and,
until 2026-09-24, `POST /locations` — now owner-or-admin, see that endpoint) —
see those endpoints' own Auth lines. Both are
an owner declaring/vouching for something new under their own brand
(a new location; a specific named person as a location's manager), not
administering an existing resource — the same reasoning `POST
/restaurants` (also owner-only, no admin path) already follows. Support
access to an *existing* problematic manager assignment is already
covered by the admin-parity `DELETE` above.

**Note on this endpoint vs. the status lifecycle below (added
2026-09-22):** this `DELETE` predates the 4-state `status` model and
keeps its old "soft-hide, one flag" behavior unchanged — it sets
`status=owner_deactivated` via the `is_active` backward-compat setter,
same as before. `POST /locations/{id}/status` below is the new
status-aware entry point for the other two self-service states
(`coming_soon`, `closed_pending_reopen`); this `DELETE` is not being
removed, just no longer the only way to hide a location.

### DELETE /locations/{id}/permanent

Auth: owner (owns parent brand) or admin — same
`require_location_owner_or_admin` dependency as the soft-delete `DELETE
/locations/{id}` above.

**Real row delete — irreversible.** Added 2026-09-22 (`docs/DECISIONS.md`
"Hard-delete a location") to close the dead end in `DELETE
/restaurants/{id}`: that endpoint's `ON DELETE RESTRICT` 409 tells the
caller to "remove or reassign its locations first," but before this
endpoint existed, nothing could actually remove one — `DELETE
/locations/{id}` only ever soft-hides. This is the new capability that
makes that instruction true.

Guardrails, checked in order, each its own `409` + `code` (never a raw DB
integrity error, root CLAUDE.md "NEVER expose internal stack details"):

| Order | Check | `code` |
|---|---|---|
| 1 | Location's `status` is not already `active` — must be hidden first (any of `owner_deactivated` / `coming_soon` / `closed_pending_reopen`) | `location_still_active` |
| 2 | No `location_manager` row with `is_active=true` for this location | `location_has_active_manager` |
| 3 | No `claim_request` with `status="pending_review"` referencing this location (via its nullable `location_id`) | `location_has_pending_claim` |
| 4 | No `location_reopen_request` with `status="pending_review"` for this location | `location_has_pending_reopen_request` |

Response: `204 No Content`. Audit: `audit_log` row
(`table_name="restaurant_location"`, `action="delete"`, `old_val` a
snapshot of `status`/`address_line1`/`city`/`state`/`brand_id`,
`new_val=null`) — written and committed together with the row delete in
the same transaction, so the audit trail and the delete never diverge.

**Cascading child rows (DB-level `ON DELETE`, not application code,
`docs/DATA_MODEL.md`):** `restaurant_hours` and `restaurant_photo`
(`CASCADE`), `location_reopen_request` (`CASCADE` — safe, guardrail 4
above already guarantees none are pending), and every `location_manager`
row for this location — active or historically inactive (`CASCADE`).
`claim_request.location_id` and `listing_report.location_id` are `SET
NULL`; those rows survive with their location pointer cleared. See
`docs/DECISIONS.md` "Hard-delete a location" for the judgment call on
accepting the loss of inactive manager history as part of this cascade.

**Not the same endpoint as `DELETE /locations/{id}`** — that one is
unchanged (still a soft-hide) and stays the default "hide this listing"
action. This one is a separate, more destructive action with its own
route, never silently substituted for the other.

### POST /locations/{id}/status

Auth: owner (owns parent brand) or admin — no manager path (manager
cannot change a location's status; root CLAUDE.md "Permission model" +
this feature's own scoping decision).

Body:
```json
{ "status": "coming_soon" }
```
One of `active` | `owner_deactivated` | `coming_soon` |
`closed_pending_reopen` (`docs/DECISIONS.md` "Location status
lifecycle"). Response: `200`, same shape as `GET /locations/{id}`
(with the caller's own access, so a caller changing their own location
into a hidden status still gets the real detail back, not a 404 from
the visibility check above).

Every pair of statuses is freely self-service both ways through this
endpoint **except** the one-way trip out of `closed_pending_reopen` —
posting anything other than `closed_pending_reopen` itself while the
location is already `closed_pending_reopen` returns `409
reopen_requires_admin`; reopening requires an admin-approved
`location_reopen_request` instead (see "Location reopen requests"
below). Re-posting the location's current status is always a harmless
no-op (`200`, not `409`), checked before the asymmetric-transition rule
so retrying an already-applied change never fails.

**Setup gate (added 2026-09-24, `docs/DECISIONS.md` "New manual listings
start in setup"):** moving a location from `coming_soon` to `active` — going
live for the first time — is refused with `422`
```json
{
  "detail": "This listing isn't ready to go live yet. Still needed: opening hours for all 7 days.",
  "code": "listing_incomplete",
  "missing": ["hours"]
}
```
until the required info exists (`missing` uses the same keys/rules as
`setup_missing` on `GET /locations/{id}`: `name`, `address`, `phone`,
`hours`). Nothing is changed and no audit row is written on a refusal. Applies
to owner and admin alike. Only that transition is gated: un-hiding an
`owner_deactivated` listing, moving to any hidden status, and approving a
reopen request are unchanged, so seeded / imported listings (which may have
`is_closed = null` days) keep working.

Audit: `audit_log` row (`action="update"`, `old_val`/`new_val` each
`{"status": "..."}` — so the activation is `coming_soon` -> `active`).

---

## Deals (`deal`)

Added 2026-09-23 — deals engine, explicitly authorized mid-Phase-1 (see
`docs/DECISIONS.md` "Deals: Phase 2 scope explicitly authorized
mid-Phase-1"). These four endpoints are the owner/manager/admin
MANAGEMENT view — always full content, including inactive deals. The
PUBLIC, content-gated read of a location's deals lives on `GET
/locations/{id}` (`has_deal_today`/`deals_today`) and `GET /search`
(`has_deal_today` badge only), not here — see those sections above.

`deal_type` is `"deal"` or `"special"` and is **derived from `end_at`, never
chosen by the owner** (user decision 2026-09-24, refining the pre-existing
`docs/DECISIONS.md` "deal type ENUM" decision): no end date (ongoing) ->
`"special"`; has an end date -> `"deal"`. It flips automatically when an
end date is added or removed. Every response that carries a deal —
management `DealOut`, `deals_today`, `upcoming_deals` — returns the derived
value, computed at read time from `end_at` (single helper
`effective_deal_type` in `app/models/deal.py`), so a legacy row whose stored
`deal_type` column was hand-picked and disagrees with its `end_at` still
reads back correctly with no migration or backfill; the stored column is
re-synced from `end_at` on every create/update. `deal_type` is
**read-only**: a `deal_type` sent in a POST/PATCH body is accepted and
ignored (backward compatibility for older clients — never a 4xx). It is
display metadata only; it doesn't affect matching/expiry (`end_at` does).
The audit log's `deal_type` old/new values record the effective type.
`applicable_days` is a
list of int, 0=Monday..6=Sunday (matches `restaurant_hours.day_of_week`
exactly) — `null`/omitted means every day; an empty list is rejected
(422). `start_at`/`end_at` are ISO 8601 timestamps (not dates) —
`null`/omitted `start_at` means active immediately, `null`/omitted
`end_at` means runs indefinitely until deactivated — **for legacy rows
only**: as of 2026-09-23 (owner feedback) new deals can no longer be
created without dates (see "Required dates" under POST below). Existing
rows with NULL dates keep working and displaying unchanged (no
migration/backfill).

### GET /locations/{id}/deals

Auth: owner (owns parent brand), manager with an active
`location_manager` row for this location, or admin — same
`require_location_write_access` dependency as the photos/hours
sub-resources (backend/app/dependencies/auth.py).

Response:
```json
{
  "results": [
    {
      "id": 12,
      "location_id": 456,
      "deal_type": "deal",
      "title": "Buy 1 Get 1 Biryani",
      "description": "Every Tuesday, dine-in only.",
      "applicable_days": [1],
      "start_at": null,
      "end_at": "2026-12-31T05:59:59Z",
      "is_active": true,
      "created_at": "2026-09-23T14:00:00Z",
      "updated_at": "2026-09-23T14:00:00Z"
    }
  ]
}
```
`deals_hidden` (added 2026-09-24) is the location's "Hide all deals" switch
state (see `PUT …/deals/visibility` below); the response otherwise carries
`{"results": [...], "deals_hidden": false}`.

Every deal for this location, active or not (used by the deal editor),
newest-created first. Not paginated — Phase 2 per-location deal counts
are small enough that pagination would be premature (same reasoning as
`GET /locations/{id}/managers`).

### PUT /locations/{id}/deals/visibility

Added 2026-09-24 — "Hide all deals" / "Show all deals" for one location.
Auth: same as `GET /locations/{id}/deals`. Body `{ "is_hidden": true }`
(required boolean; `422` otherwise). Response `200`
`{ "location_id": 456, "is_hidden": true }`. `404` for an unknown location.

Non-destructive: no deal row is touched and each deal's own `is_active`
(the per-deal Hide/Show, "Hidden from diners" in the owner UI) stays
independent — hiding all then showing all never resurrects a deal that was
individually hidden. While `deals_hidden` is true, EVERY public deal surface
behaves as if the location had no deals — content AND the public "deal(s)
available today" signal: `GET /locations/{id}` (`has_deal_today` false,
`deals_today`/`upcoming_deals` empty), `GET /search` (`has_deal_today` badge
and the `has_deals_today` filter), `GET /auth/me/follows` (`has_deal_today`,
`deal_titles_today`) and everything derived from them (tile badges, landing
cards). Implemented once, in `deal_service.get_active_deals_map`. The
management list (`GET …/deals`) still returns every deal. Idempotent;
audited as a `restaurant_location` `update` row (`{"deals_hidden": old}` ->
`{"deals_hidden": new}`), none when the value doesn't change.

### POST /locations/{id}/deals

Auth: same as `GET /locations/{id}/deals` above.

Body: `{ title, description?, applicable_days?, start_at,
end_at?, ongoing?, is_active? }` — `is_active` defaults to `true`. (A legacy
`deal_type` key is ignored — the type is derived from `end_at`, see above.) `title` required (1-255 chars).

**Required dates (added 2026-09-23):** `start_at` is required; `end_at` is
required UNLESS the request explicitly sends `ongoing: true` (an "every
Tuesday, until I stop it" deal is `applicable_days: [1]`, a `start_at` and
`ongoing: true`). `ongoing: true` together with an `end_at` is rejected.
`start_at` must be before `end_at` when both are present. Every violation is
a `422`. `ongoing` is a request-only flag — not persisted and not returned;
an ongoing deal is simply `end_at: null`. Timezone-less datetimes are read
as UTC.

Response: `201`, full `DealOut` (same shape as one entry in `GET
/locations/{id}/deals`'s `results` array).

Audit: `audit_log` row (`table_name="deal"`, `action="create"`,
`new_val` = full field snapshot, `old_val=null`).

### PATCH /locations/{id}/deals/{deal_id}

Auth: same as above. Partial update, `exclude_unset` semantics matching
`PATCH /locations/{id}` — an omitted field leaves the stored value
untouched; an explicit `null` on a nullable field (`description`,
`applicable_days`, `start_at`, `end_at`) clears it; an explicit `null`
on `title`/`is_active` (non-nullable) is a `400`. `deal_type` is not writable
(ignored); adding an `end_at` makes the deal a `"deal"`, clearing it
(`ongoing: true`) makes it a `"special"`. Used to
toggle `is_active` (owner/manager "pause" control) as well as edit
content.

Date rules on PATCH (2026-09-23) apply only to the date fields actually
sent, so a legacy deal with NULL dates can still be toggled or retitled:
sending `start_at: null` is a `422` (a deal can't lose its start date);
sending `end_at: null` is a `422` unless `ongoing: true` accompanies it;
`ongoing: true` alone clears `end_at`; `ongoing: true` with a non-null
`end_at` is a `422`. The merged stored+sent `start_at`/`end_at` must still
satisfy start < end (`400`).

Response: `200`, full `DealOut`.

Audit: `audit_log` row (`action="update"`, `old_val`/`new_val` full
before/after field snapshots).

### DELETE /locations/{id}/deals/{deal_id}

Auth: same as above. Real, hard delete (`docs/DECISIONS.md` "DELETE
/locations/{id}/deals/{deal_id} is a real, hard delete" — a deal has no
downstream FK dependents, unlike `restaurant_location`). Use `PATCH
{"is_active": false}` instead to hide-but-keep a deal.

Response: `204`.

Audit: `audit_log` row (`action="delete"`, `old_val` = full field
snapshot at time of delete, `new_val=null`).

### Frontend surface (added 2026-09-23)

How the frontend consumes the endpoints above (typed client
`frontend/src/lib/api/deals.ts`, types `frontend/src/types/deal.ts`):

- **Management UI** — "Deals & specials" section of the location editor
  (`/portal/locations/{id}`, `#deals`; `/portal/locations/{id}/deals`
  redirects there). Same access rule as hours/photos: owner, assigned
  manager, admin. Lists every deal (active or not) from `GET
  /locations/{id}/deals`; create/edit send the full form each save (start
  date required; end date required unless "Ongoing (no end date)" is
  ticked, which sends `end_at: null` + `ongoing: true`; inline field errors;
  a legacy deal with no start date opens with the start pre-filled from its
  created date and a short note; no day selected is sent as
  `applicable_days: null`, never `[]`). Each deal card shows days
  ("Tuesdays", "Mon–Fri", "Every day") and the date range or "Ongoing".
  Activate/deactivate is `PATCH
  {is_active}`; delete is two-step confirm then `DELETE`. No `is_paid`
  check anywhere (deals are free-tier).
- **Search** — Filters dropdown "Deals today" toggle, URL param
  `deals_today=true`, sent to the API as `has_deals_today=true`. Tiles show
  the content-free "Deal(s) available today" badge when
  `nearest_location.has_deal_today` is true — for every viewer, since a
  search result never carries deal content.
- **Restaurant detail** — SSR; `getLocationById` is called WITH the
  viewer's access token when signed in, so `deals_today` reflects their
  content access. `deals_today` array present -> full deal cards
  (title/description); `null` with `has_deal_today: true` -> the
  content-free badge only. A separate "More deals & specials" section
  (`RestaurantUpcomingDeals`) lists `upcoming_deals` (title, Deal/Special
  badge, description, days, date range or "Ongoing", next date) and renders
  nothing when the field is `null`/empty.

---

## Menu (`menu_section`, `menu_item`)

Added 2026-09-24 — the menu engine, same pull-forward posture as deals
(root `CLAUDE.md` scope guardrail overridden by direct user instruction;
Stripe/billing untouched). **Free-tier feature: no `is_paid` check gates
the menu or its prices** (`docs/DECISIONS.md` "Full menu with prices moved
to free tier") and the read is **public** (anonymous included), unlike deal
content. Schema: `docs/DATA_MODEL.md` "menu_section" / "menu_item".

Shape: an owner-named optional **group** ("Appetizers", "Main Course" —
free text, each with its own optional description) holds **items**; an item
may also be **ungrouped** (`section_id: null`) and ungrouped items render
FIRST, under no heading. Everything is free text, trimmed server-side
(never trust the client): group `name` required (<=100), group
`description` optional (<=500); item `name` required (<=150), `description`
optional (<=1000).

**One price OR sizes.** An item has EITHER a single free-text `price`
(required non-empty after trim, <=50 chars; `"$12"`, `"12 / 18"`, `"Market
price"` — never parsed or coerced to a number) OR `sizes`: an ordered list
of 1..6 `{ "label": "Personal", "price": "$10" }` entries (each `label` <=40
and `price` <=50, both required non-empty after trim; array order = display
order). Exactly one of the two is present on every item — "price is
mandatory" holds either way. Enforced as: `422` on create with both or
neither, on any request whose `sizes` is `[]`, has >6 entries, or has an
entry missing/blank `label` or `price`, and on a PATCH sending both
non-null; on PATCH, sending the new form's field clears the other
(`{"sizes":[…]}` clears `price`; `{"price":"$12"}` clears `sizes`), and a
PATCH whose merged result would have neither (e.g. `{"price": null}` on a
single-price item) is a `400`.

**Caps** (`409`): at most 30 groups (`menu_section_limit_reached`) and 300
items (`menu_item_limit_reached`) per location.

Auth for every WRITE: owner (owns parent brand), manager with an active
`location_manager` row for this location, or admin — the same
`require_location_write_access` dependency as deals/photos/hours
(`401` anonymous; `403` unassigned manager / other owner / registered_user;
`404` for a soft-deleted brand's location, admin excepted). A group/item id
that belongs to a different location is `404`.

Audit: every write on `menu_section` and `menu_item` writes an `audit_log`
row (`table_name` = `menu_section` | `menu_item`, `action` = `create` |
`update` | `delete`, full before/after field snapshots — for items
including `price`, `sizes`, `section_id`, `display_order` and the photo
keys). A reorder writes one `update` row per row whose `display_order`
actually changed.

### Hide / show (added 2026-09-24)

Nothing is deleted to hide it. Three independent switches: `menu_item.is_hidden`
(one dish, e.g. sold out), `menu_section.is_hidden` (a group AND its items;
the items' own flags are untouched so showing the group restores exactly what
was visible before) and `restaurant_location.menu_hidden` (the ENTIRE menu).
Hidden content is excluded from `GET /locations/{id}/menu` for EVERYONE
(the owner previewing their public page sees what diners see) and from
everything derived from it (the page's Menu section, JSON-LD `hasMenu`);
when nothing is visible the public page renders no Menu section. The editor
reads `GET /locations/{id}/menu/manage` (below), which returns everything with
each row's `is_hidden` flag. Toggling = `PATCH …/items/{id}` or
`PATCH …/sections/{id}` with `{ "is_hidden": true|false }` (`null` is `400`,
non-boolean `422`; may be combined with other fields), and
`PUT /locations/{id}/menu/visibility` with `{ "is_hidden": true|false }` for
the whole menu (`200` `{ "location_id", "is_hidden" }`, idempotent). Same
`require_location_write_access` auth as every menu write. Audit: item/group
toggles are ordinary `menu_item`/`menu_section` `update` rows (old/new
snapshots now include `is_hidden`); the whole-menu switch is a
`restaurant_location` `update` row (`{"menu_hidden": old}` -> `{"menu_hidden":
new}`), none when unchanged.

### GET /locations/{id}/menu/manage

Auth: owner / assigned manager / admin (`require_location_write_access`;
`401`/`403`/`404` as the other menu writes). Same response shape as the
public read but with EVERYTHING: hidden groups and items included, each
carrying `is_hidden: true`, and `menu_hidden` reflecting the whole-menu
switch. The reorder endpoints return this management view too.

### GET /locations/{id}/menu

Auth: none (public) — optional bearer token only matters for the hidden-
location rule below. NEVER returns hidden content (see "Hide / show" above):
hidden items, hidden groups with their items, and — when `menu_hidden` — the
whole menu (`200` with `"menu_hidden": true` and empty lists). Every item/
group object carries `is_hidden` (always `false` here). Applies the same visibility gate as `GET
/locations/{id}`: `404` for a missing location, a soft-deleted brand's
location (admin excepted), or a non-`active` location the caller can't
manage (owner / admin / assigned manager can still read it).

Response:
```json
{
  "location_id": 456,
  "menu_photos_enabled": false,
  "ungrouped_items": [
    { "id": 3, "location_id": 456, "section_id": null, "name": "Masala Chai",
      "description": null, "price": "$3", "sizes": null, "display_order": 0,
      "photo_url": null, "photo_thumbnail_url": null }
  ],
  "sections": [
    {
      "id": 10, "name": "Appetizers", "description": "Great to share.",
      "display_order": 0,
      "items": [
        { "id": 4, "location_id": 456, "section_id": 10, "name": "Veg Biryani",
          "description": "Fragrant basmati rice.", "price": null,
          "sizes": [ { "label": "Personal", "price": "$10" },
                     { "label": "Double", "price": "$15" },
                     { "label": "Family Pack", "price": "$25" } ],
          "display_order": 0, "photo_url": null, "photo_thumbnail_url": null }
      ]
    }
  ]
}
```
`sections` and each `items` list are ordered by `display_order` (ties by
id); a group with no items is returned (the editor needs it) — the public
page just doesn't render it. An empty menu is `200` with empty lists (the
public page renders nothing). Not paginated (bounded by the caps above).
`menu_photos_enabled` mirrors the platform flag below; `photo_url` /
`photo_thumbnail_url` are ALWAYS `null` while it is `false`, and `null` for
an item with no photo.

### POST /locations/{id}/menu/sections

Body: `{ "name": "Appetizers", "description"?: "…" }` — `name` required.
Appended after the existing groups. Response `201`:
`{ "id", "location_id", "name", "description", "display_order" }`.

### PATCH /locations/{id}/menu/sections/{section_id}

Body: `{ "name"?, "description"? }` — `exclude_unset` semantics: omitted =
unchanged; `description: null` (or blank) clears it; `name: null` is `400`.
Response `200`, same shape as create.

### DELETE /locations/{id}/menu/sections/{section_id}

Query: `delete_items` (bool, default `false`). **Default is
non-destructive:** the group's items are kept and MOVED TO UNGROUPED
(appended after the existing ungrouped items, relative order preserved).
`?delete_items=true` deletes the group's items with it. Each affected item
and the group get their own audit row, in one transaction. `204`.

### PUT /locations/{id}/menu/sections/order

Body: `{ "ids": [10, 12, 11] }` — the FULL set of this location's group
ids in the new order. `409 menu_out_of_date` if the set doesn't match the
current groups exactly (stale client — reload); duplicates `422`. Response
`200`: the full menu (same shape as `GET /locations/{id}/menu`).

### POST /locations/{id}/menu/items

Body: `{ "name", "description"?, "price"?, "sizes"?, "section_id"? }` —
exactly one of `price` / `sizes` (see "One price OR sizes"); `section_id`
null/omitted = ungrouped, otherwise must be a group of this location
(`404` if not). Appended at the end of its group. Response `201`, one
item object (same shape as in `GET …/menu`).

### PATCH /locations/{id}/menu/items/{item_id}

Body: any of `name`, `description`, `price`, `sizes`, `section_id` —
`exclude_unset` semantics; `description: null`/blank clears; `section_id:
null` ungroups; a `section_id` change appends the item at the end of the
destination group. Pricing-form rules as above. Response `200`, one item.

### DELETE /locations/{id}/menu/items/{item_id}

`204`. Real delete (audited with the full before-snapshot).

### PUT /locations/{id}/menu/items/order

Body: `{ "section_id": 10 | null, "ids": [4, 5] }` — the FULL set of item
ids currently in that group (`null` = the ungrouped list), new order. Same
`409 menu_out_of_date` / `422` / unknown-group `404` rules as the group
reorder. Response `200`: the full menu.

### Item photos — built, switched OFF

A single platform-level flag, the `platform_config` row
`menu_item_photos_enabled` (default **off**; a missing row, garbage value
or `"false"` all read as off), gates the whole photo capability. **When
off:** the three photo routes below reject with `403` `{"detail": "Menu
item photos are not available.", "code": "menu_photos_disabled"}`; NO
response (public or management) carries a photo URL; `menu_photos_enabled`
is `false` so the editor hides the photo control entirely. Stored photo
keys are kept, so turning the flag back on restores them. **When on:**
everything below works. The human flips the flag with the `set_platform_flag`
management command (`docs/SCRIPTS.md`). FUTURE INTENT (deliberately not
implemented — no `is_paid` logic now): when paid tiers land, the gate
becomes "flag on AND the location `is_paid`".

Same presigned-POST + resize-Lambda pipeline as location photos (BRD 5.3),
under a menu-scoped key: `raw/locations/{id}/menu/{uuid}.jpg|png` (the
existing `raw/` prefix, so the S3 event notification / resize Lambda / IAM
need no change) → `processed/…` (1200px) and `thumbnails/…` (400px).
JPEG/PNG only; **2 MB** cap (`content-length-range`, tighter than the 5 MB
gallery cap).

- `POST /locations/{id}/menu/photo-upload-url` — body `{ "content_type":
  "image/jpeg" }`; response `200` identical in shape to `POST
  /locations/{id}/photos/upload-url` (`upload_url`, `fields`, `s3_key`,
  `expires_in`); unsupported type `400 unsupported_content_type`.
- `PUT /locations/{id}/menu/items/{item_id}/photo` — body `{ "s3_key":
  "<raw key from the call above>" }`; attaches or replaces (stores the
  predicted processed/thumbnail keys immediately, like `POST
  /locations/{id}/photos`). The key must be exactly one this location's
  upload-url call could have issued, else `400 invalid_s3_key`. Response
  `200`: the item with `photo_url` / `photo_thumbnail_url` set. Audited.
- `DELETE /locations/{id}/menu/items/{item_id}/photo` — clears the item's
  photo; response `200`: the item. Audited. (The S3 objects are not
  deleted, same as gallery photos today.)

### Frontend surface (added 2026-09-24)

Typed client `frontend/src/lib/api/menu.ts`, types `frontend/src/types/menu.ts`,
validation `frontend/src/lib/validation/menu.ts` (mirrors the rules above).

- **Management UI** — "Menu" section of the location editor
  (`/portal/locations/{id}`, `#menu`; `/portal/locations/{id}/menu`
  redirects there — that's where the "Menu" button on the manager/owner
  cards lands). Same access rule as deals: owner, assigned manager, admin.
  Add/edit/delete groups (name + optional description) and items (name,
  optional description, price); each item has a "One price" / "Sizes"
  switch (sizes: add/remove/reorder up to 6 rows of name + price); a group
  dropdown (incl. "No group"); up/down reorder buttons for groups and for
  items within a group; inline validation for name/price/size fields;
  deletes are two-step (deleting a group offers "keep items" — the
  default — or "delete items too"). The photo control renders ONLY when
  `menu_photos_enabled` is true. The editor re-reads the whole menu after
  every write so it can't drift from the server. No `is_paid` check
  anywhere. **Hide / show (2026-09-24):** the editor reads
  `GET …/menu/manage`; every item and group has a one-click instant
  Hide/Show (`aria-pressed`, 44px target) with a "Hidden" chip and dimmed
  row (items inside a hidden group read "Hidden with its group"); a
  section-level bar states whether diners can see the menu and offers
  "Hide entire menu" / "Show menu". The Deals section mirrors it: per-deal
  Hide/Show ("Hidden from diners" / "Visible to diners" — the API field is
  still `is_active`) and a "Hide all deals" / "Show all deals" bar.
  Toggles are optimistic and revert with an error message on failure.
- **Public restaurant page** — SSR `RestaurantMenu` between "About" and the
  report box: ungrouped items first, then groups with their descriptions;
  item name / description / price, or sizes as "Personal $10 · Double $15 ·
  Family Pack $25"; a small photo only when the API returned one; renders
  nothing for an empty menu; a load failure never breaks the page. The
  JSON-LD gains `hasMenu` (`Menu` → `MenuSection` → `MenuItem`, name +
  description only — free-text prices can't be a valid `Offer`), and all
  page JSON-LD is now serialized with `<` escaped (`jsonLdString`) so
  owner-authored text can't close the `<script>` tag.

---

## Location reopen requests (`location_reopen_request`)

The only path that moves a `closed_pending_reopen` location back to
`active` (`docs/DECISIONS.md` "Location status lifecycle"). Submission
is owner-only, nested under the location it's about
(`POST /locations/{id}/reopen-requests`, same pattern as
`POST /locations/{id}/managers`); the admin-facing review queue
(list/get/approve/reject) lives at its own top-level path,
`/location-reopen-requests`, mirroring `/claim` and `/reports` (neither
of which live under `/admin` either, despite being admin-reviewed).
Shape mirrors `/claim` throughout: a submission row plus admin
approve/reject, `reviewer_notes` usable on approval too (not
reject-only), a partial unique index limiting a location to at most one
*pending* request at a time.

### POST /locations/{id}/reopen-requests

Auth: owner (owns parent brand) only — no admin, no manager path.

Body:
```json
{ "notes": "Renovation finished, reopening under the same menu." }
```
`notes` is optional.

Only valid while the location is currently `closed_pending_reopen` —
`409 not_closed_pending_reopen` otherwise. A second submission while one
is already pending (`status="pending_review"`) returns `409
reopen_request_already_pending` (the partial unique index).

Response: `201`
```json
{
  "request_id": 42,
  "location_id": 456,
  "status": "pending_review",
  "notes": "Renovation finished, reopening under the same menu.",
  "submitted_at": "2026-09-22T18:04:00Z",
  "reviewed_at": null,
  "reviewer_notes": null
}
```

### GET /location-reopen-requests

Auth: admin only. Admin review queue — oldest pending first.

Query params: `status` (default `pending_review`), `page` (default 1),
`page_size` (default 20, max 100).

Response:
```json
{
  "results": [
    {
      "request_id": 42,
      "location_id": 456,
      "brand_id": 123,
      "brand_name": "Spice Route",
      "brand_slug": "spice-route",
      "location_address": "123 Main St, Plano, TX 75024",
      "requested_by_user_id": "a1b2c3d4-...",
      "requester_email": "owner@example.com",
      "notes": "Renovation finished, reopening under the same menu.",
      "status": "pending_review",
      "submitted_at": "2026-09-22T18:04:00Z",
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
`requester_email` is `null` when no `owner_account` row matches the
requester (same nullability reasoning as `ClaimQueueItem.claimant_email`).

### GET /location-reopen-requests/{id}

Auth: the requesting owner (their own request) or admin (any). Same
response shape as `POST /locations/{id}/reopen-requests`'s `201` above.

### POST /location-reopen-requests/{id}/approve

Auth: admin only.

Body: `{ "reviewer_notes": "..." }` — optional.

Real side effect: flips the location's `status` back to `active`
(audit-logged, `table_name="restaurant_location"`), same "commit the
effect, then the review record" ordering as `POST /claim/{id}/approve`.
`409 request_not_pending` if the request has already been reviewed.
Response: `200`, same shape as the submission response, `status:
"approved"`.

### POST /location-reopen-requests/{id}/reject

Auth: admin only.

Body: `{ "reviewer_notes": "..." }` — **required** (same as `POST
/claim/{id}/reject`). The location's `status` is left unchanged
(`closed_pending_reopen`) — a rejection never writes to
`restaurant_location`, only to the request row itself.

Response: `200`, `status: "rejected"`.

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

Errors (checked in this order — see `assign_manager`'s own docstring for
why: cheapest/most-fundamental rejection first):
| Status | Code | When |
|---|---|---|
| 404 | `not_found` | Location doesn't exist |
| 403 | `forbidden` | Caller doesn't own the location's parent brand |
| 404 | `manager_not_found` | No Cognito user exists with `manager_email` — the "unknown email" case; no invite email is sent and no Cognito user is created (SES is Phase-2-deferred), this is a clear, immediate error only |
| 409 | `manager_different_owner` | (added 2026-09-22) The resolved manager already holds an ACTIVE `location_manager` row on a location owned by a DIFFERENT owner than the caller — see DECISIONS.md "Manager scoped to one owner at a time" |
| 409 | `manager_cap_reached` | Location is `is_paid=true` and already has the configured max active managers (default 2, `platform_config.max_active_managers_per_location` — see DECISIONS.md "Configurable manager/location caps via platform_config") — from the existing `assert_can_add_active_manager` check in `location_manager_service.py`, cap value now config-driven instead of hardcoded |
| 409 | `manager_location_cap_reached` | (added 2026-09-22) The resolved manager already actively manages the configured max number of OTHER `is_paid=true` locations (default 2, `platform_config.max_active_locations_per_manager`) — only checked when the TARGET location is also paid; free-tier assignments never count toward or trigger this cap. The message NAMES the locations, e.g. `"This person already manages 2 locations: Dera Grill (Irving), Taj Chaat House (Plano)"` — see DECISIONS.md "Symmetric manager-location cap" for the full paid-tier-only scoping rationale |
| 409 | `already_active_manager` | This user already has an active assignment on this location — `uq_location_manager_active_user` (`docs/DATA_MODEL.md`) would otherwise raise a raw DB integrity error; service layer catches it the same way other services catch a unique-constraint race |

**Backlog (explicitly not built here):** an "invite a not-yet-registered
email, auto-link them to this assignment on their later signup" flow. The
`manager_not_found` 404 above is the complete, intentional behavior for
Phase 1/this task — SES/email is Phase-2-deferred (root CLAUDE.md).

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
      "is_open_now": true,
      "follower_count": 12,
      "active_deals_count": 2,
      "deals_hidden": false
    }
  ],
  "page": 1,
  "page_size": 20,
  "total": 1
}
```
`active_deals_count` / `deals_hidden` — added 2026-09-24 for the manager
panel's Deals button. Same definitions as on `GET /restaurants/{id}/locations`
(live = `is_active` AND (`end_at` NULL or > now); `deals_hidden` = the
"Hide all deals" switch). Never `null` here: every row is one the caller is
assigned to and may write. One grouped query for the page.
Same per-row shape as `GET /restaurants/{id}/locations`'s
`LocationSummaryOut` (deliberately duplicated as its own
`ManagedLocationOut` schema, not imported — see
`backend/app/schemas/location_manager.py`). Only `is_active=true`
assignment rows on `is_active=true` locations are included — a
soft-removed assignment or a soft-deleted location doesn't appear here
(unlike the owner/admin-facing `GET /locations/{id}/managers`, which
shows full history by default).

`follower_count` — added 2026-09-22 alongside `RestaurantOut.
follower_count` above (same dashboard-only-stat task). Unlike that field
this one is **never `null`**: this whole endpoint is already hard-scoped
server-side to the caller's own active `location_manager` assignments, so
there's no public/other-caller variant of this response to gate a value
against — every row returned here is one the caller is entitled to see in
full. It's a count of `user_follow` rows against the location's parent
`brand_id` (follows are brand-level, not location-level — see "Follows"
below), so two locations under the same brand report the same number.

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
    { "brand_id": 123, "name": "Spice Garden", "slug": "spice-garden-irving", "is_claimed": true, "followed_at": "2026-09-16T10:00:00Z",
      "cuisine_tags": [ { "id": 4, "name": "hyderabadi", "display_name": "Hyderabadi", "category": "regional" } ],
      "nearest_location": {
        "location_id": 456, "distance_mi": null,
        "address_line1": "123 Main St", "city": "Irving", "state": "TX", "postal_code": "75038",
        "phone": "9725550100", "is_verified": true, "is_paid": false,
        "is_open_now": true, "open_time": "10:00:00", "close_time": "22:00:00", "is_closed": false,
        "has_deal_today": true },
      "location_count_nearby": 2,
      "cover_photo_url": "https://cdn.example.com/...jpg", "cover_photo_thumbnail_url": "https://cdn.example.com/...-thumb.jpg",
      "has_deal_today": true, "deal_titles_today": ["Lunch buffet $9.99", "Kids eat free"] }
  ],
  "page": 1,
  "page_size": 20,
  "total": 1
}
```
Ordered most-recently-followed first.

`has_deal_today` / `deal_titles_today` (additive, added 2026-09-23): follows
are brand-level and deals are per location, so `has_deal_today` is true when
ANY of the brand's `active` locations (brand not soft-deleted) has an active
deal that applies today — the exact same `deal_service.deal_matches_today`
predicate `GET /search` uses (location's own timezone, applicable weekday,
`start_at`/`end_at` window). `deal_titles_today` carries at most 2 of those
deals' titles (ordered by location id, then deal id; `[]` when there is no
deal today). Titles are safe to include here because this endpoint is
registered_user-only, a role that may view deal content (same gate as
`GET /locations/{id}` `deals_today`); descriptions are not included — the
restaurant page has the full text. Computed for the whole page in two extra
queries (locations, then one bulk deal read), never per brand.

Search-result-shaped items (additive, added 2026-09-24): each item also carries
`cuisine_tags`, `nearest_location`, `location_count_nearby`, `cover_photo_url`
and `cover_photo_thumbnail_url`, with the same field shapes as `GET /search`
(`SearchResultOut` / `NearestLocationOut`), so the favourites grid renders the
exact same tile component as the search results and the homepage (address as a
Google Maps link, today's hours pill, cuisines, cover photo, Featured ribbon,
deal badge, "N locations"). `followed_at`, `has_deal_today` and
`deal_titles_today` are unchanged.

Follows are brand-level but deals (and addresses/hours/cover photos) are per
location, and same-name restaurants at different locations run different
deals. So `nearest_location` is the ONE location the tile represents:
- when the brand has a deal today at one or more `active` locations (brand not
  soft-deleted): the first of them in stable order (lowest location id), so the
  tile's address, hours and map link belong to the location that runs the deal
  (`nearest_location.has_deal_today` is then true);
- otherwise the brand's primary display location: its first `active` location
  by id — the same one the restaurant detail page shows first
  (`GET /restaurants/{id}/locations` orders by id);
- `null` when the brand has no `active` location (the tile then omits the
  address/hours/badge rows).

`nearest_location.distance_mi` is always `null` here (there is no viewer
position). `location_count_nearby` is the brand's total number of `active`
locations (`0` when none), used for the tile's "N locations" chip. Only public
listing data is added (no new privacy surface). Everything is batched for the
whole page — one query each for locations, the chosen locations' cuisine tags, today's hours and cover
photos on top of the follows and deals queries — so the query count is constant
regardless of page size.

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

### GET /claim

Admin claims queue (`GET /claim`, no id).

Auth: admin only. Query: `status` (optional; `pending_review` (default) |
`approved` | `rejected`, else `422`), `page`, `page_size` (default 20,
max 100). Ordering: newest first (`submitted_at` desc, `id` desc).

Response: `200`
```json
{
  "results": [
    {
      "claim_id": 789,
      "brand_id": 123,
      "brand_name": "Spice Route",
      "brand_slug": "spice-route",
      "location_id": 456,
      "location_address": "100 Main St, Irving, TX 75038",
      "claimant_user_id": "b3c1...-cognito-sub",
      "claimant_email": "owner@example.com",
      "proof_method": "document_upload",
      "google_business_profile_url": null,
      "supporting_document_url": "claims/abc/proof.pdf",
      "status": "pending_review",
      "submitted_at": "2026-09-12T10:00:00Z",
      "sla_due_at": "2026-09-16T10:00:00Z",
      "reviewed_at": null,
      "reviewer_notes": null
    }
  ],
  "page": 1,
  "page_size": 20,
  "total": 1
}
```
`claimant_email` is `owner_account.email` matched on
`claim_request.claimant_user_id = owner_account.cognito_sub` (the row
`POST /claim` eagerly creates), `null` if no such row exists.
`location_address` / `location_id` are `null` when the claim has no
`location_id`. `supporting_document_url` is the stored S3 key as-is; no
presigned read URL is minted by this endpoint.

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

Cognito group elevation: after the approval is committed, the claimant
is added to the Cognito `owner` pool group (`AdminAddUserToGroup`,
`Username` = the claimant's JWT `sub`; retried once with the claimant's
email if Cognito answers `UserNotFoundException`). Adding an existing
member is a no-op success. Reject never touches Cognito.

Response: `200`, updated claim shape (`status: "approved"`) plus an
additive field:

| `owner_group_granted` | Meaning |
|---|---|
| `true` | claimant is in the `owner` group (newly added or already a member) |
| `false` | the Cognito call was attempted and failed (e.g. `AccessDenied`, network error, `COGNITO_USER_POOL_ID` unset) |
| `null` | not applicable (every response other than approve) |

Failure semantics: the group call runs AFTER the DB commit and is
best-effort. Any Cognito failure is logged as a warning (error code only,
no stack trace in the response) and NEVER rolls back or blocks the
approval — brand ownership, `is_claimed`, the audit row and the claim
status all persist, and the response is still `200`. Until the Infra
grant for `cognito-idp:AdminAddUserToGroup` is applied to the API
Lambda's role, expect `owner_group_granted: false`; the human can add the
claimant manually:
`aws cognito-idp admin-add-user-to-group --user-pool-id <pool-id> --username <claimant sub or email> --group-name owner`.
The claimant must sign in again (fresh token) to see the group.

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
  | `price_incorrect` | `menu_incorrect` | `deal_incorrect` |
  `permanently_closed` | `other`. (`deal_incorrect` added 2026-09-24; the
  column is plain text validated here, so no migration.)
- `details`: required, trimmed, 1-2000 chars.
- `location_id`: optional; must belong to `brand_id` (else `400`
  `invalid_location`).
- `reporter_email`: optional, max 254 chars, simple `a@b.c` shape check
  (blank string is treated as omitted). Used only for a manual admin
  follow-up; never shown publicly. **Anonymous callers only:** when the
  request carries a valid token, the server ignores this field entirely
  and stores the verified token's `email` claim instead (`null` if the
  token has none), so a client cannot attribute a report to another
  address. Attribution by `reporter_user_id` (Cognito `sub`) is unchanged.
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
identity off a validated JWT, lazily provisioning the local
`owner_account` row the first time a Cognito "owner" group user is
seen (Cognito has no concept of our `owner_account` table), and — since
docs/PROJECT_PLAN.csv "Generic user display name for registered_user/
manager" — reading/writing a generic `user_profile` row for
`registered_user`/`manager` callers (see `docs/DATA_MODEL.md`
"user_profile").

### GET /auth/me

Auth: any authenticated user

Response:
```json
{
  "cognito_sub": "us-east-1:abc-123",
  "role": "owner",
  "email": "owner@example.com",
  "full_name": "Priya Rao",
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

`full_name` (added alongside `user_profile` — docs/PROJECT_PLAN.csv
"Generic user display name for registered_user/manager") is a **unified**
display name regardless of which table it's actually stored in:
`owner_account.full_name` for an `owner` caller, the new
`user_profile.full_name` for `registered_user`/`manager`, `null` for
`admin` (no local profile source for admin yet). Added so a frontend
caller never needs to branch on role/backing table to show "the user's
name" — it just reads this one field.

`owner_account` is still `null` for `manager`/`admin`/`registered_user`
roles (they have no local *business* record in this schema — see
`docs/DATA_MODEL.md`'s identity note; `user_profile` is a much smaller,
name-only record, not a second `owner_account`). For an `owner`-group user
with no existing `owner_account` row yet, the service layer creates one on
first call (`cognito_sub` + `email` from the JWT claims) rather than
requiring a separate signup-sync step. `user_profile`, by contrast, is
never lazily created on `GET` — a `registered_user`/`manager` caller who
has never set a name just gets `full_name: null` back; a row is only
created on the first successful `PATCH`.

### PATCH /auth/me

Auth: any authenticated user (changed — was `owner`-only; see
docs/PROJECT_PLAN.csv "Broaden PATCH /auth/me beyond owner-only". The
owner-only gate was an oversight from when this route was first built with
only owner accounts in mind, not a deliberate restriction — `GET /auth/me`
already worked for every role.)

Body:
- `owner`: `{ "full_name": "Priya Rao", "phone": "+14695559876" }`
- `registered_user` / `manager`: `{ "full_name": "Priya Rao" }` — `phone`
  is accepted but silently ignored (`user_profile` has no phone column).

`full_name`, when provided, must be non-empty after trimming and at most
255 characters (`backend/app/schemas/auth.py FULL_NAME_MAX_LENGTH`) — `422`
otherwise. Same self-scoping posture as before: no `owner_id`/`user_id` in
the body, it's always the authenticated caller (root CLAUDE.md "Permission
model" — never trust a client-supplied identity for a write that should be
self-scoped).

**US phone rule (added 2026-09-24 — user feedback: the owner-profile phone
accepted an 11-digit number):** `phone`, when provided, must be a valid US
phone number under the ONE shared rule used by every phone field
(`backend/app/core/phone.py normalize_us_phone` / `frontend/src/lib/phone.ts
normalizePhone`): spaces, dashes, dots, parentheses and an optional leading
`+1` / `1` accepted; exactly 10 digits after that; area code and exchange
start with 2-9; anything else -> `422`. Stored normalised as
`+1XXXXXXXXXX`. Omitting `phone` (or sending `null`) leaves it untouched; a
blank string is `422`. Existing stored values are not backfilled. Same rule
on `POST/PATCH /locations` and the bulk import (per-row error, below).
Inline UI message: "Enter a valid 10-digit US phone number".

**Name lock (added 2026-09-23 — user decision "once the name is set, the
only way to change it is contacting an admin"):** `full_name` is
set-once. While no non-empty name is stored (`owner_account.full_name` /
`user_profile.full_name`), the first `PATCH` sets it as before. Once a
name is stored, a `PATCH` carrying a *different* `full_name` is rejected:
`409`, `{"detail": "Your name is already set and can't be changed here.
Contact an admin if it needs to be updated.", "code": "name_locked"}` —
nothing in the request is applied (a `phone` change in the same request
does not half-apply). Re-sending the identical stored name (compared after
trimming) is a harmless no-op `200`. Omitting `full_name` never trips the
lock, so an owner's `phone`-only `PATCH` keeps working. No schema change.
The account UI stops rendering the name form once a name exists, but this
server-side check is the enforcement. Admin path: the `set_user_name`
Lambda management command (`backend/app/scripts/set_user_name.py`,
`docs/SCRIPTS.md`) — audit-logged for `owner_account`; it only changes an
already-set name.

Response for an `owner` caller: `200`, `owner_account` shape from `GET
/auth/me` (unchanged by this generalization — still lazily provisions
`owner_account` on first write, still audit-logged).

Response for a `registered_user`/`manager` caller: `200`,
`{ "full_name": "Priya Rao" }` — upserts into `user_profile`
(`cognito_sub` primary key; see `docs/DATA_MODEL.md`). `full_name` is
required for these two roles specifically (omitting it entirely is a `400
full_name_required` — there's nothing else in the body for them to write).
**Not** audit-logged: `user_profile` isn't on root CLAUDE.md's
audited-entity list (restaurant_brand, restaurant_location, menu_item,
deal, owner_account, location_manager), and `audit_log.record_id` is a
`BigInteger` that a Cognito `sub` string doesn't fit anyway.

Response for `admin`: `404`, `{"detail": "...", "code":
"no_editable_profile"}` — deliberately NOT `403`. It is not a permissions
problem (every authenticated role may call this route); admin simply has
no local profile record in this schema to write to yet (neither
`owner_account` nor `user_profile` apply). If admin ever needs an
editable name, extending `user_profile` to cover it is the natural next
step — out of scope here since it wasn't asked for.

ARCHITECT-LEVEL JUDGMENT CALL (flagged for review, docs/PROJECT_PLAN.csv
"Generic user display name for registered_user/manager"): Cognito's own
self-service `updateUserAttributes` was considered and rejected for
`registered_user`/`manager` display names — the frontend session cookie
caches ID-token claims from sign-in, so a Cognito attribute write
wouldn't show up anywhere in the app until the next sign-in/token
refresh. The new `user_profile` table (Postgres, backed by this same
`GET`/`PATCH /auth/me` pair) gives an immediate, consistent read-your-write
instead. See `docs/DATA_MODEL.md` "user_profile" for the full schema
rationale.

### GET /auth/me/activity

**Added 2026-09-22** — closes the gap flagged in the task brief: the app
already writes an `audit_log` row for every write on
`restaurant_brand`/`restaurant_location`/`location_manager` (root
CLAUDE.md "ALWAYS write an audit_log entry ..."), including manager
edits made on an owner's behalf, but no endpoint ever let an owner see
that history.

**Broadened same day to also serve `manager` callers**, with a narrower
row set per role (task brief: "managers currently get NO activity feed
at all"). Auth: owner or manager (`require_owner_or_manager`) — still
NOT open to `admin`/`registered_user`, since `audit_log` scoping here
depends on resolving the caller's own owned/assigned entities, and
neither of those roles has an equivalent "my own entities" concept this
endpoint could scope to.

- **Owner** sees everything on their own brands/locations, PLUS
  manager-assignment changes (`location_manager` — who got assigned/
  removed) and (once they exist — none do yet in Phase 1) payment/
  billing-related updates. Unchanged from the original version of this
  endpoint.
- **Manager** sees only customer-facing-relevant changes
  (`restaurant_brand`/`restaurant_location` — address, hours, general
  listing-content edits) on their own CURRENTLY active assigned
  locations. Explicitly excluded: `location_manager` rows entirely (no
  visibility into other managers being assigned/removed, or their own
  assignment history — that's the owner's business), `owner_account`
  rows, and (not yet applicable, but architecturally excluded by table
  rather than by field so it stays excluded once it exists) payment/
  billing internals.

See `backend/app/services/audit_query_service.py` module docstring for
the full per-role table/action breakdown and the reasoning behind each
inclusion/exclusion, and for why no "hide internal system writes" filter
was added (every current `audit_log` writer is a real human actor —
owner, manager, or admin acting through an admin console — there is no
automated/scheduled writer today to filter out).

Query params: standard pagination (`page`, default `1`; `page_size`,
default `20`, max `100`).

Response: `200`
```json
{
  "results": [
    {
      "id": 9101,
      "table_name": "restaurant_location",
      "action": "update",
      "actor_role": "manager",
      "actor_label": "manager@example.com",
      "actor_resolved": true,
      "summary": "Location phone number updated",
      "created_at": "2026-09-22T14:03:11Z"
    },
    {
      "id": 9099,
      "table_name": "restaurant_brand",
      "action": "update",
      "actor_role": "owner",
      "actor_label": "You",
      "actor_resolved": true,
      "summary": "Restaurant name, website updated",
      "created_at": "2026-09-21T09:44:02Z"
    }
  ],
  "page": 1,
  "page_size": 20,
  "total": 2
}
```
Most-recent-first (`created_at desc`, `id desc` tiebreak).

**Scoping** (see `backend/app/services/audit_query_service.py` module
docstring for the full reasoning): for an **owner**, a row is included
only if its `table_name`/`record_id` traces back to a brand/location/
location_manager row this owner actually owns — via
`restaurant_brand.owner_id`, then `restaurant_location.brand_id`, then
`location_manager.location_id`. For a **manager**, a row is included
only if it traces back to one of THEIR OWN currently active
(`location_manager.is_active == true`) assigned locations — via
`location_manager.user_id`, then `restaurant_location.brand_id` for the
brand-level rows — and never includes `table_name == "location_manager"`
at all. Both are computed with real DB queries every time, never trusted
from the row's own `actor_id`/`actor_role` (e.g. an owner's edit to a
manager's assigned location shows up in that manager's feed too, same
"trace the entity, not the actor" posture in both directions) and never
from a client-supplied id. `menu_item`/`deal` are on root CLAUDE.md's
audit-required table list too but don't exist as tables yet (Phase 2) so
are not queried by either role. `owner_account` writes are deliberately
excluded from both — that's the owner's own account record, already
covered by `GET /auth/me`/`GET /auth/me/data-export`, not one of "the
entities the owner/manager manages."

**`actor_label` / `actor_resolved`** — JUDGMENT CALL (flagged for
review): `audit_log.actor_id` is a bare Cognito `sub`, not directly
human-readable. Resolution order: (1) if `actor_id` is the caller's own
`cognito_sub`, `actor_label = "You"`, `actor_resolved = true`; (2)
otherwise, best-effort resolve an email via
`cognito_service.find_email_by_sub` (same Admin API lookup
`GET /locations/{id}/managers` already uses for its own `email` field —
cheap, one call per distinct actor per page, memoized within the
request); (3) if that lookup fails or returns nothing, fall back to
`"{role} ({first 8 chars of actor_id}…)"` (e.g. `"manager (a1b2c3d4…)"`)
with `actor_resolved = false` so the frontend can render the gap
honestly instead of implying a real name was found. No new local
"display name" table was added for this — Cognito is already this app's
identity source of truth for every role (root CLAUDE.md "Auth: AWS
Cognito"), so a live lookup was preferred over introducing a second,
potentially-stale copy of the same data.

**`summary`** — a short derived one-liner (`table_name` + `action` +
which fields changed between `old_val`/`new_val`), e.g. "Location hours
updated", "Restaurant claimed", "Manager access revoked" — deliberately
NOT the raw `old_val`/`new_val` JSON diff (task brief: "keep it simple
... not a full JSON diff dump"). See `audit_query_service._summarize`
for the exact rules; unrecognized field combinations fall back to a
generic `"{Entity} {field, field} updated"` built from a field-name
label map, so a future audited field never produces a blank or broken
summary, just a slightly less specific one.

---

## Activity tracking (`/activity`)

Registered-user activity history: the searches a signed-in `registered_user`
runs and the restaurant tiles they click. **User-approved 2026-09-23**
(docs/DECISIONS.md "Registered-user activity tracking (searches + tile
clicks)"). Rules:

- **Registered users only.** Nothing is ever recorded for anonymous
  visitors, owners, managers or admins.
- **Bounded.** Search query 100 chars; location text 100 chars; at most 10
  tags per filter facet, 50 chars each; control characters stripped and
  whitespace collapsed. `source` is a closed enum.
- **Best-effort.** Recording is wrapped so it can never fail or slow the
  user-facing request (same pattern as `user_profile.last_seen_at`).
- **12-month retention** (`activity_service.ACTIVITY_RETENTION_DAYS`, the
  single source of truth). Reads (admin view, CCPA export) only ever return
  events inside the window; expired rows are physically purged
  opportunistically after writes (throttled to once per hour per Lambda
  container, table-wide, small batches) — no new AWS resource/schedule.
- **Privacy rights.** Included in `GET /auth/me/data-export`
  (`activity_events`) and hard-deleted by an approved data-deletion request.

Searches are recorded server-side inside `GET /search` (see that section).
Tile clicks use the endpoint below.

### POST /activity/tile-click

Auth: `registered_user` only (`401` unauthenticated, `403` any other role)

Body:
```json
{ "brand_id": 123, "location_id": 456, "source": "search_results" }
```
| Field | Type | Notes |
|---|---|---|
| brand_id | int, required | Must exist |
| location_id | int, optional/null | When present must belong to `brand_id`. The favourites grid is brand-level and sends `null` |
| source | enum, required | `search_results` \| `homepage` \| `favourites` |

Response: `204` no body. Fire-and-forget from the client (the frontend sends
a `navigator.sendBeacon` to a same-origin relay route, which forwards here
with the session token). `204` is returned even if the write itself failed
best-effort — the caller can do nothing useful about it.

Errors:
| Status | Code | When |
|---|---|---|
| 401 | `unauthorized` | no/invalid token |
| 403 | `forbidden` | caller is not a `registered_user` |
| 404 | `not_found` | unknown `brand_id`, or `location_id` unknown / not this brand's |
| 422 | `validation_error` | malformed body or unknown `source` |

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
  "user_profile": null,
  "location_manager_assignments": [
    { "location_id": 42, "is_active": true, "assigned_at": "2026-09-01T10:00:00Z", "revoked_at": null }
  ],
  "follows": [
    { "brand_id": 123, "followed_at": "2026-09-05T10:00:00Z" }
  ],
  "claim_requests": [
    { "claim_id": 789, "brand_id": 123, "status": "approved", "proof_method": "google_business_profile", "submitted_at": "2026-09-01T10:00:00Z", "reviewed_at": "2026-09-02T10:00:00Z" }
  ],
  "listing_reports": [
    { "report_id": 44, "brand_id": 123, "location_id": 42, "category": "hours_incorrect", "details": "Closed Mondays now.", "reporter_email": "owner@example.com", "status": "new", "submitted_at": "2026-09-18T10:00:00Z", "reviewed_at": null }
  ],
  "activity_events": [
    { "event_type": "search", "created_at": "2026-09-20T18:00:00Z", "payload": { "q": "biryani", "cuisine": ["hyderabadi"], "loc": "Irving, TX", "result_count": 7 } },
    { "event_type": "tile_click", "created_at": "2026-09-20T18:01:00Z", "payload": { "brand_id": 123, "location_id": 42, "source": "search_results" } }
  ],
  "audit_log_entries": [
    { "table_name": "restaurant_brand", "record_id": 123, "action": "update", "actor_role": "owner", "created_at": "2026-09-10T10:00:00Z" }
  ],
  "notice": "This export covers personal data held directly by this app ... audit_log_entries are retained even after a data-deletion request, for legitimate business and legal record-keeping purposes."
}
```
`owner_account` is `null` if the caller has no local business record
(same condition as `GET /auth/me`). `user_profile` (added 2026-09-23) is the
display name + last-seen record a `registered_user`/`manager` has (the
counterpart of `owner_account` for those roles):
`{ "full_name": "Asha Menon", "last_seen_at": "2026-09-20T12:00:00Z", "updated_at": "..." }`
(`full_name`/`last_seen_at` may each be `null`); `null` when the caller has no
`user_profile` row (e.g. an owner, or a diner who never set a name and has not
been seen since tracking shipped). `listing_reports` covers "report a
problem" submissions matched by `reporter_user_id` (the caller's Cognito
`sub`, set only when they were signed in when they submitted it) —
**not** by `reporter_email`, since that field is free text any submitter
(including an anonymous one) can type and is not a reliable identity
match. `activity_events` (added 2026-09-23) is the caller's recorded searches and
restaurant-tile clicks (`user_activity_event`, matched by `user_sub`), newest
first, **within the 12-month retention window only** — `[]` for every role
other than `registered_user`. `audit_log_entries` covers actions the caller themselves performed
(`actor_id` match) — included for transparency, but per `notice` and
DECISIONS.md, these are NOT touched by a data-deletion request.

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
  "data_scope": { "owner_account": 0, "user_profile": 1, "location_manager_assignments": 0, "follows": 3, "claim_requests": 0, "claim_requests_pending": 0, "listing_reports": 0, "activity_events": 0, "audit_log_entries": 0 },
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
deleted), `claim_request` (redacted only), or `listing_report` (only
`reporter_email` nulled out — `reporter_user_id` and the report's own
content are left in place, same "attribution trail, not an access grant"
reasoning `audit_log.actor_id` gets), none of which is on that list.
`user_activity_event` rows (recorded searches/tile clicks) are
**hard-deleted** — every row for the sub, including any past-retention rows
not yet physically purged — with no `audit_log` entry (pure behavioural data,
same treatment as `user_follow`). The requester's `user_profile` row (display
name + `last_seen_at`, for `registered_user`/`manager`) is likewise
**hard-deleted** with no `audit_log` entry (not on the audit-required list;
every column is personal data, so no tombstone is kept). Deleting it also
releases the "display name is set once" lock (`name_locked`) for that identity.
The Cognito identity still exists after erasure (out of scope), so a later
authenticated request may lazily recreate a row via last-seen tracking — with
a fresh `last_seen_at` only, never the erased name.

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

### GET /admin/notifications

Auth: admin only. Read-only aggregate behind the admin bell in the top
bar; computed per request (no push/polling infrastructure). Each section
is one COUNT plus a `LIMIT 5` select.

Response: `200`
```json
{
  "claims": {
    "count": 7,
    "items": [
      { "claim_id": 12, "brand_id": 88, "brand_name": "Spice Route", "submitted_at": "2026-09-18T10:00:00Z" }
    ]
  },
  "reports": {
    "count": 2,
    "items": [
      { "report_id": 3, "brand_id": 88, "brand_name": "Spice Route", "category": "hours_incorrect", "submitted_at": "2026-09-19T08:30:00Z" }
    ]
  },
  "new_users": {
    "count": 1,
    "items": [
      { "owner_id": 5, "display": "Asha Rao", "email": "asha@example.com", "role": "owner", "created_at": "2026-09-19T09:00:00Z" }
    ]
  },
  "total": 9,
  "new_users_window_days": 7
}
```

- `claims`: `claim_request.status = 'pending_review'`, **oldest first**
  (SLA order). `count` is the full pending total, `items` at most 5.
- `reports`: `listing_report.status = 'new'`, **oldest first** (same as
  `GET /reports?status=new`). `count` is the full total, `items` at most 5.
- `new_users`: `owner_account` rows created in the last 7 days, **newest
  first**; `display` is `full_name` or else `email`. `role` is always
  `"owner"` (see limitation).
- `total` = `claims.count + reports.count` — the badge number. New
  sign-ups are informational and excluded, since they can never be
  "cleared" and would keep the badge lit for a week.

**Known limitation — `new_users`.** The database has no table of all
signed-up users; identity lives in Cognito, and the only local per-user
row is `owner_account`, created lazily on an owner's first `GET /auth/me`
or claim submission. So `new_users` covers **owner** accounts that have
used the app at least once — not diner (`registered_user`) sign-ups,
managers or admins. CCPA-redacted rows (`personal_data_deleted_at` set)
are excluded. Closing the gap needs an Infra grant (`cognito-idp:ListUsers`
on the user pool) or a post-confirmation hook that writes a local row;
neither is part of this endpoint.

Errors: `403 forbidden` for any non-admin caller.

### GET /admin/registered-user-count

Auth: admin only. Total diner (`registered_user`) sign-ups — the data
source for a companion admin overview/analytics page (see
docs/PROJECT_PLAN.csv). Added to close exactly the `new_users` gap called
out above: identity for diners lives only in Cognito (`owner_account` only
has owner rows; `user_profile` only gets a row when a diner sets a display
name, which most never do), so this reads Cognito directly via
`cognito-idp:ListUsersInGroup` on the `registered_user` pool group,
paginated, summed server-side. See `infra/CLAUDE.md` "IAM Least-Privilege
Rules" for the exact grant and `app/services/cognito_service.py`'s
`count_users_in_group` docstring for why `owner`/`manager`/`admin` pool
members are excluded from the count (the group is diners only, by design,
not "everyone in the pool").

Response: `200`
```json
{ "count": 143, "group": "registered_user" }
```

Live call, no caching (admin-only, low traffic — see service docstring).

Errors:
| Status | Code | When |
|---|---|---|
| 403 | `forbidden` | caller is not admin |
| 502 | `upstream_error` | Cognito `ListUsersInGroup` call failed |

### GET /admin/registered-users

Auth: admin only. Diner (`registered_user`) directory for the admin
console's "Registered users" report (`/admin/registered-users`, linked from
the Platform Overview page's "Registered users" tile): email, Cognito
status, signup date, and a best-effort last-visited timestamp. See
docs/DECISIONS.md "Registered-user last-seen tracking" for the full design
writeup (`user_profile.last_seen_at`, throttled write, why owner/manager
click-history tracking is explicitly NOT part of this).

Combines two sources, joined by `cognito_sub`:
- Cognito (`cognito-idp:ListUsersInGroup` on the `registered_user` group —
  the SAME grant `GET /admin/registered-user-count` already uses, no new
  IAM) for `email`, `status`, `signup_at`.
- The local `user_profile.last_seen_at` column for `last_seen_at`. `null`
  when the user has never had a tracked authenticated request (either
  never returned, or returned only before this tracking shipped) — the
  frontend renders this as "Never", not a fabricated date.

Query params:
| Param | Type | Notes |
|---|---|---|
| page | int, optional, default 1 | |
| page_size | int, optional, default 20, max 100 | |

**JUDGMENT CALL:** `ListUsersInGroup` paginates via an opaque `NextToken`
cursor, not offsets, so this endpoint fetches every group member from
Cognito (same bounded, admin-only, low-traffic assumption
`GET /admin/registered-user-count` already relies on) and paginates the
combined list in application code — see
`app/services/cognito_service.py::list_registered_users` and
`app/services/admin_registered_users_service.py` for the full reasoning.
Results are ordered newest-signup-first (`signup_at` descending), a stable
sort key so pages don't reshuffle between requests the way sorting by a
live `last_seen_at` would.

Response: `200`
```json
{
  "results": [
    {
      "cognito_sub": "3f2a1c9e-...",
      "email": "diner@example.com",
      "status": "CONFIRMED",
      "signup_at": "2026-09-10T14:22:03Z",
      "last_seen_at": "2026-09-23T08:05:11Z"
    }
  ],
  "page": 1,
  "page_size": 20,
  "total": 143
}
```

Live call, no caching (same posture as `GET /admin/registered-user-count`).

Errors:
| Status | Code | When |
|---|---|---|
| 403 | `forbidden` | caller is not admin |
| 502 | `upstream_error` | Cognito `ListUsersInGroup` call failed |

### GET /admin/owners

Auth: admin only. Owner directory for the admin console's "Owners" report
(`/admin/owners`, linked from the Platform Overview page's "Total owners"
tile and its own nav item) — the owner-side counterpart of
`GET /admin/registered-users`. Local database only (`owner_account` plus its
brands/locations/follows/pending requests): **no Cognito call**, so no 502
failure mode. **No billing/payment fields** (Stripe/`is_paid` work is
deferred) — `stripe_customer_id`/`stripe_sub_id` are never returned.

Query params:
| Param | Type | Notes |
|---|---|---|
| page | int, optional, default 1 | |
| page_size | int, optional, default 20, max 100 | |
| q | string, optional, max 100 chars | Case-insensitive substring match against `email` OR `full_name`; blank/whitespace ignored; `%`/`_` matched literally |
| sort | enum, optional, default `newest` | `newest` (`joined_at` desc) · `oldest` · `most_locations` (`location_count` desc, then newest) · `email` (A–Z, case-insensitive). `id` is always the final tiebreaker so pages are stable. Unknown value → `422` |

**JUDGMENT CALLS:**
- Lists **every** `owner_account`, including owners with zero brands (an admin
  reviewing sign-ups needs them). The Platform Overview "Total owners" tile
  counts only owners with >= 1 brand, so this endpoint's `total` can be
  higher.
- **CCPA-deleted owners** (`personal_data_deleted_at` set) stay in the list
  flagged `personal_data_deleted: true`, with `email`/`full_name`/`phone`
  returned as `null` (the stored value is only a synthetic tombstone). Their
  brands/locations still exist, so hiding the row would make counts disagree
  with the Overview page.
- `location_count`/`by_status` are location-grain (same as the Overview owner
  table; `by_status` values sum to `location_count`). `brand_count` counts
  brands with `owner_id` = this owner (unclaimed brands belong to no owner).
- `follower_count` = total `user_follow` rows across the owner's brands (a
  diner following two of the owner's brands counts twice). Admin-only stat,
  same gate as `RestaurantOut.follower_count`.
- `pending_claim_count` = `claim_request` rows in `pending_review` whose
  `claimant_user_id` equals the owner's `cognito_sub`;
  `pending_reopen_request_count` = `location_reopen_request` rows in
  `pending_review` for locations under the owner's brands.
- Implemented with one `GROUP BY owner_id` subquery per aggregate, LEFT JOINed
  onto `owner_account` (no N+1, no cross-aggregate fan-out).

Response: `200`
```json
{
  "results": [
    {
      "id": 12,
      "email": "owner@example.com",
      "full_name": "Priya Sharma",
      "phone": "+12145550100",
      "joined_at": "2026-09-01T10:00:00Z",
      "personal_data_deleted": false,
      "brand_count": 2,
      "location_count": 3,
      "by_status": {
        "active": 2,
        "owner_deactivated": 0,
        "coming_soon": 1,
        "closed_pending_reopen": 0
      },
      "verified_location_count": 2,
      "follower_count": 14,
      "pending_claim_count": 0,
      "pending_reopen_request_count": 1
    }
  ],
  "page": 1,
  "page_size": 20,
  "total": 1
}
```

Errors:
| Status | Code | When |
|---|---|---|
| 403 | `forbidden` | caller is not admin |
| 422 | — | `page`/`page_size` out of range, or unknown `sort` |

### GET /admin/registered-users/{user_sub}/activity

Auth: admin only (`401` unauthenticated, `403` otherwise). One diner's
recorded searches and restaurant-tile clicks (`user_activity_event`), newest
first (`created_at` desc, `id` desc), **within the 12-month retention window
only**. Backs the per-user activity view linked from each row of the
Registered users report (`/admin/registered-users/{user_sub}`). Local DB only
— no Cognito call, so it is fast; it does not verify `user_sub` is a real
diner (an unknown sub simply has no events). Brand/location names are
resolved with two batched queries for the page (no N+1).

Query params:
| Param | Type | Notes |
|---|---|---|
| event_type | `search` \| `tile_click`, optional | Filter; anything else is `422` |
| page | int, optional, default 1 | |
| page_size | int, optional, default 20, max 100 | |

Response: `200`
```json
{
  "results": [
    {
      "id": 901,
      "event_type": "tile_click",
      "created_at": "2026-09-20T18:01:00Z",
      "payload": { "brand_id": 123, "location_id": 42, "source": "search_results" },
      "brand_name": "Spice Route",
      "location_label": "4900 W Park Blvd, Plano"
    },
    {
      "id": 900,
      "event_type": "search",
      "created_at": "2026-09-20T18:00:00Z",
      "payload": { "q": "biryani", "cuisine": ["hyderabadi"], "loc": "Irving, TX", "result_count": 7 },
      "brand_name": null,
      "location_label": null
    }
  ],
  "page": 1,
  "page_size": 20,
  "total": 2,
  "retention_days": 365
}
```
`payload` keys for `search`: `q`, `cuisine`, `dietary`, `type`, `loc`,
`has_deals_today`, `result_count` (each omitted when empty). For
`tile_click`: `brand_id`, `location_id` (nullable), `source`. `brand_name` /
`location_label` are set for `tile_click` only and are `null` when the
restaurant/location has since been removed (the frontend shows "Removed
restaurant").

### GET /admin/overview

Auth: admin only. Platform-wide restaurant/tier/owner aggregate behind the
admin console's **"Platform Overview"** page (`/admin/overview` —
deliberately not named "Reports": that name is already taken by the
report-a-problem triage queue, `/admin/reports`). Computed per request
(no push/cache), in a small, fixed number of `GROUP BY` queries — never
one query per owner or per status value (see
`app/services/admin_overview_service.py`).

Query params:
| Param | Type | Notes |
|---|---|---|
| page | int, optional, default 1 | Paginates `owners.results` only. |
| page_size | int, optional, default 20, max 100 | |

Response: `200`
```json
{
  "restaurants": {
    "total": 42,
    "by_status": {
      "active": 35,
      "owner_deactivated": 4,
      "coming_soon": 2,
      "closed_pending_reopen": 1
    },
    "by_tier": { "paid": 9, "free": 36 }
  },
  "owners": {
    "total_owners": 18,
    "results": [
      {
        "owner_id": 5,
        "email": "asha@example.com",
        "restaurant_count": 3,
        "by_status": { "active": 2, "owner_deactivated": 0, "coming_soon": 1, "closed_pending_reopen": 0 }
      }
    ],
    "page": 1,
    "page_size": 20,
    "total": 18
  },
  "registered_user_count": null
}
```

**JUDGMENT CALL — two different counting grains in one response, by
design (documented in `app/schemas/admin_overview.py` and
`app/services/admin_overview_service.py`; flagged for review):**

- **`restaurants` is brand-grain**, using the exact same "matches a brand
  if ANY of its locations satisfies this" semantics `GET /restaurants`'
  `status`/`is_paid` filters already use (PR #177) — chosen so every
  number here is identical to the `total` a caller gets back from
  `GET /restaurants?status=<x>` / `?is_paid=<x>`, and so the overview
  page's "view list" links (`/admin/listings?status=<x>`,
  `/admin/listings?is_paid=<x>`) always agree with the tile they came
  from. Consequence: `by_status`/`by_tier` are **not mutually exclusive**
  and do **not** have to sum to `total` — a brand with one `active` and
  one `coming_soon` location is counted in both status buckets, same as
  it would match both filter values as two separate `GET /restaurants`
  calls. `total` itself is a plain, unfiltered `restaurant_brand` count.
- **`owners[].restaurant_count`/`by_status` is location-grain** — a
  straightforward `GROUP BY (owner_id, status)` count of that owner's
  actual `restaurant_location` rows. There is no click-through list this
  table needs to stay link-consistent with, so it uses the arithmetically
  clean unit instead: `by_status` values always sum to
  `restaurant_count`, unlike `restaurants.by_status` above.

"Paid" throughout = **"has at least one paid location"** (`is_paid=true`
on `restaurant_location`), never a brand-level stored field — `is_paid`
only exists on `restaurant_location` (root CLAUDE.md "Tier model").

`owners.total_owners` = count of unique owners with **at least one
brand** (`restaurant_brand.owner_id IS NOT NULL`, grouped) — an
`owner_account` row with zero brands (signed up, never listed anything)
is excluded, same as `owners.results`. `owners.results` is ordered by
`email` ascending, then `id` (stable tiebreak).

`registered_user_count` is **always `null`** on THIS endpoint — kept out
of scope for `GET /admin/overview` by design, rather than folded in
after the fact. The real count is a separate call: `GET
/admin/registered-user-count` (documented directly above), added by a
companion PR that landed on `main` while this endpoint was in review. The
`/admin/overview` frontend page fetches both endpoints independently
(two ordinary typed API calls) and renders them together — this
endpoint's own shape was deliberately not changed to absorb the other
one's data, so each stays a single-responsibility aggregate (a local-DB
`GROUP BY` here vs. a live Cognito call there) that can fail
independently without taking the other down. `registered_user_count`
stays on this response as a stable placeholder field regardless, in case
a future caller wants both counts from one call.

Errors: `403 forbidden` for any non-admin caller.

### POST /admin/restaurants/bulk-import

Auth: admin

**Phone (2026-09-24):** each row's `phone` is optional; when present it must
satisfy the shared US phone rule (see `PATCH /auth/me`) and is stored
normalised (`+1XXXXXXXXXX`). An invalid number is reported as that row's
`error` (`detail` names the number and "Enter a valid 10-digit US phone
number") and the rest of the batch continues — same for the CSV import. Bulk
import still creates `active` listings (unchanged).

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
`location_cuisine` row for that row's LOCATION (tags are per location; also
idempotent — re-running doesn't duplicate the link).

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

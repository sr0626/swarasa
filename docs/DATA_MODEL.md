# Data model

> NOTE (2026-09-24): this file was empty (0 bytes) on `main` when the menu
> engine was added, although model docstrings and `docs/API_CONTRACTS.md`
> still reference it. Only the entities added in this change are documented
> here; the rest of the schema is defined by `backend/app/models/*.py` and
> the migrations in `backend/migrations/versions/`. Backfilling the other
> entities is a separate docs task.

## restaurant_location.slug

Migration `0014_location_slug`. Model: `backend/app/models/restaurant_location.py`.
`slug varchar(100) NOT NULL`, **unique per brand** —
`uq_restaurant_location_brand_slug (brand_id, slug)` (not globally: two brands
may both have an `irving` location). Public page: `/restaurant/{brand_slug}/{slug}`.
Generated once at create time by `app/services/location_slug.py` (city, else
city + street, else `-2`/`-3`; reserved words excluded) and **fixed** afterwards
(an address edit never changes it). The migration adds the column nullable,
backfills existing rows in `(brand_id, id)` order with a frozen copy of the same
rule (a unit test asserts the copy matches the app helper), then sets NOT NULL
and adds the constraint. Hard-deleting a location frees its slug within the
brand; a brand soft delete keeps every slug.

## menu_section

An optional, owner-named group of menu items on a location ("Appetizers",
"Main Course"). Migration `0013_menu`. Model: `backend/app/models/menu_section.py`.

| Column | Type | Notes |
|---|---|---|
| id | bigint PK | |
| location_id | bigint FK → restaurant_location.id | `ON DELETE CASCADE`; NOT NULL |
| name | varchar(100) | NOT NULL, free text, trimmed, non-empty (schema-enforced) |
| description | varchar(500) | nullable — every group has its own optional description |
| display_order | integer | NOT NULL default 0; 0-based, dense after any reorder; ties broken by id |
| is_hidden | boolean | NOT NULL default `false` (migration `0014_hide_menu_and_deals`). Hides the group AND its items from the public menu without touching the items' own flags |
| created_at / updated_at | timestamptz | `TimestampMixin` |

Index: `ix_menu_section_location_order (location_id, display_order)`.

## restaurant_location — `menu_hidden`, `deals_hidden` (migration `0014_hide_menu_and_deals`)

Two NOT NULL boolean columns, `server_default false`, so every existing
location stays fully visible with no backfill:

| Column | Meaning |
|---|---|
| menu_hidden | the ENTIRE menu is hidden from the public menu read (menu rows are untouched) |
| deals_hidden | "Hide all deals": every public deal surface behaves as if the location had no deals (per-deal `deal.is_active` untouched and independent) |

Judgment call — plain columns on the location rather than a per-location
settings table: they are read on every public menu/deal path, there are only
two, and a table would add a join to each of those reads (and a second audit
surface). Changes are audited as `restaurant_location` `update` rows with the
old/new value of the one column.

## menu_item

One dish/drink on a location's menu. Migration `0013_menu`. Model:
`backend/app/models/menu_item.py`.

| Column | Type | Notes |
|---|---|---|
| id | bigint PK | |
| location_id | bigint FK → restaurant_location.id | `ON DELETE CASCADE`; NOT NULL. Stored redundantly next to `section_id` so permission checks and the public read are one indexed predicate (no join) and ungrouped items still belong to a location |
| section_id | bigint FK → menu_section.id | nullable (**ungrouped** item); `ON DELETE SET NULL` (safety net — the service explicitly ungroups or deletes a deleted group's items, with audit rows) |
| name | varchar(150) | NOT NULL, free text |
| description | varchar(1000) | nullable |
| price | varchar(50) | nullable; **free text**, never parsed (`"$12"`, `"12 / 18"`, `"Market price"`). NULL when the item is sized |
| sizes | json | nullable; ordered list of 1..6 `{"label": str(<=40), "price": str(<=50)}`; array order = display order. NULL for a single-price item |
| display_order | integer | NOT NULL default 0; ordering is within `(location_id, section_id)` |
| photo_s3_key | varchar(512) | nullable; predicted `processed/…` key; only read/written while the photo flag is on |
| photo_thumbnail_s3_key | varchar(512) | nullable; predicted `thumbnails/…` key |
| is_hidden | boolean | NOT NULL default `false` (migration `0014_hide_menu_and_deals`). Non-destructive "hide this dish" (e.g. sold out): excluded from the public menu, kept in the editor |
| created_at / updated_at | timestamptz | `TimestampMixin` |

Index: `ix_menu_item_location_section_order (location_id, section_id, display_order)`.

**Price invariant: exactly one of `price` / `sizes` is non-NULL** (never both,
never neither — "price is mandatory" holds either way). Both columns are
nullable because the rule spans two columns; it is enforced in
`app/schemas/menu.py` (request shape) and re-checked on the merged state in
`app/services/menu_service.py` (PATCH), like the other cross-field rules in
this schema (e.g. `deal` start/end).

Design decisions:

- **Sizes as an inline JSON list, not a `menu_item_size` table.** Sizes have
  no identity or life of their own (never referenced elsewhere, never queried
  across items, always read/written with the item), so a child table would
  only add a join to every public read, another table to cascade on location
  delete, and a second audit surface; inline JSON audits with the item for
  free. Plain `JSON` (not `JSONB`/`ARRAY`) so the SQLite test DB works — the
  same precedent as `deal.applicable_days` and
  `restaurant_location.specialties`. Bounded to 6 entries by validation.
- **Ungrouped items** (`section_id IS NULL`) render first on the public menu,
  under no heading.
- **Deleting a group** defaults to non-destructive: its items move to
  ungrouped (appended, order preserved); `delete_items=true` deletes them too.
  Both paths audit every affected row.
- **No ORM relationships** between menu_section / menu_item / location: all
  access is explicit queries in the service, so an ORM delete can never try to
  NULL a NOT NULL FK (the failure that forced `remove_location` onto a Core
  `delete()`).
- **Location hard delete** (`DELETE /locations/{id}/permanent`,
  `location_service.remove_location`) still works with menu rows present: both
  tables' `location_id` FKs are `ON DELETE CASCADE`, exercised by
  `tests/integration/test_menu.py::test_permanent_location_delete_cascades_menu`.
  A soft-deleted brand / non-active location's menu is hidden from the public
  by the same visibility gate as `GET /locations/{id}`.
- **Free tier:** no `is_paid` column or check on the menu or its prices
  (`docs/DECISIONS.md` "Full menu with prices moved to free tier").
- Caps (service-enforced, `409`): 30 groups and 300 items per location.

## platform_config — `menu_item_photos_enabled`

The generic key/text `platform_config` table (`backend/app/models/platform_config.py`)
gains one seeded row in migration `0013_menu`: `menu_item_photos_enabled =
"false"`. It gates the whole menu-item photo capability (upload URL, attach,
remove, and every photo URL in responses). A missing row, an empty value or
unparsable text all read as **off**. Flipped with the `set_platform_flag`
management command (`docs/SCRIPTS.md`). Future intent (not implemented): gate
additionally by `restaurant_location.is_paid` when paid tiers exist.

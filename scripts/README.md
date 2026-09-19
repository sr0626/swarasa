# Dev/ops scripts

Human-run utility scripts. Nothing in this repo invokes anything here
automatically — no CI job, no application code path. These exist so a
person can run a repeatable, documented command instead of ad-hoc `aws`
calls, following the same "hand over the exact command, the human runs it"
convention as the rest of this project (root `CLAUDE.md` "NEVER run any
AWS CLI or SDK command ... without explicit permission").

Distinct from `backend/app/scripts/` — those are management commands that
run *inside* the deployed Lambda (the only thing that can reach Aurora, a
VPC-only database with no NAT/bastion/RDS Data API). Several scripts here
are thin wrappers that invoke one of those commands from your own machine.

## Prerequisites

- AWS CLI configured with the `swarasa-dev` profile (or pass `--profile`).
  If your SSO session has expired: `aws sso login --profile swarasa-dev`.
- For anything that invokes a backend management command, that command
  must already be deployed (its PR merged, backend redeployed) — a script
  will fail clearly, not silently, if the Lambda doesn't recognize it yet.

## Scripts

### `delete_test_user.py`
Fully removes one user by email — local DB rows (via the
`delete_user_data` management command) plus the Cognito user itself — so
the same email can be reused for another manual sign-up test. See its own
module docstring for exactly what it does and does not touch (never
destroys a claimed brand's restaurant data, only unclaims it).

```bash
python3 scripts/delete_test_user.py --email someone@example.com
```

### `list_users.py`
Lists every email currently in the Cognito user pool, with status and pool
group membership — useful for checking what's already registered before
deciding what to clean up, or for spotting a self-signed-up user stuck
with no group (the pre-PR-#84 symptom).

```bash
python3 scripts/list_users.py
```

### `bulk_import_restaurants_csv.py`
Reads a local CSV of restaurants (`name`, `address_line1`, `city`, `state`,
`postal_code`, `owner_email` required; `address_line2`, `country`, `phone`,
`website`, `type` [free-text cuisine], `description`, `latitude`,
`longitude` optional), geocodes any row missing `latitude`/`longitude` via
Nominatim (OpenStreetMap — free, no API key, rate-limited to this script's
own machine), and invokes the `bulk_import_restaurants` management
command's CSV path with the result. Each row resolves its own
`owner_email` to an EXISTING `owner_account` (never creates one) and
matches `type` against `cuisine_tag.name`/`display_name` case-insensitively
(unmatched is reported, not a failure). Geocoding happens here rather than
inside the Lambda deliberately — see the script's own module docstring
"Why geocoding happens HERE, not inside the Lambda" (the Lambda has no
NAT Gateway, so no route to the public internet at all).

```bash
python3 scripts/bulk_import_restaurants_csv.py --csv-file restaurants.csv
python3 scripts/bulk_import_restaurants_csv.py --csv-file restaurants.csv --dry-run
```

### `dev_unclaim_restaurants.py`
Un-assigns restaurants (owner removed, marked unclaimed) so the public
"Claim this restaurant" flow can be tested. Defaults to two searchable
seeded restaurants; pass `--slugs` for others, `--dry-run` to preview.
Dev database only. Reversible via an approved claim or a re-import.

```bash
python3 scripts/dev_unclaim_restaurants.py
python3 scripts/dev_unclaim_restaurants.py --slugs dera-grill taj-chaat-house
```

### `geocode_missing_locations.py`
Backfills coordinates for active locations with NULL `geom` (invisible to geo
search). Lists them via the `list_ungeocoded_locations` command, geocodes on
your machine via Nominatim (full address, then street+city+state, then an
approximate postal-code lookup; 1 req/sec), prints a resolved/unresolved
table, then sends only the resolved ones to `set_location_coordinates`
(validated, audit-logged, idempotent, never moves an already-set point).
Run `--dry-run` first — it geocodes and prints but writes nothing.

```bash
python3 scripts/geocode_missing_locations.py --dry-run
python3 scripts/geocode_missing_locations.py
```

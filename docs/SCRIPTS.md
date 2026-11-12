# Scripts you run by hand

All run from the repo root, against **dev**. Refresh SSO first if needed:
`aws sso login --profile swarasa-dev`. Add `--dry-run` where offered.

## Python scripts (`scripts/`)

| Script | What it does | Example |
|---|---|---|
| `list_users.py` | List Cognito users, status and groups | `python3 scripts/list_users.py` |
| `delete_test_user.py` | Remove a test user (DB rows + Cognito) | `python3 scripts/delete_test_user.py --email a@b.com` |
| `dev_unclaim_restaurants.py` | Unclaim restaurants to re-test the claim flow | `python3 scripts/dev_unclaim_restaurants.py --slugs dera-grill` |
| `bulk_import_restaurants_csv.py` | Import restaurants from a CSV (geocodes rows without lat/lng) | `python3 scripts/bulk_import_restaurants_csv.py --csv-file r.csv --dry-run` (see "Bulk import" below) |
| `geocode_missing_locations.py` | Backfill coordinates for locations without any | `python3 scripts/geocode_missing_locations.py --dry-run` |

`delete_test_user.py --skip-cognito-delete` cleans DB rows only.
`dev_unclaim_restaurants.py` with no `--slugs` unclaims the built-in two.

## Bulk import (CSV)

**Preferred path: Admin > Import (`/admin/import`)** — upload a CSV in the browser, get
a per-row check (errors, warnings, duplicates, rows with no coordinates), confirm, and
download the per-row result. Listings it creates are **unclaimed** (no `owner_email`
column; it is ignored if present) and verified, but **always created hidden (`coming_soon`)**,
even when complete: you open each one in the location editor, finish what is missing and
activate it (the server refuses activation until name, full address, valid US phone and opening
hours for all 7 days exist). The check and the results (and the downloadable CSVs) show a
`missing` list per row; empty = ready to activate. Find them in Admin > Listings with the
"Coming soon" filter. Re-uploading the same file creates nothing. It geocodes rows without coordinates itself. See docs/API_CONTRACTS.md "Admin bulk
listing import". The script below is the older **owner-assigned** path (every row needs an
existing `owner_email`) and the way to import without the browser.

Start from `scripts/data/restaurants_import_template.csv` (3 fake rows: replace them).
The page's own template (header only) has no `owner_email` column.

**Columns** (header row required, any order, blank cell = not given):

| Column | | Notes |
|---|---|---|
| `name`, `address_line1`, `city`, `state`, `postal_code` | required | `state` = 2 letters |
| `owner_email` | required | Must already be an owner account (log in once as them); unknown email = row error, nothing is created |
| `phone` | optional | 10-digit US, area code and exchange start 2-9, e.g. `(214) 555-0142`; stored `+1XXXXXXXXXX`; invalid = row error |
| `type` | optional | **One** tag per row, applied to that location. Use a tag `name` (`south_indian`) or display name (`South Indian`), any case. Unknown = imported with no tag. List: `backend/app/scripts/taxonomy.json` or `GET /cuisine-tags` |
| `address_line2`, `country` (default `US`), `website`, `description` | optional | |
| `latitude`, `longitude` | optional | Both or neither; blank = script geocodes it (Nominatim, ~1 s/row) |
| `hours` | optional, **last column** | One line, 24-hour times, days `Mon`..`Sun`: `Mon-Fri 11:00-22:00; Sat 11:00-23:00; Sun closed`, or `daily 11:00-22:00`. Ranges may wrap (`Sat-Mon`); a close earlier than the open means after midnight (`Fri 17:00-02:00`); `closed` for a closed day. One window per day, no AM/PM, no day listed twice. Anything not understood = a **warning** and the row imports **without hours** (never partial hours, never a row error). Covering all 7 days removes "hours" from the row's missing list |

Not supported: several tags per row, split-shift hours, timezone (always America/Chicago).
Every imported listing is **coming soon (hidden) + verified**, free tier, slug auto-generated,
**even when nothing is missing** - activate it in the location editor. The script prints what each
created row still needs. Max 500 rows.
Re-running is safe: same restaurant name + address is skipped (name owned by a different owner = row error).

```bash
# 1. Validate locally (no network, no AWS) - phones, states, coords, unknown tags
python3 scripts/bulk_import_restaurants_csv.py --csv-file my.csv --validate-only
# 2. Also geocode and print what would be sent (Nominatim only, no AWS)
python3 scripts/bulk_import_restaurants_csv.py --csv-file my.csv --dry-run
# 3. Import - YOU RUN THIS (invokes the Lambda)
python3 scripts/bulk_import_restaurants_csv.py --csv-file my.csv
# 4. Fix any rows the geocoder missed (they are invisible in search) - YOU RUN THIS
python3 scripts/geocode_missing_locations.py --dry-run
python3 scripts/geocode_missing_locations.py
```

**Verify:** the script prints created / skipped / errors and each row's error text;
then check Admin > Listings.
**Undo:** no bulk undo. In Admin > Listings use **Delete listing** per restaurant
(soft delete; the name stays reserved) and restore it from "Deleted listings".

## Lambda management commands (run inside the backend Lambda)

Anything that touches the database goes through the API Lambda. Pattern:

```bash
aws lambda invoke --function-name swarasa-api-dev --profile swarasa-dev --region us-east-1 \
  --cli-binary-format raw-in-base64-out \
  --payload '{"_management_command": "seed_taxonomy"}' /dev/stdout
```

| Command | Use |
|---|---|
| `alembic_upgrade` | Apply DB migrations (run after a deploy with a new migration) |
| `seed_taxonomy` | Load cuisine/dietary/type tags (idempotent) |
| `seed_random_hours` | Fake weekly hours for locations with none (dev only) |
| `seed_random_phones` | Fake 555-01XX phones for locations with none (dev only) |
| `seed_dev_data` | Small dev sample data set |
| `dev_unclaim_restaurants` | Payload `"slugs": ["dera-grill"]` (usually via the script above) |
| `list_ungeocoded_locations` / `set_location_coordinates` | Used by `geocode_missing_locations.py` |
| `bulk_import_restaurants` | Used by `bulk_import_restaurants_csv.py` |
| `delete_user_data` | Used by `delete_test_user.py` |
| `set_platform_flag` | Flip a platform feature flag in `platform_config`. Payload `"key"` + `"value"` (true/false; omit `value` to just read it). Only known keys are accepted — today `menu_item_photos_enabled` (menu-item photos are built but **off** until paid tiers exist), e.g. `--payload '{"_management_command": "set_platform_flag", "key": "menu_item_photos_enabled", "value": true}'` |
| `deactivate_incomplete_listings` | Hide (set `coming_soon`) every currently **active** listing missing required info (name, full address, valid US phone, all 7 days of hours - the same rule as activation). **Dry run by default**; see "Clean up incomplete live listings" below |
| `set_user_name` | Admin changes a user's already-set (locked) name. Payload `"email"` (or `"cognito_sub"`) + `"full_name"`; audit-logged for owners; refuses a user with no name yet |

### Clean up incomplete live listings (`deactivate_incomplete_listings`)

For listings that went live before imports respected the readiness rule (e.g. imported with no
hours). **You run these** (an agent never does). Step 1 only reports; step 2 changes data.

```bash
# 1. DRY RUN (default): counts + a capped list (100) of location ids/names and what each is missing. Changes nothing.
aws lambda invoke --function-name swarasa-api-dev --profile swarasa-dev --region us-east-1 \
  --cli-binary-format raw-in-base64-out \
  --payload '{"_management_command":"deactivate_incomplete_listings"}' /dev/stdout

# 2. APPLY: sets status='coming_soon' on every active location that fails the check
#    (one audit_log row each, actor system:deactivate_incomplete_listings).
aws lambda invoke --function-name swarasa-api-dev --profile swarasa-dev --region us-east-1 \
  --cli-binary-format raw-in-base64-out \
  --payload '{"_management_command":"deactivate_incomplete_listings","apply":true}' /dev/stdout

# Optional: only brands with no owner (e.g. just the imported ones)
aws lambda invoke --function-name swarasa-api-dev --profile swarasa-dev --region us-east-1 \
  --cli-binary-format raw-in-base64-out \
  --payload '{"_management_command":"deactivate_incomplete_listings","apply":true,"only_unclaimed":true}' /dev/stdout
```

Idempotent (a second run finds nothing), never touches locations that are already hidden, already
complete, or whose restaurant is deleted. `apply` / `only_unclaimed` must be real JSON booleans
(`"apply":"true"` is rejected). Output: `mode` (`dry_run`/`apply`), `checked_active`, `incomplete`,
`changed`, `missing_counts`, `listings[]` (`location_id`, `name`, `city`, `missing`),
`listings_truncated`. **Undo:** set a listing back to Active in the location editor once it is complete
(the editor lists exactly what is still needed).

## Infra (Terraform, from `infra/`)

```bash
export AWS_PROFILE=swarasa-dev
terraform plan  -var-file=envs/dev.tfvars
terraform apply -var-file=envs/dev.tfvars
```

## Handy checks

```bash
aws logs tail /aws/lambda/swarasa-api-dev --profile swarasa-dev --region us-east-1 --since 15m
aws cognito-idp admin-add-user-to-group --user-pool-id us-east-1_w2387tOf6 \
  --username <sub-or-email> --group-name owner --profile swarasa-dev --region us-east-1
```

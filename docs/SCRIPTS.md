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

No admin upload page yet — import is this script only. Start from
`scripts/data/restaurants_import_template.csv` (3 fake rows: replace them).

**Columns** (header row required, any order, blank cell = not given):

| Column | | Notes |
|---|---|---|
| `name`, `address_line1`, `city`, `state`, `postal_code` | required | `state` = 2 letters |
| `owner_email` | required | Must already be an owner account (log in once as them); unknown email = row error, nothing is created |
| `phone` | optional | 10-digit US, area code and exchange start 2-9, e.g. `(214) 555-0142`; stored `+1XXXXXXXXXX`; invalid = row error |
| `type` | optional | **One** tag per row, applied to that location. Use a tag `name` (`south_indian`) or display name (`South Indian`), any case. Unknown = imported with no tag. List: `backend/app/scripts/taxonomy.json` or `GET /cuisine-tags` |
| `address_line2`, `country` (default `US`), `website`, `description` | optional | |
| `latitude`, `longitude` | optional | Both or neither; blank = script geocodes it (Nominatim, ~1 s/row) |

Not supported: opening hours, several tags per row, timezone (always America/Chicago).
Every imported listing is **active + verified**, free tier, slug auto-generated. Max 500 rows.
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
| `set_user_name` | Admin changes a user's already-set (locked) name. Payload `"email"` (or `"cognito_sub"`) + `"full_name"`; audit-logged for owners; refuses a user with no name yet |

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

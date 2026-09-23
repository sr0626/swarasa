# Scripts you run by hand

All run from the repo root, against **dev**. Refresh SSO first if needed:
`aws sso login --profile swarasa-dev`. Add `--dry-run` where offered.

## Python scripts (`scripts/`)

| Script | What it does | Example |
|---|---|---|
| `list_users.py` | List Cognito users, status and groups | `python3 scripts/list_users.py` |
| `delete_test_user.py` | Remove a test user (DB rows + Cognito) | `python3 scripts/delete_test_user.py --email a@b.com` |
| `dev_unclaim_restaurants.py` | Unclaim restaurants to re-test the claim flow | `python3 scripts/dev_unclaim_restaurants.py --slugs dera-grill` |
| `bulk_import_restaurants_csv.py` | Import restaurants from a CSV (geocodes rows without lat/lng) | `python3 scripts/bulk_import_restaurants_csv.py --csv-file r.csv --dry-run` |
| `geocode_missing_locations.py` | Backfill coordinates for locations without any | `python3 scripts/geocode_missing_locations.py --dry-run` |

`delete_test_user.py --skip-cognito-delete` cleans DB rows only.
`dev_unclaim_restaurants.py` with no `--slugs` unclaims the built-in two.

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

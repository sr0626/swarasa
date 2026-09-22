# Seed data files

Input files for the scripts one directory up. Nothing here runs itself —
see `../README.md` for the scripts that consume these.

## `dfw_multi_city_restaurants.csv`

~17 obviously-fictional Indian restaurants (every name suffixed
"(Test Data)", every `description` cell says so explicitly too) spread
across 8 real DFW cities that aren't Irving: Plano, Frisco, Dallas,
Arlington, Fort Worth, Richardson, Carrollton, McKinney. All current
seeded/imported restaurants (the 26-row Irving import, `docs/PROJECT_PLAN.csv`
"CSV bulk restaurant import") are in Irving, TX only — this file exists so
geo search / multi-city display can be exercised against something else.

- **Addresses are real, geocodable DFW streets** (e.g. Greenville Ave and
  McKinney Ave in Dallas, Camp Bowie Blvd in Fort Worth, Coit Rd in
  Richardson) so `bulk_import_restaurants_csv.py`'s Nominatim geocoding
  step lands them at genuine coordinates — same "real address, fake
  business" split the existing Irving seed doesn't need (those are real
  businesses) but `backend/app/scripts/seed_dev_data.py`'s "(Dev Seed)"
  brands already use.
- **Names and descriptions are obviously fictional** — invented names
  (no real business was used), and every `description` cell states
  outright this is dev/test data, not a real restaurant.
- **Phones** follow the same NANP fictional-reserved block
  (`555-0100`..`555-0199`) the existing `seed_random_phones` command uses
  (`backend/app/scripts/seed_random_hours.py`), extended with Fort
  Worth/Arlington's real `817` area code alongside the existing
  `214`/`469`/`972` DFW codes already established there — still
  guaranteed not to ring a real person regardless of area code, since the
  safety property is the reserved last-4-digit block, not the area code.
- **`owner_email`** is `owner3@test.com` or `owner4@test.com`,
  alternating — the short test-owner convention from
  `../create_test_users.py`.

### Run order (this matters)

`bulk_import_restaurants_csv.py` resolves `owner_email` against an
EXISTING `owner_account` row — it never creates one (see that script's
own module docstring). A freshly Cognito-created `owner3@test.com` does
**not** automatically have an `owner_account` row; that row is only
lazy-provisioned the first time something calls `GET /auth/me` for that
identity. So, in order:

1. `python3 scripts/create_test_users.py` — creates `owner3@test.com` /
   `owner4@test.com` (and the other role users) in Cognito, idempotent.
2. Get an `owner_account` row provisioned for `owner3@test.com` and
   `owner4@test.com` — easiest path: log into the frontend once as each
   (password `Test123$`, any request that hits `GET /auth/me` creates the
   row). Alternative: add them to
   `backend/app/scripts/seed_dev_identities.json` and run `seed_dev_data`
   (see that script's docstring), which provisions `owner_account` rows
   the same way without a real browser login.
3. `python3 scripts/bulk_import_restaurants_csv.py --csv-file scripts/data/dfw_multi_city_restaurants.csv`
   — add `--dry-run` first to preview the geocoding without invoking the
   Lambda.

Skipping step 2 doesn't corrupt anything — each affected row just comes
back as a per-row `error` ("No existing owner_account for owner_email
..."), never a batch failure; re-run the import after step 2 completes
and those rows will succeed.

#!/usr/bin/env python3
"""Bulk-import restaurants from a local CSV file via the backend Lambda's
`bulk_import_restaurants` management command
(`backend/app/scripts/management.py`, CSV branch --
`backend/app/services/restaurant_bulk_import_service.py`'s
`bulk_import_restaurants_csv`).

This is a HUMAN-run script -- it makes real AWS calls (one `aws lambda
invoke`, plus a Nominatim HTTP call per row that needs geocoding). Root
CLAUDE.md "NEVER run any AWS CLI or SDK command that touches real AWS ...
without explicit permission for that exact command, every single time"
applies to agents, not to you running this yourself; nothing in this repo
invokes this script automatically. Same conventions as
`scripts/delete_test_user.py`/`scripts/list_users.py` (argparse, shells
out to `aws lambda invoke`, never runs itself against real AWS).

-------------------------------------------------------------------------
Why geocoding happens HERE, not inside the Lambda
-------------------------------------------------------------------------
The deployed Lambda sits in private VPC subnets with NO NAT Gateway
(`infra/modules/networking/main.tf`: "Private subnets -- Lambda + Aurora
live here; no NAT Gateway", and root CLAUDE.md "NEVER create a NAT
Gateway") -- it has a route to Aurora but no route to the public
internet, so it cannot call a third-party geocoding API
(nominatim.openstreetmap.org) itself. This script runs on YOUR machine,
which does have normal internet access, so geocoding happens here, once,
before the enriched CSV (now carrying `latitude`/`longitude` columns) is
handed to the Lambda purely for the DB write. This is the same real
pattern `backend/app/scripts/irving_restaurants_seed.json` already used
for its Irving, TX seed rows (geocoded once via Nominatim before being
committed) -- see that file's own `_comment` field.

Nominatim usage policy (https://operations.osmfoundation.org/policies/nominatim/):
free, no API key, but max 1 request/second and a descriptive `User-Agent`
identifying the application -- both honored below.

-------------------------------------------------------------------------
Input CSV format
-------------------------------------------------------------------------
Required columns (header row, any order):
    name, address_line1, city, state, postal_code, owner_email

Optional columns:
    address_line2, country (default "US"), phone, website, type,
    description, latitude, longitude

`type` is free-text regional/dietary/type cuisine, e.g. "south indian",
"vegetarian", "biryani" -- matched case-insensitively against
`cuisine_tag.name`/`display_name` server-side and applied to that row's
LOCATION (tags are per location); no match is reported per
row, not treated as a failure. `owner_email` must belong to an EXISTING
`owner_account` -- a typo'd email is a per-row error, not silently
provisioned (root CLAUDE.md doesn't allow this script to create Cognito
users or owner_account rows). If `latitude`/`longitude` are already
present for a row, this script leaves them alone and does not geocode
that row (lets you pre-fill known coordinates and skip the Nominatim
round-trip for them).

Local validation (no network, no AWS): before anything else the script checks
every row against the same rules the server applies -- required cells
non-blank, 2-letter state/country, numeric in-range latitude/longitude, and
the shared US phone rule (`backend/app/core/phone.py`, imported directly) --
and refuses to continue if any row is invalid. `type` values that match no
tag in `backend/app/scripts/taxonomy.json` are printed as warnings only. A
starter file with valid example rows: `scripts/data/restaurants_import_template.csv`.

Usage:
    python3 scripts/bulk_import_restaurants_csv.py --csv-file restaurants.csv --validate-only
    python3 scripts/bulk_import_restaurants_csv.py --csv-file restaurants.csv --dry-run
    python3 scripts/bulk_import_restaurants_csv.py --csv-file restaurants.csv
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# Reuse the server's own phone rule (stdlib-only module) so a bad number is
# caught here, before geocoding or any AWS call.
_REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO_ROOT / "backend"))
from app.core.phone import US_PHONE_ERROR, normalize_us_phone  # noqa: E402

TAXONOMY_PATH = _REPO_ROOT / "backend" / "app" / "scripts" / "taxonomy.json"

DEFAULT_PROFILE = "swarasa-dev"
DEFAULT_REGION = "us-east-1"
DEFAULT_FUNCTION_NAME = "swarasa-api-dev"

# Nominatim policy requires a descriptive User-Agent identifying the
# application (not a generic library default) -- see this file's module
# docstring "Nominatim usage policy" section.
NOMINATIM_USER_AGENT = "swarasa-restaurant-directory-bulk-import/1.0 (dev tooling; contact via repo owner)"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
NOMINATIM_RATE_LIMIT_SECONDS = 1.0  # policy max: 1 request/second

REQUIRED_COLUMNS = {"name", "address_line1", "city", "state", "postal_code", "owner_email"}
OUTPUT_COLUMNS = [
    "name", "description", "website",
    "address_line1", "address_line2", "city", "state", "postal_code", "country",
    "phone", "type", "owner_email", "latitude", "longitude",
]


def read_input_csv(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames is None:
            print(f"{path} has no header row.", file=sys.stderr)
            sys.exit(1)
        headers = {h.strip() for h in reader.fieldnames if h}
        missing = REQUIRED_COLUMNS - headers
        if missing:
            print(
                f"{path} is missing required column(s): {', '.join(sorted(missing))}. "
                f"See this script's module docstring for the full column list.",
                file=sys.stderr,
            )
            sys.exit(1)
        rows = [
            {k.strip(): (v.strip() if isinstance(v, str) else v) for k, v in row.items() if k}
            for row in reader
        ]
    rows = [row for row in rows if any(row.values())]
    if not rows:
        print(f"{path} has a header row but no data rows.", file=sys.stderr)
        sys.exit(1)
    return rows


def _tag_forms() -> set[str]:
    """Every accepted `type` spelling (lower-cased name slug and display name)
    from the seed taxonomy -- a local approximation of the server's
    `cuisine_tag` match, used for warnings only."""
    try:
        tags = json.loads(TAXONOMY_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return set()
    forms: set[str] = set()
    for tag in tags:
        forms.add(tag["name"].lower())
        forms.add(tag["display_name"].lower())
    return forms


def validate_rows(rows: list[dict]) -> tuple[list[str], list[str]]:
    """Mirror the server-side row rules locally. Returns (errors, warnings);
    row numbers are CSV line numbers (header = line 1)."""
    errors: list[str] = []
    warnings: list[str] = []
    known_tags = _tag_forms()
    for i, row in enumerate(rows, start=2):
        label = f"line {i} ({row.get('name') or '<no name>'})"
        for col in sorted(REQUIRED_COLUMNS):
            if not row.get(col):
                errors.append(f"{label}: '{col}' is blank")
        if row.get("state") and len(row["state"]) != 2:
            errors.append(f"{label}: state {row['state']!r} must be a 2-letter code")
        if row.get("country") and len(row["country"]) != 2:
            errors.append(f"{label}: country {row['country']!r} must be a 2-letter code")
        if row.get("phone") and normalize_us_phone(row["phone"]) is None:
            errors.append(f"{label}: invalid phone {row['phone']!r}: {US_PHONE_ERROR}")
        for col, limit in (("latitude", 90), ("longitude", 180)):
            if row.get(col):
                try:
                    if abs(float(row[col])) > limit:
                        raise ValueError
                except ValueError:
                    errors.append(f"{label}: {col} {row[col]!r} is not a number within +/-{limit}")
        if bool(row.get("latitude")) != bool(row.get("longitude")):
            errors.append(f"{label}: give both latitude and longitude, or neither")
        type_text = (row.get("type") or "").strip().lower()
        if known_tags and type_text and type_text.replace(" ", "_").replace("-", "_") not in known_tags \
                and type_text not in known_tags:
            warnings.append(f"{label}: type {row['type']!r} matches no known cuisine tag (row imports without a tag)")
    return errors, warnings


def geocode(row: dict) -> tuple[float, float] | None:
    """One Nominatim structured-address lookup. Returns None (not an
    error) when nothing matches -- the row still gets imported without
    coordinates, same as a plain "no lat/lng supplied" row on the JSON
    bulk-import path; the search radius query just won't surface it until
    it's geocoded some other way later.
    """
    params = {
        "format": "json",
        "limit": "1",
        "street": row["address_line1"],
        "city": row["city"],
        "state": row["state"],
        "postalcode": row.get("postal_code", ""),
        "country": row.get("country") or "US",
    }
    url = f"{NOMINATIM_URL}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(url, headers={"User-Agent": NOMINATIM_USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            results = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        print(f"  ! geocoding failed for {row['name']!r}: {exc}", file=sys.stderr)
        return None
    if not results:
        return None
    return float(results[0]["lat"]), float(results[0]["lon"])


def geocode_missing_rows(rows: list[dict]) -> list[dict]:
    enriched: list[dict] = []
    to_geocode = [r for r in rows if not r.get("latitude") or not r.get("longitude")]
    if to_geocode:
        print(
            f"Geocoding {len(to_geocode)} of {len(rows)} row(s) via Nominatim "
            f"(rate-limited to {NOMINATIM_RATE_LIMIT_SECONDS}s/request -- this will take "
            f"~{len(to_geocode) * NOMINATIM_RATE_LIMIT_SECONDS:.0f}s)..."
        )
    for row in rows:
        row = dict(row)
        if row.get("latitude") and row.get("longitude"):
            enriched.append(row)
            continue
        coords = geocode(row)
        if coords is not None:
            row["latitude"], row["longitude"] = coords
            print(f"  - {row['name']}: {coords[0]:.6f}, {coords[1]:.6f}")
        else:
            row["latitude"], row["longitude"] = None, None
            print(f"  - {row['name']}: no geocoding match -- imported without coordinates")
        enriched.append(row)
        time.sleep(NOMINATIM_RATE_LIMIT_SECONDS)
    return enriched


def build_csv_content(rows: list[dict]) -> str:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=OUTPUT_COLUMNS, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({col: row.get(col, "") for col in OUTPUT_COLUMNS})
    return buf.getvalue()


def invoke_lambda(csv_content: str, profile: str, region: str, function_name: str) -> dict:
    payload = {"_management_command": "bulk_import_restaurants", "csv_content": csv_content}

    with tempfile.TemporaryDirectory() as tmp:
        payload_path = Path(tmp) / "payload.json"
        result_path = Path(tmp) / "result.json"
        payload_path.write_text(json.dumps(payload))

        aws_args = [
            "aws", "lambda", "invoke",
            "--profile", profile,
            "--region", region,
            "--function-name", function_name,
            "--cli-binary-format", "raw-in-base64-out",
            "--payload", f"file://{payload_path}",
            str(result_path),
        ]
        print(f"  $ {' '.join(aws_args)}")
        proc = subprocess.run(aws_args, capture_output=True, text=True)
        if proc.returncode != 0:
            print(proc.stderr, file=sys.stderr)
            print("Lambda invoke itself failed (network/auth/permissions).", file=sys.stderr)
            sys.exit(1)

        return json.loads(result_path.read_text())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--csv-file", required=True, type=Path, help="Local CSV file to import.")
    parser.add_argument("--profile", default=DEFAULT_PROFILE)
    parser.add_argument("--region", default=DEFAULT_REGION)
    parser.add_argument("--function-name", default=DEFAULT_FUNCTION_NAME)
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="Validate the CSV locally (no network, no AWS) and exit.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse and geocode only -- print the enriched CSV, skip the Lambda invoke.",
    )
    args = parser.parse_args()

    if not args.csv_file.exists():
        print(f"{args.csv_file} does not exist.", file=sys.stderr)
        sys.exit(1)

    rows = read_input_csv(args.csv_file)
    print(f"Read {len(rows)} row(s) from {args.csv_file}.")

    errors, warnings = validate_rows(rows)
    for message in warnings:
        print(f"  warning: {message}")
    if errors:
        for message in errors:
            print(f"  error: {message}", file=sys.stderr)
        print(f"\n{len(errors)} problem(s) found -- fix the CSV and re-run. Nothing was sent.", file=sys.stderr)
        sys.exit(1)
    print("Validation passed.")
    if args.validate_only:
        return

    enriched_rows = geocode_missing_rows(rows)
    csv_content = build_csv_content(enriched_rows)

    if args.dry_run:
        print("\n--dry-run set: not invoking the Lambda. Enriched CSV that would be sent:\n")
        print(csv_content)
        return

    print(f"\nInvoking '{args.function_name}' bulk_import_restaurants (CSV path)...")
    result = invoke_lambda(csv_content, args.profile, args.region, args.function_name)
    print(f"\n{json.dumps(result, indent=2)}")

    if not result.get("ok"):
        print(f"\nbulk_import_restaurants reported failure: {result.get('error')}", file=sys.stderr)
        sys.exit(1)

    summary = result.get("summary", {})
    print(
        f"\nDone. created={summary.get('created')} skipped={summary.get('skipped')} "
        f"errors={summary.get('errors')}"
    )
    unmatched = [
        row for row in result.get("rows", [])
        if row.get("cuisine_type_input") and not row.get("cuisine_match")
    ]
    if unmatched:
        print(f"\n{len(unmatched)} row(s) had an unmatched cuisine 'type' value:")
        for row in unmatched:
            print(f"  - {row['name']!r}: {row['cuisine_type_input']!r} did not match any cuisine_tag")


if __name__ == "__main__":
    main()

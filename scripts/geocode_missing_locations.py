#!/usr/bin/env python3
"""Backfill coordinates for restaurant locations that have none, so they
appear in geo search. Some imported restaurants ended up with NULL
latitude/longitude/geom (Nominatim missed them at import time); the search
API only returns rows with a `geom`, so those are invisible until fixed.

HUMAN-run script -- it makes real AWS calls (two `aws lambda invoke`s) plus
one or more Nominatim HTTP calls per location. Root CLAUDE.md's "no AWS
command without explicit permission" rule applies to agents, not to you
running this yourself; nothing runs it automatically. Same conventions as
`scripts/bulk_import_restaurants_csv.py` and `scripts/dev_unclaim_restaurants.py`.

What it does
  1. Invokes the Lambda management command `list_ungeocoded_locations`
     (read-only): active locations with NULL geom.
  2. Geocodes each one via Nominatim ON YOUR MACHINE, trying in order
        a. full structured address  (street, city, state, postal code)
        b. street + city + state    (drops a wrong/odd postal code)
        c. postal code + state      (APPROXIMATE -- a ZIP-area point, not the
                                     building; flagged "zip-approx" in the table)
     and stopping at the first hit. Step (c) can be disabled with
     --no-postal-fallback if you'd rather leave such rows unresolved.
  3. Prints a table of resolved / unresolved locations.
  4. Unless --dry-run, invokes `set_location_coordinates` with ONLY the
     resolved ones. The Lambda validates lat/lng ranges and a plausible-US
     bounding box per entry, writes latitude + longitude + PostGIS geom,
     and writes an audit_log row per location. It is idempotent and never
     moves a point that is already set (so re-running is safe).

Geocoding never happens inside the Lambda: it sits in private subnets with
no NAT Gateway, so it has no route to the internet (see the "Why geocoding
happens HERE" section of scripts/bulk_import_restaurants_csv.py).

Nominatim usage policy (https://operations.osmfoundation.org/policies/nominatim/):
max 1 request/second and a descriptive User-Agent -- both honored (the
1s spacing applies to every request, fallbacks included).

Prerequisites: AWS CLI + the `swarasa-dev` profile (`aws sso login --profile
swarasa-dev` if expired); the two commands must already be deployed (this
script's PR merged and the backend redeployed) or the first invoke reports
"Unknown management command".

Usage (run from the repo root):
    # 1. Preview: lists + geocodes + prints the table; writes NOTHING.
    python3 scripts/geocode_missing_locations.py --dry-run

    # 2. For real: same, then sends the resolved coordinates to the Lambda.
    python3 scripts/geocode_missing_locations.py

Options: --profile (swarasa-dev), --region (us-east-1), --function-name
(swarasa-api-dev), --no-postal-fallback, --dry-run.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Callable

DEFAULT_PROFILE = "swarasa-dev"
DEFAULT_REGION = "us-east-1"
DEFAULT_FUNCTION_NAME = "swarasa-api-dev"

# Same identification convention as scripts/bulk_import_restaurants_csv.py
# (Nominatim policy requires a descriptive, application-specific User-Agent).
NOMINATIM_USER_AGENT = "swarasa-restaurant-directory-geocode-backfill/1.0 (dev tooling; contact via repo owner)"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
NOMINATIM_RATE_LIMIT_SECONDS = 1.0  # policy max: 1 request/second

METHOD_FULL = "full-address"
METHOD_STREET = "street+city+state"
METHOD_POSTAL = "zip-approx"

Params = dict[str, str]
Fetch = Callable[[Params], "list[dict] | None"]  # None = request failed (as opposed to "no match")


def build_queries(loc: dict, include_postal_fallback: bool = True) -> list[tuple[str, Params]]:
    """Ordered (method, Nominatim structured-search params) attempts."""
    base: Params = {"format": "json", "limit": "1", "country": "US"}
    street = (loc.get("address_line1") or "").strip()
    city = (loc.get("city") or "").strip()
    state = (loc.get("state") or "").strip()
    postal = (loc.get("postal_code") or "").strip()

    queries: list[tuple[str, Params]] = []
    if street and city and state:
        queries.append((METHOD_FULL, {**base, "street": street, "city": city, "state": state, "postalcode": postal}))
        if postal:  # otherwise identical to the query above
            queries.append((METHOD_STREET, {**base, "street": street, "city": city, "state": state}))
    if include_postal_fallback and postal and state:
        queries.append((METHOD_POSTAL, {**base, "postalcode": postal, "state": state}))
    # Drop empty params (e.g. postalcode="") so Nominatim doesn't see blanks.
    return [(m, {k: v for k, v in p.items() if v != ""}) for m, p in queries]


def nominatim_fetch(params: Params) -> "list[dict] | None":
    url = f"{NOMINATIM_URL}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(url, headers={"User-Agent": NOMINATIM_USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        print(f"  ! Nominatim request failed: {exc}", file=sys.stderr)
        return None


def geocode_location(
    loc: dict,
    include_postal_fallback: bool = True,
    fetch: Fetch = nominatim_fetch,
    sleep: Callable[[float], None] = time.sleep,
) -> dict:
    """Tries each query in order; returns {"method", "latitude", "longitude"}
    on the first hit, else {"method": None, ...None}. Sleeps
    NOMINATIM_RATE_LIMIT_SECONDS after EVERY request so the 1 req/sec policy
    holds across locations and fallbacks alike."""
    for method, params in build_queries(loc, include_postal_fallback):
        results = fetch(params)
        sleep(NOMINATIM_RATE_LIMIT_SECONDS)
        if results:
            try:
                return {"method": method, "latitude": float(results[0]["lat"]), "longitude": float(results[0]["lon"])}
            except (KeyError, ValueError, TypeError):
                continue
    return {"method": None, "latitude": None, "longitude": None}


def format_table(rows: list[dict]) -> str:
    headers = ["id", "restaurant", "address", "status", "method", "lat", "lng"]
    body = []
    for r in rows:
        address = ", ".join(p for p in (r.get("address_line1"), r.get("city"), f"{r.get('state')} {r.get('postal_code')}") if p)
        ok = r["latitude"] is not None
        body.append([
            str(r["id"]), (r.get("brand_name") or "")[:30], address[:55],
            "resolved" if ok else "UNRESOLVED", r["method"] or "-",
            f"{r['latitude']:.6f}" if ok else "-", f"{r['longitude']:.6f}" if ok else "-",
        ])
    widths = [max(len(h), *(len(row[i]) for row in body)) if body else len(h) for i, h in enumerate(headers)]
    line = lambda cells: "  ".join(c.ljust(w) for c, w in zip(cells, widths)).rstrip()  # noqa: E731
    return "\n".join([line(headers), line(["-" * w for w in widths]), *(line(row) for row in body)])


def build_set_payload(rows: list[dict]) -> dict | None:
    """Only resolved rows are sent; None if nothing resolved."""
    entries = [
        {"location_id": r["id"], "latitude": r["latitude"], "longitude": r["longitude"]}
        for r in rows
        if r["latitude"] is not None and r["longitude"] is not None
    ]
    if not entries:
        return None
    return {"_management_command": "set_location_coordinates", "locations": entries}


def invoke_lambda(payload: dict, profile: str, region: str, function_name: str) -> dict:
    """Same helper shape as scripts/dev_unclaim_restaurants.py: prints the
    exact `aws lambda invoke` command, then returns the parsed response."""
    with tempfile.TemporaryDirectory() as tmp:
        payload_path = Path(tmp) / "payload.json"
        result_path = Path(tmp) / "result.json"
        payload_path.write_text(json.dumps(payload))
        cmd = [
            "aws", "lambda", "invoke",
            "--profile", profile, "--region", region,
            "--function-name", function_name,
            "--cli-binary-format", "raw-in-base64-out",
            "--payload", f"file://{payload_path}",
            str(result_path),
        ]
        print(f"  $ {' '.join(cmd)}")
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            print(proc.stderr, file=sys.stderr)
            sys.exit("Lambda invoke failed (network/auth/permissions).")
        return json.loads(result_path.read_text())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--profile", default=DEFAULT_PROFILE)
    parser.add_argument("--region", default=DEFAULT_REGION)
    parser.add_argument("--function-name", default=DEFAULT_FUNCTION_NAME)
    parser.add_argument("--dry-run", action="store_true", help="List + geocode + print the table; do NOT write coordinates.")
    parser.add_argument(
        "--no-postal-fallback", action="store_true",
        help="Don't fall back to an approximate postal-code-only lookup; leave such rows unresolved.",
    )
    args = parser.parse_args()

    print("Listing locations with no coordinates...")
    listing = invoke_lambda({"_management_command": "list_ungeocoded_locations"}, args.profile, args.region, args.function_name)
    if not listing.get("ok"):
        sys.exit(f"list_ungeocoded_locations reported failure: {listing.get('error')}")
    locations = listing.get("locations", [])
    if not locations:
        print("Nothing to do: every active location already has coordinates.")
        return

    print(f"\n{len(locations)} location(s) to geocode via Nominatim (~1 request/second, up to 3 requests each)...")
    rows = []
    for loc in locations:
        result = geocode_location(loc, include_postal_fallback=not args.no_postal_fallback)
        rows.append({**loc, **result})
        print(f"  - [{loc['id']}] {loc.get('brand_name')}: {result['method'] or 'no match'}")

    resolved = sum(1 for r in rows if r["latitude"] is not None)
    print(f"\n{format_table(rows)}\n\nResolved {resolved} of {len(rows)}; {len(rows) - resolved} unresolved.")

    payload = build_set_payload(rows)
    if args.dry_run:
        print("\n--dry-run set: not writing anything. Payload that would be sent:")
        print(json.dumps(payload, indent=2) if payload else "(nothing resolved -- no call would be made)")
        return
    if payload is None:
        print("\nNothing resolved; not calling set_location_coordinates.")
        return

    print(f"\nWriting {resolved} resolved coordinate(s)...")
    result = invoke_lambda(payload, args.profile, args.region, args.function_name)
    print(json.dumps(result, indent=2))
    if not result.get("ok"):
        sys.exit(f"set_location_coordinates reported failure: {result.get('error')}")
    print(f"\nDone. {result.get('summary')}")
    if any(r["status"] in ("invalid", "not_found") for r in result.get("results", [])):
        print("Some entries were rejected by the Lambda (see 'invalid'/'not_found' above); fix those addresses by hand.")


if __name__ == "__main__":
    main()

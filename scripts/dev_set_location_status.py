#!/usr/bin/env python3
"""Dev/test utility: force-set a `restaurant_location.status` directly, for
manually exercising the status lifecycle on the real dev site/DB (search
visibility, direct-URL 404s, owner console rendering, the "coming soon"
section) -- including the `closed_pending_reopen -> active` transition that
the normal owner-facing API deliberately makes one-way (only reachable
through an admin-approved reopen request otherwise).

HUMAN-run script -- it makes a real AWS call (one `aws lambda invoke`). Root
CLAUDE.md's "no AWS command without explicit permission" rule applies to
agents, not to you running this yourself; nothing here runs automatically.

Invokes the backend Lambda's `dev_set_location_status` management command
(backend/app/scripts/dev_set_location_status.py), which sets `status` on the
given location id and writes an audit_log row. Reversible: run again with a
different --status. DEV DATABASE ONLY -- never point this at production.

Prerequisites: AWS CLI + the `swarasa-dev` profile (`aws sso login --profile
swarasa-dev` if expired); the command must already be deployed.

Usage:
    # Force-set one location's status:
    python3 scripts/dev_set_location_status.py --location-id 42 --status coming_soon

    # Seed one "coming soon" example location on dev (same command, just
    # named for that use in the --help text below):
    python3 scripts/dev_set_location_status.py --location-id 42 --status coming_soon --dry-run

Valid --status values: active | owner_deactivated | coming_soon |
closed_pending_reopen

Find a location's id via `GET /restaurants/{slug's brand id}/locations` or
the owner portal URL `/portal/locations/<id>`.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

DEFAULT_PROFILE = "swarasa-dev"
DEFAULT_REGION = "us-east-1"
DEFAULT_FUNCTION_NAME = "swarasa-api-dev"
VALID_STATUSES = ("active", "owner_deactivated", "coming_soon", "closed_pending_reopen")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--location-id", type=int, required=True, help="restaurant_location.id to update.")
    parser.add_argument("--status", required=True, choices=VALID_STATUSES)
    parser.add_argument("--profile", default=DEFAULT_PROFILE)
    parser.add_argument("--region", default=DEFAULT_REGION)
    parser.add_argument("--function-name", default=DEFAULT_FUNCTION_NAME)
    parser.add_argument("--dry-run", action="store_true", help="Print the payload and stop; no AWS call.")
    args = parser.parse_args()

    payload = {
        "_management_command": "dev_set_location_status",
        "location_id": args.location_id,
        "status": args.status,
    }

    print(f"Payload: {json.dumps(payload)}")
    if args.dry_run:
        return

    with tempfile.TemporaryDirectory() as tmp:
        payload_path = Path(tmp) / "payload.json"
        result_path = Path(tmp) / "result.json"
        payload_path.write_text(json.dumps(payload))
        cmd = [
            "aws", "lambda", "invoke",
            "--profile", args.profile, "--region", args.region,
            "--function-name", args.function_name,
            "--cli-binary-format", "raw-in-base64-out",
            "--payload", f"file://{payload_path}",
            str(result_path),
        ]
        print(f"  $ {' '.join(cmd)}")
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            print(proc.stderr, file=sys.stderr)
            sys.exit("Lambda invoke failed (network/auth/permissions).")
        result = json.loads(result_path.read_text())

    print(json.dumps(result, indent=2))
    if not result.get("ok"):
        sys.exit(f"dev_set_location_status reported failure: {result.get('error')}")


if __name__ == "__main__":
    main()

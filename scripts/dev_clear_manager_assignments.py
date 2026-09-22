#!/usr/bin/env python3
"""Dev/test utility: soft-remove (deactivate) a manager's active
location_manager assignments by email, so the manager cap / cross-owner /
reassignment validation added in `location_manager_service.py` can be
exercised repeatedly by hand against the real dev site without clicking
"remove manager" once per assignment in the owner portal.

HUMAN-run script -- it makes a real AWS call (one `aws lambda invoke`).
Root CLAUDE.md's "no AWS command without explicit permission" rule applies
to agents, not to you running this yourself; nothing here runs
automatically.

Invokes the backend Lambda's `dev_clear_manager_assignments` management
command (backend/app/scripts/dev_clear_manager_assignments.py), which sets
is_active=false + revoked_at=now() on the matching row(s) and writes an
audit_log entry per row -- never a hard delete (root CLAUDE.md "NEVER
delete or truncate any DB table"). Reversible: re-assign the manager again
via the owner portal or POST /locations/{id}/managers. DEV DATABASE ONLY --
never point this at production.

Prerequisites: AWS CLI + the `swarasa-dev` profile (`aws sso login --profile
swarasa-dev` if expired); the command must already be deployed.

Usage:
    python3 scripts/dev_clear_manager_assignments.py --manager-email manager@example.com
    python3 scripts/dev_clear_manager_assignments.py --manager-email manager@example.com --location-ids 12 34
    python3 scripts/dev_clear_manager_assignments.py --manager-email manager@example.com --dry-run
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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--manager-email", required=True, help="Email of the manager whose assignments to clear.")
    parser.add_argument(
        "--location-ids", nargs="+", type=int,
        help="Restrict to these location ids (default: ALL of this manager's active assignments).",
    )
    parser.add_argument("--profile", default=DEFAULT_PROFILE)
    parser.add_argument("--region", default=DEFAULT_REGION)
    parser.add_argument("--function-name", default=DEFAULT_FUNCTION_NAME)
    parser.add_argument("--dry-run", action="store_true", help="Print the payload and stop; no AWS call.")
    args = parser.parse_args()

    payload: dict = {
        "_management_command": "dev_clear_manager_assignments",
        "manager_email": args.manager_email,
    }
    if args.location_ids:
        payload["location_ids"] = args.location_ids

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
        sys.exit(f"dev_clear_manager_assignments reported failure: {result.get('error')}")


if __name__ == "__main__":
    main()

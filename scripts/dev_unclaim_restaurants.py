#!/usr/bin/env python3
"""Dev/test utility: un-assign restaurants (owner removed, "unclaimed") so the
public "Is this your restaurant? Claim it" flow can be tested end to end.

HUMAN-run script -- it makes a real AWS call (one `aws lambda invoke`). Root
CLAUDE.md's "no AWS command without explicit permission" rule applies to
agents, not to you running this yourself; nothing here runs automatically.

Invokes the backend Lambda's `dev_unclaim_restaurants` management command
(backend/app/scripts/dev_unclaim.py), which for each slug sets owner_id NULL,
is_claimed false, claimed_at NULL and writes an audit_log row. Slugs that
don't exist are reported, not errors. Reversible: approve a claim in the
admin panel (or re-import) to give the brand an owner again. DEV DATABASE
ONLY -- never point this at production.

Prerequisites: AWS CLI + the `swarasa-dev` profile (`aws sso login --profile
swarasa-dev` if expired); the command must already be deployed.

Usage:
    python3 scripts/dev_unclaim_restaurants.py                 # the default two
    python3 scripts/dev_unclaim_restaurants.py --slugs dera-grill taj-chaat-house
    python3 scripts/dev_unclaim_restaurants.py --slugs dera-grill --dry-run

Find a restaurant's slug in its public URL: /restaurant/<slug>.
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
    parser.add_argument("--slugs", nargs="+", help="Brand slugs to unclaim (default: the command's built-in two).")
    parser.add_argument("--profile", default=DEFAULT_PROFILE)
    parser.add_argument("--region", default=DEFAULT_REGION)
    parser.add_argument("--function-name", default=DEFAULT_FUNCTION_NAME)
    parser.add_argument("--dry-run", action="store_true", help="Print the payload and stop; no AWS call.")
    args = parser.parse_args()

    payload: dict = {"_management_command": "dev_unclaim_restaurants"}
    if args.slugs:
        payload["slugs"] = args.slugs

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
        sys.exit(f"dev_unclaim_restaurants reported failure: {result.get('error')}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Dev/test utility: fully remove one user (by email) so the same address
can be reused for another manual sign-up test.

This is a HUMAN-run script — it makes real AWS calls (Lambda invoke,
Cognito admin-delete-user). Root CLAUDE.md "NEVER run any AWS CLI or SDK
command that touches real AWS ... without explicit permission for that
exact command, every single time" applies to agents, not to you running
this yourself; nothing in this repo invokes this script automatically.

What it does, in order:
  1. Invokes the backend Lambda's `delete_user_data` management command
     (backend/app/scripts/delete_user_data.py) to remove every local DB row
     tied to this user's Cognito `sub` (location_manager, claim_request,
     user_follow, data_deletion_request, audit_log, and the owner_account
     row itself if one exists). This does NOT delete restaurant_brand/
     restaurant_location rows -- an owned brand is unclaimed
     (owner_id -> NULL), never destroyed. See that file's own module
     docstring for the full reasoning and how this differs from the real
     CCPA deletion flow.
  2. Deletes the actual Cognito user (`admin-delete-user`) so the email
     itself is free to sign up again -- step 1 alone does not do this,
     since Cognito is the identity source of truth, not this app's DB.

Prerequisites: the AWS CLI configured with a profile that can invoke the
backend Lambda and administer the Cognito user pool (this repo's
convention so far: `swarasa-dev`, `aws sso login --profile swarasa-dev`
first if the session has expired), and the `delete_user_data` management
command must already be deployed (i.e. its PR merged and the backend
redeployed) -- this script will fail clearly if the Lambda doesn't
recognize the command yet.

Usage:
    python3 scripts/delete_test_user.py --email someone@example.com
    python3 scripts/delete_test_user.py --email someone@example.com --skip-cognito-delete
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
DEFAULT_USER_POOL_ID = "us-east-1_w2387tOf6"


def run_aws(args: list[str]) -> subprocess.CompletedProcess:
    print(f"  $ aws {' '.join(args)}")
    return subprocess.run(["aws", *args], capture_output=True, text=True)


def delete_local_db_rows(email: str, profile: str, region: str, function_name: str) -> dict:
    print(f"[1/2] Cleaning local DB rows for {email} via the deployed Lambda's "
          f"delete_user_data management command...")
    payload = {"_management_command": "delete_user_data", "email": email}

    with tempfile.TemporaryDirectory() as tmp:
        payload_path = Path(tmp) / "payload.json"
        result_path = Path(tmp) / "result.json"
        payload_path.write_text(json.dumps(payload))

        proc = run_aws(
            [
                "lambda", "invoke",
                "--profile", profile,
                "--region", region,
                "--function-name", function_name,
                "--cli-binary-format", "raw-in-base64-out",
                "--payload", f"file://{payload_path}",
                str(result_path),
            ]
        )
        if proc.returncode != 0:
            print(proc.stderr, file=sys.stderr)
            print("Lambda invoke itself failed (network/auth/permissions) -- "
                  "stopping before touching Cognito.", file=sys.stderr)
            sys.exit(1)

        result = json.loads(result_path.read_text())

    print(f"  -> {json.dumps(result, indent=2)}")
    if not result.get("ok"):
        print(f"delete_user_data reported failure: {result.get('error')}", file=sys.stderr)
        print("Stopping before touching Cognito -- check the error above "
              "(a common cause: this command isn't deployed yet, or no "
              "Cognito user exists for this email to resolve a sub from).",
              file=sys.stderr)
        sys.exit(1)
    return result


def delete_cognito_user(email: str, profile: str, region: str, user_pool_id: str) -> None:
    print(f"[2/2] Deleting the Cognito user itself so {email} can sign up again...")
    proc = run_aws(
        [
            "cognito-idp", "admin-delete-user",
            "--profile", profile,
            "--region", region,
            "--user-pool-id", user_pool_id,
            "--username", email,
        ]
    )
    if proc.returncode != 0:
        print(proc.stderr, file=sys.stderr)
        print(
            "Cognito user deletion failed -- local DB rows were already "
            "cleaned up in step 1, so this is safe to re-run (it's "
            "idempotent: delete_user_data no-ops cleanly if nothing is left "
            "to delete locally).",
            file=sys.stderr,
        )
        sys.exit(1)
    print(f"  -> Cognito user for {email} deleted.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--email", required=True, help="Email of the test user to fully remove.")
    parser.add_argument("--profile", default=DEFAULT_PROFILE)
    parser.add_argument("--region", default=DEFAULT_REGION)
    parser.add_argument("--function-name", default=DEFAULT_FUNCTION_NAME)
    parser.add_argument("--user-pool-id", default=DEFAULT_USER_POOL_ID)
    parser.add_argument(
        "--skip-cognito-delete",
        action="store_true",
        help="Only clean local DB rows; leave the Cognito user itself in place.",
    )
    args = parser.parse_args()

    delete_local_db_rows(args.email, args.profile, args.region, args.function_name)

    if args.skip_cognito_delete:
        print("--skip-cognito-delete set: leaving the Cognito user in place.")
        return

    delete_cognito_user(args.email, args.profile, args.region, args.user_pool_id)
    print(f"\nDone. {args.email} is fully free to sign up again.")


if __name__ == "__main__":
    main()

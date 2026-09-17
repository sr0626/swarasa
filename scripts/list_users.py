#!/usr/bin/env python3
"""Dev/test utility: list every email currently registered in the Cognito
user pool (the source of truth for identity -- see root CLAUDE.md "Auth:
AWS Cognito"), along with which pool group(s) each one belongs to.

This is a HUMAN-run script -- it makes a real, read-only AWS call
(`cognito-idp list-users`). Handy alongside delete_test_user.py: check
who's currently registered before deciding what to clean up.

Usage:
    python3 scripts/list_users.py
    python3 scripts/list_users.py --profile swarasa-dev --region us-east-1
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys

DEFAULT_PROFILE = "swarasa-dev"
DEFAULT_REGION = "us-east-1"
DEFAULT_USER_POOL_ID = "us-east-1_w2387tOf6"

GROUPS = ("owner", "manager", "admin", "registered_user")


def run_aws(args: list[str]) -> dict:
    proc = subprocess.run(["aws", *args, "--output", "json"], capture_output=True, text=True)
    if proc.returncode != 0:
        print(proc.stderr, file=sys.stderr)
        sys.exit(1)
    return json.loads(proc.stdout)


def list_all_users(profile: str, region: str, user_pool_id: str) -> list[dict]:
    users: list[dict] = []
    pagination_token = None
    while True:
        args = [
            "cognito-idp", "list-users",
            "--profile", profile,
            "--region", region,
            "--user-pool-id", user_pool_id,
        ]
        if pagination_token:
            args += ["--pagination-token", pagination_token]
        result = run_aws(args)
        users.extend(result.get("Users", []))
        pagination_token = result.get("PaginationToken")
        if not pagination_token:
            break
    return users


def groups_for_user(profile: str, region: str, user_pool_id: str, username: str) -> list[str]:
    result = run_aws(
        [
            "cognito-idp", "admin-list-groups-for-user",
            "--profile", profile,
            "--region", region,
            "--user-pool-id", user_pool_id,
            "--username", username,
        ]
    )
    return [g["GroupName"] for g in result.get("Groups", [])]


def email_and_status(user: dict) -> tuple[str, str]:
    attrs = {a["Name"]: a["Value"] for a in user.get("Attributes", [])}
    return attrs.get("email", "(no email attribute)"), user.get("UserStatus", "?")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--profile", default=DEFAULT_PROFILE)
    parser.add_argument("--region", default=DEFAULT_REGION)
    parser.add_argument("--user-pool-id", default=DEFAULT_USER_POOL_ID)
    args = parser.parse_args()

    users = list_all_users(args.profile, args.region, args.user_pool_id)
    if not users:
        print("No users found in this pool.")
        return

    print(f"{len(users)} user(s) in {args.user_pool_id}:\n")
    print(f"{'EMAIL':<40} {'STATUS':<20} {'GROUPS'}")
    print("-" * 90)
    for user in sorted(users, key=lambda u: email_and_status(u)[0]):
        email, status = email_and_status(user)
        groups = groups_for_user(args.profile, args.region, args.user_pool_id, user["Username"])
        group_label = ", ".join(groups) if groups else "(none -- see PR #84's Lambda for why)"
        print(f"{email:<40} {status:<20} {group_label}")


if __name__ == "__main__":
    main()

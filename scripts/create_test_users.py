#!/usr/bin/env python3
"""Dev/test utility: create short-email, fixed-password test users -- N per
role (owner, manager, admin, registered_user) -- in the swarasa-dev Cognito
user pool, so manual multi-role testing doesn't require juggling long
real-inbox-style emails.

DEV-ONLY. NEVER point this at anything but the `dev` environment's user
pool (root CLAUDE.md "Only `dev` exists right now" -- there is no `test`/
`prod` pool for this to accidentally reach yet, but this warning stands
for when they exist too). These users share one publicly-documented
password and a fake domain that receives no real mail -- that is only
acceptable for internal dev/test use, never anywhere a real person could
sign in or be impersonated.

This is a HUMAN-run script -- it makes real AWS calls (Cognito
`admin-get-user`, `admin-create-user`, `admin-set-user-password`,
`admin-add-user-to-group`). Root CLAUDE.md "NEVER run any AWS CLI or SDK
command that touches real AWS ... without explicit permission for that
exact command, every single time" applies to agents, not to you running
this yourself; nothing in this repo invokes this script automatically.
Same conventions as `scripts/delete_test_user.py`/`scripts/list_users.py`
(argparse, shells out to the `aws` CLI printing each command first,
`--dry-run` support, never runs itself against real AWS).

-------------------------------------------------------------------------
Why short emails + one fixed password
-------------------------------------------------------------------------
Existing manually-created test identities use long, real-inbox-style
emails (e.g. `skrudrangi+swarasa-owner2@gmail.com`, see
`backend/app/scripts/seed_dev_identities.example.json`) so Cognito's
verification-code mailer could actually deliver to a real inbox during
initial sign-up testing. That's unnecessary toil for routine dev/test use
once sign-up itself isn't what's being exercised. This script instead
uses `AdminCreateUser` with `--message-action SUPPRESS` (no invite email
sent) plus `AdminSetUserPassword --permanent` (skips the
FORCE_CHANGE_PASSWORD state entirely) -- both admin-only actions that
never touch a real inbox, so a made-up `@test.com` address that can't
receive mail is fine.

Existing already-created Cognito users CANNOT be renamed (email is the
pool's username, root CLAUDE.md-adjacent identity note also documented in
`scripts/delete_test_user.py`) -- this script never touches/migrates the
old `skrudrangi+swarasa-*@gmail.com` identities, it only ever creates NEW
`roleN@domain`-style users going forward.

-------------------------------------------------------------------------
Naming convention
-------------------------------------------------------------------------
    owner1@test.com   .. ownerN@test.com     (--owners,            group "owner")
    manager1@test.com .. managerN@test.com   (--managers,          group "manager")
    admin1@test.com   .. adminN@test.com     (--admins,            group "admin")
    user1@test.com    .. userN@test.com      (--registered-users,  group "registered_user")

The `registered_user` role uses the shorter `user` email prefix on
purpose (a literal `registered_user1@test.com` is long and awkward to
type) -- the Cognito GROUP name added is still the full "registered_user"
either way. All new users get one fixed password: `Test123$` (meets the
pool's policy -- min length 8, upper+lowercase, a digit; confirmed
against `infra/modules/cognito/main.tf`'s `password_policy` block, not
assumed -- symbols aren't required but `$` is harmless extra credit).

Defaults are `--owners 4 --managers 2 --admins 1 --registered-users 2` so
that `owner3@test.com`/`owner4@test.com` exist out of the box: those two
are exactly what `scripts/data/dfw_multi_city_restaurants.csv` (the
multi-city fictional-restaurant seed CSV, see that file's own README
note) points its `owner_email` column at, deliberately distinct from
`owner1`/`owner2` in case those are wanted for something else later. Pass
smaller/larger counts to override.

-------------------------------------------------------------------------
Idempotency
-------------------------------------------------------------------------
For each target email, this script first checks (via `admin-get-user`)
whether a Cognito user already exists with that username. If so: SKIPPED,
reported, left completely untouched -- password is never reset and group
membership is never re-applied for a pre-existing user (a human may have
changed either on purpose). Only a user this run actually just created
gets its password set and group assigned. Re-running with the same or
larger counts is always safe and creates nothing twice.

-------------------------------------------------------------------------
owner_account note -- read before pointing a bulk import at these owners
-------------------------------------------------------------------------
Creating the Cognito user here does NOT create the app's local
`owner_account` DB row for an `owner`-group user -- that row is
lazy-provisioned the first time the real app calls `GET /auth/me` for
that identity (see `backend/app/services/auth_service.py`'s
`get_or_create_owner_account`, and `backend/app/scripts/seed_dev_data.py`'s
`ensure_owner`, which goes through the same function). A brand-new
`ownerN@test.com` therefore needs ONE of the following before anything
that resolves `owner_email` against an EXISTING `owner_account` -- e.g.
`scripts/bulk_import_restaurants_csv.py` -- will find it:
  1. Log into the frontend once as that user (any authenticated request
     that hits `GET /auth/me` provisions the row), or
  2. Be added to `backend/app/scripts/seed_dev_identities.json` and run
     through `seed_dev_data`'s `ensure_owner` (see that script's own
     "Cognito prerequisite" docstring section).
`scripts/bulk_import_restaurants_csv.py`'s own module docstring documents
this same constraint from the importer's side.

Usage:
    python3 scripts/create_test_users.py --dry-run
    python3 scripts/create_test_users.py
    python3 scripts/create_test_users.py --owners 4 --managers 2 --admins 1 --registered-users 2
    python3 scripts/create_test_users.py --domain test.example.com
"""
from __future__ import annotations

import argparse
import subprocess
import sys

DEFAULT_PROFILE = "swarasa-dev"
DEFAULT_REGION = "us-east-1"
DEFAULT_USER_POOL_ID = "us-east-1_w2387tOf6"
DEFAULT_DOMAIN = "test.com"
DEV_PASSWORD = "Test123$"

# Cognito group name per role -- same 4 groups root CLAUDE.md's "Auth: AWS
# Cognito" and scripts/list_users.py's GROUPS both document.
ROLE_GROUPS = ("owner", "manager", "admin", "registered_user")

# Email-local-part prefix per role. "registered_user" -> "user" is the one
# deliberate shortening -- see module docstring "Naming convention".
ROLE_PREFIX = {
    "owner": "owner",
    "manager": "manager",
    "admin": "admin",
    "registered_user": "user",
}


def build_plan(counts: dict[str, int], domain: str) -> list[dict]:
    plan: list[dict] = []
    for role in ROLE_GROUPS:
        prefix = ROLE_PREFIX[role]
        for i in range(1, counts[role] + 1):
            plan.append({"role": role, "group": role, "email": f"{prefix}{i}@{domain}"})
    return plan


def run_aws(args: list[str]) -> subprocess.CompletedProcess:
    print(f"  $ aws {' '.join(args)}")
    return subprocess.run(["aws", *args], capture_output=True, text=True)


def user_exists(profile: str, region: str, user_pool_id: str, email: str) -> bool:
    proc = run_aws(
        [
            "cognito-idp", "admin-get-user",
            "--profile", profile,
            "--region", region,
            "--user-pool-id", user_pool_id,
            "--username", email,
        ]
    )
    if proc.returncode == 0:
        return True
    if "UserNotFoundException" in proc.stderr:
        return False
    print(proc.stderr, file=sys.stderr)
    print(
        f"Could not determine whether {email} already exists (not a plain "
        f"'not found' response) -- stopping rather than risk creating a "
        f"duplicate or acting on a wrong assumption. Check AWS auth/"
        f"connectivity and re-run.",
        file=sys.stderr,
    )
    sys.exit(1)


def create_user(profile: str, region: str, user_pool_id: str, email: str) -> bool:
    proc = run_aws(
        [
            "cognito-idp", "admin-create-user",
            "--profile", profile,
            "--region", region,
            "--user-pool-id", user_pool_id,
            "--username", email,
            "--user-attributes", f"Name=email,Value={email}", "Name=email_verified,Value=true",
            "--message-action", "SUPPRESS",
        ]
    )
    if proc.returncode != 0:
        print(proc.stderr, file=sys.stderr)
        return False
    return True


def set_permanent_password(profile: str, region: str, user_pool_id: str, email: str, password: str) -> bool:
    proc = run_aws(
        [
            "cognito-idp", "admin-set-user-password",
            "--profile", profile,
            "--region", region,
            "--user-pool-id", user_pool_id,
            "--username", email,
            "--password", password,
            "--permanent",
        ]
    )
    if proc.returncode != 0:
        print(proc.stderr, file=sys.stderr)
        return False
    return True


def add_to_group(profile: str, region: str, user_pool_id: str, email: str, group: str) -> bool:
    proc = run_aws(
        [
            "cognito-idp", "admin-add-user-to-group",
            "--profile", profile,
            "--region", region,
            "--user-pool-id", user_pool_id,
            "--username", email,
            "--group-name", group,
        ]
    )
    if proc.returncode != 0:
        print(proc.stderr, file=sys.stderr)
        return False
    return True


def print_would_run(user_pool_id: str, profile: str, region: str, email: str, group: str, password: str) -> None:
    print(f"    (would run) aws cognito-idp admin-create-user --profile {profile} --region {region} "
          f"--user-pool-id {user_pool_id} --username {email} "
          f"--user-attributes Name=email,Value={email} Name=email_verified,Value=true "
          f"--message-action SUPPRESS")
    print(f"    (would run) aws cognito-idp admin-set-user-password --profile {profile} --region {region} "
          f"--user-pool-id {user_pool_id} --username {email} --password '{password}' --permanent")
    print(f"    (would run) aws cognito-idp admin-add-user-to-group --profile {profile} --region {region} "
          f"--user-pool-id {user_pool_id} --username {email} --group-name {group}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--owners", type=int, default=4, help="Number of owner1..N@domain (default: 4).")
    parser.add_argument("--managers", type=int, default=2, help="Number of manager1..N@domain (default: 2).")
    parser.add_argument("--admins", type=int, default=1, help="Number of admin1..N@domain (default: 1).")
    parser.add_argument(
        "--registered-users", type=int, default=2, dest="registered_users",
        help="Number of user1..N@domain, group registered_user (default: 2).",
    )
    parser.add_argument("--domain", default=DEFAULT_DOMAIN, help=f"Fake email domain (default: {DEFAULT_DOMAIN}).")
    parser.add_argument(
        "--password", default=DEV_PASSWORD,
        help="Permanent password set on every newly created user (default: the fixed dev password).",
    )
    parser.add_argument("--profile", default=DEFAULT_PROFILE)
    parser.add_argument("--region", default=DEFAULT_REGION)
    parser.add_argument("--user-pool-id", default=DEFAULT_USER_POOL_ID)
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Check (read-only) which target emails already exist and print what would be "
        "created for the rest -- makes no create/password/group-membership AWS calls.",
    )
    args = parser.parse_args()

    counts = {
        "owner": args.owners,
        "manager": args.managers,
        "admin": args.admins,
        "registered_user": args.registered_users,
    }
    if any(c < 0 for c in counts.values()):
        print("Counts must be >= 0.", file=sys.stderr)
        sys.exit(1)

    plan = build_plan(counts, args.domain)
    if not plan:
        print("Nothing to do (all counts are 0).")
        return

    print(f"Planned test users ({len(plan)} total) in pool {args.user_pool_id}, domain {args.domain}:")
    for entry in plan:
        print(f"  - {entry['email']}  (group: {entry['group']})")
    print()

    created, skipped, failed = [], [], []
    for entry in plan:
        email, group = entry["email"], entry["group"]
        exists = user_exists(args.profile, args.region, args.user_pool_id, email)
        if exists:
            print(f"  - {email}: already exists -- skipped (password/group left untouched).")
            skipped.append(email)
            continue

        if args.dry_run:
            print(f"  - {email}: does not exist yet -- would create (group: {group}):")
            print_would_run(args.user_pool_id, args.profile, args.region, email, group, args.password)
            continue

        print(f"  - {email}: creating (group: {group})...")
        ok = create_user(args.profile, args.region, args.user_pool_id, email)
        ok = ok and set_permanent_password(args.profile, args.region, args.user_pool_id, email, args.password)
        ok = ok and add_to_group(args.profile, args.region, args.user_pool_id, email, group)
        if ok:
            created.append(email)
        else:
            print(f"    ! {email}: one or more steps failed -- see stderr above. This user may be "
                  f"left partially created (e.g. exists but no permanent password/group); re-run "
                  f"after checking `aws cognito-idp admin-get-user` for it.", file=sys.stderr)
            failed.append(email)

    if args.dry_run:
        print(f"\n--dry-run: {len(skipped)} already exist, {len(plan) - len(skipped)} would be created. "
              f"No create/password/group-membership calls were made.")
        return

    print(f"\nDone. created={len(created)} skipped={len(skipped)} failed={len(failed)}")
    if created:
        print(f"Password for every newly created user: {args.password}")
        print(
            "\nNote: a new owner*@... user has NO local owner_account DB row yet -- see this "
            "script's module docstring 'owner_account note' before pointing a bulk import at one."
        )
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()

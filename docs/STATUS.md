# Project Status

Live snapshot — updated as work lands, not a historical log (see DECISIONS.md
for that). Phase 1 (MVP Core).

**Real infra is live in AWS (as of 2026-09-15).** `terraform apply` ran
successfully against the `swarasa-dev` account (`091823298313`) — all 61
resources created (Aurora, Lambda, Cognito, ECR, S3/CloudFront, Amplify,
IAM, networking). See the Infra section below for what's actually running
vs. what still needs data/config on top of it (no seed data, no Cognito
users yet, backend Lambda is still serving a placeholder bootstrap image).

**Reality check: there is no orchestrator running.** `orchestrator.py` was
never implemented (see root `CLAUDE.md` "Coordination status" and
`docs/PROJECT_PLAN.csv`'s Orchestrator row). The human is coordinating
everything directly for now — a deliberate choice, not a bug; a real
orchestrator is planned for later.

**Brand name: resolved.** "Swaad" (the old placeholder, flagged 2026-09-13 for
a real trademark conflict — see DECISIONS.md) has been replaced throughout
the codebase with **Swarasa**, including the repo/org rename (PR #36). The
"Fork-E" logo mark (design canvas:
https://claude.ai/artifact/JAmSrrmd7k3NuDVMUKuT4U) is wired into the
homepage header and favicon (PR #38) — this is the last version explicitly
approved before iteration paused. Per DECISIONS.md ("Features & Product"),
the direction itself is still **parked, not finalized**: the user wasn't
fully satisfied and asked to stop iterating for now, with an explicit intent
to revisit later, not a final sign-off.

## Open PRs
- #135 (ready for review) — search page tag filters moved into a Filters dropdown
  with active-filter chips.
- #136 (ready for review) — admin console layout with a left sidebar menu
  (Profile / Claims / Reports / Listings).

## Recently landed (2026-09-17 → 2026-09-19, PRs #64–#134)
- Auth: sign-up / forgot-password / remember-me, post-confirmation role Lambda,
  account dropdown + logout, password reveal toggle, session uses the Cognito ID
  token (#79–#88, #97).
- Owner/admin: owner dashboard (tier + managers), manager discovery, admin
  parity, CSV bulk import, create-restaurant flow, CCPA export/delete (#70,
  #77–#78, #93–#94, #99).
- Reliability: Lambda management commands no longer reuse a stale DB engine,
  Aurora pool sizing + dashboard fetch cap (#100–#102, #114).
- Public site: sticky header (Add Your Restaurant middle / Sign In right),
  default coffee-cup image everywhere, redesigned restaurant profile (carousel,
  info card, hours starting today, about/specialties), report-a-problem,
  fine-grained tag filter, paid-first sort, search by restaurant name (#103–#113,
  #117, #122–#127, #133–#134).
- Claims: claim flow test setup (`dev_unclaim`), claim CTA hidden while a claim
  is pending, admin pending-claims queue `GET /claim` (#121, #128–#129, #133).
- Admin/account: notifications bell (`GET /admin/notifications`), account page
  redesign + role-specific layouts (#130–#132).
- Dev data: taxonomy, random hours, fictional phones seeded on dev (#109,
  #115, #118).
- BRD v3.7 (admin capabilities) (#111).

## Known gaps (2026-09-19)
- Approving a claim does not add the claimant to the Cognito `owner` group
  (needs Infra IAM grant).
- 15 of 26 imported restaurants have no coordinates (invisible to non-text search).
- Admin new-user feed covers owner accounts only (no local diner user table).
- Deals engine, refunds mechanism, social login not started.

## Architect (schema + contracts)
- [x] 13 entities modeled, 2 migrations written (never run)
- [x] DATA_MODEL.md + API_CONTRACTS.md cover all Phase 1 endpoints
- [x] Location-manager contract, id/slug restaurant lookup contract — implemented + tests green
- [x] `GET /restaurants` (owner-scoped list) and `GET /cuisine-tags` (public)
      contracts written — implemented + tests green
- [x] Phase 1 completion plan produced (priority order + agent ownership for
      remaining pages: login, claim flow, admin claims queue, owner portal)

## Backend (FastAPI)
- [x] `/search`, `/restaurants` CRUD + owner-scoped list, `/restaurants/{id}/locations`
- [x] `/locations` CRUD + hours + photos sub-resource
- [x] `/locations/{id}/managers` (assign/list/remove)
- [ ] PR #78 (draft, not yet merged): `GET /auth/me/managed-locations`
      (a manager can now discover their own assigned locations without a
      location id up front); manager reactivation (soft-remove then
      re-assign to the same location) verified working, no bug found;
      platform admin full-access parity on `PATCH /locations/{id}`,
      `PUT /locations/{id}/hours`, and all four `/locations/{id}/photos*`
      routes (`POST /locations` and `POST /locations/{id}/managers` stay
      owner-only, deliberately — see `docs/DECISIONS.md`)
- [x] `/claim` (submit/approve/reject), `/auth/me`
- [x] `/cuisine-tags` (public read list)
- [x] `/restaurants/{id}/follow` (follow/unfollow, both idempotent) +
      `/auth/me/follows` (paginated) — PR #66, closes the tracked
      `docs/PROJECT_PLAN.csv` gap (`user_follow` table existed, no
      endpoint did)
- [x] CCPA data export/deletion (PR #70) — `GET /auth/me/data-export`
      (synchronous JSON, no async job/SES), `POST`/`GET /auth/me/data-deletion` +
      admin `/data-deletion/{id}/approve|reject` (review queue modeled on
      `/claim`). New `data_deletion_request` table + nullable
      `owner_account.personal_data_deleted_at` column (migration
      `20260916_0004`). `user_follow` hard-deleted on approval;
      `location_manager`/`claim_request` redacted in place;
      `owner_account` anonymized in place (never hard-deleted);
      `audit_log` retained untouched. See DECISIONS.md "CCPA data
      export/deletion" for the full reasoning — closes the tracked
      `docs/PROJECT_PLAN.csv` gap
- [ ] Menu, deals, Stripe — Phase 2, not started (correctly)
- [x] Dev/test seed script (`backend/app/scripts/seed_dev_data.py`, PR #46)
      — small, idempotent owner/brand/location/manager/claim rows across 3
      "(Dev Seed)"-labeled brands. Blocked on a human step it can't do
      itself: needs 6 real Cognito users created first (2 owner, 2 manager,
      1 admin, 1 registered_user — see the script's own header for the
      exact `aws cognito-idp` commands), their emails filled into
      `backend/app/scripts/seed_dev_identities.json` (gitignored, copied
      from the `.example` template). Also can't be run from a laptop even
      then — Aurora has no network path outside this Lambda's VPC (no NAT,
      no bastion, no RDS Data API — checked against `infra/modules/
      networking`/`infra/modules/aurora`), so `app/main.py`'s `handler` now
      branches on a direct `aws lambda invoke` management-command payload
      (`app/scripts/management.py`) as the way to actually run it once the
      real backend image is deployed (see next bullet down and "Blocking
      next steps" below).
- CSV bulk restaurant import (PR #93, draft) — extends PR #74's JSON
  bulk-import with a CSV path on the same `bulk_import_restaurants`
  management command: per-row `owner_email` resolution, free-text
  cuisine `type` matching (unmatched reported, not failed), new
  `restaurant_brand.website` column. New human-run
  `scripts/bulk_import_restaurants_csv.py` geocodes via Nominatim on the
  human's own machine (not inside the Lambda — no NAT Gateway, no
  internet route). Not yet applied to real AWS (migration file only).
- Container image built (Dockerfile); ECR repo now exists, but only a
  placeholder `:bootstrap` image has been pushed (one-time, to unblock
  Lambda's first create) — the real backend image still needs its first
  push, which happens automatically via `deploy-backend.yml` on the next
  `backend/**` merge to `main`
- S3 image resize pipeline (`docs/PROJECT_PLAN.csv` "S3 image resize
  pipeline") — code complete: presigned-upload-URL endpoint switched to
  presigned POST with a `raw/` key (S3-enforced 5MB cap — see
  DECISIONS.md), `POST /locations/{id}/photos` now stores the predicted
  `processed/`/`thumbnails/` keys instead of waiting on the async resize,
  new resize Lambda (`backend/app/lambda_handlers/resize_photo.py`)
  writes a 1200px processed JPEG + a 400px thumbnail (thumbnail was a
  user-requested addition beyond the BRD spec) then deletes `raw/`. Not
  deployed yet — needs its own `terraform apply` + one-time `:bootstrap`
  ECR push + `DEV_DEPLOY_RESIZE_ROLE_ARN` GitHub secret before it runs
  for real (see the PR)

## Frontend (Next.js)
- [x] Project scaffold, typed API client, auth helpers, route skeleton
- [x] Homepage built and merged: "Spice Market" direction, fully tokenized
      theme (Tailwind `brand.*` colors/fonts/radii/shadows — no hardcoded
      hex/fonts in components, so a future L&F change is a values-only edit)
- [x] Homepage wired to the real `/search` API client with graceful
      empty/error states — no fabricated restaurant data
- [x] Search results page and public restaurant detail page built (real
      results/pagination, hours, gallery, unclaimed-listing CTA)
- [x] Real Cognito login flow (email/password, in-memory token storage,
      server-verified session cookie — never localStorage)
- [x] Claim submission page + admin claims review queue (both Server
      Actions independently re-verify session/role server-side per call)
- [x] Owner dashboard + location editor (info, hours, photo gallery with
      free/paid limits, manager assignment with the 2-manager cap) —
      real presigned-S3 upload, 404/403 indistinguishable to unauthorized
      callers
- [x] Global error boundary (`app/error.tsx`) — found missing while manual
      testing; a data-fetch failure was falling through to Next.js's raw
      dev error screen instead of a graceful, branded state
- [x] Marketing copy reworded off repetitive "Indian" phrasing — new
      headline "Discover your taste," tagline "Discover Your Taste"
- [ ] PR #88 (draft, not yet merged): signed-in account dropdown in the
      shared `TopBar` (Hello, {name}, falling back to email; Profile →
      `/account`, Security → new `/account/security` change-password page,
      Logout). `TopBar` is now an async Server Component
      (`getServerSession()` + `GET /auth/me`); signed-out rendering is
      unchanged. Logout: new `DELETE /api/auth/session` route +
      `stopSessionKeepAlive()` + best-effort Amplify `signOut()`. Also
      fixed two real bugs this surfaced: `app/error.tsx` (a required
      Client Component) broke once `TopBar` pulled in `next/headers`
      (fixed via a new `TopBarShell.tsx` presentational split), and a
      375px mobile header overflow (fixed by hiding the "Add Your
      Restaurant" CTA below `sm:` only when signed in).
- [x] **`next build`/`next lint` fixed** — `next.config.ts` needed Next 15;
      converted to `next.config.mjs` (plain JS, works on the pinned Next
      14.2.18 — no version bump, per root `CLAUDE.md`'s settled Next 14
      stack decision). Verified with a real `next build` (success) and
      `next lint` (starts normally, no config-load error).
- `npm install` still unverified against the project's own npm registry
  (sandbox network issue) — verified once again against the public
  registry as a one-off; confirmed `@aws-amplify/auth@6.6.5` doesn't exist
  there (public jumps 6.5.2 → later 6.x series) — pin unchanged, needs a
  look separately. Also noted in passing: npm flags `next@14.2.18` itself
  for a known security advisory (nextjs.org/blog/security-update-2025-12-11)
  — separate from this fix, flagged for awareness.

## Infra (Terraform)
- [x] Modules written: aurora, ecr, lambda, cognito, s3, amplify, ses (deferred), eventbridge, iam, networking
- [x] **Applied to `swarasa-dev` (091823298313) on 2026-09-15 — all 61
      resources live**: Aurora Serverless v2 (PostGIS not yet enabled —
      needs an Alembic migration run), Lambda + API Gateway, Cognito user
      pool (4 groups, no users yet), ECR repo, S3 media bucket + CloudFront,
      Amplify app, IAM roles, networking (VPC, subnets, endpoints)
- Fixed along the way: Aurora `engine_version` `15.4` was deprecated by AWS
  mid-Phase-1 (bumped to `15.18`); several `description` fields on security
  groups / the DB subnet group used an em-dash, which AWS rejects as
  non-ASCII (swapped for a plain hyphen)
- **No seed data exists anywhere yet** — `restaurant_brand`/
  `restaurant_location`/etc. tables are empty, no Cognito users in any of
  the 4 roles. The seed script now exists (see Backend section above) but
  hasn't run against real Aurora — still needs the 6 Cognito users created
  and the real backend image deployed first
- State key convention set (`envs/dev/terraform.tfstate`) — in use, no
  migration needed (fresh state store on a fresh account)
- S3 image resize pipeline infra written, not yet applied: new
  `infra/modules/lambda_resize` module (resize Lambda, no VPC — S3-only,
  never touches Aurora), a second `module "ecr_resize"` (service_name
  "resize"), a resize-scoped IAM role (S3 get `raw/*`, put `processed/*`
  + `thumbnails/*`, delete `raw/*` only) and its own GitHub Actions OIDC
  deploy role, an `aws_s3_bucket_notification` wiring the media bucket's
  `raw/` prefix to it, and an `expire-stale-raw-uploads` S3 lifecycle
  rule as a cost backstop. See the PR's post-merge checklist for the
  exact human steps (apply, bootstrap image push, GitHub secret)
- Cognito post-confirmation Lambda written (PR #84), not yet applied:
  `infra/modules/cognito` extended with a small zip-packaged Lambda
  (`cognito-idp:AdminAddUserToGroup` on this one pool's ARN only, its own
  IAM role, never shared with the API Lambda's role) wired via
  `lambda_config { post_confirmation = ... }` — assigns a newly-confirmed
  sign-up to its `custom:role` pool group. No ECR/container image needed
  (stdlib + boto3 only); `data.archive_file` zips the handler straight
  from `backend/app/lambda_handlers/cognito_post_confirmation.py`, so
  Terraform itself is the deploy mechanism, no DevOps pipeline involved

## DevOps (CI/CD)
- [x] `deploy-backend.yml` reviewed and fixed (PR #39) — the image-scan
      critical-findings gate could be silently skipped on a workflow re-run;
      now unconditional
- [x] OIDC role, ECR repo, and `DEV_DEPLOY_ROLE_ARN` GitHub secret are all
      real now (2026-09-15) — pipeline is ready to fire
- [ ] Still never actually run — needs a real push under `backend/**` to
      `main` to trigger the first end-to-end pipeline run
- `deploy-resize.yml` written (S3 image resize pipeline) — mirrors
      `deploy-backend.yml`'s exact pattern for the resize Lambda's own
      image, its own path filter, its own OIDC role. Human review
      required before it's live, same as `deploy-backend.yml` was; not
      yet run even once — needs `terraform apply`, the one-time
      `:bootstrap` push, and the `DEV_DEPLOY_RESIZE_ROLE_ARN` secret first

## QA / Tests
- [x] pytest: 109 passing, 3 skipped (need real Postgres), 0 failing
- [x] Playwright e2e: 17 passing, 12 explicitly skipped (`test.fixme` with
      reasons, not silently disabled) — covers public page rendering,
      mobile viewport (375px), unauthenticated-redirect, and the new error
      boundary. Skipped: anything needing real Cognito/live backend data
      (claim approval, owner/manager permission boundaries, geo search)
- Real gap found and flagged (not fixed — out of QA's scope): zero
  `data-testid` attributes anywhere in `frontend/src`; e2e suite falls back
  to role/text/aria selectors. Fast-follow, not a blocker.

## Process
- [x] Draft-PR-until-Architect-approved safeguard live (merge button
      disabled during review)
- [x] `docs/CMD_LOG.md` write pattern fixed — orchestrator-only now,
      feature branches no longer touch it (was causing a merge conflict on
      nearly every PR)
- Flagged, non-blocking gaps: no presigned-upload endpoint for claim
  documents; no list-all-pending-claims endpoint (admin queue is
  lookup-by-id only); no `data-testid` convention (above); manager has no
  way to discover assigned locations from the dashboard (owner-scoped
  `GET /restaurants` has no manager path); `cover_photo_url` has no photo
  id, so an already-set cover can't be explicitly deleted (only replaced)

## Blocking next steps
1. Adopt a `data-testid` convention (Frontend Dev) so the e2e suite's
   selectors are more resilient — not urgent, but the fast-follow to do
   before it's a pain to retrofit
2. Seed script now exists (`backend/app/scripts/seed_dev_data.py`, PR #46)
   — what's left is human/AWS steps it deliberately can't do itself:
   (a) create 6 real Cognito users (2 owner, 2 manager, 1 admin,
   1 registered_user — exact commands in the script's own header) and
   fill their emails into `seed_dev_identities.json`; (b) get step 3 below
   done so a real image is running; (c) run
   `aws lambda invoke --function-name swarasa-api-dev --payload
   '{"_management_command": "seed_dev_data"}' ...` (explicit per-command
   approval, same as any AWS CLI use here) — this is the only run path
   that actually reaches Aurora, since it has no network route outside
   this Lambda's VPC (no NAT/bastion/RDS Data API)
3. Trigger the first real `deploy-backend.yml` run (merge something under
   `backend/**`) so the Lambda serves the real FastAPI app instead of the
   `:bootstrap` placeholder

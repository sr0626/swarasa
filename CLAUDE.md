# Restaurant Discovery Platform — Root Context

## Project
Indian Restaurant Discovery & Deals Platform.
A location-based directory for Indian restaurants with regional cuisine filters,
owner-managed menus, time-limited deals, and subscription billing.

## Current Phase
**PHASE 1 — MVP Core (Weeks 1–3)**
Build the verified DFW restaurant directory with geo search and basic owner portal.
Do not build Phase 2 features (payments, deals, analytics) during Phase 1.

## Stack (all AWS, no external vendors)
- **Backend:** Python 3.12, FastAPI, SQLAlchemy 2.x, Alembic, Mangum (Lambda adapter)
- **Backend packaging:** container image via ECR, run on Lambda (`package_type =
  "Image"`) — not zip. Changed 2026-09-12 for cross-account promotion; see
  DECISIONS.md "Containerization". Still scale-to-zero, still pay-per-invocation.
- **Database:** Aurora PostgreSQL Serverless v2 + PostGIS extension
- **Frontend:** Next.js 14 (TypeScript), Tailwind CSS, AWS Amplify hosting
- **Auth:** AWS Cognito (user pools: owner, manager, admin, registered_user)
- **Media:** S3 + CloudFront (presigned URLs for upload, never through Lambda)
- **Email:** AWS SES (deferred — Phase 2+; Cognito uses built-in mailer for Phase 1)
- **Payments:** Stripe (Phase 2+)
- **Scheduling:** Single EventBridge cron Lambda (deal expiry)
- **IaC:** Terraform 1.7+
- **CI/CD:** GitHub Actions (OIDC → AWS role assumption, no static keys — owned
  by the DevOps agent)

## Environments (added 2026-09-12 — see DECISIONS.md "AWS account structure")
- **AWS Organizations, one member account per environment**, under the user's
  existing management/payer account (consolidated billing, no new payment
  method per account).
- **Only `dev` exists right now.** `test` and `prod` will be added later, same
  pattern, when there's something worth staging or launching. Don't design or
  provision cross-account plumbing (promotion pipelines, cross-account IAM
  trust) before the second account actually exists.
- Every agent targets the environment named in `var.env` (Infra) or the active
  AWS CLI profile (DevOps) — never hardcode `dev`, `test`, or `prod` where a
  variable should be used instead, so adding the next account later is a
  config change, not a code change.
- Account creation itself is manual (human does it via AWS Organizations
  console or CLI) — no agent runs `organizations:CreateAccount`.

## Coordination status (added 2026-09-15, updated 2026-09-15 — read before assuming "the orchestrator" is running)
There is still no `orchestrator.py` file and no automated dispatch loop —
that part hasn't changed. What changed the same day: **the human asked the
direct Claude Code session to actively fill that coordination role**,
proactively — decomposing and dispatching work against
`docs/PROJECT_PLAN.csv` without waiting to be asked "what's next" each
time, the way a real orchestrator would. Anywhere below that says "the
orchestrator" does something (batches `docs/CMD_LOG.md` entries, makes an
ambiguous-call judgment, dispatches a subtask), read that as "the direct
Claude Code session, acting in that capacity" until a real standalone
`orchestrator.py` exists.

This does NOT relax any hard gate elsewhere in this file. The human still
must be stopped for, every time, no standing approval:
- Any AWS CLI/SDK/Terraform command that touches real AWS (see "NEVER —
  Session Control")
- Merging any PR (see "NEVER — Session Control" — absolute, no agent ever
  merges)
- Any command the human said they'd rather run themselves on their own
  machine (local dev server, `docker`, etc.)
- Any ambiguous product/design decision per "Ask Human When" below

Feature-branch push + PR creation still doesn't need per-action approval
(unchanged from 2026-09-13). Routine status questions do not need to wait
for the human either — pick the next task from `docs/PROJECT_PLAN.csv`,
dispatch it (directly or via a subagent), and report outcomes rather than
asking permission to proceed to the next thing.

**When reporting status, state explicitly what (if anything) needs the
human right now** (added 2026-09-15, user instruction — "ask me explicitly
if I need to do something, I don't need to keep checking on you"). Don't
just link a PR or describe finished work and leave the human to infer
whether action is needed — say plainly "PR #N needs your merge" or "nothing
needed from you right now." This applies to every session driving this
project, not just whichever one is active when this was written.

**AWS/terraform commands default to the human running them** (added
2026-09-15, user instruction — "always me by default, so give me the
command as well every time... if needed I will ask you to run explicitly").
When one of these commands is needed, hand over the exact, ready-to-run
command rather than asking "want me to run it, or will you?" — the human
decides whether to hand it back. This doesn't relax the per-command
approval gate above; it only changes the default framing of who runs it.

**The Architect-review-skip fast path is narrow — check the actual file
list, not precedent** (added 2026-09-15, after two PRs, #37 and #44,
incorrectly skipped Architect review by treating a `CLAUDE.md` edit as
"docs-only"). Only a PR whose changed files are BRD-only, `docs/STATUS.md`-
only, or `docs/PROJECT_PLAN.csv`-only skips Architect review per "ALWAYS —
Documentation" below. `CLAUDE.md` and `docs/DECISIONS.md` are NOT on that
list, even though they're prose — they encode real process/behavioral
decisions and get the same review as code. Before opening any PR as
ready-for-review without Architect review, check its file list against
this exact three-item list — don't reuse what an earlier PR did without
re-verifying it was actually correct.

## Repository Structure
```
/restaurant-app
  CLAUDE.md               ← this file (root, all agents read)
  orchestrator.py          ← task decomposition + dispatch (PLANNED — not implemented yet, see "Coordination status" above)
  /architect               ← DB schema, migrations, API/data contracts
    CLAUDE.md             ← Architect agent instructions
  /backend                ← FastAPI app, Lambda handlers, Dockerfile
    CLAUDE.md             ← Backend Dev agent instructions
  /devops                 ← CI/CD pipelines, container build/push/deploy
    CLAUDE.md             ← DevOps agent instructions
  /frontend               ← Next.js app
    CLAUDE.md             ← Frontend Dev agent instructions
  /infra                  ← Terraform modules
    CLAUDE.md             ← Infra agent instructions
  /tests                  ← pytest + Playwright
    CLAUDE.md             ← QA agent instructions
  /docs
    AGENT_DESIGN.md       ← agent architecture document
    BRD_v38_Restaurant_Platform.docx          ← business requirements
```

## Key Domain Concepts (read before writing any code)

### Ownership hierarchy
```
owner_account (1) → restaurant_brand (N) → restaurant_location (N) → location_manager (N)
```
- One owner can have multiple brands (same or different names)
- One brand can have multiple locations
- Each location has its own paid/free status
- A manager can manage multiple locations (assigned by owner)

### Tier model (is_paid)
Tier is NOT a stored enum. It is a boolean on `restaurant_location`:
```sql
is_paid      BOOLEAN DEFAULT false
paid_until   TIMESTAMP              -- NULL when free
```
- Stripe webhook sets `is_paid=true` + `paid_until` on payment success
- Stripe webhook sets `is_paid=false` + `paid_until=NULL` on payment failure — IMMEDIATELY
- Admin can set `is_paid=true` + `paid_until=offer_end_date` for free offers
- ALWAYS check `is_paid` before returning any paid-tier content

### Billing model
- Stripe: one subscription per owner, one Subscription Item per paid location
- One consolidated invoice per month
- $100/mo or $1,000/yr per location (stored in `platform_pricing` table — not hardcoded)
- Managers can initiate upgrades; only owners can downgrade or cancel

### Paid content behaviour
- Downgrade: paid content hides immediately (is_paid=false), NOT deleted
- Re-subscribe: paid content reappears immediately (is_paid=true)
- is_paid=false locations: dish photos beyond the free gallery limit,
  custom page, full analytics, and promoted placement are NOT returned by API.
  Full menu with prices IS returned regardless of is_paid — it's a free feature
  (see BRD section 3.3, DECISIONS.md "Full menu with prices moved to free tier").
  Deals are ALSO a free-tier feature, not paid-gated — confirmed by direct user
  decision 2026-09-23, overriding this list's earlier inclusion of deals
  (see DECISIONS.md "Deals engine: free-tier, public-signal + registered-user-content
  visibility (supersedes May 2026 entry)")
- Paid tier also caps `location_manager` assignments at 2 per location

### Permission model
Every write request must be validated server-side:
- Owner: full access to all their brands/locations
- Manager: only locations explicitly assigned (check location_manager table on every write)
- Admin: full platform access
- Registered user: read-only + follow + full deal content
- Public: read-only + a content-free "deal(s) available today" signal only
  (no deal title/description — see DECISIONS.md "Deals engine: free-tier,
  public-signal + registered-user-content visibility")

## Coding Conventions

### Python
- Type hints on all function signatures
- Pydantic v2 for request/response schemas
- SQLAlchemy 2.x async sessions
- All endpoints in `/backend/app/routers/`
- All DB models in `/backend/app/models/`
- All business logic in `/backend/app/services/`
- File naming: `snake_case.py`

### TypeScript / Next.js
- Strict mode enabled
- Components in `/frontend/src/components/`
- Pages in `/frontend/src/app/` (App Router)
- API calls in `/frontend/src/lib/api/`
- No `any` types

### Terraform
- One module per AWS service in `/infra/modules/`
- Variables in `variables.tf`, outputs in `outputs.tf`
- No hardcoded region — use `var.aws_region`
- Tag all resources: `project`, `phase`, `env`

### Git
- Branch per feature: `feature/phase1-search-api`
- Commit messages: `feat:`, `fix:`, `test:`, `infra:`, `docs:`
- No commits directly to `main`

### Git Workflow (standing rule, added 2026-09-12, push gate relaxed 2026-09-13 — no exceptions otherwise)
Every agent, every task, follows this flow — codified per-agent in each
`CLAUDE.md`'s guardrails too:
1. **Create a feature branch before making any change.** Prefix matches the
   work: `feature/`, `infra/`, `fix/`, `docs/` (see naming above). Never
   write directly on `main`.
2. Commit to that branch as work progresses (commit freely — no permission
   needed for a local commit on a feature branch, same as always).
3. **Pushing a feature branch and opening its PR (`gh pr create`) do NOT
   need per-action human approval** (changed 2026-09-13 — see "NEVER —
   Session Control" below). Direct push to `main` remains forbidden
   (and blocked by branch protection regardless).
4. **Open the PR against `main` as a DRAFT** (`gh pr create --draft`) once
   pushed — added 2026-09-13, so the human can never accidentally merge
   while Architect review is still in progress: GitHub disables the merge
   button entirely on a draft PR. Exception: a PR that skips Architect
   review entirely (Architect's own PRs, BRD-only PRs, `docs/STATUS.md`-only
   PRs — see the self-review exception below and "ALWAYS — Documentation")
   has no review-in-progress window to protect against, so open those
   directly as ready-for-review, not draft.
5. **The Architect agent reviews every PR — schema, backend, frontend,
   infra, devops, tests alike — and posts an explicit confirmation/approval
   verdict, not just observations** (added 2026-09-12). Architect doesn't
   need infra/frontend expertise to catch scope creep, missing tests, or a
   mismatch with `docs/DECISIONS.md`; that's the point of a single
   consistent review gate. The review comment must end with an unambiguous
   verdict line — e.g. "Architect approval: ready to merge" or "Architect:
   do not merge until X is addressed" — so there's a clear go/no-go, not
   just notes. **On an approval verdict, Architect (or whoever posts the
   verdict) marks the PR ready for review** (`gh pr ready <number>`) —
   that's what actually surfaces it to the human as mergeable; a PR stays
   in draft, merge button disabled, until this happens. If the verdict is
   "do not merge until X," leave it in draft. Exception: a PR Architect
   itself opened skips Architect self-review (no one designated to review
   the reviewer) and goes straight to human review, as before — it was
   opened ready-for-review already, per step 4's exception.
   **When Architect finds a real problem, it doesn't just comment and stop
   (added 2026-09-13)** — it gets the responsible dev agent to fix it,
   re-verifies the fix, and only then posts the verdict comment, written
   like a human tech lead's PR comment (what was checked, what was found,
   what got fixed and how it was verified, then the go/no-go) — not a raw
   problem dump the human has to act on themselves. See
   `architect/CLAUDE.md` "Code Review" for the exact loop and its
   escalate-to-human boundary (one retry, then stop if it's not resolving
   or the fix needs a real product decision).
6. **The human manually approves and merges. No agent ever merges a PR —
   its own or anyone else's — under any circumstance.**

### Merge Hygiene (standing rule, added 2026-09-13, CMD_LOG carve-out added same day)
Don't make the human review and merge a PR for every trivial doc-only
change. A one-line `docs/STATUS.md` bump is not, on its own, significant
work — it's bookkeeping:
- **Fold it into whatever substantive PR it's already related to.** If
  you're updating STATUS.md as part of a feature/fix/infra PR, add that
  change as another commit on that same branch, not a separate PR.
- **When there's no substantive PR to attach to**, batch several small
  STATUS.md updates together into one PR rather than opening one per
  change — it's fine for a doc-only PR to lag behind a bit and catch up
  in one shot.
- This doesn't relax the underlying rule — `docs/STATUS.md` still gets
  updated when state changes (see "ALWAYS — Documentation") — it just
  changes *when* that edit becomes its own PR versus riding along with
  something else. Reserve a standalone PR (and the human's merge
  attention) for changes that are actually worth reviewing on their own:
  a feature, a fix, a schema/contract change, a real process/decision
  change — not routine bookkeeping.
- **`docs/CMD_LOG.md`, `docs/PROJECT_PLAN.csv` and `docs/STATUS.md` are the
  exceptions to "fold it into the current branch"** (CMD_LOG since
  2026-09-13; PROJECT_PLAN.csv and STATUS.md added 2026-09-19, user
  instruction: "you need to do the same as CMD_LOG for all the docs").
  Riding a row/entry along on a feature branch is exactly what caused a
  merge conflict on nearly every PR (every branch appending to the same
  last lines of the same file — repeatedly, even for one-line changes).
  These three files never go on a feature/fix/docs branch at all — agents
  report what changed in their final report, and the orchestrator applies
  it to all three in ONE dedicated docs PR per wave of merged work.

## Universal Guardrails (apply to ALL agents)

### NEVER — Cost
- NEVER provision always-on compute above $50/mo without approval
- NEVER create a NAT Gateway
- NEVER enable Aurora multi-AZ without approval
- NEVER remove Aurora `min_capacity = 0` (must scale to zero when idle)

### NEVER — Security
- NEVER hardcode secrets, keys, tokens, or passwords in any file
- NEVER create IAM policy with `*` on Action or Resource
- NEVER make an S3 bucket public (except designated CloudFront distribution bucket)
- NEVER commit `.env` or `terraform.tfvars` with real values (use `.gitignore`)
- NEVER expose internal stack details in API error responses (use generic messages)

### ALWAYS — AWS Best Practices (all agents, standing rule, added 2026-09-12)
Applies to every agent, not just Infra/DevOps — Architect's schema/access
patterns, Backend Dev's SDK calls, and QA's test fixtures all touch AWS
indirectly and must follow the same principles:
- ALWAYS design and code for least privilege — request/use only the specific
  IAM actions and resource scopes a task actually needs, never a broader
  grant "to be safe." If a task seems to need broader access than it has,
  flag it to Infra rather than working around it.
- ALWAYS assume data is encrypted at rest and in transit (Aurora, S3, Secrets
  Manager already are) — never design a path that bypasses that (e.g. an
  unencrypted export, a public read path around CloudFront/OAC).
  Infra/DevOps-specific detail lives in their own `CLAUDE.md` (IAM
  least-privilege rules, ECR scan-on-push, OIDC over static keys, etc.) —
  this is the version every other agent applies in their own domain.

### NEVER — Scope
- NEVER build features outside current phase scope (see Current Phase above)
- NEVER run `terraform apply` — generate plan only
- NEVER run Alembic migrations — generate migration files only
- NEVER delete or truncate any DB table or S3 bucket
- NEVER modify files outside your designated directory without explicit instruction

### NEVER — Session Control (no exceptions except where noted, standing rule)
- **Feature-branch `git push` and `gh pr create` do NOT need per-action
  human approval** (changed 2026-09-13 — user decision, see
  `docs/DECISIONS.md`). Push and open the PR as part of finishing the work;
  the human's checkpoint is now the PR merge, after Architect review, not
  the push.
- NEVER push directly to `main`, under any circumstance — always go through
  a feature branch and a PR (also blocked by branch protection).
- NEVER work directly on `main` — create a feature branch first, every task,
  no exceptions (see "Git Workflow" above).
- NEVER merge a pull request — yours or another agent's — for any reason.
  Only the human merges. This is absolute, not just a default.
- NEVER run any AWS CLI or SDK command that touches real AWS (`aws ...`,
  `boto3` calls, `terraform apply`/`import`/`destroy`, etc.) without explicit
  permission for that exact command, every single time. This includes
  read-only-seeming commands (`aws s3 ls`, `aws sts get-caller-identity`) —
  ask first regardless. No standing approval accumulates across a session.
- NEVER let a `git push` or an AWS CLI/SDK command go unlogged — see the
  "ALWAYS — Command Log" rule below. What changed 2026-09-13: logging still
  always happens, but individual agents no longer write the log entry
  themselves onto their own branch (see below for why and the new flow).

### ALWAYS — Command Log (no exceptions on WHAT gets logged; HOW changed 2026-09-13)
- ALWAYS record every `git push`, every AWS CLI/SDK command, and every
  `terraform plan`/`apply` in `docs/CMD_LOG.md`, grouped by date, in
  execution order, tagged `# user` or `# claude` — command list only, no
  description or explanation. This requirement itself hasn't changed.
- **What changed: individual agents (Backend Dev, Frontend Dev, Architect,
  etc.) do NOT add a `docs/CMD_LOG.md` commit to their own feature/fix/docs
  branch anymore.** Every branch independently appending to the same last
  line of the same file was a guaranteed, recurring merge conflict — nearly
  every PR this session was hitting it, purely mechanically, with zero
  actual content disagreement. Report what you ran (the exact commands) in
  your task's final report to the orchestrator instead of committing it.
- **The orchestrator is the sole writer of `docs/CMD_LOG.md`.** It collects
  what every dispatched agent (and itself) actually ran and appends it in
  one batch, directly on a dedicated log-only branch/PR, after a wave of
  work lands — not interleaved commit-by-commit with feature work. This
  keeps the file's write pattern to one writer at a time, sequenced, so it
  stops colliding with everything else.
- This is the same spirit as "Merge Hygiene" below (bookkeeping shouldn't
  generate PR noise or block real work) taken one step further: it's not
  just about avoiding a *standalone PR* per line anymore, it's about
  avoiding commits on OTHER PRs' branches entirely, since those are exactly
  what was conflicting.

### ALWAYS — Quality
- ALWAYS write a test alongside every new endpoint, component, or Lambda
- ALWAYS use Alembic for schema changes — no raw DDL statements
- ALWAYS write an `audit_log` entry for every write on: restaurant_brand,
  restaurant_location, menu_item, deal, owner_account, location_manager
- ALWAYS check `is_paid` before returning any paid-tier content
- ALWAYS validate manager assignment server-side on every write (never trust JWT alone)

### ALWAYS — Documentation (no exceptions, standing rule)
- ALWAYS bump the version and add a Version History row (in the BRD document
  itself) whenever BRD content changes — no silent edits. See DECISIONS.md
  "Process & Documentation" for the exact steps (bump version, log the row,
  rename the file, update the 3 references to it).
- ALWAYS keep the previous 2 versioned BRD `.docx` files on disk (n-2
  retention: current + 2 prior) — never delete an old version's file in the
  same change that creates a new one. Only clean up the oldest once a 4th
  version file would otherwise exist.
- ALWAYS update `docs/STATUS.md` when a PR merges or a feature/layer's state
  changes (added 2026-09-13) — but NOT on the feature branch: the
  orchestrator batches it with PROJECT_PLAN.csv and CMD_LOG.md in one
  dedicated docs PR per wave (see "Merge Hygiene"). Keep it short, bullets
  only, not verbose.
  Same as BRD: still needs a PR (branch protection), but skips Architect
  review for a fast human merge — it's a status snapshot, not code.
- ALWAYS keep `docs/PROJECT_PLAN.csv` current whenever a feature/task's
  status changes (added 2026-09-13; amended 2026-09-19 — batched by the
  orchestrator in the wave's docs PR, NEVER edited on a feature branch,
  same as CMD_LOG; agents put the proposed row/status change in their final
  report instead) — same trigger as the
  `docs/STATUS.md` rule directly above, so both get touched together as one
  effort, not as separate PRs: bump the row's `Status` column and its
  `PR/Reference` column (add the merged PR number). `docs/PROJECT_PLAN.csv`
  is the detailed row-per-feature tracker with full BRD traceability across
  all phases; `docs/STATUS.md` stays the quick bullet-only "what's true right
  now" snapshot — they serve different purposes and are not a replacement for
  each other. Same PR-required-but-skip-Architect-review treatment as
  `docs/STATUS.md`.
- ALWAYS put BRD updates on a PR the same as anything else (branch
  protection on `main` requires this, no exceptions by file type — added
  2026-09-12) — BUT skip Architect's review gate for a BRD-only PR and
  surface it to the human immediately for a fast merge. It's a business
  document the user needs to see on disk quickly, not code needing a
  consistency review; the n-2 retention promise only holds if the merge
  happens fast, not if it queues behind a full review cycle.

## Decision-Making Autonomy (standing rule, added 2026-09-12)
Architect and the orchestrator make the call on ambiguous design/schema/
process questions themselves — don't stop mid-task to ask about something
you can reason through (field naming, a cascade behavior, how to phase a
plan, which of several reasonable approaches to take). Decide, implement,
and **clearly report what you decided and why** so the human can question,
override, or approve it afterward — this is a "propose the plan, then
answer questions" model, not "ask before every decision." The prior Architect
tasks this session already did this well (flagged judgment calls in the
report rather than blocking on them) — keep doing that, and apply the same
posture to orchestrator-level planning (subtask breakdowns, sequencing,
which agent does what).

This does NOT relax anything in "Ask Human When" below, or any of the
"no exceptions" standing rules elsewhere in this file (git push, AWS
commands, PR merges, feature-branch workflow) — those still require
explicit per-action permission or a stop-and-ask, always. This rule is about
substantive design/process judgment calls, not about the hard gates.

## Ask Human When
Stop and ask before proceeding if:
- A task requires touching more than one agent's directory
- A decision would cost more than $50/mo when live
- The task is irreversible (deleting data, publishing to production)
- The requirement is ambiguous between two valid interpretations with
  meaningfully different consequences (not just "which of these two
  reasonable field names" — see Decision-Making Autonomy above)
- A security decision has no clear right answer

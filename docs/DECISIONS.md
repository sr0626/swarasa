# Architecture Decision Log

Every significant technical or product decision made for this project.
Read this before asking "why did we do X?" — the answer is probably here.
When a new decision is made, add it to the top of the relevant section.

Format: **Decision** | Date | Reasoning | Alternatives Rejected

---

## Process & Documentation

**`docs/CMD_LOG.md` is written only by the orchestrator, in a batch, never as a commit on a feature/fix/docs branch — standing rule**
2026-09-13 | User decision, given after CMD_LOG.md entries caused a merge
conflict on nearly every PR in a row (#20, #21, #22, #23, #24, #26 all hit
it). Root cause: every branch independently appended to the same last line
of the same file — a mechanical, guaranteed collision with zero actual
content disagreement, not a real editorial conflict. Fix: dispatched agents
stop adding a CMD_LOG commit to their own branch — they report what they
ran in their final task report instead. The orchestrator (who dispatches
every logged action, or runs it directly) is the sole writer, appending
entries in one batch on a dedicated branch after a wave of work lands, so
the file has one writer at a time instead of N concurrent ones. What gets
logged and why (audit trail for every push/AWS command) is unchanged — only
who writes it and when. `docs/STATUS.md` keeps its existing "ride along on
a substantive branch, or batch" treatment (Merge Hygiene) — it doesn't
generate the same append-conflict pattern since its edits are targeted
content changes, not everyone appending to one shared tail.
*Rejected: keeping CMD_LOG entries on feature branches and just resolving
the conflict each time (that's the status quo that prompted this — pure
toil with no benefit), moving CMD_LOG.md to a per-branch or per-day file
(defeats the point of one linear log a human can skim)*

**`docs/PROJECT_PLAN.csv` — a detailed row-per-feature/task tracker with full BRD traceability, distinct from `docs/STATUS.md`'s quick snapshot**
2026-09-13 | User decision: `docs/STATUS.md` is a bullet-only "what's true right
now" snapshot, but there was no single place that mapped the platform's ENTIRE
BRD scope — Phase 1 through Phase 4, including infra/DevOps tasks as first-
class rows, not just customer-facing features — against real implementation
status. Added `docs/PROJECT_PLAN.csv`: one row per BRD feature/task, columns
`Feature/Task`, `BRD Section`, `BRD Version`, `Phase`, `Layer/Owner`, `Status`
(Not Started / In Progress / Done / Blocked), `PR/Reference`, `Notes`. Built by
reading the full BRD (confirmed current version: v3.6,
`docs/BRD_v36_Restaurant_Platform.docx`) and cross-referencing every row
against actual code (`backend/app/routers`, `frontend/src/app`,
`infra/modules`, `.github/workflows`) rather than trusting prior status claims
— this surfaced several gaps `docs/STATUS.md` hadn't called out explicitly
(e.g. the owner portal, claim-flow UI, and admin pages are auth-gated
placeholders, not built; no `/follow` API exists despite the `user_follow`
table; the S3 image resize Lambda from BRD 5.3 was never built; `orchestrator.py`
doesn't exist despite being listed as "active from Phase 1"). `docs/STATUS.md`
is unchanged in purpose and stays the fast bullet snapshot; the two files are
updated together (same trigger — see root `CLAUDE.md` "ALWAYS — Documentation")
but never merged into one file.
*Rejected: folding this level of detail into `docs/STATUS.md` (would turn a
short live snapshot into an unreadable wall of rows), tracking only what's
built so far instead of the full BRD scope (defeats the point of BRD
traceability — a reader needs to see Phase 2/3/4 scope too, marked Not
Started, not just a done-list)*

**PRs needing Architect review are opened as draft PRs; Architect marks ready-for-review on approval — standing rule**
2026-09-13 | User decision: with push/PR-open no longer needing pre-approval
(and Architect review now happening in the background, sometimes taking
minutes), there was a real window where a PR sat open, mergeable, while
Architect was still reviewing it — risking an accidental merge before the
verdict lands. Fix: every PR that needs Architect review opens as a draft
(`gh pr create --draft`) — GitHub disables the merge button entirely on a
draft, so an accidental merge during review is now physically impossible,
not just discouraged. Architect marks it ready (`gh pr ready <number>`)
the moment it posts an approval verdict; a "do not merge until X" verdict
leaves it in draft. PRs that already skip Architect review (Architect's
own PRs, BRD-only PRs, `docs/STATUS.md`-only PRs) have no review-in-progress
window to protect against, so they're opened ready-for-review directly, not
draft — otherwise they'd need a manual ready-for-review step for no safety
benefit. Codified in root `CLAUDE.md` ("Git Workflow" steps 4-5) and
`architect/CLAUDE.md` ("Code Review").
*Rejected: a GitHub Actions status check gating merge on a parsed
Architect-verdict comment (real CI infrastructure for a problem draft PRs
solve natively, with zero extra moving parts), relying on human discipline
alone to check for Architect's comment before merging (exactly the failure
mode that prompted this rule)*

**Trivial doc-only bookkeeping (CMD_LOG entries, STATUS.md bumps) rides along on an existing PR or batches up — doesn't need its own standalone PR every time**
2026-09-13 | User decision, given after a run of single-line PRs (a
CMD_LOG.md entry logging one push, a one-line STATUS.md tweak) each showed
up as something to review and merge. The human's merge attention should go
to actually-significant work — features, fixes, schema/contract changes,
real process/decision changes — not routine logging. New guidance: fold a
log/status edit into whatever substantive branch it's already related to as
another commit, and when there's no such branch, batch several small
edits into one catch-up PR instead of opening one per line. Every push and
AWS command is still logged and `docs/STATUS.md` still gets updated on
state changes — this only changes when that edit becomes its own PR versus
riding along with other work. Codified in root `CLAUDE.md` ("Git Workflow"
→ "Merge Hygiene").
*Rejected: stopping the logging/status-update practice itself (still
useful, was never the complaint — the complaint was PR-per-line, not the
content), letting agents merge trivial PRs themselves to skip the friction
(violates the "no agent ever merges" hard gate — not up for relaxing)*

**`docs/STATUS.md` — a live, bullet-only project status doc, updated on every PR merge/feature change**
2026-09-13 | User wants an always-current snapshot of what's implemented per
layer, separate from this decision log. Kept short (bullets, no prose) per
user instruction. Same PR-required-but-skip-Architect-review treatment as
BRD updates.
*Rejected: folding status into DECISIONS.md (that's a history log, not a snapshot)*

**Feature-branch `git push` and `gh pr create` no longer need per-action human approval — standing rule**
2026-09-13 | User decision, given after a session of pushing ~8 PRs one
approval-prompt at a time. The pre-push approval gate added most of its
friction without adding much safety: nothing reaches `main` without
Architect review plus the human's own merge approval anyway, and `main`
itself is branch-protected against direct pushes regardless of who tries.
New flow: agents commit, push, and open the PR against `main` as part of
finishing a task, without asking first; `docs/CMD_LOG.md` still logs every
push after the fact (unchanged); Architect still reviews every PR before it
reaches the human; the human's checkpoint moves from "approve the push" to
"approve the merge." Direct push to `main`, agent-merging a PR, and every
AWS CLI/SDK command remain hard-gated exactly as before — this decision
touches feature-branch git push/PR-open only.
*Rejected: leaving the pre-push gate in place (pure friction once Architect
review + human merge already gate what lands on `main`), relaxing the AWS
command gate too (not requested — AWS commands have real-money and
real-infrastructure consequences a git push doesn't)*

**Architect fixes what it finds (via the responsible dev agent) and verifies the fix before posting its verdict — standing rule, tightened again**
2026-09-13 | User decision. Extends the 2026-09-12 verdict-comment rule
(below): finding a problem and leaving a "do not merge until X" comment
isn't the end state anymore — Architect gets it fixed. Flow: identify the
problem and which agent owns it → get that agent to make the fix (direct
dispatch if Architect's own task execution can do that, otherwise a
precise fix description handed to the orchestrator) → re-check the fix
actually resolves what was found (re-read the diff, re-run tests if
relevant) → post one human-readable verdict comment covering what was
checked, what was found, what got fixed and how it was verified, then the
go/no-go. Escalates to the human instead of continuing to iterate if a fix
attempt doesn't resolve the issue after one retry, or if the real fix
needs a product/design decision not already in this file (a
Decision-Making-Autonomy DECISIONS.md-gap case, not something to keep
looping on alone). Codified in root `CLAUDE.md` ("Git Workflow" step 5)
and `architect/CLAUDE.md` ("Code Review").
*Rejected: leaving Architect's role as comment-only (pushes the fix-
dispatch work onto the human every time, when Architect already has the
context to do it directly), unlimited retry looping (could stall a PR
indefinitely on something that actually needs a human call)*

**Architect must post an explicit confirmation/approval verdict on every PR before it's surfaced to the human — standing rule, tightened from "adds comments"**
2026-09-12 | User decision. The prior rule only required Architect to leave
review comments; this raises the bar to an unambiguous go/no-go verdict
("Architect approval: ready to merge" / "Architect: do not merge until X"),
and the PR must not be presented to the human as "ready for your review"
until that verdict exists. Self-review exception unchanged and explicitly
reconfirmed by the user: a PR Architect itself opened skips straight to
human review, no one reviews the reviewer. Same exception extended to
BRD-only PRs (business document, not code — see "Every BRD update..."
entry below). Architect posts the verdict as the closing line of a plain
PR comment, not via `gh pr review --approve` — a native GitHub approval
would be attributed to the same account as the human's own reviews (no
separate bot identity exists), blurring who actually decided what.
*Rejected: using `gh pr review --approve`/`--request-changes` for the verdict
(identity confusion, same GitHub account as the human), requiring Architect
confirmation on its own PRs too (no reviewer for the reviewer — user
explicitly confirmed keeping this exception when asked)*

**Architect and the orchestrator decide judgment calls themselves and report the plan — standing rule**
2026-09-12 | User decision: don't stop mid-task to ask about ambiguous
design/schema/process questions with a reasonable answer (field naming, a
cascade rule, how to sequence a plan) — decide, implement, and clearly
report the decision and reasoning so the human can question, override, or
approve it afterward. This is "propose the plan, then take questions," not
"ask before every decision." Explicitly does NOT relax any "no exceptions"
standing rule (git push, AWS commands, PR merges, feature-branch workflow)
or the existing "Ask Human When" triggers (cross-directory work, >$50/mo,
irreversible actions, genuinely ambiguous requirements, no-clear-answer
security calls) — those remain hard stops. Codified in root `CLAUDE.md`
("Decision-Making Autonomy") and `architect/CLAUDE.md`.
*Rejected: keeping the prior ask-first posture (the two Architect tasks this
session already showed that deciding-and-flagging produces better results
than blocking on every judgment call)*

**Every agent works on a feature branch and opens a PR — no direct commits/pushes to `main`, Architect reviews, human merges — standing rule, no exceptions**
2026-09-12 | User decision. Formalizes and enforces what README.md's Git
Conventions already said aspirationally ("No direct commits to main. All
changes via pull request") but wasn't actually being followed by dispatched
agent tasks. Flow: create a feature branch before any change → commit freely
on that branch → pushing the branch and opening the PR both require the same
per-action explicit permission as any other `git push` → Architect reviews
every PR (schema, backend, frontend, infra, devops, tests) and adds comments,
except a PR Architect itself opened, which skips straight to human review →
the human alone approves and merges; no agent ever merges any PR. Codified in
root `CLAUDE.md` ("Git Workflow", "NEVER — Session Control") and reinforced
in every agent's own `CLAUDE.md` guardrails.
*Rejected: letting agents merge their own PRs after Architect approval (removes
the human's final say on what lands on `main`), requiring Architect
self-review (no one designated to review the reviewer; human review already
covers it)*

**AWS best practices (least privilege, encryption, no hardcoded secrets) apply to every agent, not just Infra/DevOps**
2026-09-12 | User decision. Infra and DevOps already had detailed AWS-security
guardrails specific to their domain (IAM least-privilege rules, ECR
scan-on-push, OIDC over static keys). Added a general "AWS Best Practices"
section to root `CLAUDE.md`'s Universal Guardrails so every agent applies the
same principles in their own domain, plus concrete role-specific instances:
Architect (design for least-privilege data access, reference secrets via
env/Secrets Manager not literals), Backend Dev (scope boto3 calls minimally,
ask Infra for a specific permission rather than requesting a broader role),
QA (never reuse broad/admin credentials in test fixtures, prefer mocking AWS
calls over hitting real AWS in tests).
*Rejected: leaving this implicit / assuming agents infer it from Infra's
guardrails alone (Architect, Backend Dev, and QA don't read infra/CLAUDE.md
by default, so the principle needs to live where they'll actually see it)*

**Every git push and AWS CLI/SDK command is logged in `docs/CMD_LOG.md` — standing rule, no exceptions**
2026-09-12, simplified same day | User decision, given while about to run the
state-bucket setup commands. `docs/CMD_LOG.md` covers every `git push`, every
AWS CLI/SDK command, and every `terraform plan`/`apply` — i.e. every action
already gated by the "explicit permission every time" rules in root
`CLAUDE.md`. Kept deliberately minimal per user follow-up the same day: just
the commands, grouped by date, in execution order, tagged `# user` /
`# claude` — no per-entry description, context, or result fields. Committed
to git — it's an audit trail, not a secret; account IDs and credentials still
live only in the gitignored `infra/ACCOUNTS.md`.
*Rejected: relying on git log + terminal scrollback alone (scattered across
two places and loses AWS commands entirely, since those aren't git-tracked
by nature), logging in `infra/ACCOUNTS.md` (mixes a running log with a
reference doc, and that file is gitignored — the log should be committed),
a verbose per-entry format with context/result fields (user wanted it simple)*

**Every BRD update bumps the version and logs it in the BRD's own Version History table — standing rule, no exceptions**
2026-09-12, retention rule added same day | The BRD (`docs/BRD_v36_Restaurant_Platform.docx`
as of this decision) now carries a "Version History" table (Version | Date |
Changes) right after its title-page metadata. Any future edit to BRD content —
not just this one — must:
1. Bump the version number in the title-page metadata table
2. Add a new row to the Version History table describing what changed and why
3. Rename the file to match (`BRD_v<major>_Restaurant_Platform.docx`) and update
   the three references to it (`README.md`, root `CLAUDE.md`, `docs/AGENT_DESIGN.md`)
4. **Keep n-2 old version files before cleanup** — retain the current file's
   two immediately-preceding versioned `.docx` files in `docs/` (3 files on
   disk at any time: current + previous 2). Only delete the oldest kept file
   once a new bump would make a 4th file exist. Never delete an old version's
   file in the same edit that creates the new one — the deletion (if any) is a
   separate, later cleanup step once the n-2 window is exceeded.
No silent edits — the document must be able to answer "what changed and when"
from its own content, without needing git history, and old versions stay
recoverable from disk for a window rather than relying solely on git history.
*Rejected: git history as the only changelog (BRD is reviewed by stakeholders who
don't use git), a separate changelog file (splits the log from the document it
describes), deleting the previous version immediately on every bump (no
same-day fallback if the new version needs correcting)*

---

## Infrastructure & Hosting

**Missing Cognito VPC endpoint — every Cognito-email-lookup code path was silently unreachable from the Lambda**
2026-09-18 | Real production bug, found live while testing `scripts/delete_test_user.py`
against the deployed dev environment: three consecutive `aws lambda invoke`
calls each hung for the full 30s Lambda timeout with zero application-level
log lines, even after confirming Aurora itself was healthy (`GET
/cuisine-tags`, no Cognito call in its path, succeeded normally at a routine
~16s cold-start). Root cause: the Lambda's IAM role has held
`cognito-idp:ListUsers` since PR #10 (manager-assignment-by-email lookup),
and `find_sub_by_email()` — called by manager assignment, `seed_dev_data`,
`bulk_import_restaurants`, and `delete_user_data` alike — has no network
path to Cognito's API at all: no NAT Gateway (root CLAUDE.md guardrail) and
no `cognito-idp` VPC interface endpoint ever existed (`infra/modules/
networking/main.tf` only had S3/Secrets Manager/Logs). IAM authorization was
correct from day one; the network path to use it never existed, so every one
of those code paths has been hanging on an unreachable connection attempt in
every real deployment since this Lambda was first created — invisible until
now because every automated test mocks the Cognito call.
Fix: added `aws_vpc_endpoint.cognito_idp` (Interface, `private_dns_enabled =
true`), same pattern/security-group/cost tier as the existing Secrets
Manager and Logs endpoints (~$7.30/mo per AZ). `terraform validate` passed
in an isolated scratch copy; a real `plan`/`apply` still needs the human
(root CLAUDE.md "NEVER run terraform apply").
*Rejected: a NAT Gateway (explicitly forbidden, and massive overkill for
reaching one AWS service); polling/retrying around the hang in application
code (treats a structural unreachability as a transient blip — it isn't,
every attempt would fail identically forever without the endpoint).*

**S3 image resize pipeline: `raw/`/`processed/`/`thumbnails/` key convention, predictable key instead of read-after-write**
2026-09-16 | Completed the pipeline BRD 5.3 "S3 Image Upload Pipeline"
already fully specified but that was only half-built (`docs/PROJECT_PLAN.csv`
"S3 image resize pipeline" — the presigned-upload-URL half existed, the
resize Lambda did not). Two judgment calls made while implementing an
already-decided spec (Decision-Making Autonomy):
- **Key convention:** the upload-url endpoint now generates
  `raw/locations/{id}/photos/{uuid}.<ext>` (previously `locations/{id}/
  photos/{uuid}.<ext>`, no `raw/` prefix at all). The resize Lambda's
  output keys are a pure-string transform of that path — `raw/` swapped
  for `processed/`, extension normalized to `.jpg` (the resize Lambda
  always outputs JPEG regardless of input format, per BRD). Lives in
  `backend/app/media/key_transform.py`, a dependency-free module shared
  by the FastAPI app and the resize Lambda's own minimal container image
  (see "Resize Lambda packaging" below for why it has to stay
  dependency-free).
- **Predictable key, not read-after-write:** `POST /locations/{id}/photos`
  (the "record it" call) happens immediately after the client's direct
  S3 upload completes, but the resize Lambda runs asynchronously off the
  S3 event and will not have finished by then. Rather than block/poll for
  that, the API computes and stores the *predicted* `processed/`/
  `thumbnails/` keys synchronously via the same pure transform, so the DB
  record and the response are correct on the very first call — the actual
  S3 objects typically appear a few seconds later. Considered and
  rejected: (a) polling S3 for the processed object before responding —
  adds latency and a timeout failure mode to every photo-record call for
  no real benefit; (b) a `status` field (`pending`/`ready`) the client
  polls — real complexity (a new state machine, a new poll loop on the
  frontend) for a window that's normally a few seconds; (c) doing the
  resize synchronously in the request path — directly reintroduces the
  6MB Lambda payload problem presigned uploads exist to avoid, and BRD
  5.3 explicitly specifies an async S3-event-triggered Lambda. Tradeoff
  accepted: a client that requests the photo URL in that narrow window
  gets a 404 from CloudFront until the resize Lambda finishes — acceptable
  for Phase 1 traffic, revisit only if it proves to be a real problem.
*Rejected: read-after-write polling, a pending/ready status field,
synchronous in-request resize (see above)*

**S3 image resize pipeline: presigned POST for location-photo uploads, not presigned PUT**
2026-09-16 | Same pipeline as above. BRD 5.3 requires the 5MB cap to be
"enforced by S3 ... before the upload completes" — verified (not assumed)
that this is achievable ONLY via a presigned POST's `content-length-range`
condition: AWS's own bucket-policy-condition-key documentation
(`amazon-s3-policy-keys.html`) has no `PutObject` size-limiting example,
`content-length-range` is documented as a presigned-POST-policy construct,
and a plain presigned `PUT` (SigV4 query-string signing) has no way to
pin an exact/max `Content-Length` either — it isn't part of what that
signature covers. This is a deviation from `backend/CLAUDE.md`'s general
"S3 presigned URL generation" pattern (still the exact plain-`PUT` pattern
for every other upload in this app, e.g. claim documents) — narrowly
scoped to the one endpoint that actually needs a hard, S3-enforced size
cap. `POST /locations/{id}/photos/upload-url` now returns `{upload_url,
fields, s3_key, expires_in}` (added `fields`) instead of the previous
`{upload_url, s3_key, expires_in}` — a documented, flagged contract
change (root CLAUDE.md "never change an API contract silently"); no
frontend consumer existed yet (this pipeline was "Not Started" end to end
before this change), so the blast radius is this backend + its docs only.
*Rejected: presigned PUT with a signed Content-Length parameter (confirmed
not supported — Content-Length isn't signable on a SigV4 query-string
presigned URL), app-side-only size validation with no S3-side enforcement
(doesn't satisfy the BRD's literal "before the upload completes"), a
post-upload verify-and-delete-if-oversized callback (upload still
completes first, same problem)*

**Resize Lambda: thumbnail variant added alongside the main 1200px processed image**
2026-09-16 | **User-requested addition beyond BRD 5.3's documented spec**
(BRD only specifies the single 1200px/quality-85 processed JPEG) — not a
misreading of the BRD, an explicit scope addition for future card/list-view
and email/notification imagery. The resize Lambda now writes a SECOND
JPEG per upload: 400px on the long edge, quality 80, to a third prefix
mirroring the existing convention — `thumbnails/locations/{id}/photos/
{uuid}.jpg`. Dimension/quality judgment call: 400px comfortably covers a
2x-density card thumbnail at a common ~200 CSS px listing-card width, or
an inline email image, while meaningfully cutting bytes vs. the 1200px
image for those bandwidth-sensitive contexts; quality dialed down a notch
from the main image's 85 (fine detail loss matters less at this size, and
the extra size reduction matters more for the "cheap, frequent load"
contexts this variant targets). Derived from the same decoded source
image as the 1200px variant (not re-derived from the already-JPEG-encoded
1200px output), avoiding a second generation-loss pass. `restaurant_photo`
gained a nullable `thumbnail_s3_key` column (migration
`20260916_0003_photo_thumbnail_key.py`) and every photo-shaped API
response gained a `..._thumbnail_url` field alongside (never replacing)
its existing `..._url` field — `PhotoOut.thumbnail_url`,
`GalleryPhotoOut.thumbnail_url`, `LocationOut.cover_photo_thumbnail_url`,
`SearchResultOut.cover_photo_thumbnail_url`. The resize Lambda's IAM
`s3:PutObject` grant was widened from one prefix (`processed/*`) to two
(`processed/*` and `thumbnails/*`) — still least-privilege, still no
`s3:GetObject`/`s3:DeleteObject` outside `raw/*`.
*Rejected: deriving the thumbnail from the 1200px JPEG output instead of
the original decode (extra generation-loss pass for no benefit), a single
configurable-size endpoint instead of a fixed second variant (real
complexity — signed transform URLs / on-the-fly resizing — for a Phase 1
need that's fully met by one fixed extra size)*

**Resize Lambda packaging: own container image, not a zip + Lambda Layer**
2026-09-16 | The resize Lambda needs Pillow, a compiled C extension —
can't ship as a plain zip without a Lambda-compatible binary wheel.
Compared the two real options:
- **Container image** (chosen) — `backend/Dockerfile.resize`, built from
  the same `public.ecr.aws/lambda/python:3.12` base as the API Lambda,
  `pip install`s Pillow inside that base image so the wheel is guaranteed
  built for the actual Lambda execution environment's architecture/glibc.
  Needs its own ECR repo — `infra/modules/ecr` already has a
  `service_name` variable for exactly this multi-service case
  (DECISIONS.md "Multi-service scaling"), so `module "ecr_resize"` with
  `service_name = "resize"` is a straight copy of the established pattern,
  not a new one.
- **Zip + Lambda Layer** — lighter weight (no container build/push step),
  but needs a Lambda-compatible Pillow wheel from somewhere: either build
  one in CI (real, ongoing build-environment-matching risk — "works on
  the build machine, breaks in Lambda" is a well-known trap for compiled
  deps) or depend on a public third-party layer (e.g. Klayers/SAR).
  Rejected the public-layer path specifically: root CLAUDE.md's "no
  external vendors" is about SaaS vendors (Stripe, Vercel, etc.), not
  AWS-hosted resources, so it wouldn't literally violate that guardrail —
  but a public Lambda Layer is an unversioned-by-us, unaudited third-party
  artifact this Lambda's execution role would run at full trust,
  unpinned to anything this repo controls or reviews. The container-image
  route gets an equivalent-or-better binary-compat guarantee (same base
  image family already proven for the API Lambda) with a supply chain
  this repo actually controls (ECR scan-on-push + an explicit
  `ecr:StartImageScan` step, same as the API image).
- **New Terraform module, not a second `module "lambda"` block:** the
  DECISIONS.md "Multi-service scaling" precedent (a second `module
  "lambda"` block with a different `service_name`) doesn't fit here —
  `infra/modules/lambda` bundles the API Lambda, the deal-expiry Lambda,
  AND the shared API Gateway into one module; reusing it would duplicate
  the deal-expiry Lambda and stand up a second, useless API Gateway just
  to get a third Lambda function. `infra/modules/lambda_resize` is a new,
  narrowly-scoped module instead — same tagging/naming/`service_name`
  conventions as every other module, just sized to one event-triggered
  Lambda with no API Gateway integration. Also not placed in a VPC (unlike
  the API/deal-expiry Lambdas) — it only ever talks to S3's public
  regional endpoint, never Aurora, so VPC attachment would only add
  ENI-attach cold-start cost for no benefit.
- **Own DevOps pipeline:** `.github/workflows/deploy-resize.yml`, mirroring
  `.github/workflows/deploy-backend.yml`'s exact pattern (OIDC, idempotent
  build/push, explicit `ecr:StartImageScan`, critical-findings gate,
  `update-function-code` + wait) with its own path filter and its own
  OIDC deploy role (`aws_iam_role.github_actions_deploy_resize`, GitHub
  secret `DEV_DEPLOY_RESIZE_ROLE_ARN`) scoped to exactly this one ECR repo
  and this one Lambda function — devops/CLAUDE.md "Multi-service scaling"
  is explicit that a second service's deploy role must never widen an
  existing one to cover both. Known minor overlap, flagged rather than
  silently accepted: `deploy-backend.yml`'s path filter is `backend/**`,
  which also matches the resize Lambda's own files (they live under
  `backend/app/lambda_handlers/` and `backend/app/media/`) — so a
  resize-only change triggers an unnecessary API-image rebuild/redeploy
  too (harmless/idempotent, just wasted CI minutes). Narrowing
  `deploy-backend.yml`'s filter to exclude those paths was considered and
  deferred — not done here to avoid touching a workflow this task didn't
  need to change, on top of everything else in this PR; a fast-follow if
  the wasted CI time becomes a real cost.
- **Same one-time bootstrap chicken-and-egg as the API Lambda:** the
  resize Lambda function can't be created until an image exists at
  `module.ecr_resize`'s repo, so the same manual one-time `:bootstrap`
  tag push documented for the API Lambda (`infra/main.tf`'s `module
  "lambda"` comment) is required here too, before the very first
  `terraform apply` of a new environment — see this task's post-merge
  checklist for the exact commands.
*Rejected: a zip + public Lambda Layer for Pillow (unaudited third-party
supply chain), a second `module "lambda"` block (would duplicate
deal-expiry + API Gateway), sharing the API image's Dockerfile/ECR repo
(mixes an unrelated heavy dependency into the API image, and violates the
one-repo-one-function IAM scoping convention)*

**Migrations applied to the real database via a Lambda management command (`alembic_upgrade`), human-invoked via `aws lambda invoke` — not run by any agent, ever**
2026-09-15 | Found while investigating why the first fully-successful
deploy 500'd on every DB-touching endpoint: `relation "restaurant_location"
does not exist` — Alembic migrations have never been run against the real
Aurora database (expected; `terraform apply` only creates the empty
cluster, per `docs/STATUS.md`). Same network-reachability problem as the
dev-seed script (PR #46): Aurora sits in private subnets with no NAT
Gateway, no bastion, no RDS Data API, so nothing outside the Lambda's own
VPC route can reach it — a migration runner has to execute inside a Lambda
invocation, same as the seed script. Added `app/scripts/run_migrations.py`
(thin wrapper around `alembic.command.upgrade`, reusing
`app.db.session._get_database_url()` for the connection string so it can
never drift from what the app itself connects with) and registered it as
the `alembic_upgrade` management command (`app/scripts/management.py`,
same dispatch table `seed_dev_data` already uses). `backend/Dockerfile` now
also copies `migrations/` into the image — it previously only copied
`app/`, so even with the runner present, the image had no migration files
to apply.
Root CLAUDE.md's "NEVER run Alembic migrations — generate migration files
only" is unchanged and still absolute for every agent — this only builds
the mechanism; running it is the human's own explicit, per-command-approved
`aws lambda invoke` call, the identical trust boundary as `terraform apply`
or any other direct AWS action in this repo.
*Rejected: a bastion host or RDS Data API just to run migrations
(meaningful new cost/attack-surface for something the Lambda-invoke path
already solves); an agent running migrations directly from a local machine
(would require VPN/bastion access this project doesn't have, and would
violate the "NEVER run Alembic migrations" guardrail regardless of network
path).*

**Backend reads `DATABASE_URL` when set, else builds it from the `DB_SECRET_NAME` secret at cold start — closes a gap where the deployed Lambda had no way to get a DB connection string at all**
2026-09-15 | Backend Dev decision, found during Architect review of PR #46:
`backend/app/db/session.py` read `DATABASE_URL` directly from the
environment and raised if unset, but `infra/modules/lambda/main.tf` (both
the API Lambda and the deal-expiry Lambda) only ever sets `DB_SECRET_NAME`
— the Secrets Manager secret *name* — never `DATABASE_URL`. The real
deployed Lambda would have failed on its first DB-touching request with
"DATABASE_URL is not set," which would have blocked the whole Phase 1
backend the moment the deploy pipeline actually ran. `infra/CLAUDE.md`
"Secrets Management" already documents the intended pattern ("ALL secrets
stored in AWS Secrets Manager — never in environment variables directly.
Lambda reads secrets at cold start via boto3 `get_secret_value`") — the gap
was that nothing on the backend side actually implemented it yet. Fix:
`_get_database_url()` now tries `DATABASE_URL` first (keeps local dev via
gitignored `.env` unchanged), and falls back to fetching
`aws_secretsmanager_secret_version.db` (`infra/modules/aurora/main.tf`) via
boto3 `get_secret_value` and building a `postgresql+asyncpg://` URL from its
`username`/`password`/`host`/`port`/`dbname` fields when `DATABASE_URL`
isn't set but `DB_SECRET_NAME` is. The built URL is cached at module scope
so the secret is fetched once per cold start, not once per request — same
reasoning as every other cold-start-cached AWS client in this codebase
(e.g. `app/services/s3_service.py`'s lazy client singleton). `boto3` was
already a pinned backend dependency (`requirements.txt`), so no dependency
change was needed. No infra/Terraform change required — this consumes the
`DB_SECRET_NAME` variable Infra already provisions, it doesn't add a new one.
*Rejected: also/instead setting `DATABASE_URL` directly as a Lambda env var
in Terraform (exactly the environment-variable-secret anti-pattern
`infra/CLAUDE.md` already rejects — would put the DB password in plaintext
Lambda config instead of Secrets Manager); re-fetching the secret on every
request (unnecessary Secrets Manager calls/cost and latency on a value that
never changes within a warm execution environment).*

**Terraform environment promotion: one shared codebase on `main`, explicit per-environment state keys and var-files (workspaces rejected), migration-before-image sequencing**
2026-09-12 | Joint Architect + DevOps decision, prompted by the user's
question "container is good for app code, what about infra IaC — you can't
containerize that." App code promotes by moving one built container image's
digest forward through each environment's ECR/Lambda (see "Containerization"
below). Infra can't promote an artifact the same way — Terraform has no
build output to carry forward, only a codebase applied against per-environment
state. Landed on:
- **One Terraform codebase, no environment branches.** The reviewed commit on
  `main` is what gets applied to every environment in turn — dev, then test,
  then prod (see the hotfix exception below). Environment differences (prod
  multi-AZ, larger Aurora `max_capacity`, etc.) are `var.env`-conditionals in
  shared module code, never forked branches — a forked branch is exactly the
  long-lived-branch drift problem the trunk-based git model was chosen to avoid.
- **Explicit per-environment state keys, not Terraform workspaces.** Each
  environment's state lives at its own S3 backend key
  (`envs/<env>/terraform.tfstate`) and is applied with its own var-file
  (`infra/envs/<env>.tfvars`) and its own AWS CLI profile/account. Workspaces
  were considered and rejected: a workspace is selected by a `terraform
  workspace select` call that leaves no trace in the command or CI job
  config itself — it's easy to run a plan/apply against the wrong workspace
  by omission. An explicit state key and var-file must be named in every
  command, so "which environment am I about to touch" is visible in the
  command line / CI job definition, not in mutable local CLI state. This
  matters more, not less, as environment count grows.
- **State stays single-per-environment (not split per module) through
  Phase 1–2**, even as module count grows toward 3x. Splitting Terraform
  state by domain (e.g. a separate `data-layer` state for Aurora vs. a
  `compute` state for Lambda/API Gateway) is a real technique for limiting
  blast radius and speeding up plan/apply, but it adds real coordination
  overhead (cross-state data sources, more applies to sequence) that isn't
  justified by module *count* alone. Revisit only if apply times become
  painful or a real blast-radius incident argues for isolating a specific
  domain (most likely candidate: splitting Aurora into its own state before
  touching it in prod, once prod exists).
- **Migrations promote before the image, within each environment's promotion
  step — never the reverse.** Promoting to an environment means: (1) run
  Alembic `upgrade` against that environment's Aurora database, confirm
  success, (2) only then point that environment's Lambda at the new image
  digest. If the migration fails, promotion to that environment stops there —
  the image does not move forward. This is a human-run sequence per the
  existing "never terraform apply / never run Alembic migrations" agent
  guardrail — an agent generates the migration and the plan, a human runs
  both steps against each environment in order.
- **Migrations must default to additive/backward-compatible (expand-contract),
  because the promotion window always has a moment where old app code faces
  new-or-old schema and vice versa.** A migration that only adds a nullable
  column or a new table is safe regardless of ordering. A destructive change
  (drop/rename a column, tighten a NOT NULL, remove a table) must be split
  into an expand phase (additive, ships now) and a later contract phase
  (removes the old shape, ships only after every environment's app code no
  longer reads it) — otherwise there's a real window, mid-promotion, where
  either the old image or the new image can't run against the schema in
  front of it.
- **Destructive migrations get caught before prod by explicit PR-time
  flagging, not by discovering it at apply time.** Architect already reviews
  every PR (see "Every agent works on a feature branch..." above); any
  migration that isn't purely additive must say so in the PR description
  (what's destructive, why, what the expand/contract plan is) so it gets
  extra scrutiny during that review — the same review gate the promotion
  order relies on, not a new gate. Once `test` exists, a destructive
  migration should be exercised there (ideally against a prod-like data
  copy) before the same commit is promoted to prod — test is functioning as
  the destructive-migration canary, not just a code-correctness canary.
*Rejected: Terraform workspaces (implicit environment selection, no
command-line/CI trace of which environment is targeted — rejected more
confidently after this review, not just tentatively), one Terraform state
file for all environments (defeats the isolation the separate-account
structure already provides), splitting state per module/domain now (real
technique, but not justified until module count or blast-radius risk
actually causes pain — premature for Phase 1), rebuilding the migration
history per environment branch (reintroduces the long-lived-branch drift the
trunk-based git model exists to avoid), applying the image before the
migration (would put new code in front of an old schema it wasn't written
against)*

**Terraform rollback playbook: infra rolls forward, not back — `prevent_destroy` on stateful resources, "plan shows a destroy" is a hard stop**
2026-09-12 | Joint Architect + DevOps decision, same discussion as above.
App-code rollback is cheap and symmetric: redeploy the previous image digest,
done. Terraform rollback is NOT symmetric — reapplying an older commit against
current state does not "undo" a destructive change; it computes a fresh diff
against whatever exists *now*, which can mean deleting a resource (or a
column, or a bucket) that current data now depends on. Landed on:
- **Treat infra rollback as "roll forward with a corrective commit," not
  "revert to an old commit."** The fix for a bad `apply` is a new, reviewed
  commit that repairs the current state forward — not reapplying history
  and hoping Terraform's diff reconstructs the old shape correctly.
- **Every stateful/hard-to-recreate resource (Aurora cluster, S3 media
  bucket, anything holding data that isn't trivially reproducible) gets a
  `lifecycle { prevent_destroy = true }` block once created.** This is a
  deliberate friction addition: a plan that would destroy/replace one of
  these resources fails outright rather than silently succeeding, forcing a
  human to explicitly remove the guard (a visible, reviewable action) before
  a destructive apply can proceed.
- **Any `terraform plan` output showing a destroy or a replace on a
  `prevent_destroy`-guarded resource is a hard stop, not a routine apply** —
  flag it explicitly to the human rather than treating it as one line in a
  larger diff. This applies starting now, in `dev`, even though dev data
  isn't precious yet — the guard is cheap to add at resource-creation time
  and expensive to retrofit correctly later once real data and more
  environments exist.
*Rejected: no special handling for destructive plans (relies on someone
noticing a `- destroy` line buried in a larger plan diff), only adding
`prevent_destroy` once `test`/`prod` exist (defers a cheap guard to a point
where retrofitting it is riskier and easier to forget)*
**Signed off by user 2026-09-12** — Architect/DevOps flagged this specifically
(applying `prevent_destroy` in `dev` before it's strictly needed) for explicit
human sign-off rather than treating it as settled; approved as written.

**Hotfix path for an environment beyond dev: still PR + review, expedited, prod can go ahead of test but must backfill test immediately after**
2026-09-12 | Joint Architect + DevOps decision, same discussion — addresses
"how does an urgent fix reach test/prod without a long-lived branch and
without necessarily going through every earlier environment first." No new
branch type and no skipped review: the standing git workflow (feature branch
→ PR → Architect review → human merge) still applies. What's different for a
genuinely urgent, environment-specific fix:
- Label the PR `hotfix` in its title/description so Architect's review can be
  scoped tighter and faster (schema/security/scope check, not a full design
  review) — still required, never skipped.
- The human may promote the merged commit to prod ahead of test if test
  doesn't reproduce the issue and the human explicitly approves skipping
  ahead — but the same commit must be promoted (backfilled) into test
  immediately after, in the next promotion pass, not "whenever." Environments
  are never allowed to silently diverge in what commit their state reflects;
  skipping test's turn is a one-time expedite, not a standing exemption.
- Every use of this exception is recorded (PR description + `docs/CMD_LOG.md`
  entry noting the out-of-order promotion) so "we skipped test" stays visible
  history, not a habit that erodes the promotion order by default.
*Rejected: a dedicated long-lived hotfix branch (reintroduces the branch
drift trunk-based git was chosen to avoid), skipping Architect review for
speed (review is the scope/consistency gate for every PR, urgency isn't a
reason to remove the only reviewer), silently allowing prod-ahead-of-test
promotions with no record (makes environment drift invisible)*
**Signed off by user 2026-09-12** — Architect/DevOps flagged the prod-ahead-
of-test exception specifically (real speed-vs-drift-risk tradeoff) for
explicit human sign-off rather than treating it as settled; approved as
written, including the mandatory backfill-next-pass and CMD_LOG record.

**Multi-service scaling: ECR/Lambda modules gain a `service_name` variable now, so a second service is a module-block copy, not a redesign**
2026-09-12 | DevOps assessment, same discussion. `infra/modules/ecr` (see PR
#2, `infra/ecr-container-lambda-image`) currently hard-codes the single-service
naming convention `${var.project}-api-${var.env}`. A second Lambda
function/service later (e.g. a notifications service) shouldn't require
redesigning the module — it should be a second `module "ecr"` /
`module "lambda"` block passing a different `service_name`, producing
`${var.project}-${service_name}-${env}` repo/function names, plus a second
CI workflow (or a matrix job in the existing one) with its own `paths:`
filter and its own OIDC role scoped to that one repo and one function (never
widened to cover both services). Flagged as a small addition Infra should
make when it next touches the ECR/Lambda modules (add the variable with a
default of `"api"` so the existing single-service call site doesn't change)
rather than something to retrofit under time pressure when the second
service actually shows up.
*Rejected: waiting until a second service exists to add the variable (cheap
now, forces a mid-migration module signature change later), one shared ECR
repo for multiple services distinguished by tag prefix (loses per-service
lifecycle policy and scan configuration, and IAM scoping to "one repo" no
longer means "one service")*

**Region: `us-east-1`, confirmed despite DFW being the initial market**
2026-09-12 | Considered switching to a west-coast region given the DFW launch
market, but geography doesn't favor it: us-west-1/us-west-2 are farther from
Dallas than us-east-1 (Virginia), not closer, so there's no latency argument
for moving west. us-east-1 is already the default across every Terraform
module and `terraform.tfvars.example`, and it has the broadest AWS service
availability and typically the lowest pricing. No change made — confirming
the existing default rather than picking a new region.
*Rejected: us-west-1/us-west-2 (farther from Texas, no latency benefit, would
require re-plumbing every module's default), us-east-2 (marginal geographic
difference vs. us-east-1, not worth a config change for no real benefit)*

**AWS account structure: AWS Organizations member accounts, one per environment, starting with `dev` only**
2026-09-12 | User decision. New member accounts under the existing management/
payer account — consolidated billing, no separate payment method per
environment. Only `dev` is created now; `test` and `prod` follow later, added
the same way when there's something worth staging or launching. Account
creation itself is a manual step (AWS Organizations console, or
`aws organizations create-account` run by the human) — no agent creates AWS
accounts, ever (see root `CLAUDE.md` "NEVER — Session Control" and the
Prohibited-actions policy this session operates under).
*Rejected: fully standalone accounts with separate billing (no benefit over
Organizations member accounts for this use case), setting up all three
environments now (Phase 1 work only needs `dev`; test/prod would sit unused)*

**Containerization: Lambda container images via ECR, chosen for cost at low/no load**
2026-09-12 | User wants to containerize for easy promotion across environments,
and asked for the cheapest option given light load expected for months to
years. Compared against ECS Fargate and AWS App Runner:
- **Lambda (container image)** — true scale-to-zero, pay per invocation/duration,
  no VPC or NAT required. Cheapest at low/no traffic, matches the existing
  Phase cost ladder ($20-50/mo Phase 1) exactly, because it's the same pricing
  model as the zip-based Lambda already decided — only the packaging changes.
- **App Runner** — simpler ops than Fargate, but no true scale-to-zero; some
  baseline cost exists even at zero traffic.
- **ECS Fargate** — most flexible, but needs a VPC and typically a NAT Gateway
  or VPC endpoints, and tasks don't scale to zero as cleanly — highest cost
  and complexity of the three, and the NAT Gateway path directly conflicts
  with the existing "NEVER create a NAT Gateway" guardrail.
Chose Lambda container images: same Mangum/FastAPI code, packaged as a Docker
image (`backend/Dockerfile`) instead of a zip, stored in ECR, referenced by
the Lambda function's `image_uri`. Promotable across environments by pushing
the same image digest into each environment's ECR once `test`/`prod` exist.
*Rejected: App Runner (baseline cost at zero traffic), ECS Fargate (VPC/NAT
cost and complexity, guardrail conflict)*

**All infrastructure runs on AWS — no external vendors**
May 2026 | Single vendor means one bill, one IAM setup, one Terraform state.
Vercel was considered for Next.js hosting but rejected to avoid split vendor management.
*Rejected: Vercel, Netlify, Railway*

**Next.js hosted on AWS Amplify (Phase 1–2)**
May 2026 | Amplify handles Next.js SSR natively within AWS. Free tier covers Phase 1
traffic (1,000 build min/mo, 15GB served/mo). Migration trigger to App Runner:
80GB/mo bandwidth or 10,000 MAU.
*Rejected: Vercel (external vendor), App Runner (over-spec for Phase 1)*

**No Redis in Phase 1–2**
May 2026 | At Phase 1 scale (dozens of concurrent users), Redis adds cost and
operational complexity without meaningful benefit. is_paid() uses a stored boolean
(single DB read). Redis added in Phase 3 for geo search query caching only.
*Rejected: Redis from day 1 (premature optimisation)*

**No RDS Proxy in Phase 1–2**
May 2026 | Aurora Serverless v2 at Phase 1 traffic won't hit connection limits.
RDS Proxy added in Phase 3+ only when concurrent users exceed ~200.
*Rejected: RDS Proxy from day 1 (unnecessary cost ~$15-30/mo at launch)*

**Terraform for all infrastructure**
May 2026 | Version-controlled, reproducible, auditable. All AWS resources in code.
Agents generate plans only — humans apply.
*Rejected: AWS Console manual setup, AWS CDK (team prefers HCL over Python for infra)*

**Aurora PostgreSQL Serverless v2 + PostGIS (not DynamoDB)**
May 2026 | Geographic search (radius queries, multi-filter) requires relational + geo
capabilities. PostGIS ST_DWithin makes 15-mile radius queries trivial. DynamoDB has
no native geo support and would require a custom library.
Aurora Serverless v2 scales to zero (min_capacity=0) maintaining cost parity.
*Rejected: DynamoDB (no native geo), MongoDB Atlas (external vendor)*

**Single EventBridge cron rule for deal expiry (not one rule per deal)**
May 2026 | One rule per deal = thousands of rules at scale, high management complexity.
Single Lambda runs every 5 minutes:
UPDATE deal SET is_active=false WHERE is_active=true AND end_at IS NOT NULL AND end_at <= NOW()
*Rejected: Per-deal EventBridge rules (rule proliferation), SQS delay queues (complexity)*

**S3 presigned URLs for image uploads (never through Lambda)**
May 2026 | Lambda has a 6MB payload limit. Passing 5MB images through Lambda exhausts
memory and hits size limits. Presigned URL flow: client requests URL → uploads directly
to S3 → S3 event triggers resize Lambda.
*Rejected: Direct Lambda upload endpoint (hits 6MB limit)*

**AWS Amplify build, not separate CI/CD for frontend**
May 2026 | Amplify handles build + deploy + CDN in one service. GitHub Actions handles
backend and infra CI only.
*Rejected: GitHub Actions for frontend deploy (extra complexity)*

**One-off ops scripts (dev seed data, future admin/maintenance commands) run via a direct `aws lambda invoke` management-command payload, not a bastion or the RDS Data API**
2026-09-15 | Backend Dev needed a way to actually run `backend/app/scripts/
seed_dev_data.py` against real Aurora. Checked `infra/modules/networking` and
`infra/modules/aurora` first, not assumed: no NAT Gateway, no bastion host, RDS
Data API not enabled — the API Lambda's own VPC route is the only thing that can
reach Aurora at all. `app/main.py`'s `handler` now branches on a
`_management_command` key in the Lambda invoke event (bypassing API Gateway/
Mangum) to a small dispatch table in `app/scripts/management.py`. Trust
boundary: no HTTP/API Gateway surface at all — reachable only by a caller who
already holds `lambda:InvokeFunction` on this one function in the target AWS
account, the same boundary as `terraform apply` or any other direct AWS action
in this repo. Same container image, same `CMD`, no Dockerfile/infra change.
*Rejected: a small bastion EC2 instance + SSM Session Manager port-forwarding
(new always-on-ish resource, new cost line, Infra work not justified for a
low-frequency dev-ops need); enabling the RDS Data API (`enable_http_endpoint`
on the Aurora cluster — cheaper and worth reconsidering later, but changes the
app's DB access story more broadly than one seed script warrants; flagged for
Infra to revisit if this pattern gets used often enough to want it).*

---

## Database & Data Model

**Location status lifecycle: a single `status` column (not a DB enum) replacing the old `is_active` boolean, kept alive as a derived `hybrid_property`; one asymmetric transition (`closed_pending_reopen` -> `active`) requires admin approval, everything else is freely self-service**
2026-09-22 | Combined schema+backend+frontend decision (root CLAUDE.md
"Decision-Making Autonomy"), closing the product need for more than a
binary "listed or not" state — an owner needs to mark a new location
"coming soon" (distinct from a deliberate hide, so it isn't confused
with one in the console) and to signal "permanently closed" in a way
that can't be silently un-done by mistake.

- **Four states, one plain `String` column, not a stored Postgres
  `ENUM` type:** `active` \| `owner_deactivated` \| `coming_soon` \|
  `closed_pending_reopen`. Root CLAUDE.md's Architect guardrails forbid
  a stored *tier* enum specifically (`is_paid` stays boolean by
  explicit product decision) but say nothing about a status/lifecycle
  enum elsewhere — `claim_request.status` and `listing_report.status`
  already use exactly this pattern (plain `String`, allowed values
  documented in a comment, no DB-level `ENUM`) and passed prior
  Architect review. A DB-level `ENUM` would need a migration to add a
  5th value later; plain `String` doesn't. See
  `app/models/restaurant_location.py` module docstring for the full
  write-up and `docs/DATA_MODEL.md` "restaurant_location".
- **`is_active` is kept, not renamed, as a Python-level
  `hybrid_property` derived from `status`** (`True` only when
  `status == "active"`) rather than a hard rename across the ~15 call
  sites across services/scripts/tests that read or write it. There is
  no state where "hidden" and "not active" diverge — every non-`active`
  status is equally invisible to a caller without access — so the old
  boolean's meaning maps cleanly onto the new column with zero
  behavior change for existing callers. Writing `location.is_active =
  False` maps to `status = "owner_deactivated"` (the closest existing
  status to the old blanket soft-hide); new code that needs a *specific*
  hidden state sets `.status` directly instead.
- **One asymmetric transition, enforced in the service layer, not the
  schema:** every pair of statuses is freely self-service both ways
  through `POST /locations/{id}/status` (owner or admin, no manager
  path) EXCEPT the one-way trip out of `closed_pending_reopen` — an
  owner who closes a location can't self-reopen it; only an
  admin-approved `location_reopen_request` (shaped like
  `claim_request` — submission + admin approve/reject, real side effect
  on approval) can move it back to `active`. This mirrors "closing an
  account requires re-verification to reopen" patterns elsewhere and
  gives admin a checkpoint on a location that was deliberately taken
  down, without blocking the freely-reversible day-to-day toggles
  (temporarily hiding a listing, marking a new one "coming soon").
  *Rejected: making `closed_pending_reopen` -> `active` also
  self-service (loses the admin checkpoint that's the whole point of a
  distinct "closed" state vs. just reusing `owner_deactivated`)*.
- **Manager cannot change status — owner or admin only.** Root
  CLAUDE.md's Permission model scopes a manager to location-level
  content edits (info, hours, photos), not the location's own
  existence/visibility as a product — the same reasoning that already
  keeps `POST /locations/{id}/managers` and `POST /locations` owner-only
  (`docs/API_CONTRACTS.md` "Deliberately left owner-only"). A manager
  can still *see* a hidden location they're assigned to (so they can
  keep setting it up), just not change its status.
- **`GET /locations/{id}` becomes status-aware** (a real gap closed by
  this change, not a new feature): previously this public endpoint
  returned a hidden location's full detail to any caller regardless of
  status. Now a non-`active` location 404s (never 403 — an unauthorized
  caller can't distinguish "doesn't exist" from "exists but hidden",
  same posture as the claim-flow 404/403 pattern) unless the caller is
  the owning owner, an admin, or an actively assigned manager. See
  `docs/API_CONTRACTS.md` "GET /locations/{id}" "Status-aware
  visibility".

**Hard-delete a location: new `DELETE /locations/{id}/permanent` endpoint, gated on already-hidden status + no active manager/pending claim/pending reopen — closes the "remove or reassign its locations first" dead end in `DELETE /restaurants/{id}`**
2026-09-22 | Confirmed bug: `DELETE /restaurants/{id}` 409s with "Cannot
delete a restaurant that still has locations. Remove or reassign its
locations first" whenever `restaurant_location.brand_id`'s `ON DELETE
RESTRICT` fires — but no endpoint existed that could actually remove a
location (the existing `DELETE /locations/{id}` only soft-hides,
`status -> owner_deactivated`, row kept) or reassign one to another brand
(no such endpoint at all). Every real listing with any location history
hit a permanent dead end trying to delete the brand. Picked the smallest
option that's actually correct (root CLAUDE.md "Decision-Making
Autonomy") over the fallback of just fixing the error message, since the
capability itself was in reach:

- **New route, not a repurposed `DELETE /locations/{id}`:** that route's
  contract (`docs/API_CONTRACTS.md`, `app/models/restaurant_location.py`)
  is a settled soft-hide with real callers (owner console's location
  editor before this task, `admin/listings` moderation panel) — changing
  its behavior in place would silently turn every existing caller's
  "hide" into a "destroy." `DELETE /locations/{id}/permanent` is a
  distinct, unambiguous, separately-authorized action instead, same auth
  (`require_location_owner_or_admin`) as the soft version.
- **Guardrail order — status first, then manager, then the two pending-review
  tables:** (1) location must already be non-`active` (any of the three
  hidden statuses) — a live, public listing can't be hard-deleted in one
  step; the caller has to hide it first, which doubles as a confirmation
  that they've accepted it's coming down. (2) no *active*
  `location_manager` row — don't remove a location a manager is actively
  working. (3) no `claim_request` in `pending_review` referencing this
  location via its nullable `location_id` (the phone_verification proof
  path). (4) no `location_reopen_request` in `pending_review` for this
  location. Each 409s with its own `code` (`location_still_active`,
  `location_has_active_manager`, `location_has_pending_claim`,
  `location_has_pending_reopen_request`) rather than one generic message.
- **Cascading child rows is accepted, including losing INACTIVE
  `location_manager` history:** `restaurant_hours`, `restaurant_photo`,
  and `location_reopen_request` are all `ON DELETE CASCADE` on
  `location_id` already (`docs/DATA_MODEL.md`); so is `location_manager`
  — which means a hard delete also removes that location's past
  (already-inactive) manager assignments, not just the active one
  guardrail (2) already refuses on. `claim_request.location_id` and
  `listing_report.location_id` are `SET NULL`, so those rows survive with
  their location pointer cleared. Accepted rather than blocking on it:
  the `audit_log` row this endpoint writes (`action="delete"`,
  `old_val` snapshot of status/address/brand_id) has no FK to
  `restaurant_location` and survives independently, and refusing hard
  delete until every historical manager row is manually purged would make
  the feature useless for exactly the established listings most likely to
  need it.
  *Rejected: also gating on inactive manager history (defeats the
  feature's purpose for any location with a manager past); silently
  nulling `location_manager.location_id` instead of cascading (that
  column isn't nullable, and making it so would weaken the paid-tier
  manager-cap queries elsewhere that assume a location_id is always
  real)*.
- **Frontend: a "Remove this location" danger-zone action added to the
  owner/admin location editor (`LocationStatusControl.tsx`), visible only
  when `status !== "active"`** (mirroring the backend's own first
  guardrail rather than duplicating it as a second source of truth), with
  a real two-step confirmation distinct from every other "soft" toggle
  already in that component — the copy says explicitly that this is
  permanent and cannot be undone. On success the page navigates back to
  the caller's console (`/account` for owner, `/admin/listings` for
  admin) rather than re-rendering, since the location it was showing no
  longer exists.
  *Rejected: also wiring a "reassign this location to another brand"
  endpoint — out of scope for this fix; a single-location brand (the
  common case per the task's own framing) is fully unblocked by hard
  delete alone, and multi-brand reassignment is a distinct, bigger
  feature with its own ownership-transfer questions (billing, manager
  assignments, claim history) better decided on its own.*

**CSV bulk restaurant import: `website` is brand-level, geocoding happens on the human's machine (not inside the Lambda), CSV extends the existing `bulk_import_restaurants` command rather than forking a new one**
2026-09-17 | Combined schema+backend decision (root CLAUDE.md
"Decision-Making Autonomy"), closing the user request "upload a CSV with
name/address/url/phone/type, related to an owner email." Three real
sub-decisions:

- **`website` added to `restaurant_brand`, not `restaurant_location`.**
  A restaurant's website describes the concept as a whole, not one
  address — the same rationale `restaurant_cuisine` already uses for
  staying brand-level (docs/DATA_MODEL.md "restaurant_cuisine" judgment
  call). `varchar(500)`, matching `claim_request.google_business_profile_url`'s
  existing sizing convention for a URL column in this schema. See
  docs/DATA_MODEL.md "restaurant_brand" for the full write-up.
  *Rejected: `restaurant_location.website` (a chain's locations would
  each need the same URL re-entered, and nothing else location-specific
  about a website was asked for)*.
- **Geocoding happens in the new human-run script
  (`scripts/bulk_import_restaurants_csv.py`), before the Lambda is ever
  invoked — NOT inside the `bulk_import_restaurants` management command,
  despite that being the more obvious place for it.** Confirmed against
  `infra/modules/networking/main.tf` ("Private subnets — Lambda + Aurora
  live here; no NAT Gateway") and root CLAUDE.md "NEVER create a NAT
  Gateway": the deployed Lambda has an in-VPC route to Aurora but **no
  route to the public internet at all**, so it could not reach
  Nominatim even if the command tried. This is also the real precedent
  already in this repo, not a new pattern: `app/scripts/irving_restaurants_seed.json`'s
  own `_comment` field says its rows were "geocoded via Nominatim" before
  being committed, not at Lambda runtime. The script geocodes any row
  missing `latitude`/`longitude` (1 req/sec, descriptive `User-Agent`,
  per Nominatim's usage policy) and hands the Lambda an already-enriched
  CSV; the Lambda's only job stays "write to Aurora," consistent with
  every other management command in this file.
  *Rejected: geocoding inside the Lambda per a literal reading of "runs
  inside the Lambda" (would require provisioning a NAT Gateway, an
  always-on cost explicitly forbidden by root CLAUDE.md "NEVER — Cost",
  just to reach one third-party HTTP API)*.
- **CSV is a second input shape (`csv_content`) on the existing
  `bulk_import_restaurants` management command, not a new command name,
  and not a new HTTP endpoint.** Reuses the identical brand/location
  create-or-skip logic (`app/services/restaurant_bulk_import_service.py`)
  rather than forking it — only owner resolution (per-row `owner_email`
  vs. one batch-level `owner_id`) and cuisine matching (free-text `type`
  vs. no cuisine at all) differ. Kept off HTTP because the actual caller
  is a human running a local script against a local file, not a
  browser/admin-panel flow, and a large CSV would risk API Gateway's
  payload-size limits with no benefit over a direct Lambda invoke — same
  trust boundary (`lambda:InvokeFunction` in the target AWS account) as
  every other management command. See docs/API_CONTRACTS.md "CSV bulk
  restaurant import" for the full column list and payload shape.
  *Rejected: a brand-new `bulk_import_restaurants_csv` command name
  (would duplicate the owner-lookup/cap/dispatch boilerplate
  `management.py` already has for zero real benefit), an HTTP endpoint
  parallel to `POST /admin/restaurants/bulk-import` (no frontend caller
  exists or was asked for, and CSV body size is a worse fit for API
  Gateway than a direct Lambda invoke)*.

**CCPA data export/deletion: scoped to this app's own DB (not Cognito), synchronous export, admin-reviewed deletion queue modeled on `claim_request`, audit_log retained not redacted**
2026-09-16 | Backend Dev decision (root CLAUDE.md "Decision-Making
Autonomy"), closing the tracked Phase 1 gap in `docs/PROJECT_PLAN.csv`
("CCPA data export / deletion flow"). The BRD itself only says "CCPA
compliant. Users can request data export and deletion" (BRD v3.6 sections
7 and 12) — no further detail — so the shape below is an engineering
judgment call, not a re-reading of a more detailed spec. Several
sub-decisions, each with real alternatives considered:

- **Scope is this app's own database only — Cognito's own account record
  (login email, password, MFA, the account itself) is explicitly OUT of
  scope.** Deleting a Cognito user needs `cognito-idp:AdminDeleteUser`,
  a permission this Lambda does not have and, per root CLAUDE.md "AWS
  Best Practices" (least privilege — ask for exactly what's needed, never
  a broader grant "to be safe"), shouldn't be requested just to build this
  without a clear need. It's also a materially bigger, harder-to-reverse
  action than redacting app-DB fields (it ends the person's ability to
  log in at all) that deserves its own deliberate decision, not a
  side-effect of this task. If real usage later shows people expect
  "delete my data" to also kill their login, that's a follow-up requiring
  an explicit Infra grant — flagged here, not built speculatively.
- **What "this identity's data" means, given `docs/DATA_MODEL.md`'s
  already-flagged judgment call that there is no local `registered_user`
  or `manager` table:** every table that stores a caller's Cognito `sub`
  directly — `owner_account.cognito_sub`, `location_manager.user_id`,
  `user_follow.user_id`, `claim_request.claimant_user_id`, and
  `audit_log.actor_id` (actions the identity performed). Queried by the
  caller's own `sub` across ALL of these, not gated to only the table(s)
  matching their *current* role claim — the same person can have rows in
  more than one regardless of their present pool group (e.g. `docs/
  API_CONTRACTS.md` "Claim flow" allows any authenticated user to submit
  a claim, so a `registered_user` can have `claim_request` history too).
  A role-gated query would silently under-export/under-delete for anyone
  whose Cognito history doesn't match their current group.
- **Export is synchronous JSON (`GET /auth/me/data-export`), not an async
  job + emailed download link.** CCPA doesn't require instant response,
  and many real implementations do queue + email — but root CLAUDE.md is
  explicit that SES is deferred to Phase 2+ and this Lambda has no SES
  grant yet, and the actual per-user data volume here is a handful of
  rows across five tables, not a bulk export needing async handling. A
  synchronous response is well within a Lambda request's timeout and adds
  zero new infrastructure (no job table, no delivery mechanism, no SES
  permission request). GET, not POST: this creates nothing and has no
  side effect — same semantics as the existing `GET /auth/me`. Revisit
  if/when SES exists and volumes grow.
- **Deletion is a reviewed request (`data_deletion_request`, modeled
  directly on the existing `claim_request` table/flow: submit ->
  `pending_review` -> admin `approve`/`reject`), not executed
  synchronously at submission.** CCPA gives businesses up to 45 days
  (extendable) to respond to a verified request — no instant-execution
  requirement. An irreversible, whole-identity data purge triggered
  by a single self-service click, with zero human check, is a real risk
  on a first implementation (a leaked/stolen JWT could be used to nuke
  someone's manager assignments or claim history with no recourse; a
  pending fraud investigation or dispute might need the data to stay put
  a little longer). `claim_request` already established exactly this
  "submit now, admin resolves later" shape in this codebase for another
  irreversible-ish action (granting brand ownership) — reusing it is the
  lowest-risk, lowest-new-complexity option, not a new pattern. Identity
  verification itself is already handled by the Cognito JWT (the caller
  can only ever request/view their own request — service-layer check,
  same posture as every other self-scoped write in this app) — admin
  review here is about legitimacy/scope/legal-hold judgment, not
  re-verifying who the requester is.
- **`audit_log` rows are retained, never edited or removed by a deletion
  request — even the ones where the caller is the recorded actor.** Root
  CLAUDE.md already makes `audit_log` append-only ("NEVER delete or
  truncate any DB table") for data-governance reasons, and CCPA's
  deletion right itself has a standard legitimate-business-purpose/legal-
  compliance carve-out (Cal. Civ. Code §1798.105(d)) that an audit trail
  of who-changed-what on business records fits squarely into — deleting
  or anonymizing it would also break its whole purpose (investigating a
  disputed change requires knowing who made it). These entries ARE
  included in the export response for transparency, with an explicit
  `notice` field explaining they're retained.
- **`user_follow` rows are hard-deleted** on approval — pure personal
  preference data, not on the audit-required table list, no legitimate
  reason to keep a redacted tombstone.
- **`location_manager` and `claim_request` rows are kept but have their
  identifying column (`user_id` / `claimant_user_id`) redacted to a
  shared literal marker (`"deleted-user"`), not deleted outright** —
  `location_manager` is on root CLAUDE.md's audit-required table list and
  documents real access-control history (who could manage a location and
  when); `claim_request` is a business record of ownership-claim attempts
  useful for anti-fraud/dispute history (e.g. a rejected claimant
  re-attempting). Deleting the rows would also just orphan any
  `audit_log.record_id` pointing at them for no benefit. A currently
  *active* `location_manager` row is also deactivated (`is_active=false`,
  `revoked_at=now()`) — same effect as the existing owner-initiated
  removal path, since the person can no longer legitimately hold that
  access once their identity is redacted.
- **A PENDING `claim_request` under the identity being deleted blocks
  approval (`409 pending_claim_blocks_deletion`)** rather than silently
  redacting it — an admin mid-review of a claim needs to know who they're
  evaluating; redacting the claimant out from under a live review would
  break that review, not just tidy up data. Admin resolves the claim via
  the normal `/claim/{id}/approve`/`reject` flow first, then retries the
  deletion approval.
- **`owner_account` is anonymized in place (`full_name`/`phone` nulled,
  `email` replaced with a synthetic unique placeholder, new
  `personal_data_deleted_at` timestamp set), never hard-deleted — and the
  brands/locations they own are NOT touched.** Hard-deleting the row would
  cascade `restaurant_brand.owner_id` to `NULL` (existing `ON DELETE SET
  NULL`), silently turning a claimed, live restaurant listing back into
  "unclaimed" as a side effect of one person's personal-data request —
  surprising and disproportionate. More fundamentally: the restaurant
  business record (name, address, menu, photos) is this platform's own
  business-directory content about a business, submitted by the owner on
  its behalf — it is not "the owner's personal information" in the CCPA
  sense, only the identifying fields describing the owner *as an
  individual* (name, phone, email) are. `cognito_sub` is deliberately
  left unredacted — it remains the live join key for login (Cognito
  account deletion is out of scope, see above) and for this very
  request's own idempotency check, and it's an opaque identifier with no
  directly-identifying content by itself, the same treatment already
  given to it everywhere else in this schema (`location_manager.user_id`,
  etc.). New nullable `owner_account.personal_data_deleted_at` column
  (migration `20260916_0004_data_deletion_request.py`) — a small,
  additive schema change alongside the new table; flagged explicitly
  since schema changes are normally Architect's territory (backend/
  CLAUDE.md: Backend Dev may write migrations for non-design changes,
  should flag if a change crosses into real schema design) — this one
  column follows the exact existing pattern of a nullable timestamp
  marker (no new judgment about relationships/cascades/naming beyond what
  this decision already covers), so implemented directly rather than
  escalated, but called out here for a human sanity-check regardless.
- **Not handled here, flagged as a Phase 2 follow-up:** once Stripe
  billing exists, deleting an owner with an active paid subscription will
  also need to cancel/handle that subscription — not a concern yet since
  no Stripe integration is live in Phase 1 (`is_paid` never becomes true
  today).
*Rejected: also deleting the Cognito account (broader IAM grant than
justified, bigger irreversible action deserving its own decision), an
async export job + SES email delivery (real new infrastructure — job
table, delivery mechanism, SES permission — not justified by Phase 1's
tiny per-user data volume or SES's Phase 2+ deferral), immediate
synchronous deletion execution with no review step (real self-service
data-loss risk with no undo, on a compliance-critical irreversible
action, for a first implementation with no verification step beyond the
JWT itself), hard-deleting `owner_account` (cascades unclaimed status
onto live restaurant listings as a side effect, conflates the platform's
own business-directory content with the owner's personal information),
hard-deleting/anonymizing `audit_log` (breaks its data-governance
purpose and root CLAUDE.md's existing append-only guarantee, and CCPA
itself carves out this exact legitimate-business-purpose case).

**Amendment 2026-09-22 — `listing_report` added to export/deletion
scope, `reporter_email` nulled but `reporter_user_id` kept:** PR #113
(`listing_report`, "report a problem") shipped after the CCPA flow above
and was never wired into it — a signed-in caller's `reporter_email` sat
in a table `_gather`/export/deletion didn't know about. Fixed by adding
`listing_report` to `_gather`, matched by `reporter_user_id` (the
Cognito `sub`, set only when the submitter was signed in) — deliberately
**not** by `reporter_email`, since that column is free text any
submitter, including an anonymous one, can type; matching on it could
both miss the caller's own reports (submitted with no email, or a
different email than their account's) and wrongly pull in someone
else's report (an anonymous submitter typing another person's email).
On deletion approval, only `reporter_email` is nulled — `reporter_user_id`
is deliberately left in place, given the same treatment as
`audit_log.actor_id` rather than `location_manager.user_id` /
`claim_request.claimant_user_id`: a report is an attribution/triage
trail (who flagged this listing issue), not an access grant or a
contested business claim, so there's no access-control or fraud-history
reason to sever it, and severing it would also make the row impossible
to find again via `reporter_user_id` in any future export/deletion pass
for that identity. `category`/`details`/`status` are never touched.
`listing_report` was already outside root CLAUDE.md's audit-required
table list (see its own model docstring), so this redaction gets no
`audit_log` entry, same as `claim_request`'s.

**Owner-scoped restaurant list: bare `GET /restaurants`, not `/restaurants/mine` or a `/search` variant**
2026-09-13 | Architect decision, made while writing the contract to unblock
the owner portal dashboard (there was no way for an authenticated owner to
discover their own brands — `GET /restaurants` only supported the existing
id-or-slug lookup). Resolved by overloading the bare `GET /restaurants`
route on caller role rather than adding a new top-level route: an owner
caller is implicitly filtered to `owner_id = current_user.id` with no
query param able to widen that (never trust a client-supplied owner
filter for a non-admin, same posture as `PATCH /auth/me`'s self-scoped
write); an admin caller gets an optional `owner_id` filter, omitted
returns all brands, paginated. Not a duplicate of `GET /search`: `/search`
is the public geo/filter discovery endpoint with no auth and no ownership
concept, while this is "what do I own," auth-gated, with no geo component
at all. Consistent with how `GET /restaurants/{id}` already overloads on
caller intent (id vs. slug, see below) instead of spawning new top-level
routes for each variant lookup.
*Rejected: a new `/restaurants/mine` route (works, but breaks the
established pattern of overloading the existing route on caller
intent/role rather than adding a route per variant — see the id-or-slug
precedent below), extending `/search` with an owner-scoped mode (conflates
two endpoints with fundamentally different auth models and no shared geo
component; `/search` must stay public)*

**Cuisine tags: public read endpoint (`GET /cuisine-tags`), no pagination**
2026-09-13 | Architect decision, closing a gap flagged during PR #17
review: the homepage's cuisine filter chips were a hardcoded frontend
constant with no backend source of truth, risking silent drift from the
real `cuisine_tag` table. Added `GET /cuisine-tags` (public, optional
`category` filter, `is_active=true` only) as its own top-level endpoint
family rather than a sub-resource of `/restaurants` or `/search` —
`cuisine_tag` isn't owned by a brand or location, it's a standalone
admin-seeded taxonomy table both `/search`'s filters and the owner
portal's tag picker need to resolve against. No pagination: same
reasoning already used for `GET /locations/{id}/managers` not needing
it — `cuisine_tag` is a small, effectively-static seeded table
(`docs/TAXONOMY.md`), not a growing collection.
*Rejected: keeping the cuisine list as a frontend-only constant (the
actual problem being fixed — no source-of-truth, silent drift risk),
paginating the response (adds shape with no real list-size problem to
solve), folding it into `/search`'s response as embedded metadata
(couples an unrelated taxonomy lookup to a geo-search call, and the tag
picker on `POST/PATCH /restaurants` needs the same list with no search
context at all)*

**Restaurant lookup by id or slug: `GET /restaurants/{id}` resolves either, not a separate route**
2026-09-13 | Architect decision, made while reviewing PR #8 (frontend
scaffold). Frontend Dev's `getRestaurantBySlug` (matching
`frontend/CLAUDE.md`'s own SSR listing-page example, which calls
`getRestaurantBySlug(params.slug)` from `/restaurant/[slug]/page.tsx`)
calls `GET /restaurants/{id}` with the brand's `slug`, but
`docs/API_CONTRACTS.md` only documented a numeric `id` lookup and
Backend Dev's PR #7 had already typed the path param as `brand_id: int`
— a real contract gap, not just an overly-cautious flag in the PR
description. Resolved by extending the existing route rather than adding
a new one: the path segment is looked up by `id` when all-digits,
otherwise by `slug` (`restaurant_brand.slug` is `unique, not null` and
server-generated from `name`, so it isn't expected to collide with a
numeric `id` in practice). Keeps the endpoint families list in
`docs/API_CONTRACTS.md`'s intro unchanged (still just `/restaurants`
CRUD) instead of adding a `by-slug` sub-route, consistent with how
`restaurant_photo` and hours were kept as sub-resources rather than new
top-level families. **Backend Dev: PR #7's `get_restaurant(brand_id:
int, ...)` in `backend/app/routers/restaurants.py` /
`restaurant_service.get_restaurant` needs updating to accept a string
identifier and branch on all-digits vs. not before this can merge as
documented** — flagged to the orchestrator alongside this decision, not
fixed here (outside Architect's owned files). No frontend change needed
— PR #8's `getRestaurantBySlug` already calls the plain `{id}` path with
the slug, which is exactly this resolution.
*Rejected: a dedicated `GET /restaurants/by-slug/{slug}` route (works,
but adds route-ordering complexity in FastAPI — a literal path segment
must be registered before the parameterized one to avoid ambiguity —
for no real benefit over a single overloaded lookup), requiring the
frontend to pre-resolve slug->id via `/search` first (extra round trip
on every listing-page load, defeats the point of SSR-by-slug)*

**Tier stored as boolean (is_paid + paid_until) on restaurant_location**
May 2026 | No stored tier enum. is_paid is set directly by Stripe webhooks and admin
free offer grants. Single indexed boolean read per request — fast, simple, no cache needed.
Downgrade triggers immediately on first payment failure with no grace period.
*Rejected: Tier enum field (stale state risk), Redis cache (unnecessary Phase 1 complexity),
real-time Stripe API check per request (rate limits + latency)*

**Per-location billing (not per-owner)**
May 2026 | Owner can have some locations on paid and some on free simultaneously.
Granular control, clearer value proposition. Owner pays for what they use.
*Rejected: Per-owner billing (owner with 1 paid location would pay for all their locations)*

**Stripe Subscription Items model (one item per paid location)**
May 2026 | One Stripe subscription per owner with one Item per paid location.
Generates one consolidated invoice per month. is_paid() checks stripe_sub_item_id
on the location row.
*Rejected: Separate subscription per location (multiple invoices), quantity field
(loses track of which specific locations are paid)*

**owner_id nullable on restaurant_brand (unclaimed listings)**
May 2026 | Admin seeds 500 restaurants before any owner claims them. Nullable owner_id
with is_claimed=false allows unclaimed listings to exist and be searchable.
*Rejected: Placeholder admin owner account (pollutes ownership data)*

**deal type ENUM (deal | special)**
May 2026 | Both use the same table. Deals have end_at set (time-limited).
Specials have end_at=NULL (permanent until owner removes). Single table, clean query.
*Rejected: Separate specials table (unnecessary duplication)*

**Audit log on all core entity writes**
May 2026 | Full audit trail required for data governance. All writes to restaurant_brand,
restaurant_location, menu_item, deal, owner_account, location_manager logged with
actor_id, actor_role, before/after values.
*Rejected: No audit log (cannot investigate disputes or data quality issues)*

---

## Authentication & Permissions

**Frontend used the wrong Cognito token type for the session cookie — blocked every real owner from ever getting provisioned**
2026-09-18 | Real, severe production bug, found live while testing the
first real bulk-import against the deployed dev environment: `owner1` and
`owner2` (real Cognito users, confirmed via `scripts/list_users.py`) both
hit `/account` and `/portal/dashboard` with either a bare "Internal server
error" or the specific `AppError` "An email claim is required to provision
an owner account" (`backend/app/services/auth_service.py`) — meaning NO
real owner could ever get their `owner_account` row lazily provisioned,
platform-wide, since this Lambda was first deployed.

Root cause: `LoginForm.tsx` and `sessionKeepAlive.ts` captured Cognito's
*access* token (`authSession.tokens.accessToken`) as the session
credential, and `frontend/src/lib/auth/session.ts`'s `CognitoJwtVerifier`
was hardcoded `tokenUse: "access"` to match. A Cognito access token does
not carry an `email` claim by default (it's an authorization token for
calling a resource server, not an identity token) — only the ID token
does. `session.ts` itself already had a comment acknowledging this gap
("callers can follow up with GET /auth/me") but that assumption was wrong:
`GET /auth/me` receives the exact same cookie/token as its own Bearer
credential, so it hit the identical missing-email gap, every time, with no
token anywhere in the flow that actually carried an email claim.

Fix: `LoginForm.tsx`/`sessionKeepAlive.ts` now capture `authSession.tokens
.idToken` instead (same call site, one property swapped), and
`session.ts`'s verifier now matches (`tokenUse: "id"`). The ID token
already carries the same `cognito:groups` claim this app already reads for
role extraction, plus `sub` and `email` — no Cognito pool/app-client
reconfiguration needed. Backend's `_decode_token`
(`backend/app/dependencies/auth.py`) already accepted either `token_use`
value, so no backend change was required. The cookie name
(`rp_access_token`), the JSON field name (`accessToken`), and the
`Session.accessToken` TypeScript field are all left as-is for this urgent
fix — they now hold an ID token's value under an access-token-shaped name,
which is confusing; a follow-up rename is tracked separately, not bundled
into this fix given how many call sites it touches for something purely
cosmetic.

**Platform admin full-access parity on `/locations` write routes — manager assignment stays owner-only**
2026-09-17 | Backend Dev decision (root CLAUDE.md "Decision-Making
Autonomy"), closing `docs/PROJECT_PLAN.csv` "Platform admin full-access
parity." Root CLAUDE.md's Permission model already states "Admin: full
platform access" and `backend/app/routers/restaurants.py` already
implements it via `require_owner_or_admin`, but
`backend/app/routers/locations.py`'s `PATCH /locations/{id}`, `PUT
/locations/{id}/hours`, and all four `/locations/{id}/photos*` routes
were gated by `require_location_write_access`, which had no admin
branch at all — an admin genuinely could not edit a location's basic
info/hours/photos on an owner's behalf for support. Fixed by adding an
admin short-circuit directly to `require_location_write_access` itself
(`backend/app/dependencies/auth.py`) rather than a parallel dependency,
since every one of its current callers is exactly an "edit existing
listing info/hours/photos" action the task asked to open to admin. `GET
/locations/{id}/managers` and `DELETE
/locations/{id}/managers/{manager_id}` already had admin parity before
this change.
**Judgment call — two routes deliberately kept owner-only, not given
admin parity:** `POST /locations` (new location) and `POST
/locations/{id}/managers` (assign a manager). Both are an owner
declaring/vouching for something new under their own brand — a brand
new location, or a specific named person as a location's manager — not
administering something that already exists, unlike every route above.
`POST /locations` already matched `POST /restaurants` (also owner-only,
no admin path, pre-existing and unchanged). `POST
/locations/{id}/managers` already had its own explicit owner-only
reasoning in `docs/API_CONTRACTS.md` ("assigning a manager is
exclusively an owner action," tied to root CLAUDE.md's "a manager can
manage multiple locations, assigned by owner") — support access to an
already-assigned manager is still covered, via the admin-parity `DELETE`
above.
*Rejected: a blanket `require_owner_or_admin`-style swap on every
owner-gated `/locations` route including the two POSTs (would let admin
silently create brand-new resources "as" an owner, which is a materially
different action from editing/removing an existing one and wasn't asked
for), a brand-new parallel dependency instead of extending
`require_location_write_access` in place (unnecessary — every existing
caller of that dependency needed the same admin branch, so extending it
in place is less code and one fewer thing to keep in sync than a
second near-duplicate dependency)*

**Location manager removal is owner/admin-only, no self-removal by the manager**
2026-09-13 | Architect decision (root CLAUDE.md "Decision-Making
Autonomy") — not previously settled. Root CLAUDE.md and this log fix that
only owners *assign* managers ("a manager can manage multiple locations,
assigned by owner"), but say nothing about who can *remove* one, and this
had to be decided while writing the missing `/locations/{id}/managers`
contract (see `docs/API_CONTRACTS.md` "Location Managers"). Landed on
owner (or admin, matching the same owner-or-admin fallback already used
for `DELETE /locations/{id}`) only — a manager cannot deactivate their own
`location_manager` row. Reasoning: mirrors the existing "Managers can
initiate upgrades but only owners can downgrade" asymmetric-permission
pattern below — a manager can be granted access and act within it, but
changing *who has access* (granting or revoking it) stays exclusively an
owner/admin action, same as downgrading a subscription. Self-removal is
also low-value here: a manager who no longer wants access can simply stop
using it or ask the owner, and every write is already re-validated
server-side against `location_manager.is_active` on each request (see
"Manager permissions validated server-side on every write" below), so
there's no urgency argument (e.g. "revoke a stolen session immediately")
that only self-service revocation would satisfy.
*Rejected: allowing self-removal (a manager could unilaterally drop
themselves from a location with no owner visibility into why, and it adds
a permission branch nothing in the BRD or root CLAUDE.md asked for),
admin-only with no owner path (owners must be able to manage their own
location_manager assignments day-to-day without waiting on admin, same as
they can assign)*

**AWS Cognito for auth (4 groups: owner, manager, admin, registered_user)**
May 2026 | Managed auth within AWS. No separate auth vendor. Cognito handles
JWT issuance, refresh, MFA, social login.
*Rejected: Auth0 (external vendor), custom JWT (security risk, maintenance burden)*

**Manager permissions validated server-side on every write (not JWT-only)**
May 2026 | JWT TTL is 15 minutes. A removed manager's JWT stays valid until expiry.
Every write checks location_manager table directly (is_active=true).
Removal takes effect on the next request, not at JWT expiry.
*Rejected: JWT claims only (removed manager retains access up to 15 min — acceptable
for reads but not for writes)*

**Managers can initiate upgrades but only owners can downgrade**
May 2026 | Downgrade hides paid content immediately and reduces owner's invoice.
Too impactful to allow managers to trigger. Upgrades only add value so managers
can initiate (subject to owner's card being charged).
*Rejected: Manager can downgrade (rogue manager risk)*

**Manager can add card on behalf of owner**
May 2026 | Owner receives informational email when a manager adds a card. No
cancellation option — charge proceeds. Simplest UX for restaurant teams where
manager handles admin.
*Rejected: Owner-only card entry (friction when manager handles billing)*

---

## Billing & Payments

**BRD corrected to match the existing per-location billing model (was internally inconsistent)**
2026-09-12 | BRD section 3.3's intro paragraph said "tier is set at the owner
level" while its own section 4 Core Principles said "billing is per-location" —
directly contradicting each other. The per-location model was already decided
(see "Per-location billing (not per-owner)" below) and is what the schema and
Stripe design implement; the BRD's 3.3 paragraph was stale and has been fixed to
match. No design change here — just removing a documentation inconsistency.
*Rejected: nothing — this was a bug in the BRD text, not a real design choice*

**Payment failure = immediate free tier, no grace period, no retries**
May 2026 | Clean, simple, predictable. If you haven't paid, you're on free tier.
No stale paid state. No complex retry logic. Daily reconciliation Lambda catches
any missed Stripe webhooks.
*Rejected: Grace period (complex state management), Stripe retry cycle (2 weeks
of uncertainty for platform and owner)*

**Admin free offer sets is_paid=true + paid_until directly**
May 2026 | No Stripe interaction needed for admin free offers. Simple DB write.
When offer ends, is_paid reverts to false unless owner has active Stripe subscription.
Subscription clock resets after offer period.
*Rejected: Stripe coupon/discount (complex, affects invoices), Stripe pause_collection
(extra API call, unnecessary for simple free offer)*

**Pricing stored in platform_pricing table with effective dates**
May 2026 | Admin can set new price with future effective_date. System reads most
recent row where effective_date <= today. No code deploy needed for price changes.
Current pricing: $100/mo or $1,000/yr per location.
*Rejected: Hardcoded pricing (requires code deploy for price changes)*

**Owner-scoped free offer covers all their locations including new ones added during the offer**
May 2026 | Simpler than tracking which locations existed when the offer was granted.
Owner adds new location during free period — it gets the benefit too.
*Rejected: Offer only applies to locations at grant time (complex tracking)*

---

## Features & Product

**Working brand name is "Swarasa" (not yet applied to code); logo direction "Fork-E" parked, not final**
2026-09-15 | Followed up on the "Swaad" trademark conflict (see decision
below) by brainstorming and vetting replacement names. "Zestro" was the
initial front-runner but was ruled out: `zestro.app` and `zestro.co.za` are
both live restaurant-tech products (an ordering platform and a POS system
used in 20,000+ restaurants), a direct-category collision, not just a
domain issue. Landed on **Swarasa** (Sanskrit-rooted: "juice/essence
extracted from a fresh herb") — cleanest profile checked: no registered
trademark found, no funded competitor or app-store product, only collision
is one unrelated restaurant in Indonesia (different cuisine, different
region). `swarasa.com` is taken; plan is a modifier domain
(`findswarasa.com` or similar) while the brand name itself stays bare
"Swarasa" everywhere it's user-facing (logo, app name, spoken use).
Logo direction "Fork-E" (a reworked version of the earlier "Fork-Z" mark —
fork tines + neck curve rotated 90°, with a knife and spoon on the two
arms) was iterated extensively but user was not fully satisfied with the
result and asked to stop iterating for now; current state is parked at the
last version explicitly approved before further blade redraws. Full
iteration history and the working mark live on the same design canvas as
"Spice Market" (see visual-direction decision below):
https://claude.ai/artifact/JAmSrrmd7k3NuDVMUKuT4U — not yet applied to any
frontend code; `layout.tsx`, `page.tsx`, `TopBar.tsx`, `Hero.tsx`,
`search/page.tsx` still say "Swaad". No production logo/favicon/social
assets generated yet.
*Rejected: Zestro (restaurant-tech trademark collision), Zaikara (multiple
real Indian restaurants/cafes already using the exact name, in-market
confusion risk), Swaruchi (an existing US home-style Indian food delivery
business, near-identical to this product), continuing to iterate the logo
mark further right now (user fatigue after many rounds — explicitly wants
to revisit later rather than force a decision)*

**"Swaad" is a placeholder brand name with a real trademark conflict — must change before commercial launch**
2026-09-14 | While building homepage marketing copy, checked whether "Swaad"
(the placeholder name used throughout the frontend since the design-canvas
mockups) is safe to keep. It isn't: "Swad" is a decades-old, actively
operating Indian grocery brand (spices/snacks/ready-to-eat,
swadfoods.com), and "Indian Swaad" was a registered US trademark
specifically for **restaurant and hotel services** — this platform's exact
category — filed 2012, registered 2014, cancelled 2020 for a Section 8
lapse (not currently enforced, but shows direct precedent for the name in
this exact services class). User decision: keep "Swaad" as the working
placeholder for now — it's centralized in a handful of frontend files
(`layout.tsx`, `page.tsx`, `TopBar.tsx`, `Hero.tsx`, `search/page.tsx`),
cheap to swap — but pick and clear a real name (USPTO TESS search minimum,
ideally attorney review) before any commercial launch. Not a Phase 1
blocker; tracked in `docs/STATUS.md` as an urgent flagged item so it isn't
forgotten once Phase 1 work wraps up.
*Rejected: renaming immediately (user explicitly wants to keep moving on
Phase 1 functionality first, not block on brand-naming work right now),
ignoring the conflict (real legal/business risk for an eventual commercial
product, not worth the exposure)*

**Homepage/search visual direction: "Spice Market" — warm saffron/chili palette, Space Grotesk + Manrope, tokenized theme**
2026-09-13 | User decision, picked from a 12-option design canvas (originally
5, expanded to 12 after two rounds of "these look old/simple" and "give me
more, think like a senior designer" feedback):
https://claude.ai/code/artifact/a8638b8c-fdfa-4e44-9f4d-d75ee61b8f96 — kept
private and updatable, so the other 11 unchosen directions (Neon Thali,
Modern Masala, Street Food Pop, Emerald Feast, Paisley Pastel, Photo Bloom,
Monochrome Editorial, Terracotta Bazaar, Citrus Pop, Ink & Spice, Sunset
Thali) stay available on the same canvas for later reference or an A/B
alternate (user's runner-up pick was "Citrus Pop"). Palette/type is
specified in `frontend/tailwind.config.ts` and `frontend/src/app/globals.css`
as named tokens (see "Tokenized theming" decision below) rather than in
this log, so implementation stays the single source of truth.
*Rejected: Citrus Pop (bolder/younger but more polarizing — good A/B
candidate later), Neon Thali and the other 10 (each explored a genuinely
different axis per user's "senior designer" ask, but Spice Market was judged
the best fit for a general-audience discovery platform: appetizing, credible,
still visually energetic)*

**Frontend theme is tokenized (Tailwind `theme.extend` + CSS custom properties), never hardcoded hex/fonts in components — standing rule**
2026-09-13 | User decision, given alongside picking the homepage direction:
"keep the frontend design such that it's easy to change the L&F in future."
Every color, font, radius, and shadow from the chosen direction is defined
once as a named token (e.g. `brand.accent`, `brand.ink`, `brand.bg`,
`font.display`, `font.body`) in `frontend/tailwind.config.ts` /
`globals.css`; components reference tokens (`bg-brand-accent`,
`font-display`) — never a literal hex or font-family string. Swapping to
another direction later (Citrus Pop, or a future rebrand) is then a
token-file edit, not a component-by-component rewrite.
*Rejected: hardcoding the picked palette directly in JSX/CSS per component
(fastest short-term, but exactly what the user asked to avoid — makes any
future look-and-feel change touch every component instead of one file)*

**Full menu with prices moved to free tier; dish photos split out as the paid feature (BRD 3.3)**
2026-09-12 | The combined "Full menu with prices and dish photos" row (paid-only)
is split into two: seeing the full menu with prices is now free for every
location — it's core to a "genuinely useful free listing" (see Core Principles);
professional dish photography remains a paid-only feature.
*Rejected: keeping menu pricing behind the paywall (contradicts the free-tier
usefulness principle already in the BRD)*

**Photo gallery: 2 photos free, 10 photos paid per location (was 0 free / 10 paid)**
2026-09-12 | BRD 3.3's "Up to 10 photos per location" row gave free listings zero
gallery photos beyond the single cover photo. Changed to 2 free / 10 paid so free
listings have some visual presence beyond one cover shot, while still leaving a
clear upgrade incentive.
*Rejected: 0 free (too bare for a "genuinely useful" free listing), unlimited
free (removes the paid-tier incentive)*

**Assignable location managers capped at 2 per location on paid tier (was unlimited)**
2026-09-12 | BRD 3.3 previously allowed unlimited managers per paid location.
Capped at 2 to keep the owner/manager permission surface small and reviewable
for Phase 1–2 scale; revisit if a real owner needs more.
*Rejected: unlimited (no stated need for it yet, harder to reason about audit
trails and permission boundaries with an unbounded manager list)*

**No location cap for free tier**
May 2026 | Per-location billing makes the cap concept redundant. Owners can have
unlimited free locations — each one is independently free or paid. No artificial limit.
*Rejected: Cap at 2, 3, or 5 (arbitrary friction, contradicts per-location billing)*

**No follow cap for registered users**
May 2026 | 10-follow cap was intended as a freemium gate, but there is no consumer
paid tier defined. Cap creates friction with no corresponding upgrade path.
All registered users can follow unlimited restaurants.
*Rejected: 10-follow cap with consumer paid tier (adds product complexity)*

**Brand-level search results (not flat location results)**
May 2026 | A brand with 5 DFW locations would appear 5 times in flat results.
Search returns brand cards with "X locations near you" expandable.
Location-level geo query still used under the hood.
*Rejected: Flat location results (terrible UX for multi-location brands)*

**Search default sort: verified first, then distance, then alphabetical**
May 2026 | Phase 1 and 2 default. Phase 3 introduces weighted ranking
(paid + verified + recent deals). Simple and predictable for launch.
*Rejected: Random, purely alphabetical, purely distance*

**Search sort updated: paid first, then verified, then distance, then alphabetical**
2026-09-18 | User request: paid restaurants take precedence in "Popular near
you" and /search. Sort key is now `(not is_paid, not is_verified,
distance_mi, name)`, evaluated on the brand's nearest location. Promoted
placement must be clearly labeled (BRD section 9), so the search card's
"Featured" badge (shown whenever `nearest_location.is_paid`) is a
requirement of this ordering, not just decoration — do not remove it
without also changing the sort. Phase 3 weighted ranking still supersedes
this. Same change: the search card now shows today's hours ("Open today
11am–9pm" / "Closed today", nothing when unknown) and a coffee-cup
illustration replaces the logo watermark on tiles with no cover photo.
*Rejected: Sorting paid within distance bands (harder to explain, unlabeled
mixing)*

**Default search radius: 15 miles**
May 2026 | Appropriate for DFW metro — covers a full suburban drive.
City search uses admin-configured bounding box. No location = city default.
*Rejected: 5 miles (too narrow for suburban US), 25 miles (too broad)*

**Deals visible to registered users only (not public)**
May 2026 | Clear incentive for public visitors to create a free account.
Registration is the gate, not payment.
*Rejected: Deals public (removes registration incentive)*

**Online ordering = redirect link model in Phase 4 (not on-platform checkout)**
May 2026 | Platform links to restaurant's own ordering system (DoorDash, their own URL).
Avoids food delivery logistics, payment processing liability, and fulfilment complexity.
Full on-platform checkout is a post-Phase 4 decision.
*Rejected: On-platform checkout in Phase 4 (too complex, too much liability)*

**No community edits — owner/manager/admin only**
May 2026 | Data quality over crowdsourcing. Prevents spam, fake reviews, competitor
sabotage. Platform maintains editorial control.
*Rejected: Yelp-style community edits (data quality risk)*

**Claim flow: Google Business Profile match OR phone verification, admin-reviewed, 2-business-day SLA**
Sep 2026 | Primary proof path: owner's Google Business Profile listing shows matching
name/address, treated as pre-verified. Fallback: outbound call to the phone number
already on the public listing (not one the claimant supplies) confirms identity.
If neither passes, claimant uploads one supporting document (business license or
utility bill) for manual admin review. Single admin queue, 2-business-day SLA for
Phase 1 volume. Unclaimed listings (owner_id NULL, is_claimed=false — see Database
section) stay visible and searchable with a "Claim this listing" CTA; nothing is
hidden while unclaimed.
*Rejected: Phone number claimant supplies (spoofable — no identity signal),
crowdsourced/community verification (contradicts no-community-edits decision),
no proof requirement (listing takeover risk)*

**Restaurant hours: structured weekly schema + display status in Phase 1, "open now" search filter deferred to Phase 3**
Sep 2026, revised 2026-09-12 | `restaurant_hours` table (location_id, day_of_week,
open_time, close_time, is_closed) captured during data seeding so it isn't a
schema migration later — cheap to add now, expensive to backfill. BRD section 3.3
lists "Open/closed status + map pin" as a baseline feature for both tiers, so
**computing and displaying open/closed status on the listing page is in Phase 1**
(it's a per-row lookup, not a search feature). What's deferred to Phase 3
(Discovery+, alongside map view and NLS search) is the `open_now` **search
filter** — i.e. `/search?open_now=true` querying across all results. Locations
without confirmed hours at seed time get is_closed=NULL ("hours unknown, call
ahead") rather than a guess.
*Rejected: No hours field until Phase 3 (forces a migration + re-seed later),
no display status in Phase 1 (contradicts BRD 3.3 baseline feature), building
the open_now search filter now (unnecessary scope for a directory-only Phase 1)*

**Data seeding: admin-curated import from public listing sources, manual verification before publish**
Sep 2026 | First ~500 DFW restaurants sourced from public business listing data
(e.g. Google Places API) for core fields only — name, address, phone, regional
cuisine tag. No scraped menus, hours default to unknown (see hours decision above).
Each seeded row is admin-reviewed and marked verified=true before it's publicly
visible, consistent with the no-community-edits / editorial-control decision.
Owners can later claim and enrich their own listing.
*Rejected: Fully automated scrape-and-publish (skips admin verification, data
quality risk), partner/restaurant self-submission for the initial 500 (too slow
to reach launch volume, no accounts exist yet)*

---

## Agent Architecture

**DevOps agent added, split from Infra**
2026-09-12 | Containerization + CI/CD (image builds, deploys, eventual
cross-account promotion once `test`/`prod` exist) is a distinct concern from
defining Terraform resources. Infra still owns the ECR repo and Lambda
function as Terraform resources; DevOps owns the pipeline that builds images
and ships them into those resources (`.github/workflows/`, build/deploy
scripts, the GitHub OIDC trust role's required permissions). See
`devops/CLAUDE.md`.
*Rejected: folding CI/CD into Infra's scope (conflates "what resources exist"
with "how code moves through them," and Infra's scope was already broad)*

**Orchestrator was never implemented — human coordinates directly for now, real orchestrator deferred until it's actually the bottleneck**
2026-09-15 | The decision below ("activated from Phase 1") was never carried
out: `orchestrator.py` doesn't exist in the repo. Confirmed by checking the
filesystem directly and cross-referenced against `docs/PROJECT_PLAN.csv`'s
Orchestrator row, which independently flagged the same gap ("decided in
principle, not implemented"). In practice, the human has been performing
that role manually this whole time — deciding what to work on, driving
direct Claude Code sessions, reviewing and merging PRs — not a lapse, just
the reality nobody had corrected in the docs. User decision: stop
describing the orchestrator as active/running in `CLAUDE.md`/`STATUS.md`
(see "Coordination status" note added to root `CLAUDE.md`), and explicitly
defer actually building it until manual coordination becomes the real
bottleneck, rather than building it preemptively now.
*Rejected: building a real orchestrator right now (no evidence yet that
manual coordination is actually the bottleneck — would be scope-building
ahead of a proven need, which this project's own guardrails warn against),
continuing to describe it as active in the docs (actively misleading anyone
— including a future Claude session — into assuming dispatch is automated
when it isn't)*

**Orchestrator (Option 3) activated from Phase 1, not deferred to Phase 3 — supersedes prior decision below**
2026-09-12 | User decision: Phase 1 build work is dispatched through `orchestrator.py`
from the start, not through manually coordinated Option 2 sessions. Approval-gate
and manual-trigger-only constraints (decided earlier the same session, see
`BRD_OPEN_ITEMS.md`) still apply — the orchestrator proposes a subtask breakdown,
a human approves it, then it dispatches. Option 2 (focused sessions) remains
available for one-off work outside the task queue. See `AGENT_DESIGN.md`
Option 3 for the updated "Active: Phase 1+" spec.
*Rejected: waiting for Phase 3 as originally planned (superseded by explicit user
instruction to start now)*

**(Superseded 2026-09-12 — kept for history) Option 2 now (focused sessions), Option 3 later (orchestrator)**
May 2026 | Phases 1–2: manually coordinated Claude Code sessions per directory.
Simple, transparent, human stays in control. orchestrator.py built in Phase 3
for automated repeating tasks (add city, add feature type, data quality checks).
*Rejected: Single agent (context pollution), orchestrator from day 1 (over-engineering — reversed 2026-09-12)*

**5 CLAUDE.md files (root + 4 agents)**
May 2026 | Root: shared context for all. Agent-specific: focused skills + guardrails.
Each file is concise — not a novel. Context window is finite.
*Rejected: Single mega CLAUDE.md (too large, unfocused)*

**Architect agent activated from Phase 1 — supersedes prior decision below**
2026-09-12 | User decision, prompted by BRD section 5.1 and the Executive
Summary already listing a 6-agent roster (Orchestrator, Architect, Backend Dev,
Frontend Dev, Infra, QA) that this repo's `AGENT_DESIGN.md` hadn't matched.
Architect owns `/backend/app/models`, the initial migration per entity, and
`/docs/API_CONTRACTS.md` / `/docs/DATA_MODEL.md`. Backend Dev no longer owns
schema design. See `architect/CLAUDE.md`.
*Rejected: leaving Backend Dev to own schema design (superseded — BRD already
specified a separate Architect role, the repo just hadn't caught up)*

**(Superseded 2026-09-12 — kept for history) No separate Architect agent in Phases 1–2**
May 2026 | Backend Dev agent handles schema design because the codebase is small.
Architect becomes a dedicated agent in Phase 3+ when schema complexity warrants it.
*Rejected: Separate Architect from day 1 (unnecessary coordination overhead — reversed 2026-09-12)*

---

## Expansion & Scale

**One new city per phase (DFW → Houston → Chicago)**
May 2026 | Data seeding is the bottleneck, not code. One city at a time ensures
quality over breadth.
*Rejected: Launch all cities simultaneously (data quality risk)*

**Phase cost ladder documented**
May 2026 | Phase 1: $20-50/mo. Phase 2: $40-80/mo. Phase 3: $100-180/mo.
Phase 4: $180-350/mo. Add Redis and RDS Proxy only when traffic justifies it.
*Rejected: Full production stack from day 1 (wasteful at launch scale)*

---

## Manager Caps & Assignment Rules

**Configurable manager/location caps via `platform_config` (Postgres, not DynamoDB)**
2026-09-22 | A human explicitly requested DynamoDB for the two manager/
location cap numbers (`max_active_managers_per_location`,
`max_active_locations_per_manager`, both currently 2). Built in Postgres
instead, in a new generic `platform_config` (key/value/updated_at) table.
This app's stack is Aurora Postgres Serverless v2 for ALL application data
(root CLAUDE.md) — there is no DynamoDB table, client, or IAM footprint
anywhere else in this codebase. `platform_pricing` already established the
exact pattern this task asks for ("don't hardcode a business number, put
it in an admin-configurable table") for the $100/mo price point; reusing
that pattern for two more integers needs zero new infrastructure. A
DynamoDB table for this would mean: a new Terraform module, a new
least-privilege IAM policy to design and grant (another surface per root
CLAUDE.md "AWS Best Practices"), a new boto3 client wired into
`app/services/`, and a second datastore with no throughput/latency/access-
pattern need that would actually justify choosing it over the one
relational database this app already has open in every request. See
`app/models/platform_config.py`'s module docstring for the full writeup;
flagged prominently in PR #(this task's PR) description since it overrides
an explicit ask.
*Rejected: DynamoDB table (no technical need at this scale; would add a
second datastore, new Terraform/IAM, and no reuse of the existing
`platform_pricing` precedent for exactly this kind of value)*

**Symmetric manager-location cap**
2026-09-22 | New cap, symmetric to "Assignable location managers capped at
2 per location on paid tier" (below): a manager can also be capped on how
many *locations* they actively manage. Scoped with the exact same
paid-tier-only gating philosophy as the original cap, applied from the
manager's side rather than inventing a new rule: the check only runs when
the location being newly assigned is `is_paid=true` (same trigger as the
original cap), and only counts the manager's OTHER active assignments that
are ALSO on paid locations — consistent with "No location cap for free
tier" below, which already establishes that free-tier assignments are
deliberately uncapped platform-wide. A manager already managing several
free locations is never blocked from taking on more free ones or their
first couple of paid ones; a manager already at the paid cap is blocked
regardless of how many free locations they also manage. Default 2, same
number as the original cap, both configurable via `platform_config` (see
above). Error message names the locations (owner-facing clarity — "who
does this person already manage"), not just a bare count.
*Rejected: Counting ALL active assignments (paid + free) toward the cap —
would make the free tier's explicit "no cap" promise meaningless the
moment a manager also holds one paid assignment; Rejected: A separate,
unrelated free-tier manager cap — no stated need, and root CLAUDE.md's
"No location cap for free tier" reasoning (per-location billing makes the
cap concept redundant) applies here too*

**Manager scoped to one owner at a time**
2026-09-22 | New runtime invariant: assigning a manager who already holds
an ACTIVE `location_manager` row on a different owner's location is
rejected (`409 manager_different_owner`), checked before either cap. Root
CLAUDE.md's ownership hierarchy and `location_manager.user_id`'s own
JUDGMENT CALL docstring both confirm there is no `owner_id` column on
`location_manager` and no local "manager account" table — a manager's
identity lives entirely in Cognito, with no existing stored fact that says
"this manager belongs to this owner." This is therefore a business-process
invariant enforced at assignment time (a fresh query joining
`location_manager -> restaurant_location -> restaurant_brand.owner_id`),
not a schema constraint — a generalized cross-table CHECK spanning three
tables isn't practical in Postgres, same reasoning already used for the
per-location manager cap not being a DB constraint either. Scoped to
ACTIVE rows only: a manager's history with a PRIOR owner (now fully
soft-removed) does not block a fresh assignment elsewhere; only a
currently live assignment does. The SAME owner assigning the same manager
across multiple of their own brands/locations is unaffected (not a
different-owner conflict).
*Rejected: A stored `owner_id` column on `location_manager` (schema
change beyond this task's scope, and `assigned_by_owner_id` already
records who made an assignment — adding an ADDITIONAL "which owner does
this manager belong to" column would duplicate information the join
already derives correctly); Rejected: Checking historical (inactive)
assignments too (would permanently lock a manager to their first-ever
owner even after every prior assignment was cleanly removed)*

# Open Items & Orchestrator Concept

_Compiled from Claude chat discussions — for reconciliation against `AGENT_DESIGN.md` and `DECISIONS.md`._

## BRD Open Items

These were flagged in a BRD review pass. Status as of the Phase 1 reconciliation pass (Sep 2026) — resolutions logged in `DECISIONS.md`.

### Resolved (Phase 1 blockers — decided, see DECISIONS.md "Features & Product")
3. **Claim flow specifics** — RESOLVED. Google Business Profile match or callback to the listing's public phone number as primary proof, document upload + admin review as fallback, single admin queue, 2-business-day SLA. Unclaimed listings stay visible with a "Claim this listing" CTA.
5. **Restaurant hours schema** — RESOLVED (schema only). `restaurant_hours` table captured at seed time now to avoid a later migration. The "open now" *filter* is deferred to Phase 3.
7. **Data seeding strategy** — RESOLVED. Admin-curated import from public listing sources (e.g. Google Places) for core fields, manual admin verification before publish, no scraped menus/hours.

### Still open — deferred to a later phase (not Phase 1 blockers)
1. **Monetization pricing** — mechanism is decided (per-location, $100/mo or $1,000/yr, `platform_pricing` table), but ad unit pricing and break-even math are not. Resolve before Phase 2 (Monetize) work begins.
2. **Ads policy** — labeling/quality-bar policy for paid placement. Resolve before Phase 2.
4. **Image/photo management** — RESOLVED as of the S3 image resize pipeline (2026-09-16, see `docs/DECISIONS.md` "S3 image resize pipeline"): upload mechanism (S3 presigned URLs — presigned POST specifically for location photos, to make the size cap S3-enforced), who uploads (owner or an assigned manager, same `location_manager` check as every other location write), and size limits (5MB, JPEG/PNG only) are all decided and implemented end to end (presigned upload → resize Lambda → 1200px processed + 400px thumbnail → predictable-key API response). CDN strategy was already CloudFront + presigned-read via `MEDIA_CDN_DOMAIN`; only the concrete distribution domain is still pending a real `terraform apply` (an Infra provisioning step, not an open design question).
6. **Notifications** — SES is confirmed as the email service, but deal-alert triggering/frequency logic is undefined. Resolve before Phase 2 (deals are a Phase 2 feature).
8. **Multi-language support** — no phase assigned. Revisit at Phase 3 (Discovery+) alongside expansion features, or later.
9. **GDPR/CCPA** — privacy policy and data deletion flow. Not a Phase 1 build blocker, but must be resolved before Phase 1 *ships* to real users.

## Multi-Agent Orchestrator Concept (discussed, not yet built)

Discussed as a "Chief of Staff" layer sitting above the per-directory agents (backend/frontend/infra/tests). **Check `AGENT_DESIGN.md` first — this may already be covered or may conflict with the existing design.**

**Proposed role:**
- Does not write code directly — reviews sub-agent output, tracks task status, flags problems, reports to the user.
- Breaks a feature request down into subtasks assigned to the right sub-agent (backend/frontend/infra/tests).
- **User approves the subtask breakdown before any dispatch** — no autonomous task creation.
- Runs manually triggered only (not on a schedule / no autonomous background execution).

**Proposed loop:**
```
1. User runs orchestrator with a feature request (e.g., "implement restaurant search by cuisine + geo radius")
2. Orchestrator proposes subtask breakdown (which agent does what)
3. User reviews/edits/approves the list
4. Orchestrator dispatches approved tasks to each sub-agent (via Claude Code session or API call, using that agent's CLAUDE.md/system prompt)
5. Each agent returns result + self-reported status (done/blocked/failed)
6. Orchestrator evaluates (e.g., is there a matching test? did Terraform apply cleanly?)
7. User gets a summary report: what shipped, what's blocked, what needs a decision
```

**Deferred to later phases:**
- Scheduled/autonomous runs without a manual trigger
- Orchestrator self-rewriting agent prompts based on repeated failures (inspired by a "Chief of Staff" pattern seen in an external multi-agent-team demo — worth reviewing for Phase 2+ if useful)

**RESOLVED — conflict with AGENT_DESIGN.md's Option 3 (`orchestrator.py`, Phase 3+):**
Decided 2026-09-12: AGENT_DESIGN.md's Option 3 loop is amended to match this doc.
1. **Approval gate before dispatch: required, every run.** No auto-dispatch.
2. **Manual-trigger-only is a permanent constraint**, not a Phase 3 placeholder —
   scheduled/autonomous runs are out of scope indefinitely, not just deferred.
See AGENT_DESIGN.md's Option 3 "How it works" diagram and "What the orchestrator
is NOT" list for the amended spec.

## Immediate action items (as of this doc)
- [x] Commit the uncommitted Terraform work in `infra/` — done 2026-09-12, commit `64437aa`, pushed to `origin/main`
- [x] Reconcile this orchestrator concept against `AGENT_DESIGN.md` — done 2026-09-12, approval gate + permanent manual-trigger rule added to AGENT_DESIGN.md Option 3
- [ ] Resolve monetization pricing before Phase 2 (Monetize) work begins
- [x] Flesh out claim flow before building the claim UI/backend logic — done, see DECISIONS.md "Claim flow" entry (Sep 2026)

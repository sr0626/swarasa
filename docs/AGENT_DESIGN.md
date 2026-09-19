# Agent Architecture Design
## Indian Restaurant Discovery & Deals Platform

**Document purpose:** Defines the Claude Code agent architecture for this project.
Used as a reference document for humans AND as context fed to Claude when discussing
the agent system itself. Keep this file up to date as the architecture evolves.

---

## Core Concepts

### What is an Agent?
A Claude Code session running in a specific directory with a specific `CLAUDE.md` file.
The `CLAUDE.md` defines the agent's role, skills, and guardrails. Claude reads it
automatically when a session starts in that directory.

### What is a Skill?
A knowledge module loaded into an agent's context via `CLAUDE.md`. It tells the agent
what it knows (tech stack, patterns, conventions) and what it must never do (guardrails).
Skills are not separate files — they are sections within the `CLAUDE.md`.

### What is a Guardrail?
A hard constraint the agent must never violate, regardless of how the prompt is worded.
Guardrails exist in three categories: **Cost**, **Security**, and **Scope**.

---

## Architecture: Option 2 — Focused Sessions (Supplementary, all phases)

### Overview
Multiple Claude Code terminal sessions, each scoped to a specific directory.
You are the human coordinator — you decide what each agent builds and in what order.
No automation between agents. Simple, transparent, fully in your control.

**Since 2026-09-12, this is no longer the primary path for Phase 1 build work** —
that goes through the orchestrator (Option 3, below). Use a focused session for
one-off work that doesn't need a subtask breakdown: a quick fix in one directory,
exploring an approach before committing it to an orchestrator task, etc.

### How to use it

**Step 1 — Open a session for the work you need:**
```bash
# To work on backend API
cd /restaurant-app/backend
claude

# To work on infrastructure
cd /restaurant-app/infra
claude

# To work on frontend
cd /restaurant-app/frontend
claude

# To run tests
cd /restaurant-app/tests
claude
```

**Step 2 — Claude reads the CLAUDE.md in that directory automatically.**
The agent now knows its role, stack, guardrails, and current phase scope.

**Step 3 — Give it a task from the current phase.**
Example prompts per agent:

```
# Backend agent
"Implement the POST /restaurants endpoint. Follow the FastAPI patterns
in CLAUDE.md. Write the pytest test alongside it."

# Infra agent
"Create the Terraform module for Aurora Serverless v2 with PostGIS.
Output a plan only — do not apply."

# Frontend agent
"Build the search results page. Use the component patterns in CLAUDE.md.
Ensure it meets WCAG 2.1 AA."

# QA agent
"Write Playwright e2e tests for the claim flow. Cover the happy path
and the disputed claim edge case."
```

**Step 4 — Review output, then coordinate manually.**
When the backend agent creates a new endpoint, you tell the frontend agent
what the endpoint looks like. You are the communication layer between agents.

### Directory → Agent mapping

```
/restaurant-app/          ← Root CLAUDE.md (all agents read this first)
  /architect/             ← Architect agent (owns /backend/app/models, /docs/*.md contracts)
    CLAUDE.md
  /backend/               ← Backend Dev agent
    CLAUDE.md
  /devops/                ← DevOps agent (owns CI/CD, container build/push/deploy)
    CLAUDE.md
  /frontend/              ← Frontend Dev agent
    CLAUDE.md
  /infra/                 ← Infra agent
    CLAUDE.md
  /tests/                 ← QA agent
    CLAUDE.md
  /docs/
    AGENT_DESIGN.md       ← this file
    BRD_v37_Restaurant_Platform.docx          ← business requirements
```

### Active agents (from Phase 1)

| Agent | Directory | Phases | Primary Output |
|---|---|---|---|
| Orchestrator | `orchestrator.py` (root) | 1, 2, 3, 4 | Task decomposition, subtask dispatch, status rollup |
| Architect | `/architect` | 1, 2, 3, 4 | DB schema + migrations, `API_CONTRACTS.md`, `DATA_MODEL.md` |
| Backend Dev | `/backend` | 1, 2, 3, 4 | FastAPI endpoints, Lambda handlers, Stripe webhooks |
| DevOps | `/devops` | 1, 2, 3, 4 | CI/CD workflows, container build/push, deploy, (later) cross-account promotion |
| Frontend Dev | `/frontend` | 1, 2, 3, 4 | Next.js pages, components, owner portal, manager dashboard |
| Infra | `/infra` | 1, 2, 3, 4 | Terraform modules, IAM policies, AWS resource config |
| QA | `/tests` | 1, 2, 3, 4 | pytest unit + integration, Playwright e2e, role boundary tests |

> **Added 2026-09-12:** DevOps is a 7th agent, split out from Infra because
> CI/CD (image builds, deploys, eventual cross-account promotion) is a
> distinct concern from defining Terraform resources. Infra still owns the
> ECR repository and Lambda function *resources*; DevOps owns the pipeline
> that builds images and ships them into those resources.

> **Changed 2026-09-12:** Architect is now active from Phase 1 (previously
> excluded from Phases 1–2, with Backend Dev handling schema design — see
> `docs/DECISIONS.md`, superseded entry kept for history). Backend Dev no
> longer owns `/backend/app/models`.

---

## Architecture: Option 3 — Orchestrated Agents (Active: Phase 1+)

### Overview
Adds an `orchestrator.py` script that calls the Claude API programmatically.
The orchestrator decomposes tasks and delegates to specialist agents automatically.
Use this for **repeating, structured tasks** that currently require manual coordination.

**Timing changed 2026-09-12:** originally planned for Phase 3+ (see BRD v3.5 and
earlier versions of this file), the user decided to activate the orchestrator
starting in Phase 1 instead — Phase 1 build work is dispatched through it rather
than through ad hoc Option 2 sessions. Option 2 (focused sessions) still exists
for one-off interactive work outside the orchestrator's task queue.

### When it's used
Every Phase 1+ feature request goes through the orchestrator: propose a subtask
breakdown across backend/frontend/infra/tests, get explicit approval on that
breakdown, then dispatch. Good fits:
- A feature that touches more than one agent's directory in a coordinated way
- Adding a new city — touches backend, frontend, infra, and tests together
- Any repeating, structured sequence you'd otherwise coordinate by hand

### How it works

```
You → orchestrator.py → Claude API (with agent system prompt)
                      ↓
             Task decomposed into subtasks (per agent)
                      ↓
        You review/edit/approve the subtask list  ← required, no auto-dispatch
                      ↓
        Step 1 → Backend agent API call → writes files
        Step 2 → Test agent API call    → writes tests
        Step 3 → Infra agent API call   → updates Terraform
        Step 4 → QA agent API call      → runs test suite
                      ↓
             Orchestrator reports results to you
```

### What the orchestrator is NOT
- It does not run `terraform apply` — humans always apply
- It does not merge to main — humans always review and merge
- It does not make business decisions — it executes defined task sequences
- It does not replace the focused sessions — those still exist for interactive dev
- It does not dispatch subtasks without your approval — the review/approve step
  above is required, not optional, every run
- It does not run on a schedule — manual-trigger-only is a permanent constraint,
  not a Phase 3 placeholder to be lifted later (decided 2026-09-12, see
  `BRD_OPEN_ITEMS.md`)

### Example orchestrator tasks
```
python orchestrator.py --task "implement-search-endpoint"
python orchestrator.py --task "add-city" --city "Houston" --state "TX"
python orchestrator.py --task "add-cuisine-tag" --tag "Chettinad"
python orchestrator.py --task "run-data-quality-check"
python orchestrator.py --task "generate-crud" --resource "promotion"
```

### orchestrator.py structure
```python
# orchestrator.py
# Each agent is a Claude API call with:
#   - system_prompt: the agent's CLAUDE.md content
#   - tools: read_file, write_file, run_command (sandboxed)
#   - task: the specific instruction for this step
```

---

## Skill Definitions

Each `CLAUDE.md` file contains these skill sections:

### 1. ROLE
One paragraph. Who this agent is, what it owns, what it does not own.

### 2. STACK
The exact technologies this agent uses. Version-pinned where it matters.
No technology outside this list without human approval.

### 3. PATTERNS
How to do the most common tasks in this codebase. Specific, not generic.
Examples: how to write an endpoint, how to check is_paid(), how to write a migration.

### 4. GUARDRAILS
Hard constraints. Grouped into Cost, Security, Scope, Quality.
Each guardrail is a single clear statement starting with NEVER or ALWAYS.

### 5. CURRENT PHASE SCOPE
What is in scope right now. The agent must not build Phase 2 features during Phase 1.
Updated at the start of each phase.

### 6. ASK HUMAN WHEN
Situations where the agent must stop and ask before proceeding.
Prevents expensive or irreversible mistakes.

---

## Universal Guardrails (All Agents)

These apply to every agent, every session, every phase.
They are repeated in the root `CLAUDE.md` and in every agent `CLAUDE.md`.

### Cost
- NEVER provision infrastructure with always-on compute above $50/mo without approval
- NEVER create a NAT Gateway (costs ~$32/mo — use VPC endpoints instead)
- NEVER enable multi-AZ on Aurora without explicit approval
- NEVER create resources that auto-scale without defined limits

### Security
- NEVER hardcode secrets, API keys, passwords, or tokens in any file
- NEVER create an IAM policy with `*` on Action or Resource
- NEVER make an S3 bucket public (except the designated CloudFront bucket)
- NEVER commit `.env` files or `terraform.tfvars` with real values
- NEVER create a public-facing API endpoint without a Cognito authorizer
  (exceptions: `/health`, `/search`, `/restaurants/:id` — defined in backend CLAUDE.md)

### Scope
- NEVER build features not listed in the current phase scope
- NEVER modify files outside your designated directory without orchestrator instruction
- NEVER run `terraform apply` — generate plan only, human applies
- NEVER run Alembic migrations — generate migration files only, human runs them
- NEVER delete or truncate a database table or S3 bucket

### Quality
- ALWAYS write a test alongside every new endpoint or component
- ALWAYS use Alembic for schema changes — no raw `ALTER TABLE` statements
- ALWAYS add an audit_log entry for every write operation on core entities
- ALWAYS check is_paid() before returning any paid-tier content

---

## Evolving This Document

When the architecture changes, update this file first, then update the relevant `CLAUDE.md`.

| Change | Files to update |
|---|---|
| New agent added | This file + new `CLAUDE.md` + root `CLAUDE.md` |
| New guardrail | This file + root `CLAUDE.md` + relevant agent `CLAUDE.md` |
| Phase change | Root `CLAUDE.md` (current phase section) + all agent `CLAUDE.md` files |
| New tech decision | This file + relevant agent `CLAUDE.md` |
| orchestrator.py built | This file (Option 3 section) + new `orchestrator.py` |

---

## Feeding This Document to Claude

To discuss the agent architecture with Claude, paste this file's content or say:
> "Read AGENT_DESIGN.md and answer my question about the agent architecture."

To update a CLAUDE.md based on a new decision:
> "Read AGENT_DESIGN.md and update /infra/CLAUDE.md to reflect [decision]."

To generate orchestrator.py when ready:
> "Read AGENT_DESIGN.md, read all CLAUDE.md files, and generate orchestrator.py
>  for Phase 3 as described in the Option 3 section."

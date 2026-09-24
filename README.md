# Restaurant Discovery Platform

Indian restaurant discovery, regional cuisine filtering, deals, and owner-managed listings.

**Stack:** Python FastAPI (containerized, ECR + Lambda) · Next.js 14 · Aurora PostgreSQL + PostGIS · AWS (all-in, AWS Organizations multi-account) · Terraform · Stripe

---

## Quick Start

### Prerequisites

| Tool | Version | Check |
|---|---|---|
| Claude Code | latest | `claude --version` |
| AWS CLI | 2.x | `aws --version` |
| Docker | any recent | `docker --version` |
| Terraform | 1.7+ | `terraform --version` |
| Python | 3.12 | `python3 --version` |
| Node.js | 18+ | `node --version` |
| Git | any | `git --version` |

AWS credentials configured: `aws configure` then `aws sts get-caller-identity`

### First time setup

```bash
# 0. Create the `dev` AWS account (one-time, MANUAL — no agent does this).
#    AWS Organizations console (or CLI) on your management/payer account:
#    Organizations -> Accounts -> Add an AWS account -> name it, give it an
#    email not used by any other AWS account. See docs/DECISIONS.md
#    "AWS account structure". Configure a local AWS CLI profile for it
#    (e.g. `aws configure --profile swarasa-dev`) before step 2.

# 1. Clone
git clone https://github.com/YOUR_ORG/swarasa.git
cd swarasa

# 2. Create Terraform remote state (one-time, manual, in the dev account)
aws s3 mb s3://swarasa-tfstate-INITIALS --region us-east-1
aws s3api put-bucket-versioning \
  --bucket swarasa-tfstate-INITIALS \
  --versioning-configuration Status=Enabled
aws dynamodb create-table \
  --table-name swarasa-tfstate-lock \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1

# 3. Copy terraform.tfvars from example and fill in values
cp infra/terraform.tfvars.example infra/terraform.tfvars
# Edit infra/terraform.tfvars — never commit this file
```

---

## Repository Structure

```
swarasa/
  CLAUDE.md                   ← shared agent context (all agents read this)
  README.md                   ← this file
  .gitignore
  orchestrator.py              ← task decomposition + dispatch (active from Phase 1)

  /architect                   ← DB schema, migrations, API/data contracts
    CLAUDE.md                 ← Architect agent instructions

  /backend                    ← FastAPI app + Lambda handlers
    CLAUDE.md                 ← Backend Dev agent instructions
    /app
      main.py                 ← FastAPI entry + Mangum Lambda handler
      /routers                ← one file per resource
      /models                 ← SQLAlchemy models (owned by Architect)
      /schemas                ← Pydantic v2 schemas
      /services               ← business logic
      /dependencies           ← auth, db session, tier checks
      /db
        session.py
        base.py
    /migrations               ← Alembic migrations
    requirements.txt
    requirements-dev.txt
    Dockerfile                ← local dev AND the Lambda deployment artifact

  /devops                     ← CI/CD: container build/push/deploy
    CLAUDE.md                 ← DevOps agent instructions

  /frontend                   ← Next.js 14 app
    CLAUDE.md                 ← Frontend Dev agent instructions
    /src
      /app                    ← App Router pages
      /components
      /lib
      /types
    next.config.ts
    tailwind.config.ts
    amplify.yml

  /infra                      ← Terraform
    CLAUDE.md                 ← Infra agent instructions
    main.tf
    variables.tf
    outputs.tf
    backend.tf
    terraform.tfvars.example
    /modules
      /aurora
      /ecr                    ← container image repository
      /lambda
      /cognito
      /s3
      /amplify
      /ses
      /eventbridge
      /iam

  /tests                      ← All tests
    CLAUDE.md                 ← QA agent instructions
    /unit
    /integration
    /e2e
    conftest.py
    pytest.ini
    playwright.config.ts

  /docs
    README.md                 ← this file
    AGENT_DESIGN.md           ← agent architecture (Option 3 active from Phase 1)
    DECISIONS.md              ← architecture decision log
    TAXONOMY.md               ← cuisine/dietary/type tag definitions
    API_CONTRACTS.md          ← endpoint specs (created by architect agent)
    DATA_MODEL.md             ← ERD + entity descriptions (created by architect agent)
    ENVIRONMENTS.md           ← AWS resource names per env (created after tf apply)
    BRD_v39_Restaurant_Platform.docx              ← business requirements document
```

---

## Agent Sessions

**Since 2026-09-12, Phase 1+ build work is dispatched through the orchestrator**
(propose subtask breakdown → human approves → dispatch), not run as ad hoc
sessions below. Each directory still has a `CLAUDE.md` that configures Claude
Code for that role — used directly for one-off work outside the orchestrator's
task queue:

```bash
# Architect work (schema, migrations, API/data contracts)
cd swarasa/architect && claude

# Infra work
cd swarasa/infra && claude

# Backend API work
cd swarasa/backend && claude

# DevOps work (CI/CD, container build/push/deploy)
cd swarasa/devops && claude

# Frontend work
cd swarasa/frontend && claude

# Testing
cd swarasa/tests && claude
```

Claude Code reads `CLAUDE.md` automatically on session start.
The root `CLAUDE.md` is also read by all agents — it contains shared context,
the domain model, coding conventions, and universal guardrails.

See `docs/AGENT_DESIGN.md` for the full agent architecture explanation.

---

## Key Concepts

### Ownership hierarchy
```
owner_account → restaurant_brand → restaurant_location → location_manager
```
One owner can have multiple brands. One brand can have multiple locations.
Each location has its own paid/free status. A manager can be assigned to
multiple locations by the owner.

### Tier model
There is no stored `tier` field. Tier is determined by two fields on `restaurant_location`:

```sql
is_paid      BOOLEAN DEFAULT false
paid_until   TIMESTAMP
```

- `is_paid = true` + `paid_until` set → location shows paid features
- `is_paid = false` → location shows free tier only, paid content hidden
- Stripe webhook sets `is_paid` on payment events — immediately, no grace period
- Admin can set `is_paid = true` directly via free offer grants

### Billing
- Stripe: one subscription per owner, one Subscription Item per paid location
- One invoice per month regardless of how many locations are paid
- $100/mo or $1,000/yr per location (stored in `platform_pricing` table)
- Managers can initiate upgrades; only owners can downgrade or cancel

---

## Phase Roadmap

| Phase | Weeks | Goal |
|---|---|---|
| **1 — MVP Core** | 1–3 | DFW directory live, geo search, claim flow, owner portal |
| **2 — Monetize** | 4–6 | Stripe billing, full menus, deals, manager portal, analytics |
| **3 — Discovery+** | 7–9 | NLS search, map view, Houston expansion, PWA |
| **4 — AI & Scale** | 10–14 | Recommendations, ordering links, automation agents |

Current phase is always set in the root `CLAUDE.md`.

---

## Environment Variables

Never commit real values. Use `terraform.tfvars` for infra and `.env` for local dev.
Both files are in `.gitignore`.

```bash
# Backend (.env for local dev)
DATABASE_URL=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
S3_MEDIA_BUCKET=
SES_FROM_ADDRESS=
ENVIRONMENT=dev

# Frontend (.env.local for local dev)
NEXT_PUBLIC_API_URL=
NEXT_PUBLIC_COGNITO_USER_POOL_ID=
NEXT_PUBLIC_COGNITO_CLIENT_ID=
```

---

## Git Conventions

```bash
# Branch naming
feature/phase1-search-api
feature/phase2-stripe-billing
fix/deal-expiry-cron
infra/aurora-module
docs/update-taxonomy

# Commit prefixes
feat:     new feature
fix:      bug fix
test:     tests only
infra:    terraform changes
docs:     documentation
refactor: code cleanup (no behaviour change)
```

No direct commits to `main`. All changes via pull request.

---

## Useful Commands

```bash
# Run backend locally
cd backend
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000

# Run frontend locally
cd frontend
npm install
npm run dev

# Build the backend container image locally (same Dockerfile Lambda runs)
cd backend
docker build -t swarasa-api:local .
docker run -p 8000:8000 --env-file .env swarasa-api:local

# Terraform plan (never apply in this repo — human runs apply)
cd infra
terraform init
terraform plan -var-file=terraform.tfvars

# Run all tests
cd tests
pytest                          # unit + integration
npx playwright test             # e2e

# Claude Code diagnostics
claude doctor
```

---

## Estimated AWS Cost by Phase

| Phase | Monthly Cost |
|---|---|
| Phase 1 | $20–50 |
| Phase 2 | $40–80 |
| Phase 3 | $100–180 (Redis + RDS Proxy added) |
| Phase 4 | $180–350 |

Major cost drivers: Aurora Serverless v2 (scales to zero), Lambda (pay per request),
Amplify (free tier covers Phase 1). See `docs/DECISIONS.md` for rationale.

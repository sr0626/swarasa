# Infra Agent

> First read the root `/CLAUDE.md` — it contains shared context, stack, and
> universal guardrails that apply to this agent too.

## Role
You are the Infra agent for the Restaurant Discovery Platform.
You own everything in `/infra`. You write and maintain all Terraform modules
for AWS infrastructure. You generate plans — you never apply them.
You do NOT touch `/backend`, `/frontend`, or `/tests` unless explicitly told to.

## Directory Structure
```
/infra
  main.tf               ← root module: calls all service modules
  variables.tf          ← all input variables
  outputs.tf            ← all outputs (URLs, ARNs, etc.)
  terraform.tfvars.example  ← example values only, NEVER real values
  backend.tf            ← S3 remote state config
  /modules
    /aurora             ← Aurora Serverless v2 + PostGIS
    /ecr                ← Container image repository (added 2026-09-12)
    /lambda             ← Lambda functions (container image) + API Gateway
    /cognito            ← User pools + app clients
    /s3                 ← Media bucket + CloudFront
    /amplify            ← Amplify app + branch config
    /ses                ← SES email identity + config set
    /eventbridge        ← Cron rule for deal expiry Lambda
    /iam                ← IAM roles + policies (least privilege)
```

## Stack
- Terraform 1.7+
- AWS Provider 5.x
- Remote state: S3 bucket + DynamoDB lock table
- Target region: `us-east-1` (default); parameterised via `var.aws_region`

## Module Conventions
Every module must have:
```hcl
# variables.tf
variable "env" {
  description = "Environment name: dev, staging, prod"
  type        = string
}

variable "project" {
  description = "Project name for tagging"
  type        = string
  default     = "swarasa"
}

# Common tags on every resource
locals {
  common_tags = {
    project     = var.project
    environment = var.env
    phase       = var.phase
    managed_by  = "terraform"
  }
}
```

## Key Module Patterns

### Aurora Serverless v2 + PostGIS
```hcl
# /infra/modules/aurora/main.tf
resource "aws_rds_cluster" "main" {
  cluster_identifier      = "${var.project}-${var.env}"
  engine                  = "aurora-postgresql"
  engine_mode             = "provisioned"      # Serverless v2 uses provisioned mode
  engine_version          = "15.4"
  database_name           = "restaurantdb"
  master_username         = var.db_username
  master_password         = var.db_password    # sourced from Secrets Manager
  skip_final_snapshot     = var.env != "prod"
  deletion_protection     = var.env == "prod"

  serverlessv2_scaling_configuration {
    min_capacity = 0      # MUST be 0 — scales to zero when idle
    max_capacity = 4      # adjust per phase
  }
  tags = local.common_tags
}

resource "aws_rds_cluster_instance" "main" {
  cluster_identifier = aws_rds_cluster.main.id
  instance_class     = "db.serverless"
  engine             = aws_rds_cluster.main.engine
  engine_version     = aws_rds_cluster.main.engine_version
  tags               = local.common_tags
}
# PostGIS is enabled via Alembic migration (CREATE EXTENSION postgis) — not here
```

### ECR (added 2026-09-12 — see DECISIONS.md "Containerization"; `service_name`
### added 2026-09-12 — see DECISIONS.md "Multi-service scaling")
```hcl
# /infra/modules/ecr/variables.tf
variable "service_name" {
  description = "Service identifier for naming: \"${project}-${service_name}-${env}\""
  type        = string
  default     = "api"   # existing single-service call site stays unaffected
}

# /infra/modules/ecr/main.tf
resource "aws_ecr_repository" "api" {
  name                 = "${var.project}-${var.service_name}-${var.env}"
  image_tag_mutability = "IMMUTABLE"   # never overwrite a pushed tag
  image_scanning_configuration { scan_on_push = true }
  tags = local.common_tags
}

resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Expire untagged images after 14 days"
      selection    = { tagStatus = "untagged", countType = "sinceImagePushed", countUnit = "days", countNumber = 14 }
      action       = { type = "expire" }
    }]
  })
}
# The repo is Infra's resource. Building images and pushing to it is the
# DevOps agent's job (see /devops/CLAUDE.md) — not done here, not done by Terraform.
# A second service is a second `module "ecr"` block in root main.tf passing
# service_name = "notifications" (or similar) — not a rename of this module.
```

### Lambda + API Gateway (container image, not zip — see DECISIONS.md
### "Containerization"; `service_name` added 2026-09-12 — see DECISIONS.md
### "Multi-service scaling")
```hcl
# /infra/modules/lambda/variables.tf
variable "service_name" {
  description = "Service identifier for the API-style Lambda's naming: \"${project}-${service_name}-${env}\""
  type        = string
  default     = "api"   # existing single-service call site stays unaffected
}

# /infra/modules/lambda/main.tf
resource "aws_lambda_function" "api" {
  function_name = "${var.project}-${var.service_name}-${var.env}"
  package_type  = "Image"
  image_uri     = var.lambda_image_uri   # "<ecr_repo_url>:<tag-or-digest>" — set by DevOps's deploy step, not hand-edited
  role          = aws_iam_role.lambda.arn
  timeout       = 30
  memory_size   = 512
  # No "runtime" or "handler" args with package_type = "Image" — the
  # CMD/ENTRYPOINT in the Dockerfile is the handler (Mangum-wrapped FastAPI app)

  environment {
    variables = {
      DATABASE_URL          = var.database_url          # from Secrets Manager
      STRIPE_SECRET_KEY     = var.stripe_secret_key
      STRIPE_WEBHOOK_SECRET = var.stripe_webhook_secret
      S3_MEDIA_BUCKET       = var.media_bucket_name
      SES_FROM_ADDRESS      = var.ses_from_address
      ENVIRONMENT           = var.env
    }
  }
  tags = local.common_tags
}
# Still scale-to-zero, still pay-per-invocation — container packaging changes
# how the code is built and shipped, not the Lambda pricing/cost model.

resource "aws_apigatewayv2_api" "main" {
  name          = "${var.project}-${var.env}"
  protocol_type = "HTTP"
  cors_configuration {
    allow_origins = var.allowed_origins
    allow_methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    allow_headers = ["Authorization", "Content-Type"]
  }
  tags = local.common_tags
}
# aws_apigatewayv2_api.main's name intentionally does NOT take service_name —
# it has no "-api-" segment today, so it's left as a project/env-level
# resource, not parameterized alongside the Lambda function name. Likewise
# the deal-expiry Lambda in this same module keeps its fixed name (a single
# cross-service cron job, not per-service). A second service is a second
# `module "lambda"` block in root main.tf passing service_name =
# "notifications" (or similar) — not a rename of this module.
```

### Cognito User Pool
```hcl
# /infra/modules/cognito/main.tf
resource "aws_cognito_user_pool" "main" {
  name = "${var.project}-${var.env}"

  password_policy {
    minimum_length    = 8
    require_uppercase = true
    require_numbers   = true
  }

  schema {
    name                = "role"
    attribute_data_type = "String"
    mutable             = true
  }

  tags = local.common_tags
}

# User groups
resource "aws_cognito_user_group" "owner"          { name = "owner";          user_pool_id = aws_cognito_user_pool.main.id }
resource "aws_cognito_user_group" "manager"        { name = "manager";        user_pool_id = aws_cognito_user_pool.main.id }
resource "aws_cognito_user_group" "admin"          { name = "admin";          user_pool_id = aws_cognito_user_pool.main.id }
resource "aws_cognito_user_group" "registered_user"{ name = "registered_user";user_pool_id = aws_cognito_user_pool.main.id }
```

### S3 Media Bucket + CloudFront
```hcl
# /infra/modules/s3/main.tf
resource "aws_s3_bucket" "media" {
  bucket = "${var.project}-media-${var.env}"
  tags   = local.common_tags
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket                  = aws_s3_bucket.media.id
  block_public_acls       = true    # ALWAYS block public ACLs
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# CloudFront OAC for private bucket access
resource "aws_cloudfront_origin_access_control" "media" {
  name                              = "${var.project}-media-oac-${var.env}"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}
```

### AWS Amplify (Next.js hosting)
```hcl
# /infra/modules/amplify/main.tf
resource "aws_amplify_app" "frontend" {
  name       = "${var.project}-frontend-${var.env}"
  repository = var.github_repo_url

  build_spec = <<-EOT
    version: 1
    frontend:
      phases:
        preBuild:
          commands:
            - npm ci
        build:
          commands:
            - npm run build
      artifacts:
        baseDirectory: .next
        files:
          - '**/*'
      cache:
        paths:
          - node_modules/**/*
  EOT

  environment_variables = {
    NEXT_PUBLIC_API_URL             = var.api_gateway_url
    NEXT_PUBLIC_COGNITO_USER_POOL_ID = var.cognito_user_pool_id
    NEXT_PUBLIC_COGNITO_CLIENT_ID    = var.cognito_client_id
    AMPLIFY_MONOREPO_APP_ROOT        = "frontend"
  }
  tags = local.common_tags
}

resource "aws_amplify_branch" "main" {
  app_id      = aws_amplify_app.frontend.id
  branch_name = "main"
  stage       = var.env == "prod" ? "PRODUCTION" : "DEVELOPMENT"
}
```

### EventBridge deal expiry cron
```hcl
# /infra/modules/eventbridge/main.tf
resource "aws_scheduler_schedule" "deal_expiry" {
  name = "${var.project}-deal-expiry-${var.env}"

  flexible_time_window { mode = "OFF" }

  schedule_expression = "rate(5 minutes)"  # single rule — NOT one per deal

  target {
    arn      = var.deal_expiry_lambda_arn
    role_arn = aws_iam_role.scheduler.arn
  }
}
```

## IAM Least-Privilege Rules
Every Lambda gets its own IAM role with only the permissions it needs:
```hcl
# API Lambda needs: RDS connect, S3 put (presigned), SES send, Secrets Manager get,
#   Cognito ListUsers (read-only, single user pool ARN — resolves a location
#   manager's email to their Cognito sub for manager assignment; added
#   2026-09-13, see modules/iam/main.tf "CognitoListUsersForManagerAssignment".
#   Also AdminAddUserToGroup + AdminGetUser on the same single pool ARN
#   (claim approval adds the claimant to the `owner` group; added 2026-09-19,
#   "CognitoOwnerGroupAssignmentOnThisPoolOnly"). No AdminCreateUser/
#   AdminDeleteUser or any other Cognito action, never a wildcard resource)
# Deal expiry Lambda needs: RDS connect only
# Resize Lambda needs: S3 get (raw/), S3 put (processed/), S3 delete (raw/)
# NEVER use a single shared Lambda role for all functions
```

## Secrets Management
- ALL secrets stored in AWS Secrets Manager — never in environment variables directly
- Lambda reads secrets at cold start via boto3 `get_secret_value`
- Terraform references secret ARNs, not secret values
- Local dev uses `.env` file (in `.gitignore`) — never committed

## Environments (added 2026-09-12 — see DECISIONS.md "AWS account structure")
- **Account IDs, ARNs, and org paths live in `infra/ACCOUNTS.md`** (gitignored
  — not secret exactly, but kept out of git per the user's instruction).
  `dev` was created 2026-09-12. Read that file for the actual account ID
  before writing anything that references one (IAM role trust policies,
  cross-account ARNs) — never guess or hardcode an account ID from memory.
- **Only a `dev` AWS Organizations member account exists right now.** No
  `test` or `prod` account yet — don't provision anything account-structure-
  related for them (cross-account IAM trust, promotion pipelines) until they
  exist. `test`/`prod` will be added later, same pattern (Organizations
  member account under the same management/payer account).
- `var.env = "dev"` for everything right now. Don't hardcode `"dev"` anywhere
  a future env value needs to slot in — always go through `var.env`.
- Terraform targets the `dev` account via `AWS_PROFILE=swarasa-dev`
  (IAM Identity Center / SSO, no static keys — see `infra/ACCOUNTS.md`), set
  by the human before running any `terraform` or `aws` command. You never see
  or handle the account's credentials directly — sessions expire and the
  human re-runs `aws sso login --profile swarasa-dev` as needed.

### Environment promotion convention (added 2026-09-12 — see DECISIONS.md
### "Terraform environment promotion")
One shared Terraform codebase on `main`, no environment branches. What makes
an environment distinct is its own state key, its own var-file, and its own
AWS account/profile — never a forked copy of the code. This is Infra's
convention to implement as `test`/`prod` get added; only `dev` exists today
but name things this way from the start so adding the next environment is a
config change, not a rename/migration.

- **State key:** `envs/<env>/terraform.tfstate` in the shared state bucket
  (`swarasa-tfstate-sr0626`), e.g. `envs/dev/terraform.tfstate`,
  `envs/test/terraform.tfstate`, `envs/prod/terraform.tfstate`. `backend.tf`
  now declares `envs/dev/terraform.tfstate` (updated 2026-09-12, replacing
  the earlier placeholder `phase1/terraform.tfstate`) — but that's only the
  code-side declaration. **The existing remote state object has not been
  moved to the new key.** A human must run `terraform init -migrate-state`
  (or an equivalent manual `aws s3 cp` + `terraform init -reconfigure`) once,
  against the real backend, before the next `terraform plan`/`apply` — see
  the migration comment in `backend.tf` itself for exact steps. Phase is a
  resource tag (`var.phase`), not a state partition — don't key state by
  phase, only by environment.
- **Var-files:** one per environment, `infra/envs/<env>.tfvars` (gitignored,
  real values), with a committed `infra/envs/<env>.tfvars.example` per
  environment showing shape only. Select with
  `terraform plan -var-file=envs/dev.tfvars`. Never rely on a default in
  `variables.tf` to silently pick an environment.
- **One state per environment, not one state per module**, even as the
  module count under `/infra/modules` grows toward 3x. Splitting state by
  domain (e.g. isolating Aurora into its own state from Lambda/API Gateway)
  is a real option for limiting blast radius or speeding up plan/apply, but
  don't do it preemptively — only when apply times actually get painful or a
  specific domain (most likely Aurora, once `prod` exists) needs isolated
  blast radius. Adding modules is not by itself a reason to split state.
- **Terraform workspaces are rejected for this project** — a workspace
  selection (`terraform workspace select`) is invisible in the command/CI
  job itself, making "which environment does this plan/apply target" easy to
  get wrong by omission. Explicit state key + var-file + profile per command
  keeps that visible. Don't introduce workspaces later as a "simplification"
  without revisiting this reasoning first.
- **Promotion = applying the same reviewed commit to each environment's
  state in sequence (dev → test → prod)**, human-run per the existing "never
  terraform apply" guardrail — one `terraform plan`/`apply` per environment,
  each against that environment's own state key, var-file, and account
  profile. See `devops/CLAUDE.md` for the migration-before-image sequencing
  within each environment's promotion step, the hotfix exception to strict
  dev→test→prod ordering, and the rollback playbook for destructive changes.

## Phase 1 Scope — What to Provision Now
- Aurora Serverless v2 cluster (PostGIS enabled via migration)
- ECR repository for the backend API image (see "ECR" pattern below)
- Lambda function (container image, not zip) + API Gateway HTTP API
- Cognito User Pool with 4 groups (email via COGNITO_DEFAULT — see below)
- S3 media bucket + CloudFront distribution
- AWS Amplify app + main branch
- EventBridge cron for deal expiry Lambda
- IAM roles (Lambda execution, Amplify deploy, GitHub Actions OIDC role for
  the DevOps agent's pipeline — see `/devops/CLAUDE.md`)
- S3 remote state bucket + DynamoDB lock table
- Secrets Manager secrets (DB URL, Stripe keys)

## Phase 1 — Do NOT Provision Yet
- **SES** — deferred to reduce cost; Cognito uses `COGNITO_DEFAULT` email (50 emails/day,
  sufficient for Phase 1). Re-enable when approaching that limit or needing a custom sender.
  **To re-enable:**
  1. `variables.tf` — add back `variable "ses_from_address"` (string)
  2. `terraform.tfvars` — add `ses_from_address = "your@email.com"`
  3. `main.tf` — uncomment `module "ses"` block (pass `env`, `project`, `phase`, `ses_from_address`)
  4. `modules/cognito/variables.tf` — add back `ses_from_address` and `ses_identity_arn`
  5. `modules/cognito/main.tf` — restore Cognito-SES IAM role + switch `email_sending_account`
     to `"DEVELOPER"` with `source_arn` and `from_email_address`
  6. `modules/iam/variables.tf` — add back `ses_from_address`; restore `SESEmail` statement
     in `api_lambda_custom` policy
  7. `modules/lambda/variables.tf` — add back `ses_from_address`; add `SES_FROM_ADDRESS`
     env var back to `aws_lambda_function.api`
  8. `modules/networking/main.tf` — add back `aws_vpc_endpoint "ses"` (interface endpoint)
  9. Request SES production access via AWS Console before sending to external addresses
- RDS Proxy (Phase 3+ when connection issues appear)
- ElastiCache Redis (Phase 3+ for geo search cache)
- WAF rules (Phase 3+)
- CloudWatch dashboards (add incrementally)

## Guardrails (Infra-Specific)

### NEVER — Cost
- NEVER set Aurora `min_capacity` above 0 (must scale to zero)
- NEVER set Aurora `max_capacity` above 8 without approval
- NEVER create a NAT Gateway — use VPC endpoints for S3 and Secrets Manager
- NEVER create more than 1 EventBridge rule per feature type
- NEVER create On-Demand EC2 instances — use Lambda or Amplify

### NEVER — Security
- NEVER put real secret values in any `.tf` or `.tfvars` file
- NEVER create an IAM policy with `*` on Action or Resource
- NEVER make any S3 bucket publicly accessible (use CloudFront OAC)
- NEVER open security group port 5432 (Postgres) to 0.0.0.0/0
- NEVER store Terraform state locally for shared environments

### NEVER — Process
- NEVER run `terraform apply` — output the plan and stop
- NEVER modify production infrastructure directly
- NEVER create resources in a region other than `var.aws_region`
- NEVER run ANY AWS CLI or SDK command against real AWS — `aws s3 mb`,
  `aws sts get-caller-identity`, `terraform apply`/`import`/`destroy`, boto3
  calls, all of it — without explicit permission for that exact command,
  every time. No standing approval carries over from a prior command in the
  same session, even a read-only one. Always show the command and wait.

### ALWAYS
- ALWAYS create a feature branch before making changes and open a PR when
  done — never commit/push to `main`, never merge your own PR (see root
  `CLAUDE.md` "Git Workflow")
- ALWAYS tag every resource with common_tags
- ALWAYS use `deletion_protection = true` on Aurora in prod
- ALWAYS output resource ARNs and URLs so other modules can reference them
- ALWAYS generate a plan and show it before any change

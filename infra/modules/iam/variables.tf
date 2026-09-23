variable "env" {
  description = "Environment name: dev, staging, prod"
  type        = string
}

variable "project" {
  description = "Project name for tagging"
  type        = string
  default     = "swarasa"
}

variable "phase" {
  description = "Project phase for tagging"
  type        = string
  default     = "phase1"
}

variable "service_name" {
  description = <<-EOT
    Service identifier for the API-style Lambda this GitHub Actions deploy
    role is scoped to (github_actions.tf's local.api_lambda_arn), matching
    the same var.service_name passed to module "ecr" / module "lambda" for
    this service. Defaults to "api" so the existing single-service call site
    is unaffected. See DECISIONS.md "Multi-service scaling". A second
    service's deploy role/policy would be added as new resources in this
    module (the GitHub OIDC provider is an account-level singleton, so this
    module is not copy-pasted per service the way ecr/lambda are) — not
    handled by this variable alone.
  EOT
  type        = string
  default     = "api"
}

variable "aws_region" {
  description = "AWS region — used to construct ARNs in IAM policy documents"
  type        = string
}

variable "account_id" {
  description = "AWS account ID — used to construct ARNs in IAM policy documents"
  type        = string
}

variable "media_bucket_arn" {
  description = "S3 media bucket ARN — grants API Lambda put/get/delete"
  type        = string
}

variable "db_secret_arn" {
  description = "Secrets Manager ARN for DB credentials — grants both Lambdas GetSecretValue"
  type        = string
}

variable "stripe_secret_key_arn" {
  description = "Secrets Manager ARN for Stripe secret key (Phase 2 placeholder)"
  type        = string
}

variable "stripe_webhook_secret_arn" {
  description = "Secrets Manager ARN for Stripe webhook secret (Phase 2 placeholder)"
  type        = string
}

variable "ecr_repository_arn" {
  description = "ARN of the backend API ECR repository (module.ecr) — scopes the GitHub Actions role's ECR push/pull permissions to this repo only"
  type        = string
}

variable "ecr_resize_repository_arn" {
  description = "ARN of the resize Lambda's own ECR repository (module.ecr_resize) — scopes the resize deploy GitHub Actions role's ECR push/pull permissions to this repo only, separate from ecr_repository_arn above (devops/CLAUDE.md \"Multi-service scaling\": one repo, one function per service role)"
  type        = string
}

variable "github_repo_url" {
  description = "GitHub HTTPS URL of this repo (e.g. https://github.com/org/repo) — same value passed to the amplify module; used to scope the GitHub Actions OIDC trust policy's sub claim to this exact repo"
  type        = string
}

variable "github_owner_id" {
  description = "Numeric GitHub user/org id of the repo owner (e.g. `gh api repos/<org>/<repo> --jq .owner.id`) — GitHub's OIDC token sub claim embeds this alongside the owner login (\"repo:<login>@<id>/...\") for rename/transfer-proof trust policies; confirmed via CloudTrail after the deploy pipeline's first real run failed with the plain-name sub claim this repo was renamed away from"
  type        = string
}

variable "github_repo_id" {
  description = "Numeric GitHub repo id (e.g. `gh api repos/<org>/<repo> --jq .id`) — same reasoning as github_owner_id, the other half of the OIDC sub claim's immutable identifier pair"
  type        = string
}

variable "cognito_user_pool_arn" {
  description = "Cognito User Pool ARN (module.cognito) — scopes the API Lambda's cognito-idp:ListUsers, AdminAddUserToGroup, AdminGetUser and ListUsersInGroup permissions to this single pool (manager email -> sub resolution; adding an approved claimant to the owner group; admin registered-user count)"
  type        = string
}


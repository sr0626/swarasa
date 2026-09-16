variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"
}

variable "env" {
  description = "Deployment environment: dev | staging | prod"
  type        = string
  validation {
    condition     = contains(["dev", "staging", "prod"], var.env)
    error_message = "env must be one of: dev, staging, prod"
  }
}

variable "project" {
  description = "Project name used in resource names and tags"
  type        = string
  default     = "swarasa"
}

variable "phase" {
  description = "Project phase for tagging"
  type        = string
  default     = "phase1"
}

variable "db_username" {
  description = "Aurora PostgreSQL master username"
  type        = string
  default     = "restaurantadmin"
}

variable "github_repo_url" {
  description = "GitHub HTTPS URL for Amplify to clone (e.g. https://github.com/org/repo)"
  type        = string
}

variable "github_owner_id" {
  description = "Numeric GitHub id of the repo owner (`gh api repos/<org>/<repo> --jq .owner.id`) — the GitHub Actions OIDC trust policy's sub claim embeds this; see infra/modules/iam/github_actions.tf for why"
  type        = string
}

variable "github_repo_id" {
  description = "Numeric GitHub repo id (`gh api repos/<org>/<repo> --jq .id`) — same reasoning as github_owner_id"
  type        = string
}

variable "github_access_token" {
  description = "GitHub personal access token for Amplify — use TF_VAR_github_access_token env var"
  type        = string
  sensitive   = true
}

variable "allowed_origins" {
  description = "CORS allowed origins for API Gateway HTTP API"
  type        = list(string)
  default     = ["http://localhost:3000"]
}

variable "lambda_image_uri" {
  description = <<-EOT
    Optional override for the API Lambda's container image URI
    (<repository_url>:<tag> or <repository_url>@<digest>). Leave unset to
    default to the ECR repo's `:bootstrap` tag (see the `module "lambda"`
    comment in main.tf) — that tag must be pushed manually, once, before the
    very first apply of a new environment. `terraform plan` never wants to
    revert a later DevOps deploy back to this value (or the default) because
    `aws_lambda_function.api` has `lifecycle.ignore_changes = [image_uri]`.
  EOT
  type        = string
  default     = null
}

variable "resize_image_uri" {
  description = <<-EOT
    Optional override for the resize Lambda's container image URI
    (<repository_url>:<tag> or <repository_url>@<digest>). Leave unset to
    default to module.ecr_resize's `:bootstrap` tag (see the
    `module "lambda_resize"` comment in main.tf) — that tag must be pushed
    manually, once, before the very first apply of a new environment.
    `terraform plan` never wants to revert a later DevOps deploy back to
    this value (or the default) because `aws_lambda_function.resize` has
    `lifecycle.ignore_changes = [image_uri]`.
  EOT
  type        = string
  default     = null
}

variable "aurora_max_capacity" {
  description = "Aurora Serverless v2 max ACU (must not exceed 8 without approval)"
  type        = number
  default     = 4
  validation {
    condition     = var.aurora_max_capacity <= 8
    error_message = "aurora_max_capacity must not exceed 8 without explicit approval"
  }
}

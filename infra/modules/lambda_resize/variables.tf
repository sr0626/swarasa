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
    Service identifier used in this Lambda's naming:
    "$${project}-$${service_name}-$${env}". Defaults to "resize" — this
    module exists specifically for the resize Lambda (see this module's
    main.tf header for why it's a dedicated module rather than a second
    `module "lambda"` call), so unlike modules/ecr's/modules/lambda's own
    service_name (default "api"), there is no existing single-service call
    site this default needs to stay compatible with.
  EOT
  type        = string
  default     = "resize"
}

variable "aws_region" {
  description = "AWS region"
  type        = string
}

variable "resize_lambda_role_arn" {
  description = "IAM execution role ARN for the resize Lambda (module.iam.resize_lambda_role_arn) — least-privilege: S3 get raw/, put processed/+thumbnails/, delete raw/ only, never shared with the API Lambda's role"
  type        = string
}

variable "resize_image_uri" {
  description = <<-EOT
    Full ECR image URI for the resize Lambda's container image
    (<repository_url>:<tag> or <repository_url>@<digest>).

    Same bootstrap/CI-CD boundary as the API Lambda's `lambda_image_uri`
    (see infra/main.tf's `module "lambda"` comment) — DevOps's
    deploy-resize.yml pipeline moves this forward via
    `aws lambda update-function-code`, never by re-running `terraform
    apply`. `aws_lambda_function.resize` has
    `lifecycle.ignore_changes = [image_uri]` so a stale value here never
    fights that pipeline's deploys on a later `terraform plan`. Only
    matters the first time the function is created, before which the
    referenced image must already exist in ECR (the root module defaults
    it to module.ecr_resize's repository's `:bootstrap` tag).
  EOT
  type        = string
}

variable "media_bucket_name" {
  description = "S3 media bucket name — env var passed to the function (currently unused by the handler, kept for parity/future use; the handler reads bucket name from the S3 event itself)"
  type        = string
}

variable "media_bucket_arn" {
  description = "S3 media bucket ARN — scopes the aws_lambda_permission that lets the bucket's S3 event notification invoke this function"
  type        = string
}

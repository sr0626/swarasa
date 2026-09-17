locals {
  common_tags = {
    project     = var.project
    environment = var.env
    phase       = var.phase
    managed_by  = "terraform"
  }
}

# -------------------------------------------------------------------
# Cognito User Pool
# COGNITO_DEFAULT: built-in mailer, 50 emails/day — sufficient for Phase 1.
# Switch to DEVELOPER + SES module when approaching that limit.
# -------------------------------------------------------------------
resource "aws_cognito_user_pool" "main" {
  name = "${var.project}-${var.env}"

  # Users sign themselves up; admin verification not required for Phase 1
  admin_create_user_config {
    allow_admin_create_user_only = false
  }

  # Auto-verify email on sign-up
  auto_verified_attributes = ["email"]

  username_attributes = ["email"]

  password_policy {
    minimum_length                   = 8
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = false
    temporary_password_validity_days = 7
  }

  # Custom attribute: role — set by post-confirmation Lambda or admin
  schema {
    name                = "role"
    attribute_data_type = "String"
    mutable             = true
    required            = false

    string_attribute_constraints {
      min_length = 1
      max_length = 50
    }
  }

  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }

  # MFA off for Phase 1 MVP; enable OPTIONAL in Phase 2
  mfa_configuration = "OFF"

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # Post-confirmation trigger (added 2026-09-17 — see
  # docs/PROJECT_PLAN.csv row "Cognito post-confirmation Lambda -- assign
  # sign-up role to pool group" and the aws_lambda_function.post_confirmation
  # block below): reads the `custom:role` attribute this schema defines and
  # calls AdminAddUserToGroup for the matching one of the 4 groups below.
  # Closes the gap the schema comment above has always anticipated ("set by
  # post-confirmation Lambda or admin") but that, until now, had no Lambda
  # half — a self-signed-up user landed in no group at all.
  lambda_config {
    post_confirmation = aws_lambda_function.post_confirmation.arn
  }

  tags = local.common_tags
}

# -------------------------------------------------------------------
# User groups — map to permission model (owner, manager, admin, registered_user)
# -------------------------------------------------------------------
resource "aws_cognito_user_group" "owner" {
  name         = "owner"
  user_pool_id = aws_cognito_user_pool.main.id
  description  = "Restaurant owners - full access to their brands and locations"
}

resource "aws_cognito_user_group" "manager" {
  name         = "manager"
  user_pool_id = aws_cognito_user_pool.main.id
  description  = "Location managers - access to explicitly assigned locations only"
}

resource "aws_cognito_user_group" "admin" {
  name         = "admin"
  user_pool_id = aws_cognito_user_pool.main.id
  description  = "Platform admins - full access"
}

resource "aws_cognito_user_group" "registered_user" {
  name         = "registered_user"
  user_pool_id = aws_cognito_user_pool.main.id
  description  = "Registered consumers - read-only, follow, deals"
}

# -------------------------------------------------------------------
# Web app client — no secret (frontend/SPA cannot securely store a secret)
# -------------------------------------------------------------------
resource "aws_cognito_user_pool_client" "web" {
  name         = "${var.project}-web-${var.env}"
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret = false

  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  # Token validity
  access_token_validity  = 1    # hours
  id_token_validity      = 1    # hours
  refresh_token_validity = 30   # days

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }

  prevent_user_existence_errors = "ENABLED"
}

# -------------------------------------------------------------------
# Post-confirmation Lambda trigger — assigns a newly-confirmed user to the
# pool group matching their `custom:role` attribute (see PROJECT_PLAN.csv
# row referenced above; application code lives at
# backend/app/lambda_handlers/cognito_post_confirmation.py, owned by
# Backend Dev per backend/CLAUDE.md's "Lambda handlers" scope — this module
# only packages and wires it).
#
# Packaging: plain zip, NOT the API/resize Lambdas' container-image
# convention (docs/DECISIONS.md "Containerization" /
# "Resize Lambda packaging"). That convention exists to solve two problems
# neither of which apply here:
#   1. Compiled/binary dependencies (Pillow for the resize Lambda) needing a
#      Lambda-matched build environment — this handler imports only stdlib +
#      boto3, and boto3 already ships in every AWS-managed Python 3.12
#      Lambda runtime, so there is nothing to bundle at all.
#   2. A CI/CD image-promotion pipeline (ECR push + `aws lambda
#      update-function-code` on every merge) — appropriate for code that
#      changes often; this is a ~100-line, single-purpose trigger expected
#      to change rarely. `data.archive_file` below zips the handler
#      straight from its source path on every `terraform plan`/`apply`, so
#      Terraform IS the deploy mechanism for this one function — no ECR
#      repo, no DevOps pipeline, no bootstrap-tag chicken-and-egg step
#      (unlike modules/lambda and modules/lambda_resize) needed to stand
#      this up. If this Lambda's code ever grows into something that
#      changes frequently enough to want a real CI/CD pipeline, that is a
#      natural follow-up, not something to over-build now.
# No VPC attachment: this Lambda only ever calls cognito-idp, reachable over
# its public regional endpoint from outside a VPC, and never touches Aurora
# — same reasoning as modules/lambda_resize.
# -------------------------------------------------------------------
data "archive_file" "post_confirmation" {
  type        = "zip"
  output_path = "/tmp/${var.project}-cognito-post-confirmation-${var.env}.zip"

  source {
    content  = file("${path.module}/../../../backend/app/lambda_handlers/cognito_post_confirmation.py")
    filename = "cognito_post_confirmation.py"
  }
}

resource "aws_cloudwatch_log_group" "post_confirmation" {
  name              = "/aws/lambda/${var.project}-cognito-post-confirmation-${var.env}"
  retention_in_days = 30

  tags = local.common_tags
}

# -------------------------------------------------------------------
# IAM role — least privilege per infra/CLAUDE.md "IAM Least-Privilege
# Rules": the ONLY permission this Lambda's execution role grants beyond
# its own CloudWatch log stream is cognito-idp:AdminAddUserToGroup, scoped
# to this one user pool's ARN. Deliberately its own role, never shared with
# the API Lambda's role (module.iam's api_lambda role in
# infra/modules/iam/main.tf) — that role intentionally carries only
# cognito-idp:ListUsers (read-only, manager-email lookup) and explicitly
# excludes AdminAddUserToGroup (see docs/PROJECT_PLAN.csv row for this
# task, and infra/CLAUDE.md "IAM Least-Privilege Rules"). Keeping this
# grant on a separate, narrowly-scoped role means a compromised API Lambda
# still cannot add itself (or anyone) to any Cognito group.
# -------------------------------------------------------------------
data "aws_iam_policy_document" "post_confirmation_lambda_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "post_confirmation_lambda" {
  name               = "${var.project}-cognito-post-confirmation-lambda-${var.env}"
  assume_role_policy = data.aws_iam_policy_document.post_confirmation_lambda_trust.json

  tags = local.common_tags
}

resource "aws_iam_role_policy" "post_confirmation_lambda" {
  name = "${var.project}-cognito-post-confirmation-lambda-policy-${var.env}"
  role = aws_iam_role.post_confirmation_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "AdminAddUserToGroupOnThisPoolOnly"
        Effect   = "Allow"
        Action   = ["cognito-idp:AdminAddUserToGroup"]
        Resource = aws_cognito_user_pool.main.arn
      },
      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "${aws_cloudwatch_log_group.post_confirmation.arn}:*"
      }
    ]
  })
}

resource "aws_lambda_function" "post_confirmation" {
  function_name    = "${var.project}-cognito-post-confirmation-${var.env}"
  runtime          = "python3.12"
  handler          = "cognito_post_confirmation.handler"
  role             = aws_iam_role.post_confirmation_lambda.arn
  filename         = data.archive_file.post_confirmation.output_path
  source_code_hash = data.archive_file.post_confirmation.output_base64sha256
  timeout          = 10
  memory_size      = 128

  tags = local.common_tags

  depends_on = [aws_cloudwatch_log_group.post_confirmation]
}

# Allows Cognito to invoke this function as the pool's post-confirmation
# trigger — scoped to this one user pool's ARN via source_arn, never a
# wildcard. Required alongside `lambda_config.post_confirmation` above;
# Cognito will not invoke a trigger Lambda without this resource-based
# permission.
resource "aws_lambda_permission" "cognito_invoke_post_confirmation" {
  statement_id  = "AllowCognitoInvokePostConfirmation"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.post_confirmation.function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.main.arn
}

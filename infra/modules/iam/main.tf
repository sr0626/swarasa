locals {
  common_tags = {
    project     = var.project
    environment = var.env
    phase       = var.phase
    managed_by  = "terraform"
  }

  # Construct log group ARNs from known naming convention (avoids circular deps)
  api_log_group_arn         = "arn:aws:logs:${var.aws_region}:${var.account_id}:log-group:/aws/lambda/${var.project}-api-${var.env}:*"
  deal_expiry_log_group_arn = "arn:aws:logs:${var.aws_region}:${var.account_id}:log-group:/aws/lambda/${var.project}-deal-expiry-${var.env}:*"
  # "resize" is hardcoded here the same way "deal-expiry" is above (not
  # parameterized via a service_name variable) — modules/lambda_resize's
  # own service_name variable defaults to "resize" too; if that default is
  # ever overridden this ARN would need to be updated alongside it.
  resize_log_group_arn = "arn:aws:logs:${var.aws_region}:${var.account_id}:log-group:/aws/lambda/${var.project}-resize-${var.env}:*"
}

# -------------------------------------------------------------------
# Shared Lambda trust policy
# -------------------------------------------------------------------
data "aws_iam_policy_document" "lambda_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# -------------------------------------------------------------------
# API Lambda execution role
# -------------------------------------------------------------------
resource "aws_iam_role" "api_lambda" {
  name               = "${var.project}-api-lambda-${var.env}"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json

  tags = local.common_tags
}

# AWSLambdaVPCAccessExecutionRole — grants CreateNetworkInterface / DeleteNetworkInterface
# needed for Lambda to attach to the private subnets
resource "aws_iam_role_policy_attachment" "api_lambda_vpc" {
  role       = aws_iam_role.api_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy" "api_lambda_custom" {
  name = "${var.project}-api-lambda-policy-${var.env}"
  role = aws_iam_role.api_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "S3MediaReadWrite"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:DeleteObject"
        ]
        Resource = "${var.media_bucket_arn}/*"
      },
      {
        Sid      = "S3MediaList"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = var.media_bucket_arn
      },
      {
        Sid    = "SecretsManagerRead"
        Effect = "Allow"
        Action = ["secretsmanager:GetSecretValue"]
        Resource = [
          var.db_secret_arn,
          var.stripe_secret_key_arn,
          var.stripe_webhook_secret_arn,
        ]
      },
      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = local.api_log_group_arn
      },
      {
        # Read-only, single pool: resolves a location manager's email to their
        # Cognito sub (backend/app/services/cognito_service.py). No admin,
        # create, delete, or group-management actions — see infra/CLAUDE.md
        # "IAM Least-Privilege Rules".
        Sid      = "CognitoListUsersForManagerAssignment"
        Effect   = "Allow"
        Action   = ["cognito-idp:ListUsers"]
        Resource = var.cognito_user_pool_arn
      },
      {
        # Claim approval: adds the approved claimant to the `owner` pool group
        # (admin_add_user_to_group) and resolves their pool identity
        # (admin_get_user) when the sub alone isn't accepted as Username.
        # Two actions, one pool ARN. No AdminCreateUser/AdminDeleteUser/
        # AdminUpdateUserAttributes.
        Sid    = "CognitoOwnerGroupAssignmentOnThisPoolOnly"
        Effect = "Allow"
        Action = [
          "cognito-idp:AdminAddUserToGroup",
          "cognito-idp:AdminGetUser"
        ]
        Resource = var.cognito_user_pool_arn
      }
    ]
  })
}

# -------------------------------------------------------------------
# Deal-expiry Lambda execution role — DB read only; no S3 or SES needed
# -------------------------------------------------------------------
resource "aws_iam_role" "deal_expiry_lambda" {
  name               = "${var.project}-deal-expiry-lambda-${var.env}"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json

  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "deal_expiry_lambda_vpc" {
  role       = aws_iam_role.deal_expiry_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy" "deal_expiry_lambda_custom" {
  name = "${var.project}-deal-expiry-lambda-policy-${var.env}"
  role = aws_iam_role.deal_expiry_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "SecretsManagerRead"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = var.db_secret_arn
      },
      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = local.deal_expiry_log_group_arn
      }
    ]
  })
}

# -------------------------------------------------------------------
# Resize Lambda execution role — S3 image resize pipeline (BRD 5.3 +
# thumbnail variant). Least privilege per infra/CLAUDE.md "IAM
# Least-Privilege Rules": S3 get raw/, put processed/ AND thumbnails/
# (two prefixes since 2026-09-16's thumbnail addition — see
# docs/DECISIONS.md "Resize Lambda: thumbnail variant"), delete raw/ —
# nothing else, never shared with the API Lambda's role. No RDS/VPC
# permissions attached (unlike api_lambda/deal_expiry_lambda above) — this
# function isn't in a VPC (see modules/lambda_resize/main.tf) and never
# touches Aurora.
# -------------------------------------------------------------------
resource "aws_iam_role" "resize_lambda" {
  name               = "${var.project}-resize-lambda-${var.env}"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json

  tags = local.common_tags
}

resource "aws_iam_role_policy" "resize_lambda_custom" {
  name = "${var.project}-resize-lambda-policy-${var.env}"
  role = aws_iam_role.resize_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "S3ReadRawUploads"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${var.media_bucket_arn}/raw/*"
      },
      {
        Sid    = "S3WriteProcessedAndThumbnails"
        Effect = "Allow"
        Action = ["s3:PutObject"]
        Resource = [
          "${var.media_bucket_arn}/processed/*",
          "${var.media_bucket_arn}/thumbnails/*",
        ]
      },
      {
        Sid      = "S3DeleteRawAfterProcessing"
        Effect   = "Allow"
        Action   = ["s3:DeleteObject"]
        Resource = "${var.media_bucket_arn}/raw/*"
      },
      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = local.resize_log_group_arn
      }
    ]
  })
}

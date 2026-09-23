locals {
  common_tags = {
    project     = var.project
    environment = var.env
    phase       = var.phase
    managed_by  = "terraform"
  }

  # Parameterized on var.service_name (default "api") so a second service is
  # a copy-paste `module "lambda"` block with a different service_name, not
  # a naming-convention redesign — see DECISIONS.md "Multi-service scaling".
  # deal_expiry stays fixed: it's a single cross-service cron job, not
  # per-service, so it does not take service_name.
  service_function_name     = "${var.project}-${var.service_name}-${var.env}"
  deal_expiry_function_name = "${var.project}-deal-expiry-${var.env}"
}

# -------------------------------------------------------------------
# CloudWatch Log Groups — created explicitly so Lambda role needs no
# logs:CreateLogGroup permission and retention is enforced.
# -------------------------------------------------------------------
resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${local.service_function_name}"
  retention_in_days = 30

  tags = local.common_tags
}

resource "aws_cloudwatch_log_group" "deal_expiry" {
  name              = "/aws/lambda/${local.deal_expiry_function_name}"
  retention_in_days = 30

  tags = local.common_tags
}

# -------------------------------------------------------------------
# API Lambda — FastAPI via Mangum handler, container image (see
# DECISIONS.md "Containerization: Lambda container images via ECR" and
# infra/CLAUDE.md "Lambda + API Gateway (container image, not zip)").
# No "runtime" or "handler" with package_type = "Image" — the Dockerfile's
# CMD/ENTRYPOINT (Mangum-wrapped FastAPI app) is the handler.
#
# `image_uri` bootstrap/CI-drift note: on the very first apply there is no
# image in ECR yet for var.lambda_image_uri to point to (Lambda validates the
# image exists at create time), so a human must push one placeholder image to
# the ECR repo's `:bootstrap` tag before that first apply — see the comment
# on `lambda_image_uri` in variables.tf and on `module "ecr"` /
# `module "lambda"` in the root main.tf for the exact reasoning. After that,
# DevOps's pipeline moves the running image forward via
# `aws lambda update-function-code` (devops/CLAUDE.md), never through
# Terraform — `lifecycle.ignore_changes` below is what keeps `terraform plan`
# from trying to revert those deploys back to the Terraform-declared value,
# same pattern this module already used for the old zip's filename/hash.
# -------------------------------------------------------------------
resource "aws_lambda_function" "api" {
  function_name = local.service_function_name
  package_type  = "Image"
  image_uri     = var.lambda_image_uri
  role          = var.api_lambda_role_arn
  timeout       = 30
  memory_size   = 512

  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = [var.lambda_sg_id]
  }

  environment {
    variables = {
      ENVIRONMENT          = var.env
      DB_SECRET_NAME       = var.db_secret_name
      S3_MEDIA_BUCKET      = var.media_bucket_name
      COGNITO_USER_POOL_ID = var.cognito_user_pool_id
    }
  }

  depends_on = [aws_cloudwatch_log_group.api]

  lifecycle {
    ignore_changes = [image_uri]
  }

  tags = local.common_tags
}

# -------------------------------------------------------------------
# Deal-expiry Lambda — single EventBridge cron target; runs every 5 min.
#
# Container image, REUSING the API Lambda's own image (var.lambda_image_uri)
# rather than a dedicated ECR repo/Dockerfile — decided over the resize
# Lambda's "own image" pattern (infra/modules/lambda_resize,
# infra/modules/ecr's `ecr_resize` call) because the two cases differ in the
# one way that matters: resize needs Pillow, a dependency the API image
# doesn't carry, so it earns its own image; deal_expiry
# (backend/app/lambda_handlers/deal_expiry.py) imports
# app.db.session/app.models.deal/app.services.audit_service, which pull in
# the full sqlalchemy[asyncio]+asyncpg+geoalchemy2 stack — already in
# backend/requirements.txt and already installed into the API image by
# backend/Dockerfile's `RUN pip install -r requirements.txt`. The Dockerfile
# also `COPY app/ ${LAMBDA_TASK_ROOT}/app/` wholesale, so
# app/lambda_handlers/deal_expiry.py is already IN the API image today, just
# unreachable because CMD points at app.main.handler. A second ECR repo +
# Dockerfile + deploy-*.yml pipeline for a handler the existing image
# already contains would just be duplicate build/storage cost for a cron
# job that runs a handful of times an hour. `image_config.command`
# overrides the image's default CMD per-function, without rebuilding —
# exactly what's needed here.
#
# `image_uri = var.lambda_image_uri` deliberately reuses the SAME variable
# as `aws_lambda_function.api` above (not a separate deal-expiry-specific
# var) — they are, by design, always the same image. This also means no
# new one-time `:bootstrap` push is needed for this function: whatever
# image the API Lambda is already running from already contains this
# handler. See this PR's description for the exact human command to confirm
# the currently-deployed image is current (post the deals-engine-backend
# merge) before applying.
# -------------------------------------------------------------------
resource "aws_lambda_function" "deal_expiry" {
  function_name = local.deal_expiry_function_name
  package_type  = "Image"
  image_uri     = var.lambda_image_uri
  role          = var.deal_expiry_lambda_role_arn
  timeout       = 60
  memory_size   = 256

  image_config {
    command = ["app.lambda_handlers.deal_expiry.handler"]
  }

  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = [var.lambda_sg_id]
  }

  environment {
    variables = {
      ENVIRONMENT    = var.env
      DB_SECRET_NAME = var.db_secret_name
    }
  }

  depends_on = [aws_cloudwatch_log_group.deal_expiry]

  lifecycle {
    ignore_changes = [image_uri]
  }

  tags = local.common_tags
}

# -------------------------------------------------------------------
# API Gateway HTTP API
# -------------------------------------------------------------------
resource "aws_apigatewayv2_api" "main" {
  name          = "${var.project}-${var.env}"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = var.allowed_origins
    allow_methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    allow_headers = ["Authorization", "Content-Type"]
    max_age       = 300
  }

  tags = local.common_tags
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = "$default"
  auto_deploy = true

  tags = local.common_tags
}

resource "aws_apigatewayv2_integration" "api_lambda" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "default" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.api_lambda.id}"
}

# Allow API Gateway to invoke the API Lambda
resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

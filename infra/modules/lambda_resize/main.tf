# -------------------------------------------------------------------
# Resize Lambda — S3 image resize pipeline (BRD 5.3 steps 3-5 + the
# thumbnail variant, docs/DECISIONS.md "Resize Lambda: thumbnail
# variant"). Container image (Pillow needs a compiled binary wheel — see
# docs/DECISIONS.md "Resize Lambda packaging").
#
# NOT a second `module "lambda"` call (unlike the copy-paste pattern
# DECISIONS.md "Multi-service scaling" describes for a same-shaped
# service, e.g. a future notifications API) — `modules/lambda` bundles
# the API Lambda, the deal-expiry Lambda, AND the shared API Gateway into
# one module; reusing it here would duplicate the deal-expiry Lambda and
# stand up a second, useless API Gateway just to get a third Lambda
# function. This dedicated module fits the resize Lambda's genuinely
# different shape — event-triggered by S3, no API Gateway integration at
# all — while still following the same tagging/naming/service_name
# conventions as every other module. Flagged for review.
#
# No VPC attachment (unlike the API/deal-expiry Lambdas in modules/lambda,
# which need it for Aurora access): this Lambda only ever talks to S3,
# reachable over its public regional endpoint from outside a VPC, and
# never touches Aurora. Skipping VPC config avoids the ENI attach/detach
# cold-start cost for a Lambda that gets no benefit from being in one.
# -------------------------------------------------------------------

locals {
  common_tags = {
    project     = var.project
    environment = var.env
    phase       = var.phase
    managed_by  = "terraform"
  }

  function_name = "${var.project}-${var.service_name}-${var.env}"
}

resource "aws_cloudwatch_log_group" "resize" {
  name              = "/aws/lambda/${local.function_name}"
  retention_in_days = 30

  tags = local.common_tags
}

resource "aws_lambda_function" "resize" {
  function_name = local.function_name
  package_type  = "Image"
  image_uri     = var.resize_image_uri
  role          = var.resize_lambda_role_arn
  timeout       = 30
  # Pillow decode+resize of a <=5MB JPEG/PNG (BRD 5.3's own upload cap)
  # comfortably fits in 512MB with headroom; revisit if the upload cap
  # ever changes.
  memory_size = 512

  environment {
    variables = {
      ENVIRONMENT     = var.env
      S3_MEDIA_BUCKET = var.media_bucket_name
    }
  }

  depends_on = [aws_cloudwatch_log_group.resize]

  lifecycle {
    ignore_changes = [image_uri]
  }

  tags = local.common_tags
}

# Allows the media bucket's S3 event notification (infra/main.tf's
# aws_s3_bucket_notification.media_raw_upload) to invoke this function —
# scoped to exactly this one bucket's ARN, never a wildcard. S3 validates
# this permission exists at notification-config-write time, which is why
# infra/main.tf's notification resource has an explicit
# `depends_on = [module.lambda_resize]`.
resource "aws_lambda_permission" "s3_invoke" {
  statement_id  = "AllowS3InvokeFromMediaBucket"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.resize.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = var.media_bucket_arn
}

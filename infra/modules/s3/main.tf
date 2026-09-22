locals {
  common_tags = {
    project     = var.project
    environment = var.env
    phase       = var.phase
    managed_by  = "terraform"
  }
}

# -------------------------------------------------------------------
# S3 media bucket — private; served exclusively through CloudFront OAC.
# Direct public access is NEVER allowed per guardrails.
# -------------------------------------------------------------------
resource "aws_s3_bucket" "media" {
  bucket = "${var.project}-media-${var.env}"

  tags = local.common_tags
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket = aws_s3_bucket.media.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "media" {
  bucket = aws_s3_bucket.media.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "media" {
  bucket = aws_s3_bucket.media.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Lifecycle rules: clean up incomplete multipart uploads after 7 days, and
# (added 2026-09-16, S3 image resize pipeline — docs/DECISIONS.md "S3
# image resize pipeline") expire anything still sitting under raw/ after 2
# days. The resize Lambda deletes a raw/ object itself once it's
# successfully processed (BRD 5.3 step 5) — normally raw/ objects live for
# seconds, not days. This is a defense-in-depth cost/hygiene backstop for
# the failure case only (a resize Lambda bug, a corrupt upload it can't
# decode, or a raw/ object it never got invoked for at all) — root
# CLAUDE.md "NEVER — Cost" guardrail spirit, not a load-bearing part of
# the pipeline's normal operation.
resource "aws_s3_bucket_lifecycle_configuration" "media" {
  bucket = aws_s3_bucket.media.id

  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"

    # Intentionally bucket-wide (no prefix) — incomplete multipart uploads
    # can land anywhere in the bucket, not just under raw/. An empty filter
    # block is the modern S3 lifecycle resource's explicit way to say "all
    # objects", and silences the provider's "Invalid Attribute Combination"
    # warning without narrowing this rule's actual scope.
    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  rule {
    id     = "expire-stale-raw-uploads"
    status = "Enabled"

    filter {
      prefix = "raw/"
    }

    expiration {
      days = 2
    }

    # Versioning is enabled on this bucket (aws_s3_bucket_versioning.media
    # above) — `expiration` alone only adds a delete marker on the current
    # version after 2 days, it does NOT remove the actual object bytes.
    # Without this, a failed/never-processed raw/ upload would keep
    # costing storage indefinitely as a noncurrent version, defeating the
    # whole point of this rule.
    noncurrent_version_expiration {
      noncurrent_days = 2
    }
  }
}

# -------------------------------------------------------------------
# CloudFront Origin Access Control — sigv4 signed requests to S3
# -------------------------------------------------------------------
resource "aws_cloudfront_origin_access_control" "media" {
  name                              = "${var.project}-media-oac-${var.env}"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# -------------------------------------------------------------------
# CloudFront distribution — Phase 1 uses default certificate (*.cloudfront.net)
# Custom domain + ACM cert can be added in Phase 2.
# -------------------------------------------------------------------
resource "aws_cloudfront_distribution" "media" {
  enabled = true
  comment = "${var.project} media ${var.env}"

  origin {
    domain_name              = aws_s3_bucket.media.bucket_regional_domain_name
    origin_id                = "S3MediaOrigin"
    origin_access_control_id = aws_cloudfront_origin_access_control.media.id
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3MediaOrigin"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }

    min_ttl     = 0
    default_ttl = 86400
    max_ttl     = 31536000
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = local.common_tags
}

# -------------------------------------------------------------------
# S3 bucket policy — allow CloudFront OAC to read objects
# -------------------------------------------------------------------
resource "aws_s3_bucket_policy" "media" {
  bucket = aws_s3_bucket.media.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "AllowCloudFrontOAC"
      Effect = "Allow"
      Principal = {
        Service = "cloudfront.amazonaws.com"
      }
      Action   = "s3:GetObject"
      Resource = "${aws_s3_bucket.media.arn}/*"
      Condition = {
        StringEquals = {
          "AWS:SourceArn" = aws_cloudfront_distribution.media.arn
        }
      }
    }]
  })

  depends_on = [aws_s3_bucket_public_access_block.media]
}

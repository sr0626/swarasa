locals {
  common_tags = {
    project     = var.project
    environment = var.env
    phase       = var.phase
    managed_by  = "terraform"
  }
}

data "aws_availability_zones" "available" {
  state = "available"
}

# -------------------------------------------------------------------
# VPC
# -------------------------------------------------------------------
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = merge(local.common_tags, { Name = "${var.project}-vpc-${var.env}" })
}

# -------------------------------------------------------------------
# Private subnets — Lambda + Aurora live here; no NAT Gateway
# -------------------------------------------------------------------
resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.${count.index + 1}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]

  tags = merge(local.common_tags, {
    Name = "${var.project}-private-${count.index + 1}-${var.env}"
  })
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
  tags   = merge(local.common_tags, { Name = "${var.project}-rt-private-${var.env}" })
}

resource "aws_route_table_association" "private" {
  count          = 2
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

# -------------------------------------------------------------------
# Security group: Lambda
# Egress to Aurora (5432) and VPC interface endpoints (443) within VPC CIDR only.
# CIDR-based egress avoids circular SG reference with the Aurora module's RDS SG.
# -------------------------------------------------------------------
resource "aws_security_group" "lambda" {
  name        = "${var.project}-lambda-sg-${var.env}"
  description = "Lambda - egress to Aurora and VPC endpoints only; no inbound"
  vpc_id      = aws_vpc.main.id

  egress {
    description = "PostgreSQL to Aurora"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/16"]
  }

  egress {
    description = "HTTPS to VPC interface endpoints (Secrets Manager, Logs, SES)"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/16"]
  }

  tags = merge(local.common_tags, { Name = "${var.project}-lambda-sg-${var.env}" })
}

# -------------------------------------------------------------------
# Security group: VPC interface endpoints
# Only accepts HTTPS from Lambda SG.
# -------------------------------------------------------------------
resource "aws_security_group" "vpc_endpoints" {
  name        = "${var.project}-vpce-sg-${var.env}"
  description = "VPC interface endpoints - inbound HTTPS from Lambda only"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "HTTPS from Lambda"
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    security_groups = [aws_security_group.lambda.id]
  }

  tags = merge(local.common_tags, { Name = "${var.project}-vpce-sg-${var.env}" })
}

# -------------------------------------------------------------------
# VPC Gateway endpoint — S3 (free; routes S3 traffic within AWS fabric)
# -------------------------------------------------------------------
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${var.aws_region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.private.id]

  tags = merge(local.common_tags, { Name = "${var.project}-vpce-s3-${var.env}" })
}

# -------------------------------------------------------------------
# VPC Interface endpoint — Secrets Manager
# Lambda reads DB + Stripe secrets at cold start. ~$7.30/mo per AZ.
# -------------------------------------------------------------------
resource "aws_vpc_endpoint" "secretsmanager" {
  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.${var.aws_region}.secretsmanager"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.private[*].id
  security_group_ids  = [aws_security_group.vpc_endpoints.id]
  private_dns_enabled = true

  tags = merge(local.common_tags, { Name = "${var.project}-vpce-secretsmanager-${var.env}" })
}

# -------------------------------------------------------------------
# VPC Interface endpoint — CloudWatch Logs
# Required for Lambda in a private subnet to emit logs. ~$7.30/mo per AZ.
# -------------------------------------------------------------------
resource "aws_vpc_endpoint" "logs" {
  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.${var.aws_region}.logs"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.private[*].id
  security_group_ids  = [aws_security_group.vpc_endpoints.id]
  private_dns_enabled = true

  tags = merge(local.common_tags, { Name = "${var.project}-vpce-logs-${var.env}" })
}

# -------------------------------------------------------------------
# VPC Interface endpoint — Cognito Identity Provider
#
# Found 2026-09-18: the Lambda's IAM role has held cognito-idp:ListUsers
# since PR #10 (manager-assignment-by-email lookup, docs/API_CONTRACTS.md),
# and every management command that resolves an owner/manager by email
# (seed_dev_data, bulk_import_restaurants, delete_user_data) calls the same
# find_sub_by_email(). None of that is reachable from inside this Lambda's
# private subnets without this endpoint -- there's no NAT Gateway (root
# CLAUDE.md "NEVER create a NAT Gateway") and no cognito-idp endpoint
# existed, so every one of those code paths has been hanging on an
# unreachable connection attempt until the Lambda's own 30s function
# timeout kills it, in every real deployment since this Lambda was first
# created. IAM authorization was correct; the network path to use it never
# existed. Caught live via `delete_test_user.py` timing out 3x in a row
# while GET /cuisine-tags (no Cognito call in its path) succeeded
# normally -- see docs/DECISIONS.md "Missing Cognito VPC endpoint" for the
# full diagnostic trail. ~$7.30/mo per AZ, same order as the
# secretsmanager/logs endpoints above.
#
# Subnet selection is filtered to only the AZs cognito-idp's endpoint
# service actually supports (found 2026-09-18 on the first real apply
# attempt: it rejected one of this VPC's two private subnets outright --
# "does not support the availability zone of the subnet" -- unlike
# secretsmanager/logs above, which happen to support both this VPC's AZs.
# Not every AWS service's VPC endpoint is available in every AZ in a
# region, and that set isn't stable enough to hardcode; this data source
# is the standard Terraform pattern for it. If that leaves only one AZ,
# this endpoint is intentionally single-AZ -- an availability tradeoff
# already accepted by definition for a private-subnet-only path with no
# NAT Gateway.
# -------------------------------------------------------------------
data "aws_vpc_endpoint_service" "cognito_idp" {
  service = "cognito-idp"
}

resource "aws_vpc_endpoint" "cognito_idp" {
  vpc_id            = aws_vpc.main.id
  service_name      = data.aws_vpc_endpoint_service.cognito_idp.service_name
  vpc_endpoint_type = "Interface"
  subnet_ids = [
    for s in aws_subnet.private : s.id
    if contains(data.aws_vpc_endpoint_service.cognito_idp.availability_zones, s.availability_zone)
  ]
  security_group_ids  = [aws_security_group.vpc_endpoints.id]
  private_dns_enabled = true

  tags = merge(local.common_tags, { Name = "${var.project}-vpce-cognito-idp-${var.env}" })
}

# SES VPC endpoint deferred — SES not provisioned in Phase 1.
# Add com.amazonaws.{region}.ses interface endpoint here when SES is activated.

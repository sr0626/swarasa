# -------------------------------------------------------------------
# GitHub Actions OIDC role — DevOps's CI/CD pipeline (see devops/CLAUDE.md
# "Key Patterns", `role-to-assume: ${{ secrets.DEV_DEPLOY_ROLE_ARN }}`).
# Scoped to exactly two things per devops/CLAUDE.md "NEVER — give the
# pipeline's IAM role permissions beyond what it needs": ECR push/pull on
# the one backend repo (module.ecr) and lambda:UpdateFunctionCode on the API
# function AND the deal-expiry function (both run the same image — see
# local.deal_expiry_lambda_arn below for why this role now names two
# function ARNs instead of one). Nothing account-wide, no static keys
# (OIDC only).
# -------------------------------------------------------------------

# One GitHub OIDC provider per AWS account, shared by any workflow in this
# account that assumes a role via OIDC. Checked: no existing
# aws_iam_openid_connect_provider anywhere in this codebase, so it's created
# here rather than assumed to pre-exist.
resource "aws_iam_openid_connect_provider" "github_actions" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]

  # GitHub's documented root CA thumbprint. AWS now validates the token
  # against its own trusted CA bundle for OIDC-compliant providers like
  # GitHub's rather than actually checking this value, but the field is
  # still required by the aws_iam_openid_connect_provider resource schema
  # on AWS provider ~> 5.0 (pinned in backend.tf), so it's supplied for
  # schema validity.
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]

  tags = local.common_tags
}

locals {
  # var.github_repo_url is "https://github.com/<org>/<repo>" — the same
  # value already used by the amplify module for its own repo reference.
  # Reused here (rather than adding a second variable for the same repo) to
  # derive the "<org>/<repo>" slug the OIDC sub claim needs.
  #
  # NOT used directly in the trust condition below anymore — see the
  # github_repo_slug_immutable local for why (GitHub's actual sub claim
  # format embeds numeric ids, confirmed via CloudTrail after this repo's
  # rename broke the plain-name version of this condition).
  github_repo_slug = trimprefix(var.github_repo_url, "https://github.com/")

  # GitHub's OIDC sub claim is NOT "repo:<org>/<repo>:ref:..." — it's
  # "repo:<org>@<owner_id>/<repo>@<repo_id>:ref:...", embedding the
  # immutable numeric owner/repo ids alongside the (mutable, rename-able)
  # login/name. Confirmed empirically via CloudTrail's
  # AssumeRoleWithWebIdentity error event after this repo was renamed
  # restaurant-platform -> swarasa and the deploy pipeline's first real run
  # failed with AccessDenied: the trust condition below used to be
  # "repo:${local.github_repo_slug}:ref:refs/heads/main" (plain names only,
  # matching AWS's own official example in their GitHub OIDC docs — this
  # wasn't a made-up format, GitHub apparently now sends the id-augmented
  # form regardless), which never matched the token GitHub actually issued.
  # Using the immutable ids here (rather than just fixing the name to
  # "swarasa") also means this condition survives a FUTURE rename without
  # needing another Terraform change — the whole point of GitHub adding the
  # ids to the claim in the first place.
  github_repo_slug_immutable = "${local.github_repo_slug_owner}@${var.github_owner_id}/${local.github_repo_slug_name}@${var.github_repo_id}"
  github_repo_slug_owner     = split("/", local.github_repo_slug)[0]
  github_repo_slug_name      = split("/", local.github_repo_slug)[1]

  # Constructed from the known naming convention (same technique this module
  # already uses for the CloudWatch log group ARNs above) instead of taking
  # module.lambda's output directly — module.lambda already depends on this
  # iam module for its execution role ARNs, so depending back on
  # module.lambda.api_lambda_arn here would create a circular module
  # dependency. The ECR repo ARN has no such cycle (module.ecr depends on
  # nothing), so that one is passed in as a real variable instead.
  #
  # Parameterized on var.service_name (default "api", matching module.ecr /
  # module.lambda's own default) so this ARN stays correct if the root
  # module's service_name for this Lambda ever changes — see DECISIONS.md
  # "Multi-service scaling".
  api_lambda_arn = "arn:aws:lambda:${var.aws_region}:${var.account_id}:function:${var.project}-${var.service_name}-${var.env}"

  # Same constructed-not-referenced reasoning as api_lambda_arn above —
  # avoids a circular dependency on module.lambda (which depends on this
  # iam module for its execution role ARNs). Added when deal_expiry moved
  # from a zip placeholder to a container image REUSING the API Lambda's
  # own image (infra/modules/lambda/main.tf's aws_lambda_function.deal_expiry
  # comment): deploy-backend.yml's "Point deal-expiry Lambda at the same new
  # image" step now calls lambda:UpdateFunctionCode on this function too, so
  # this role needs it in its Resource list below. Name is constructed from
  # modules/lambda/main.tf's fixed `deal_expiry_function_name` local
  # (`"${var.project}-deal-expiry-${var.env}"` — not parameterized by
  # service_name, same as that resource: a single cross-service cron job).
  deal_expiry_lambda_arn = "arn:aws:lambda:${var.aws_region}:${var.account_id}:function:${var.project}-deal-expiry-${var.env}"

  # Same constructed-not-referenced reasoning as api_lambda_arn above
  # (avoids a circular dependency on module.lambda_resize, which itself
  # depends on this iam module for its execution role). "resize" is
  # hardcoded rather than parameterized — see the resize_log_group_arn
  # comment in main.tf for why.
  resize_lambda_arn = "arn:aws:lambda:${var.aws_region}:${var.account_id}:function:${var.project}-resize-${var.env}"
}

# -------------------------------------------------------------------
# Trust policy — restricts to THIS repo, THIS branch, nothing else.
#
# JUDGMENT CALL (flag for review): scoped to the sub claim
# `repo:<org>/<repo>:ref:refs/heads/main`, matching devops/CLAUDE.md's
# `deploy-backend.yml`, which only triggers on `push: branches: [main]` — no
# other workflow needs this role today. This is intentionally tighter than
# the common `repo:<org>/<repo>:*` pattern (which would let any branch, PR,
# or environment in the repo assume the role). Tradeoff: if DevOps adds a
# second workflow that needs to assume this role from a non-main ref (e.g. a
# PR-preview build), this condition has to widen then — not pre-opened now
# for a need that doesn't exist yet.
# -------------------------------------------------------------------
data "aws_iam_policy_document" "github_actions_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github_actions.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${local.github_repo_slug_immutable}:ref:refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "github_actions_deploy" {
  name               = "${var.project}-github-actions-deploy-${var.env}"
  assume_role_policy = data.aws_iam_policy_document.github_actions_trust.json

  tags = local.common_tags
}

# -------------------------------------------------------------------
# Permissions — ECR push/pull on the one backend repo,
# lambda:UpdateFunctionCode on the one API function. No account-wide access.
#
# JUDGMENT CALL (flag for review): `ecr:GetAuthorizationToken` is granted
# with `Resource = "*"` in its own statement. This is a deliberate, narrow
# exception to the "never Resource *" guardrail, not an oversight —
# GetAuthorizationToken is an account-level ECR API with no resource-level
# permission support at all (every AWS-documented ECR push/pull policy
# grants it this way); there is no repo ARN to scope it to. Every other
# action below is scoped to the single ECR repo ARN or the single Lambda
# function ARN.
# -------------------------------------------------------------------
resource "aws_iam_role_policy" "github_actions_deploy" {
  name = "${var.project}-github-actions-deploy-policy-${var.env}"
  role = aws_iam_role.github_actions_deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "EcrAuthToken"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Sid    = "EcrPushPullOwnRepo"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:PutImage",
          # Added: the deploy workflow's idempotency check and scan-gate
          # step (devops/ci-pipeline-placeholder) call these — flagged by
          # Architect's PR review, missing in the original policy.
          "ecr:DescribeImages",
          "ecr:DescribeImageScanFindings",
          # Added 2026-09-15: scan_on_push doesn't reliably auto-trigger in
          # this account (confirmed live — images sat at scan status null
          # for hours), so the workflow now explicitly calls start-image-scan
          # after push rather than relying on it firing automatically.
          "ecr:StartImageScan",
        ]
        Resource = var.ecr_repository_arn
      },
      {
        Sid    = "LambdaUpdateOwnFunctionCode"
        Effect = "Allow"
        Action = [
          "lambda:UpdateFunctionCode",
          # Added: the deploy workflow polls this after update-function-code
          # to wait for the new image to become Active — same review finding.
          "lambda:GetFunction",
          # Added 2026-09-15: confirmed live -- `aws lambda wait
          # function-updated` (the workflow's final step) actually polls via
          # GetFunctionConfiguration, a distinct action from GetFunction.
          # Found because the real deploy succeeded (confirmed via
          # `aws lambda get-function`: image updated, State=Active,
          # LastUpdateStatus=Successful) but the pipeline's own confirmation
          # step failed with AccessDeniedException on this specific action.
          "lambda:GetFunctionConfiguration",
        ]
        # Two ARNs, not one, since deal_expiry moved to a container image
        # REUSING this same pipeline's image (see local.deal_expiry_lambda_arn
        # above) — deploy-backend.yml now updates both functions' code from
        # the one image it builds. Still not a wildcard: an explicit list of
        # the exact two function ARNs this one pipeline is allowed to touch,
        # same least-privilege posture as before, just enumerating a second
        # resource instead of widening to "any function."
        Resource = [local.api_lambda_arn, local.deal_expiry_lambda_arn]
      }
    ]
  })
}

# -------------------------------------------------------------------
# Second GitHub Actions OIDC role — resize Lambda's own deploy pipeline
# (.github/workflows/deploy-resize.yml). A SEPARATE role, not an addition
# to the policy above, per devops/CLAUDE.md "Multi-service scaling": each
# service's deploy role is scoped to "one repo, one function", never
# widened to cover a second service. Reuses the same OIDC provider
# (`aws_iam_openid_connect_provider.github_actions`, an account-level
# singleton) and the same trust condition (this repo, `main` branch only)
# as the API's deploy role above — only the permissions differ.
# -------------------------------------------------------------------
resource "aws_iam_role" "github_actions_deploy_resize" {
  name               = "${var.project}-github-actions-deploy-resize-${var.env}"
  assume_role_policy = data.aws_iam_policy_document.github_actions_trust.json

  tags = local.common_tags
}

resource "aws_iam_role_policy" "github_actions_deploy_resize" {
  name = "${var.project}-github-actions-deploy-resize-policy-${var.env}"
  role = aws_iam_role.github_actions_deploy_resize.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # Same account-level-only exception as EcrAuthToken above —
        # GetAuthorizationToken has no resource-level permission support.
        Sid      = "EcrAuthToken"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Sid    = "EcrPushPullOwnRepo"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:PutImage",
          "ecr:DescribeImages",
          "ecr:DescribeImageScanFindings",
          "ecr:StartImageScan",
        ]
        Resource = var.ecr_resize_repository_arn
      },
      {
        Sid    = "LambdaUpdateOwnFunctionCode"
        Effect = "Allow"
        Action = [
          "lambda:UpdateFunctionCode",
          "lambda:GetFunction",
          "lambda:GetFunctionConfiguration",
        ]
        Resource = local.resize_lambda_arn
      }
    ]
  })
}

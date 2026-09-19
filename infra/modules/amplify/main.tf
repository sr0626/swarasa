locals {
  common_tags = {
    project     = var.project
    environment = var.env
    phase       = var.phase
    managed_by  = "terraform"
  }
}

# -------------------------------------------------------------------
# Amplify app — Next.js 14 with App Router (SSR requires WEB_COMPUTE)
# Monorepo: frontend code lives in /frontend subdirectory.
# -------------------------------------------------------------------
resource "aws_amplify_app" "frontend" {
  name       = "${var.project}-frontend-${var.env}"
  repository = var.github_repo_url

  # GitHub OAuth token — stored in Terraform state (S3, encrypted).
  # For production, rotate this token and update via terraform apply.
  access_token = var.github_access_token

  # WEB_COMPUTE enables SSR support for Next.js App Router
  platform = "WEB_COMPUTE"

  build_spec = <<-EOT
    version: 1
    applications:
      - frontend:
          phases:
            preBuild:
              commands:
                - npm ci
            build:
              commands:
                - npm run build
          artifacts:
            baseDirectory: .next
            files:
              - '**/*'
          cache:
            paths:
              - node_modules/**/*
              - .next/cache/**/*
        appRoot: frontend
  EOT

  environment_variables = merge(
    {
      NEXT_PUBLIC_API_URL              = var.api_gateway_url
      NEXT_PUBLIC_COGNITO_USER_POOL_ID = var.cognito_user_pool_id
      NEXT_PUBLIC_COGNITO_CLIENT_ID    = var.cognito_client_id
      NEXT_PUBLIC_MEDIA_URL            = var.cloudfront_url
      AMPLIFY_MONOREPO_APP_ROOT        = "frontend"
    },
    # Only set when provided; otherwise the frontend falls back to its
    # provisional placeholder (frontend/src/lib/contact.ts).
    var.contact_email == "" ? {} : { NEXT_PUBLIC_CONTACT_EMAIL = var.contact_email },
  )

  # Redirect /* to /index.html for SPA fallback (Next.js handles its own routing)
  custom_rule {
    source = "/<*>"
    status = "404"
    target = "/index.html"
  }

  tags = local.common_tags
}

resource "aws_amplify_branch" "main" {
  app_id      = aws_amplify_app.frontend.id
  branch_name = "main"
  stage       = var.env == "prod" ? "PRODUCTION" : "DEVELOPMENT"

  enable_auto_build = true

  tags = local.common_tags
}

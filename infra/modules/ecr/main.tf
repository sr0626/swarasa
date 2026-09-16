locals {
  common_tags = {
    project     = var.project
    environment = var.env
    phase       = var.phase
    managed_by  = "terraform"
  }
}

# -------------------------------------------------------------------
# ECR — backend API container image repository (see DECISIONS.md
# "Containerization: Lambda container images via ECR" and infra/CLAUDE.md
# "ECR"). One repo, IMMUTABLE tags so a pushed tag can never be silently
# overwritten (a deploy is always reproducible/promotable — see
# devops/CLAUDE.md "ALWAYS tag images immutably"), scan_on_push so every
# pushed image is scanned before DevOps's pipeline treats a deploy as good.
#
# Building and pushing images is DevOps's job (devops/CLAUDE.md,
# .github/workflows/deploy-backend.yml) — Terraform only owns the repo
# resource itself, never an image inside it.
# -------------------------------------------------------------------
resource "aws_ecr_repository" "api" {
  name                 = "${var.project}-${var.service_name}-${var.env}"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = local.common_tags
}

# Two rules:
# 1. Expire untagged images (dangling layers left behind when a tag is
#    re-pointed at a new digest, or a failed/aborted push) after 14 days.
# 2. Cap TAGGED image retention too (added 2026-09-15, user request) — every
#    real deploy pushes a new commit-SHA tag (IMMUTABLE, devops/CLAUDE.md
#    "ALWAYS tag images immutably") and nothing was ever removing old ones,
#    so the repo would grow forever. Keeps the most recent 20 tagged images
#    (by push time, any tag pattern via tagPatternList — commit SHAs have
#    no fixed prefix to match on) once there are more than 20, expiring the
#    rest. 20 is a judgment call: generous enough for realistic
#    rollback/promotion needs at Phase 1's deploy cadence, not "keep
#    everything forever" (the previous, now-superseded design). Revisit the
#    count if rollback needs turn out to reach further back than that.
resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images after 14 days"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 14
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep only the most recent 20 tagged images"
        selection = {
          tagStatus      = "tagged"
          tagPatternList = ["*"]
          countType      = "imageCountMoreThan"
          countNumber    = 20
        }
        action = { type = "expire" }
      }
    ]
  })
}

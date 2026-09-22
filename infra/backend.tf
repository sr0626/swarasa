terraform {
  required_version = ">= 1.7"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }

  # Pre-created (2026-09-15, account 091823298313 "swarasa-dev" — this
  # account replaced the earlier "restaurant-platform-dev" account, which
  # is being removed):
  #   aws s3 mb s3://swarasa-tfstate-sr0626 --region us-east-1
  #   aws s3api put-bucket-versioning --bucket swarasa-tfstate-sr0626 \
  #       --versioning-configuration Status=Enabled
  #   aws dynamodb create-table --table-name swarasa-tfstate-lock \
  #       --attribute-definitions AttributeName=LockID,AttributeType=S \
  #       --key-schema AttributeName=LockID,KeyType=HASH \
  #       --billing-mode PAY_PER_REQUEST --region us-east-1
  #
  # State key follows the environment promotion convention (see
  # infra/CLAUDE.md "Environment promotion convention" and
  # DECISIONS.md "Terraform environment promotion"): envs/<env>/terraform.tfstate,
  # one key per environment, never a forked codebase. `dev` is the only
  # environment that exists today.
  #
  # No migration needed: `terraform apply` has never been run against any
  # backend, so this bucket/table start empty — this is a fresh account and
  # a fresh state store, not a rename of the old one.
  # FOLLOW-UP (flagged 2026-09-22, infra/fix-plan-warnings, not applied here —
  # see that PR's report for full reasoning): the AWS provider warns that
  # `dynamodb_table` is deprecated in favor of `use_lockfile` (S3-native
  # conditional-write locking, no separate lock table). NOT a same-PR fix:
  # `swarasa-tfstate-lock` is an actively used lock table against real,
  # already-applied `dev` state (61+ resources, many applies since — see
  # docs/CMD_LOG.md) — this isn't the empty/fresh-state case the comment
  # below describes for the key-path migration. Switching now is a real
  # state-locking behavior change, not a rename, and needs a human to:
  #   1. Confirm no `terraform plan`/`apply` is in-flight (no live lock held)
  #      before touching this.
  #   2. Confirm the Terraform version actually used to run plan/apply is
  #      >= 1.10 (use_lockfile support) — this repo's required_version
  #      (">= 1.7" above) does not guarantee that; only the *locally checked*
  #      Terraform here happens to be 1.15.4.
  #   3. Decide whether to add `use_lockfile = true` alongside
  #      `dynamodb_table` for one transition apply (both can coexist per
  #      Terraform docs) versus a hard cutover, and whether/when to decommission
  #      `swarasa-tfstate-lock` afterward (it isn't deleted by this change
  #      either way — it just stops being written to).
  #   4. Re-run `terraform init -reconfigure` once the backend block changes,
  #      same as any backend config change.
  # Until a human signs off on that sequence, this stays on `dynamodb_table`
  # and the provider warning stays present (harmless, not a hard error yet).
  backend "s3" {
    bucket         = "swarasa-tfstate-sr0626"
    key            = "envs/dev/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "swarasa-tfstate-lock"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      project    = var.project
      phase      = var.phase
      managed_by = "terraform"
    }
  }
}

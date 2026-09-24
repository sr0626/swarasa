# Command Log

Every `git push`, AWS CLI/SDK command, and `terraform plan`/`apply` — in
execution order, grouped by date. `# user` / `# claude` marks who ran it.

## 2026-09-12
```bash
git push origin main   # claude
git push origin main   # claude
git push origin main   # claude
aws configure sso --profile restaurant-platform-dev   # user
aws sts get-caller-identity --profile restaurant-platform-dev   # user
aws s3 mb s3://restaurant-platform-tfstate-sr0626 --region us-east-1   # user
aws s3api put-bucket-versioning --bucket restaurant-platform-tfstate-sr0626 --versioning-configuration Status=Enabled   # user
aws dynamodb create-table --table-name restaurant-platform-tfstate-lock --attribute-definitions AttributeName=LockID,AttributeType=S --key-schema AttributeName=LockID,KeyType=HASH --billing-mode PAY_PER_REQUEST --region us-east-1   # user
aws s3api get-bucket-versioning --bucket restaurant-platform-tfstate-sr0626   # user
aws dynamodb describe-table --table-name restaurant-platform-tfstate-lock --query "Table.TableStatus" --output text   # user
git push origin main   # claude
git push -u origin feature/phase1-architect-schema   # claude
git push -u origin infra/ecr-container-lambda-image   # claude
git push -u origin devops/ci-pipeline-placeholder   # claude
gh pr create --base main --head feature/phase1-architect-schema   # claude
gh pr create --base main --head infra/ecr-container-lambda-image   # claude
gh pr create --base main --head devops/ci-pipeline-placeholder   # claude
gh api --method PUT repos/sr0626/restaurant-platform/branches/main/protection --input branch_protection.json   # claude
git push origin infra/ecr-container-lambda-image   # claude
git push -u origin docs/environment-promotion-strategy   # claude
gh pr create --base main --head docs/environment-promotion-strategy   # claude
git push origin main   # claude  (rejected — main is now protected, no direct pushes)
git push -u origin docs/cmd-log-updates   # claude
gh pr create --base main --head docs/cmd-log-updates   # claude
git merge origin/main   # claude  (resolved devops/CLAUDE.md add/add conflict on docs/environment-promotion-strategy)
git push origin docs/environment-promotion-strategy   # claude
git merge main   # claude  (resolved architect/CLAUDE.md add/add conflict on docs/architect-approval-gate)
git push -u origin docs/architect-approval-gate   # claude
gh pr create --base main --head docs/architect-approval-gate   # claude
```

## 2026-09-13
```bash
git push -u origin integration/phase1-backend-full   # claude
git push -u origin feature/phase1-frontend-scaffold   # claude
git push -u origin infra/service-name-and-state-key   # claude
git push -u origin infra/lambda-cognito-listusers   # claude
gh pr create --base main --head integration/phase1-backend-full   # claude
gh pr create --base main --head feature/phase1-frontend-scaffold   # claude
gh pr create --base main --head infra/service-name-and-state-key   # claude
gh pr create --base main --head infra/lambda-cognito-listusers   # claude
```

## 2026-09-13
```bash
git push -u origin docs/project-status   # claude
gh pr create --base main --head docs/project-status   # claude
git push origin integration/phase1-backend-full   # claude  (id/slug fix, commit 1af489d, onto PR #7)
git push origin docs/project-status   # claude  (STATUS.md refresh + .gitignore fix, onto PR #13)
git push origin pr7-slug-test-fix:integration/phase1-backend-full   # claude  (Architect's slug-lookup test coverage, onto PR #7)
git push origin docs/project-status   # claude  (PR #7 approved status update, onto PR #13)
git push origin docs/project-status   # claude  (log entry only, onto PR #13)
git push -u origin docs/relax-feature-branch-push-gate   # claude  (no pre-approval needed, per new rule)
gh pr create --base main --head docs/relax-feature-branch-push-gate   # claude  (no pre-approval needed, per new rule)
```

## 2026-09-13
```bash
git push -u origin docs/project-status   # claude
gh pr create --base main --head docs/project-status   # claude
git push origin integration/phase1-backend-full   # claude  (id/slug fix, commit 1af489d, onto PR #7)
git push origin docs/project-status   # claude  (STATUS.md refresh + .gitignore fix, onto PR #13)
git push origin pr7-slug-test-fix:integration/phase1-backend-full   # claude  (Architect's slug-lookup test coverage, onto PR #7)
git push origin docs/project-status   # claude  (PR #7 approved status update, onto PR #13)
git push -u origin docs/homepage-direction-spice-market   # claude  (no pre-approval needed, per relaxed push rule)
gh pr create --base main --head docs/homepage-direction-spice-market   # claude  (no pre-approval needed, per relaxed push rule)
git push -u origin docs/merge-hygiene-rule   # claude
gh pr create --base main --head docs/merge-hygiene-rule   # claude
git push -u origin feature/homepage-spice-market-theme   # claude  (Spice Market homepage implementation, no pre-approval needed, per relaxed push rule)
gh pr create --base main --head feature/homepage-spice-market-theme   # claude  (no pre-approval needed, per relaxed push rule)
git push -u origin docs/status-homepage-merged   # claude
gh pr create --base main --head docs/status-homepage-merged   # claude
git push -u origin fix/next-config-js   # claude  (next.config.ts -> .mjs fix, no pre-approval needed, per relaxed push rule)
gh pr create --base main --head fix/next-config-js   # claude  (no pre-approval needed, per relaxed push rule)
git push -u origin feature/search-and-restaurant-detail-pages   # claude  (search + restaurant detail pages, no pre-approval needed, per relaxed push rule)
gh pr create --base main --head feature/search-and-restaurant-detail-pages   # claude  (no pre-approval needed, per relaxed push rule)
git push -u origin docs/api-contracts-restaurants-list-cuisine-tags   # claude  (no pre-approval needed, per relaxed push rule)
gh pr create --base main --head docs/api-contracts-restaurants-list-cuisine-tags   # claude  (no pre-approval needed, per relaxed push rule)
gh pr ready 21 --undo   # claude  (converted PR #21 to draft, per new draft-until-approved rule)
git push -u origin docs/draft-pr-until-architect-approves   # claude
gh pr create --base main --head docs/draft-pr-until-architect-approves   # claude
git merge origin/main   # claude  (resolved next.config.ts/.mjs + CMD_LOG.md conflicts from PR #19 landing after this branch was cut)
git push origin feature/search-and-restaurant-detail-pages   # claude  (Architect fix-loop: merge main to un-revert the next.config.mjs fix, onto PR #21)
git merge origin/main   # claude  (resolved second CMD_LOG.md conflict — PR #20 merged to main mid-review)
git push origin feature/search-and-restaurant-detail-pages   # claude  (onto PR #21)
git push -u origin feature/restaurants-list-and-cuisine-tags   # claude  (Gap A/B endpoint implementation, no pre-approval needed, per relaxed push rule)
gh pr create --base main --head feature/restaurants-list-and-cuisine-tags   # claude  (no pre-approval needed, per relaxed push rule)
git merge origin/main   # claude  (resolved CMD_LOG.md conflict — PR #22 merged mid-review, onto PR #21)
git push origin HEAD:feature/search-and-restaurant-detail-pages   # claude  (onto PR #21)
git push -u origin docs/status-phase1-progress   # claude
gh pr create --base main --head docs/status-phase1-progress   # claude
git push -u origin feature/login-cognito-signin   # claude  (real Cognito sign-in flow, no pre-approval needed, per relaxed push rule)
gh pr create --draft --base main --head feature/login-cognito-signin   # claude  (opened as draft, per draft-until-Architect-approval rule)
git push -u origin feature/phase1-claim-flow-ui   # claude  (claim submission page + admin claims review queue, no pre-approval needed, per relaxed push rule)
gh pr create --base main --head feature/phase1-claim-flow-ui --draft   # claude  (opened as draft per new draft-until-approved rule)
git push origin HEAD:feature/phase1-claim-flow-ui   # claude  (Architect fix: corrected @aws-amplify/auth pin, onto PR #27)
gh pr ready 27   # claude  (Architect approved PR #27)
git push -u origin docs/project-plan-csv   # claude  (PROJECT_PLAN.csv tracker, no pre-approval needed, per relaxed push rule)
gh pr create --base main --head docs/project-plan-csv   # claude  (no pre-approval needed, per relaxed push rule)
git merge origin/main   # claude  (resolved CMD_LOG.md+STATUS.md conflict, onto PR #24)
git push origin docs/status-phase1-progress   # claude  (onto PR #24)
git merge origin/main   # claude  (resolved CMD_LOG.md conflict, onto PR #26)
git push origin HEAD:docs/project-plan-csv   # claude  (onto PR #26)
git push -u origin docs/cmd-log-orchestrator-only   # claude  (new CMD_LOG write-pattern rule)
gh pr create --base main --head docs/cmd-log-orchestrator-only   # claude
git merge origin/main   # claude  (resolved DECISIONS.md conflict, onto PR #28)
git push origin docs/cmd-log-orchestrator-only   # claude  (onto PR #28)
git push -u origin docs/status-login-claim-merged   # claude
gh pr create --base main --head docs/status-login-claim-merged   # claude
git push -u origin feature/phase1-owner-portal-dashboard-location-editor   # claude  (Frontend Dev, owner dashboard + location editor, no pre-approval needed, per relaxed push rule)
gh pr create --draft --base main --head feature/phase1-owner-portal-dashboard-location-editor   # claude  (opened as draft per draft-until-approved rule)
git push -u origin fix/hero-copy-and-error-boundary   # claude  (error.tsx boundary + de-repetitive marketing copy)
gh pr create --draft --base main --head fix/hero-copy-and-error-boundary   # claude
gh pr ready 32   # claude  (Architect approved PR #32)
git push -u origin test/phase1-playwright-e2e   # claude  (QA, Playwright e2e suite, no pre-approval needed, per relaxed push rule)
gh pr create --draft --base main --head test/phase1-playwright-e2e   # claude  (opened as draft per draft-until-approved rule)
gh pr ready 33   # claude  (Architect approved PR #33)
```

## 2026-09-15
```bash
git push -u origin docs/status-e2e-owner-portal-merged   # claude
gh pr create --base main --head docs/status-e2e-owner-portal-merged   # claude  (docs-only, opened ready per fast-path)
gh repo rename swarasa --yes   # user  (restaurant-platform -> swarasa)
git push -u origin docs/swarasa-brand-decision   # claude
gh pr create --draft --base main --head docs/swarasa-brand-decision   # claude
gh pr ready 35   # claude
aws sts get-caller-identity --profile restaurant-platform-dev   # user  (expired token, triggered re-login)
aws sso login --profile restaurant-platform-dev   # user
aws sso login --profile swarasa-dev   # user  (new dev account, 091823298313)
aws sts get-caller-identity --profile swarasa-dev   # user
aws s3 mb s3://swarasa-tfstate-sr0626 --region us-east-1 --profile swarasa-dev   # user
aws s3api put-bucket-versioning --bucket swarasa-tfstate-sr0626 --versioning-configuration Status=Enabled --profile swarasa-dev   # user
aws dynamodb create-table --table-name swarasa-tfstate-lock --attribute-definitions AttributeName=LockID,AttributeType=S --key-schema AttributeName=LockID,KeyType=HASH --billing-mode PAY_PER_REQUEST --region us-east-1 --profile swarasa-dev   # user
git push -u origin chore/rebrand-swarasa   # claude  (25+ files, restaurant-platform -> swarasa; infra/backend.tf repointed at new bucket/table)
gh pr create --draft --base main --head chore/rebrand-swarasa   # claude
gh pr ready 36   # claude
git push -u origin docs/orchestrator-not-implemented   # claude
gh pr create --base main --head docs/orchestrator-not-implemented   # claude  (docs-only, opened ready per fast-path)
git push -u origin feature/logo-mark-wiring   # claude
gh pr create --draft --base main --head feature/logo-mark-wiring   # claude
git push origin feature/logo-mark-wiring   # claude  (STATUS.md wording fix, onto PR #38)
gh pr ready 38   # claude  (Architect approved PR #38)
aws sso login --profile swarasa-dev   # user  (expired token)
terraform init   # claude  (infra/, swarasa-dev backend)
terraform apply -target=module.ecr -auto-approve   # claude  (infra/, swarasa-dev)
aws ecr get-login-password --region us-east-1 --profile swarasa-dev   # claude  (piped to docker login)
docker pull public.ecr.aws/docker/library/hello-world:latest   # claude
docker tag public.ecr.aws/docker/library/hello-world:latest 091823298313.dkr.ecr.us-east-1.amazonaws.com/swarasa-api-dev:bootstrap   # claude
docker push 091823298313.dkr.ecr.us-east-1.amazonaws.com/swarasa-api-dev:bootstrap   # claude
git push -u origin devops/finalize-deploy-pipeline   # claude
gh pr create --draft --base main --head devops/finalize-deploy-pipeline   # claude
gh pr ready 39   # claude  (Architect self-review approved PR #39)
terraform plan   # user  (infra/, swarasa-dev)
terraform apply   # user  (infra/, swarasa-dev — failed: Amplify GitHub credentials, RDS subnet group + security group description non-ASCII)
aws rds describe-db-engine-versions --engine aurora-postgresql --profile swarasa-dev   # claude  (aurora-postgresql 15.4 deprecated by AWS)
terraform apply --auto-approve   # claude  (infra/, swarasa-dev — failed: state lock, concurrent with user's own run)
terraform apply   # user  (infra/, swarasa-dev — succeeded, 61 resources created)
gh secret set DEV_DEPLOY_ROLE_ARN --repo sr0626/swarasa --body "arn:aws:iam::091823298313:role/swarasa-github-actions-deploy-dev"   # user
git push -u origin infra/fix-apply-blockers   # claude  (Aurora engine_version 15.4->15.18, em-dash description fixes, found via the apply above)
gh pr create --draft --base main --head infra/fix-apply-blockers   # claude
gh pr ready 40   # claude  (Architect approved PR #40)
git push -u origin docs/status-infra-live   # claude
gh pr create --base main --head docs/status-infra-live   # claude  (docs-only, opened ready per fast-path)
git push -u origin docs/cmd-log-2026-09-15   # claude
gh pr create --base main --head docs/cmd-log-2026-09-15   # claude  (docs-only, opened ready per fast-path)
git push -u origin docs/project-plan-stale-frontend-qa-rows   # claude
gh pr create --base main --head docs/project-plan-stale-frontend-qa-rows   # claude  (docs-only, opened ready per fast-path; PR #43)
git push -u origin docs/orchestrator-mode-active   # claude
gh pr create --base main --head docs/orchestrator-mode-active   # claude  (PR #44 — incorrectly treated as docs-only fast-path; see PR #48's correction)
git push -u origin docs/project-plan-audit-round-2   # claude
gh pr create --base main --head docs/project-plan-audit-round-2   # claude  (docs-only, opened ready per fast-path; PR #45)
git push -u origin backend/dev-seed-script   # claude
gh pr create --draft --base main --head backend/dev-seed-script   # claude
gh pr ready 46   # claude  (Architect self-review approved PR #46)
git push -u origin backend/fix-database-url-secrets-wiring   # claude
gh pr create --draft --base main --head backend/fix-database-url-secrets-wiring   # claude
gh pr ready 47   # claude  (Architect self-review approved PR #47)
git push -u origin docs/claude-md-interaction-rules   # claude
gh pr create --draft --base main --head docs/claude-md-interaction-rules   # claude
gh pr ready 48   # claude  (Architect approved PR #48)
aws cognito-idp admin-create-user --user-pool-id us-east-1_w2387tOf6 --message-action SUPPRESS --profile swarasa-dev --region us-east-1   # claude  (x6: 2 owner, 2 manager, 1 admin, 1 registered_user test users)
aws cognito-idp admin-set-user-password --user-pool-id us-east-1_w2387tOf6 --password '***' --permanent --profile swarasa-dev --region us-east-1   # claude  (x6, one per test user)
aws cognito-idp admin-add-user-to-group --user-pool-id us-east-1_w2387tOf6 --profile swarasa-dev --region us-east-1   # claude  (x6, one per role group)
aws cognito-idp list-users --user-pool-id us-east-1_w2387tOf6 --profile swarasa-dev --region us-east-1   # claude  (verification — all 6 CONFIRMED)
```

## 2026-09-15
```bash
git push -u origin infra/fix-oidc-trust-policy-immutable-ids   # claude
gh pr create --draft --base main --head infra/fix-oidc-trust-policy-immutable-ids   # claude
gh pr ready 50   # claude  (Architect approved PR #50)
terraform apply --auto-approve   # user  (infra/, swarasa-dev — applied PR #50's OIDC trust policy fix)
aws iam get-role --role-name swarasa-github-actions-deploy-dev --profile swarasa-dev   # claude  (verify trust policy took effect)
gh run rerun 35001155382 --repo sr0626/swarasa   # claude  (re-test deploy-backend pipeline; x3 across this stretch as each new fix landed)
aws cloudtrail lookup-events --lookup-attributes AttributeKey=EventName,AttributeValue=AssumeRoleWithWebIdentity --profile swarasa-dev --region us-east-1   # claude  (root-cause diagnosis, x2)
gh api repos/sr0626/swarasa --jq '{owner_id: .owner.id, repo_id: .id}'   # claude  (verify numeric ids for OIDC sub claim)
git push -u origin devops/ecr-scan-explicit-trigger   # claude
gh pr create --draft --base main --head devops/ecr-scan-explicit-trigger   # claude
gh pr ready 52   # claude  (Architect approved PR #52)
git push -u origin frontend/admin-listings-management   # claude
gh pr create --base main --head frontend/admin-listings-management   # claude
git push -u origin frontend/sitemap-robots   # claude
gh pr create --base main --head frontend/sitemap-robots   # claude
git push -u origin docs/aws-commands-default-to-human   # claude
gh pr create --draft --base main --head docs/aws-commands-default-to-human   # claude
gh pr ready 54   # claude  (Architect approved PR #54)
terraform apply --auto-approve   # user  (infra/, swarasa-dev — applied PR #52's ecr:StartImageScan permission)
aws ecr describe-image-scan-findings --repository-name swarasa-api-dev --profile swarasa-dev --region us-east-1   # claude  (verify scan-trigger fix, x2)
git push -u origin infra/lambda-get-function-configuration-perm   # claude
gh pr create --draft --base main --head infra/lambda-get-function-configuration-perm   # claude
gh pr ready 55   # claude  (Architect approved PR #55)
terraform apply --auto-approve   # user  (infra/, swarasa-dev — applied PR #55's lambda:GetFunctionConfiguration permission; first attempt was a no-op against a stale local checkout, re-run after git pull)
aws lambda get-function --function-name swarasa-api-dev --profile swarasa-dev --region us-east-1   # claude  (confirm real backend image deployed)
curl https://qfqiaztj14.execute-api.us-east-1.amazonaws.com/cuisine-tags   # claude  (smoke test, repeated across this stretch as each fix landed)
aws logs tail /aws/lambda/swarasa-api-dev --profile swarasa-dev --region us-east-1   # claude  (diagnose live 500s, repeated across this stretch)
git push -u origin fix/204-response-model-none   # claude
gh pr create --draft --base main --head fix/204-response-model-none   # claude
gh pr ready 56   # claude  (Architect approved PR #56)
git push -u origin backend/alembic-upgrade-management-command   # claude
gh pr create --draft --base main --head backend/alembic-upgrade-management-command   # claude
gh pr ready 57   # claude  (Architect approved PR #57)
git push -u origin infra/per-env-tfvars   # claude
git push -u origin infra/ecr-tagged-image-lifecycle   # claude
```

## 2026-09-16
```bash
gh pr create --draft --base main --head infra/per-env-tfvars   # claude
gh pr ready 58   # claude  (Architect approved PR #58)
gh pr create --draft --base main --head infra/ecr-tagged-image-lifecycle   # claude
gh pr ready 59   # claude  (Architect approved PR #59)
terraform apply --auto-approve   # user  (infra/, swarasa-dev — failed once on a transient DynamoDB ResourceNotFoundException, succeeded on retry; applied PRs #58/#59)
aws dynamodb describe-table --table-name swarasa-tfstate-lock --profile swarasa-dev --region us-east-1   # claude  (diagnose the transient lock error)
aws ecr get-lifecycle-policy --repository-name swarasa-api-dev --profile swarasa-dev --region us-east-1   # claude  (verify PR #59 took effect)
git push -u origin fix/alembic-url-percent-escaping   # claude
gh pr create --draft --base main --head fix/alembic-url-percent-escaping   # claude
gh pr ready 60   # claude  (Architect approved PR #60)
git push -u origin fix/alembic-0002-revision-id-length   # claude
gh pr create --draft --base main --head fix/alembic-0002-revision-id-length   # claude
gh pr ready 61   # claude  (Architect approved PR #61)
git push -u origin fix/management-command-event-loop-leak   # claude
gh pr create --draft --base main --head fix/management-command-event-loop-leak   # claude
gh pr ready 62   # claude  (Architect approved PR #62)
aws sso login --profile swarasa-dev   # user  (expired session, repeated several times across this stretch)
aws lambda invoke --function-name swarasa-api-dev --cli-binary-format raw-in-base64-out --payload '{"_management_command": "alembic_upgrade"}' --profile swarasa-dev --region us-east-1 /tmp/migrate-output.json   # user  (x3 — first two failed: %-escaping bug then 0002 revision-id-too-long bug, each fixed and redeployed; third succeeded)
git push -u origin feature/phase1-s3-image-resize-pipeline   # claude
gh pr create --draft --base main --head feature/phase1-s3-image-resize-pipeline   # claude
gh pr ready 63   # claude  (Architect self-review approved PR #63)
terraform init -backend=false   # claude  (infra/, unintentional — made a real HeadObject call against swarasa-tfstate-sr0626 before being caught and stopped; see PR #63's Architect review comment)
```

<!-- Catch-up 2026-09-19 (orchestrator): entries for 2026-09-17..19 reconstructed from
PR/branch history (push, PR create, ready per PR #65-#135). User-run AWS commands on
09-17/09-18 were not captured at the time except where listed; 09-19 is complete for
this session. -->

## 2026-09-17
```bash
git push -u origin docs/project-plan-resync   # claude
gh pr create --base main --head docs/project-plan-resync   # claude  (PR #65)
git push -u origin feature/phase1-user-follow-api   # claude
gh pr create --draft --base main --head feature/phase1-user-follow-api   # claude  (PR #66)
gh pr ready 66   # claude  (Architect approved PR #66)
git push -u origin feature/phase1-lighthouse-ci   # claude
gh pr create --draft --base main --head feature/phase1-lighthouse-ci   # claude  (PR #67)
gh pr ready 67   # claude  (Architect approved PR #67)
git push -u origin docs/lighthouse-project-plan-update   # claude
gh pr create --base main --head docs/lighthouse-project-plan-update   # claude  (PR #68)
git push -u origin fix/frontend-package-lock-sync   # claude
gh pr create --draft --base main --head fix/frontend-package-lock-sync   # claude  (PR #69)
gh pr ready 69   # claude  (Architect approved PR #69)
git push -u origin feature/phase1-ccpa-data-export-deletion   # claude
gh pr create --draft --base main --head feature/phase1-ccpa-data-export-deletion   # claude  (PR #70)
gh pr ready 70   # claude  (Architect approved PR #70)
git push -u origin fix/frontend-amplify-tokenprovider-not-wired   # claude
gh pr create --draft --base main --head fix/frontend-amplify-tokenprovider-not-wired   # claude  (PR #71)
gh pr ready 71   # claude  (Architect approved PR #71)
git push -u origin feature/about-contact-legal-pages   # claude
gh pr create --draft --base main --head feature/about-contact-legal-pages   # claude  (PR #72)
gh pr ready 72   # claude  (Architect approved PR #72)
git push -u origin fix/frontend-dashboard-ssr-hang-apifetch-timeout   # claude
gh pr create --draft --base main --head fix/frontend-dashboard-ssr-hang-apifetch-timeout   # claude  (PR #73)
gh pr ready 73   # claude  (Architect approved PR #73)
git push -u origin feature/restaurant-bulk-import   # claude
gh pr create --draft --base main --head feature/restaurant-bulk-import   # claude  (PR #74)
gh pr ready 74   # claude  (Architect approved PR #74)
git push -u origin fix/frontend-cold-start-timeout   # claude
gh pr create --draft --base main --head fix/frontend-cold-start-timeout   # claude  (PR #75)
gh pr ready 75   # claude  (Architect approved PR #75)
git push -u origin docs/backlog-auth-owner-manager-admin-gaps   # claude
gh pr create --base main --head docs/backlog-auth-owner-manager-admin-gaps   # claude  (PR #76)
git push -u origin feature/owner-dashboard-tier-status-managers   # claude
gh pr create --draft --base main --head feature/owner-dashboard-tier-status-managers   # claude  (PR #77)
gh pr ready 77   # claude  (Architect approved PR #77)
git push -u origin feature/manager-location-discovery-admin-parity   # claude
gh pr create --draft --base main --head feature/manager-location-discovery-admin-parity   # claude  (PR #78)
gh pr ready 78   # claude  (Architect approved PR #78)
git push -u origin feature/auth-signup-forgot-password-remember-me   # claude
gh pr create --draft --base main --head feature/auth-signup-forgot-password-remember-me   # claude  (PR #79)
gh pr ready 79   # claude  (Architect approved PR #79)
git push -u origin feature/user-profile-page   # claude
gh pr create --draft --base main --head feature/user-profile-page   # claude  (PR #80)
gh pr ready 80   # claude  (Architect approved PR #80)
git push -u origin docs/backlog-signup-lambda-patch-me-scope   # claude
gh pr create --base main --head docs/backlog-signup-lambda-patch-me-scope   # claude  (PR #81)
git push -u origin docs/backlog-account-dropdown-logout   # claude
gh pr create --base main --head docs/backlog-account-dropdown-logout   # claude  (PR #82)
git push -u origin fix/patch-auth-me-role-scope   # claude
gh pr create --draft --base main --head fix/patch-auth-me-role-scope   # claude  (PR #83)
gh pr ready 83   # claude  (Architect approved PR #83)
git push -u origin infra/cognito-post-confirmation-role-lambda   # claude
gh pr create --draft --base main --head infra/cognito-post-confirmation-role-lambda   # claude  (PR #84)
gh pr ready 84   # claude  (Architect approved PR #84)
git push -u origin docs/backlog-password-toggle-verification-email   # claude
gh pr create --base main --head docs/backlog-password-toggle-verification-email   # claude  (PR #85)
git push -u origin feature/password-reveal-toggle   # claude
gh pr create --draft --base main --head feature/password-reveal-toggle   # claude  (PR #86)
gh pr ready 86   # claude  (Architect approved PR #86)
git push -u origin feature/delete-test-user-script   # claude
gh pr create --draft --base main --head feature/delete-test-user-script   # claude  (PR #87)
gh pr ready 87   # claude  (Architect approved PR #87)
git push -u origin feature/account-dropdown-logout   # claude
gh pr create --draft --base main --head feature/account-dropdown-logout   # claude  (PR #88)
gh pr ready 88   # claude  (Architect approved PR #88)
git push -u origin docs/bump-password-toggle-status   # claude
gh pr create --base main --head docs/bump-password-toggle-status   # claude  (PR #89)
git push -u origin docs/fix-stale-status-rows   # claude
gh pr create --base main --head docs/fix-stale-status-rows   # claude  (PR #90)
git push -u origin docs/defer-cognito-email-decision   # claude
gh pr create --base main --head docs/defer-cognito-email-decision   # claude  (PR #91)
git push -u origin fix/serialize-location-paid-status   # claude
gh pr create --draft --base main --head fix/serialize-location-paid-status   # claude  (PR #92)
gh pr ready 92   # claude  (Architect approved PR #92)
```

## 2026-09-18
```bash
git push -u origin feature/csv-bulk-import   # claude
gh pr create --draft --base main --head feature/csv-bulk-import   # claude  (PR #93)
gh pr ready 93   # claude  (Architect approved PR #93)
git push -u origin feature/owner-profile-phone-and-restaurants   # claude
gh pr create --draft --base main --head feature/owner-profile-phone-and-restaurants   # claude  (PR #94)
gh pr ready 94   # claude  (Architect approved PR #94)
git push -u origin infra/cognito-vpc-endpoint   # claude
gh pr create --draft --base main --head infra/cognito-vpc-endpoint   # claude  (PR #95)
gh pr ready 95   # claude  (Architect approved PR #95)
git push -u origin fix/cognito-vpc-endpoint-az-support   # claude
gh pr create --draft --base main --head fix/cognito-vpc-endpoint-az-support   # claude  (PR #96)
gh pr ready 96   # claude  (Architect approved PR #96)
git push -u origin fix/session-uses-id-token-not-access-token   # claude
gh pr create --draft --base main --head fix/session-uses-id-token-not-access-token   # claude  (PR #97)
gh pr ready 97   # claude  (Architect approved PR #97)
git push -u origin feature/add-header-to-authenticated-pages   # claude
gh pr create --draft --base main --head feature/add-header-to-authenticated-pages   # claude  (PR #98)
gh pr ready 98   # claude  (Architect approved PR #98)
git push -u origin feature/create-restaurant-brand-flow   # claude
gh pr create --draft --base main --head feature/create-restaurant-brand-flow   # claude  (PR #99)
gh pr ready 99   # claude  (Architect approved PR #99)
git push -u origin fix/async-engine-cross-loop-reuse   # claude
gh pr create --draft --base main --head fix/async-engine-cross-loop-reuse   # claude  (PR #100)
gh pr ready 100   # claude  (Architect approved PR #100)
git push -u origin fix/db-pool-exhaustion-and-brand-name   # claude
gh pr create --draft --base main --head fix/db-pool-exhaustion-and-brand-name   # claude  (PR #101)
gh pr ready 101   # claude  (Architect approved PR #101)
git push -u origin fix/dashboard-fetch-burst-and-homepage-copy   # claude
gh pr create --draft --base main --head fix/dashboard-fetch-burst-and-homepage-copy   # claude  (PR #102)
gh pr ready 102   # claude  (Architect approved PR #102)
git push -u origin feature/search-card-cover-photo-and-address   # claude
gh pr create --draft --base main --head feature/search-card-cover-photo-and-address   # claude  (PR #103)
gh pr ready 103   # claude  (Architect approved PR #103)
git push -u origin docs/homepage-backlog-paid-sort-deals-filters   # claude
gh pr create --base main --head docs/homepage-backlog-paid-sort-deals-filters   # claude  (PR #104)
git push -u origin fix/search-card-default-icon   # claude
gh pr create --draft --base main --head fix/search-card-default-icon   # claude  (PR #105)
gh pr ready 105   # claude  (Architect approved PR #105)
git push -u origin fix/search-card-branded-placeholder   # claude
gh pr create --draft --base main --head fix/search-card-branded-placeholder   # claude  (PR #106)
gh pr ready 106   # claude  (Architect approved PR #106)
git push -u origin fix/restaurant-page-null-description   # claude
gh pr create --draft --base main --head fix/restaurant-page-null-description   # claude  (PR #107)
gh pr ready 107   # claude  (Architect approved PR #107)
git push -u origin feature/topbar-sticky-owners-link   # claude
gh pr create --draft --base main --head feature/topbar-sticky-owners-link   # claude  (PR #108)
gh pr ready 108   # claude  (Architect approved PR #108)
git push -u origin feature/seed-taxonomy-command   # claude
gh pr create --draft --base main --head feature/seed-taxonomy-command   # claude  (PR #109)
gh pr ready 109   # claude  (Architect approved PR #109)
git push -u origin feature/tile-hours-icon-paid-sort   # claude
gh pr create --draft --base main --head feature/tile-hours-icon-paid-sort   # claude  (PR #110)
gh pr ready 110   # claude  (Architect approved PR #110)
git push -u origin docs/brd-v37-admin-discovery   # claude
gh pr create --base main --head docs/brd-v37-admin-discovery   # claude  (PR #111)
git push -u origin feature/fine-grained-tag-filter   # claude
gh pr create --draft --base main --head feature/fine-grained-tag-filter   # claude  (PR #112)
gh pr ready 112   # claude  (Architect approved PR #112)
git push -u origin feature/report-a-problem   # claude
gh pr create --draft --base main --head feature/report-a-problem   # claude  (PR #113)
gh pr ready 113   # claude  (Architect approved PR #113)
```

## 2026-09-19
```bash
git push -u origin fix/management-command-discard-stale-engine   # claude
gh pr create --draft --base main --head fix/management-command-discard-stale-engine   # claude  (PR #114)
gh pr ready 114   # claude  (Architect approved PR #114)
git push -u origin feature/seed-random-hours-command   # claude
gh pr create --draft --base main --head feature/seed-random-hours-command   # claude  (PR #115)
gh pr ready 115   # claude  (Architect approved PR #115)
git push -u origin fix/remove-for-owners-link   # claude
gh pr create --draft --base main --head fix/remove-for-owners-link   # claude  (PR #116)
gh pr ready 116   # claude  (Architect approved PR #116)
git push -u origin fix/default-image-hero-and-shared-component   # claude
gh pr create --draft --base main --head fix/default-image-hero-and-shared-component   # claude  (PR #117)
gh pr ready 117   # claude  (Architect approved PR #117)
git push -u origin feature/seed-random-phones-command   # claude
gh pr create --draft --base main --head feature/seed-random-phones-command   # claude  (PR #118)
gh pr ready 118   # claude  (Architect approved PR #118)
git push -u origin feature/edit-link-for-editors   # claude
gh pr create --draft --base main --head feature/edit-link-for-editors   # claude  (PR #119)
gh pr ready 119   # claude  (Architect approved PR #119)
git push -u origin docs/tracker-batched-like-cmd-log   # claude
gh pr create --base main --head docs/tracker-batched-like-cmd-log   # claude  (PR #120)
git push -u origin feature/dev-unclaim-restaurants   # claude
gh pr create --draft --base main --head feature/dev-unclaim-restaurants   # claude  (PR #121)
gh pr ready 121   # claude  (Architect approved PR #121)
git push -u origin feature/location-about-specialties   # claude
gh pr create --draft --base main --head feature/location-about-specialties   # claude  (PR #122)
gh pr ready 122   # claude  (Architect approved PR #122)
git push -u origin fix/topbar-swap-signin-and-add-restaurant   # claude
gh pr create --draft --base main --head fix/topbar-swap-signin-and-add-restaurant   # claude  (PR #123)
gh pr ready 123   # claude  (Architect approved PR #123)
git push -u origin feature/restaurant-profile-redesign   # claude
gh pr create --draft --base main --head feature/restaurant-profile-redesign   # claude  (PR #124)
gh pr ready 124   # claude  (Architect approved PR #124)
git push -u origin fix/add-restaurant-signin-redirect   # claude
gh pr create --draft --base main --head fix/add-restaurant-signin-redirect   # claude  (PR #125)
gh pr ready 125   # claude  (Architect approved PR #125)
git push -u origin fix/topbar-dark-pill-on-add-restaurant   # claude
gh pr create --draft --base main --head fix/topbar-dark-pill-on-add-restaurant   # claude  (PR #126)
gh pr ready 126   # claude  (Architect approved PR #126)
git push -u origin feature/search-by-name   # claude
gh pr create --draft --base main --head feature/search-by-name   # claude  (PR #127)
gh pr ready 127   # claude  (Architect approved PR #127)
git push -u origin fix/claim-submit-unhandled-error   # claude
gh pr create --draft --base main --head fix/claim-submit-unhandled-error   # claude  (PR #128)
gh pr ready 128   # claude  (Architect approved PR #128)
git push -u origin feature/admin-claims-queue   # claude
gh pr create --draft --base main --head feature/admin-claims-queue   # claude  (PR #129)
gh pr ready 129   # claude  (Architect approved PR #129)
git push -u origin feature/account-profile-redesign   # claude
gh pr create --draft --base main --head feature/account-profile-redesign   # claude  (PR #130)
gh pr ready 130   # claude  (Architect approved PR #130)
git push -u origin feature/admin-notifications   # claude
gh pr create --draft --base main --head feature/admin-notifications   # claude  (PR #131)
gh pr ready 131   # claude  (Architect approved PR #131)
git push -u origin feature/role-based-account-pages   # claude
gh pr create --draft --base main --head feature/role-based-account-pages   # claude  (PR #132)
gh pr ready 132   # claude  (Architect approved PR #132)
git push -u origin feature/pending-claim-and-hours-order   # claude
gh pr create --draft --base main --head feature/pending-claim-and-hours-order   # claude  (PR #133)
gh pr ready 133   # claude  (Architect approved PR #133)
git push -u origin fix/search-name-precision   # claude
gh pr create --draft --base main --head fix/search-name-precision   # claude  (PR #134)
gh pr ready 134   # claude  (Architect approved PR #134)
git push -u origin feature/search-filters-dropdown   # claude
gh pr create --draft --base main --head feature/search-filters-dropdown   # claude  (PR #135)
gh pr ready 135   # claude  (Architect approved PR #135)
git push -u origin feature/admin-sidebar-layout   # claude
gh pr create --draft --base main --head feature/admin-sidebar-layout   # claude  (PR #136)
gh pr ready 136   # claude  (Architect approved PR #136)
aws sso login --profile swarasa-dev   # user  (expired session, x2)
aws lambda invoke --function-name swarasa-api-dev ... '{"_management_command": "alembic_upgrade"}' --profile swarasa-dev --region us-east-1   # user  (0007 about/specialties)
aws lambda invoke --function-name swarasa-api-dev ... '{"_management_command": "seed_taxonomy"}' --profile swarasa-dev --region us-east-1   # user  (failed once on cross-loop engine bug, fixed by #114, then inserted 0 / already_present 63)
aws lambda invoke --function-name swarasa-api-dev ... '{"_management_command": "seed_random_hours"}' --profile swarasa-dev --region us-east-1   # user
aws lambda get-function --function-name swarasa-api-dev --profile swarasa-dev --region us-east-1   # user  (read deployed ImageUri)
python3 scripts/dev_unclaim_restaurants.py   # user  (aws lambda invoke dev_unclaim_restaurants: dera-grill, masala-wok-indian-asian-fare)
aws logs tail /aws/lambda/swarasa-api-dev --profile swarasa-dev --region us-east-1 --since 15m   # user  (claim-submit investigation; no errors)
```

## 2026-09-19 (later)
```bash
git push -u origin infra/api-lambda-cognito-add-user-to-group   # claude
git push -u origin feature/claim-approval-owner-group   # claude
git push -u origin feature/geocode-missing-locations   # claude
git push -u origin fix/no-cache-authenticated-fetch   # claude
git push -u origin feature/owner-console-layout   # claude
git push -u origin fix/geocode-script-unit-tokens   # claude
git push -u origin feature/add-restaurant-full-details   # claude
git push -u origin fix/geocode-script-census-primary   # claude
git push -u origin docs/scripts-guide   # claude
git push -u origin feature/owner-single-business-page   # claude
terraform plan -var-file=envs/dev.tfvars   # user  (infra/, swarasa-dev; first run showed no changes before #138 merged, second showed 1 in-place IAM update)
terraform apply -var-file=envs/dev.tfvars   # user  (infra/, swarasa-dev; api_lambda_custom policy: +AdminAddUserToGroup/AdminGetUser)
python3 scripts/geocode_missing_locations.py --dry-run   # user  (x several: 0/15 on old script, 429s, then 15/15 with Census)
python3 scripts/geocode_missing_locations.py   # user  (aws lambda invoke set_location_coordinates: updated 15)
```

## 2026-09-22
```bash
git push -u origin fix/desi-restaurant-copy   # claude
git push -u origin fix/account-menu-role-aware-links   # claude
git push -u origin fix/search-location-geocoding   # claude
git push -u origin feat/dev-seed-multi-city-and-short-users   # claude
git push -u origin feature/manager-caps-and-assignment-rules   # claude
git push -u origin feat/restaurant-page-back-link-and-tag-labels   # claude
git push -u origin fix/owner-console-hours-freshness-and-status   # claude
git push -u origin fix/csv-import-cuisine-type-dropped   # claude
git push -u origin feat/phone-required-field   # claude
git push -u origin feature/owner-audit-report   # claude
git push -u origin feat/follow-any-authenticated-role   # claude (PR #161, later closed unmerged)
git push -u origin feature/generic-user-display-name   # claude
git push -u origin feat/manager-console-redesign   # claude
git push -u origin infra/amplify-contact-email   # claude (merged as #150)
terraform plan -var-file=envs/dev.tfvars   # user  (infra/, swarasa-dev; contact_email in aws_amplify_app.frontend)
terraform apply -var-file=envs/dev.tfvars   # user
```

## 2026-09-22 (later)
```bash
git push -u origin infra/fix-plan-warnings   # claude
git push -u origin fix/ccpa-listing-report-coverage   # claude
git push -u origin feat/admin-claims-show-owner-group-status   # claude
git push -u origin fix/data-export-type-listing-reports   # claude
git push -u origin feature/restaurant-status-lifecycle   # claude (finished + pushed to the existing WIP branch)
git push -u origin feat/follow-button-tiles-and-detail   # claude
terraform -chdir=infra init   # user
terraform -chdir=infra plan -var-file=envs/dev.tfvars   # user (x2 -- contact_email pickup, then S3 lifecycle filter)
terraform -chdir=infra apply -var-file=envs/dev.tfvars   # user (x2)
python3 scripts/list_users.py   # user
aws sso login --profile swarasa-dev   # user (expired session)
```

## 2026-09-23
```bash
git push -u origin fix/follow-icon-position-bug   # claude
git push -u origin feat/owner-preview-registered-user-view   # claude
git push -u origin feat/follower-count-owner-dashboard   # claude
git push -u origin feat/manager-activity-feed-and-owner-scope   # claude
git push -u origin fix/delete-listing-dead-end   # claude
git push -u origin feat/admin-listings-filters   # claude
git push -u origin fix/console-closed-now-label   # claude
git push -u origin feat/admin-tile-follower-count   # claude
git push -u origin feat/registered-user-count   # claude
git push -u origin feat/admin-platform-reports   # claude
git push -u origin fix/manager-location-name-and-copy   # claude
git push -u origin fix/manager-photo-upload-failure   # claude
git push -u origin feat/admin-registered-users-report   # claude
git push -u origin feature/deals-engine-backend   # claude
git push -u origin docs/deals-policy-conflict-resolution   # claude
git push -u origin infra/deal-expiry-lambda-packaging   # claude
git push -u origin fix/alembic-merge-0009-heads   # claude
git push -u origin feature/deals-engine-frontend   # claude
git push -u origin docs/brd-v38-current-functionality   # claude
git push -u origin docs/wave5-tracker-status-cmdlog   # claude
git push -u origin feat/admin-owners-report   # claude
git push -u origin feat/soft-delete-listing   # claude
git push -u origin feat/lock-display-name   # claude
git push -u origin feat/user-activity-tracking   # claude
git push -u origin docs/wave6-tracker-status-cmdlog   # claude
git push -u origin docs/decisions-wave6   # claude
git push -u origin fix/ccpa-user-profile-coverage   # claude
git push -u origin docs/wave7-tracker-status-cmdlog   # claude
git push -u origin docs/decisions-ccpa-profile   # claude
aws sso login --profile swarasa-dev   # user  (expired session, x2)
aws sts get-caller-identity --profile swarasa-dev   # user  (first run in the wrong account 044336301301, no effect; then the correct account 091823298313)
aws ecr describe-images --repository-name swarasa-api-dev --profile swarasa-dev --region us-east-1 --query 'sort_by(imageDetails,&imagePushedAt)[-1].{tag:imageTags,pushedAt:imagePushedAt}'   # user
aws lambda get-function --function-name swarasa-api-dev --profile swarasa-dev --region us-east-1 --query 'Code.ImageUri' --output text   # user
terraform init -reconfigure   # user  (infra/)
terraform plan -var-file=envs/dev.tfvars -var="lambda_image_uri=<swarasa-api-dev image URI>"   # user  (infra/, swarasa-dev; x3)
terraform apply -var-file=envs/dev.tfvars -var="lambda_image_uri=<swarasa-api-dev image URI>"   # user  (infra/, swarasa-dev; 1 added, 3 changed, 1 destroyed: deal_expiry Lambda replaced zip -> container image)
aws lambda invoke --function-name swarasa-deal-expiry-dev --profile swarasa-dev --region us-east-1 ...   # user  (x3; first two failed -- old code, then `deal` table not yet migrated; third succeeded, {"expired": 0})
aws logs tail /aws/lambda/swarasa-deal-expiry-dev --profile swarasa-dev --region us-east-1 ...   # user  (x2)
aws lambda invoke --function-name swarasa-api-dev --payload '{"_management_command": "alembic_upgrade"}' --profile swarasa-dev --region us-east-1 ...   # user  (x3; first failed 'Multiple head revisions' before #190 deployed, then applied 0009_deal + 0009_user_profile_last_seen_at + 0010, then no-op; order of the deal-expiry/alembic invokes above is approximate)
python3 scripts/create_test_users.py   # user
python3 scripts/list_users.py   # user
aws lambda invoke --function-name swarasa-api-dev --payload '{"_management_command": "alembic_upgrade"}' --profile swarasa-dev --region us-east-1 ...   # user  (x2 more: after the #193 deploy applying 0011_brand_deleted_at, after the #194 deploy applying 0012_user_activity_event)
git fetch --prune && git branch -r --merged origin/main | grep -v 'origin/HEAD\|origin/main$' | sed 's#^ *origin/##' | xargs -n 40 git push origin --delete   # user  (cleanup of the 200+ merged remote branches)
git push origin --delete docs/backlog-auth-owner-manager-admin-gaps docs/bump-password-toggle-status feat/follow-any-authenticated-role   # user  (3 leftover branches)
gh api -X PATCH repos/sr0626/swarasa -F delete_branch_on_merge=true   # claude  (enable "Automatically delete head branches")
```

## 2026-09-24
```bash
git push -u origin feat/deal-badge-signup-link   # claude
git push -u origin feat/manager-deals-button   # claude
git push -u origin feat/deals-other-active-and-dates   # claude
git push -u origin feat/favourites-deals-today   # claude
git push -u origin fix/deals-card-days-only   # claude
git push -u origin feat/menu-engine   # claude
git push -u origin docs/wave8-tracker-status-cmdlog   # claude
aws lambda invoke --function-name swarasa-api-dev --payload '{"_management_command": "alembic_upgrade"}' --profile swarasa-dev --region us-east-1 ...   # user  (after the #206 deploy, applying 0013_menu)
```

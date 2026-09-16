output "api_lambda_role_arn" {
  description = "IAM execution role ARN for the API Lambda"
  value       = aws_iam_role.api_lambda.arn
}

output "api_lambda_role_name" {
  description = "IAM execution role name for the API Lambda"
  value       = aws_iam_role.api_lambda.name
}

output "deal_expiry_lambda_role_arn" {
  description = "IAM execution role ARN for the deal-expiry Lambda"
  value       = aws_iam_role.deal_expiry_lambda.arn
}

output "deal_expiry_lambda_role_name" {
  description = "IAM execution role name for the deal-expiry Lambda"
  value       = aws_iam_role.deal_expiry_lambda.name
}

output "github_actions_role_arn" {
  description = "IAM role ARN DevOps's GitHub Actions pipeline assumes via OIDC (GitHub secret DEV_DEPLOY_ROLE_ARN — see devops/CLAUDE.md)"
  value       = aws_iam_role.github_actions_deploy.arn
}

output "resize_lambda_role_arn" {
  description = "IAM execution role ARN for the resize Lambda"
  value       = aws_iam_role.resize_lambda.arn
}

output "resize_lambda_role_name" {
  description = "IAM execution role name for the resize Lambda"
  value       = aws_iam_role.resize_lambda.name
}

output "github_actions_resize_role_arn" {
  description = "IAM role ARN DevOps's resize-Lambda GitHub Actions pipeline assumes via OIDC (GitHub secret DEV_DEPLOY_RESIZE_ROLE_ARN — see devops/CLAUDE.md and .github/workflows/deploy-resize.yml)"
  value       = aws_iam_role.github_actions_deploy_resize.arn
}

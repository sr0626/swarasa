output "user_pool_id" {
  description = "Cognito User Pool ID"
  value       = aws_cognito_user_pool.main.id
}

output "user_pool_arn" {
  description = "Cognito User Pool ARN"
  value       = aws_cognito_user_pool.main.arn
}

output "client_id" {
  description = "Cognito web app client ID (no secret — safe for frontend)"
  value       = aws_cognito_user_pool_client.web.id
}

output "user_pool_endpoint" {
  description = "Cognito User Pool endpoint (used as JWT issuer)"
  value       = aws_cognito_user_pool.main.endpoint
}

output "post_confirmation_lambda_arn" {
  description = "ARN of the post-confirmation Lambda trigger (assigns sign-up role to pool group)"
  value       = aws_lambda_function.post_confirmation.arn
}

output "post_confirmation_lambda_function_name" {
  description = "Function name of the post-confirmation Lambda trigger"
  value       = aws_lambda_function.post_confirmation.function_name
}

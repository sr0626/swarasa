output "resize_lambda_arn" {
  description = "Resize Lambda function ARN"
  value       = aws_lambda_function.resize.arn
}

output "resize_lambda_name" {
  description = "Resize Lambda function name"
  value       = aws_lambda_function.resize.function_name
}

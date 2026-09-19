variable "env" {
  description = "Environment name: dev, staging, prod"
  type        = string
}

variable "project" {
  description = "Project name for tagging"
  type        = string
  default     = "swarasa"
}

variable "phase" {
  description = "Project phase for tagging"
  type        = string
  default     = "phase1"
}

variable "github_repo_url" {
  description = "GitHub HTTPS URL of the monorepo"
  type        = string
}

variable "github_access_token" {
  description = "GitHub personal access token for Amplify repo access"
  type        = string
  sensitive   = true
}

variable "api_gateway_url" {
  description = "API Gateway invoke URL passed as NEXT_PUBLIC_API_URL"
  type        = string
}

variable "cognito_user_pool_id" {
  description = "Cognito User Pool ID passed as NEXT_PUBLIC_COGNITO_USER_POOL_ID"
  type        = string
}

variable "cognito_client_id" {
  description = "Cognito app client ID passed as NEXT_PUBLIC_COGNITO_CLIENT_ID"
  type        = string
}

variable "cloudfront_url" {
  description = "CloudFront media base URL passed as NEXT_PUBLIC_MEDIA_URL"
  type        = string
}

variable "contact_email" {
  description = "Public contact email passed as NEXT_PUBLIC_CONTACT_EMAIL (Contact/Terms pages, geocoder User-Agent). Empty = not set."
  type        = string
  default     = ""
}

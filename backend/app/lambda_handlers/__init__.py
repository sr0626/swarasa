"""Lambda entry points that are NOT part of the FastAPI/Mangum app —
triggered directly by an AWS event source (S3, Cognito, EventBridge, etc.)
rather than API Gateway. Each handler here gets its own IAM role and its
own packaging choice (container image for a handler with compiled
dependencies like resize_photo's Pillow, plain zip for a handler with only
stdlib/boto3 dependencies like cognito_post_confirmation — see each
handler's own module docstring and its infra module's comments for the
specific reasoning); see backend/CLAUDE.md and infra/CLAUDE.md.
"""

"""Lambda entry points that are NOT part of the FastAPI/Mangum app —
triggered directly by an AWS event source (S3, EventBridge, etc.) rather
than API Gateway. Each handler here gets its own container image and its
own IAM role; see backend/CLAUDE.md and infra/CLAUDE.md.
"""

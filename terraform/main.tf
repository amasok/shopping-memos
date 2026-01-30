# =============================================================================
# Terraform Configuration for Shopping Memos
# =============================================================================

terraform {
  required_version = ">= 1.0.0"

  required_providers {
    vercel = {
      source  = "vercel/vercel"
      version = "~> 2.0"
    }
  }
}

# -----------------------------------------------------------------------------
# Vercel Provider
# -----------------------------------------------------------------------------
# 認証: VERCEL_API_TOKEN 環境変数を使用
# export VERCEL_API_TOKEN="your-token-here"

provider "vercel" {
  # API token is read from VERCEL_API_TOKEN environment variable
}

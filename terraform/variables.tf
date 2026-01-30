# =============================================================================
# Variables
# =============================================================================

# -----------------------------------------------------------------------------
# Vercel Project
# -----------------------------------------------------------------------------

variable "project_name" {
  description = "Vercel project name"
  type        = string
  default     = "shopping-memos"
}

variable "github_repo" {
  description = "GitHub repository in format 'owner/repo'"
  type        = string
  default     = "amasok/shopping-memos"
}

variable "framework" {
  description = "Framework preset for the project"
  type        = string
  default     = "nextjs"
}

variable "root_directory" {
  description = "Root directory of the project"
  type        = string
  default     = null
}

# -----------------------------------------------------------------------------
# Environment Variables (Sensitive) - Vercel ダッシュボードで管理
# -----------------------------------------------------------------------------
# 以下のシークレットは Terraform で管理せず、Vercel ダッシュボードで直接設定:
#
#   - NEXTAUTH_SECRET     : セッション暗号化キー
#   - GOOGLE_CLIENT_ID    : Google OAuth クライアントID
#   - GOOGLE_CLIENT_SECRET: Google OAuth シークレット
#
# 理由: tfstate ファイルに平文で保存されるリスクを回避
# 設定場所: Vercel Dashboard > Project > Settings > Environment Variables
# -----------------------------------------------------------------------------

# -----------------------------------------------------------------------------
# Domain (Optional - Future Implementation)
# -----------------------------------------------------------------------------
# カスタムドメイン機能は将来実装予定
# 現時点では Vercel のデフォルトドメインを使用
#
# variable "custom_domain" {
#   description = "Custom domain for production (optional)"
#   type        = string
#   default     = null
# }

# =============================================================================
# Vercel Resources
# =============================================================================

# -----------------------------------------------------------------------------
# Project
# -----------------------------------------------------------------------------

resource "vercel_project" "app" {
  name      = var.project_name
  framework = var.framework

  git_repository = {
    type              = "github"
    repo              = var.github_repo
    production_branch = "main"
  }

  root_directory = var.root_directory

  # ビルド設定
  build_command    = "npm run build"
  install_command  = "npm ci"
  output_directory = ".next"

  # 自動デプロイ設定
  automatically_expose_system_environment_variables = true
}

# -----------------------------------------------------------------------------
# Environment Variables - Non-Sensitive Only
# -----------------------------------------------------------------------------
# シークレット（NEXTAUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET）は
# Vercel ダッシュボードで直接設定してください。
# 理由: tfstate に平文で保存されるリスクを回避するため
#
# 設定場所: Vercel Dashboard > Project > Settings > Environment Variables
# -----------------------------------------------------------------------------

resource "vercel_project_environment_variable" "nextauth_url_production" {
  project_id = vercel_project.app.id
  key        = "NEXTAUTH_URL"
  value      = "https://${var.project_name}.vercel.app"
  target     = ["production"]
}

resource "vercel_project_environment_variable" "nextauth_url_preview" {
  project_id = vercel_project.app.id
  key        = "NEXTAUTH_URL"
  value      = "https://${var.project_name}-git-develop-${replace(var.github_repo, "/", "-")}.vercel.app"
  target     = ["preview"]
}

# -----------------------------------------------------------------------------
# Database URL Alias
# Vercel Postgres creates POSTGRES_URL, but our app uses DATABASE_URL
# -----------------------------------------------------------------------------

resource "vercel_project_environment_variable" "database_url_alias" {
  project_id = vercel_project.app.id
  key        = "DATABASE_URL"
  # Vercel Postgres が設定する POSTGRES_URL を参照
  # Note: Vercel Postgres作成後に手動で設定するか、
  # Vercelダッシュボードで POSTGRES_URL の値をコピーして設定
  value  = "$POSTGRES_URL"
  target = ["production", "preview"]
}


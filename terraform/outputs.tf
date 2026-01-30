# =============================================================================
# Outputs
# =============================================================================

output "project_id" {
  description = "Vercel project ID"
  value       = vercel_project.app.id
}

output "project_name" {
  description = "Vercel project name"
  value       = vercel_project.app.name
}

output "production_url" {
  description = "Production deployment URL"
  value       = "https://${var.project_name}.vercel.app"
}

output "preview_url_pattern" {
  description = "Preview deployment URL pattern"
  value       = "https://${var.project_name}-git-<branch>-${replace(var.github_repo, "/", "-")}.vercel.app"
}

output "google_oauth_redirect_uris" {
  description = "Google OAuth redirect URIs to configure in Google Cloud Console"
  value = [
    "https://${var.project_name}.vercel.app/api/auth/callback/google",
    "https://${var.project_name}-git-develop-${replace(var.github_repo, "/", "-")}.vercel.app/api/auth/callback/google",
  ]
}

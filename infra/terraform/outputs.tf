output "service_url" {
  description = "Set this as SYNAP_SERVICE_URL and as the PWA's backend base URL."
  value       = google_cloud_run_v2_service.backend.uri
}

output "audio_bucket" {
  value = google_storage_bucket.audio.name
}

output "api_service_account" {
  value = google_service_account.api.email
}

output "tasks_invoker_service_account" {
  value = google_service_account.tasks_invoker.email
}

output "kek" {
  description = "The key that wraps every user DEK. Destroying it destroys all user data."
  value       = google_kms_crypto_key.user_kek.id
}

output "gemini_secret_id" {
  description = "Add your AI Studio key: gcloud secrets versions add synap-gemini-api-key --data-file=-"
  value       = google_secret_manager_secret.gemini_api_key.secret_id
}

output "next_steps" {
  value = <<-EOT
    1. Put your Gemini AI Studio key in Secret Manager:
         printf '%s' "$GEMINI_API_KEY" | gcloud secrets versions add ${google_secret_manager_secret.gemini_api_key.secret_id} --data-file=- --project=${var.project_id}
    2. Redeploy so the service picks up SYNAP_SERVICE_URL:
         gcloud run services update ${google_cloud_run_v2_service.backend.name} --region=${var.region} --update-env-vars=SYNAP_SERVICE_URL=${google_cloud_run_v2_service.backend.uri}
    3. Point the PWA at it: set SYNAP_BACKEND_URL in synap-backend.js, or configure it in Settings.
  EOT
}

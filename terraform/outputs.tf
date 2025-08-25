# Output the Cloud Function URL
output "function_url" {
  description = "URL of the Cloud Function (webhook endpoint)"
  value       = google_cloudfunctions_function.line_webhook.https_trigger_url
}

# Output the project ID
output "project_id" {
  description = "The GCP project ID"
  value       = var.project_id
}

# Output the Firestore database
output "firestore_database" {
  description = "The Firestore database name"
  value       = google_firestore_database.database.name
}
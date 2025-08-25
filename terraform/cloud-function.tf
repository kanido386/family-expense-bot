# Create a storage bucket for Cloud Function source code
resource "google_storage_bucket" "function_bucket" {
  name     = "${var.project_id}-family-expense-bot-source"
  location = var.region
  
  depends_on = [google_project_service.cloud_functions_api]
}

# Create a zip file of the source code
data "archive_file" "function_source" {
  type        = "zip"
  source_dir  = "../"
  output_path = "../function-source.zip"
  excludes    = [
    "node_modules", 
    ".env",
    ".env.local",
    "*.log",
    "terraform/",
    ".git/",
    "test.js",
    "test-webhook.js",
    ".terraform/",
    "*.tfstate*",
    "terraform.tfvars"
  ]
}

# Upload the function source code to the bucket
resource "google_storage_bucket_object" "function_source_object" {
  name   = "function-source.zip"
  bucket = google_storage_bucket.function_bucket.name
  source = data.archive_file.function_source.output_path
}

# Create Firestore database
resource "google_firestore_database" "database" {
  project     = var.project_id
  name        = "(default)"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"
  
  depends_on = [google_project_service.firestore_api]
}

# Create Cloud Function
resource "google_cloudfunctions_function" "line_webhook" {
  name        = var.service_name
  description = "LINE Bot for family expense tracking"
  runtime     = "nodejs20"
  
  available_memory_mb   = 256
  source_archive_bucket = google_storage_bucket.function_bucket.name
  source_archive_object = google_storage_bucket_object.function_source_object.name
  trigger_http = true
  entry_point = "lineWebhook"
  
  environment_variables = {
    CHANNEL_ACCESS_TOKEN = var.channel_access_token
    CHANNEL_SECRET      = var.channel_secret
    NODE_ENV           = "production"
  }
  
  depends_on = [
    google_project_service.cloud_functions_api,
    google_project_service.cloud_build_api,
    google_firestore_database.database
  ]
}

# Make the function publicly accessible for LINE webhooks
resource "google_cloudfunctions_function_iam_member" "invoker" {
  project        = google_cloudfunctions_function.line_webhook.project
  region         = google_cloudfunctions_function.line_webhook.region
  cloud_function = google_cloudfunctions_function.line_webhook.name

  role   = "roles/cloudfunctions.invoker"
  member = "allUsers"
}
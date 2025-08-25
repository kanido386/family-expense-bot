# Enable required APIs
resource "google_project_service" "cloud_functions_api" {
  service = "cloudfunctions.googleapis.com"
  
  disable_dependent_services = true
  disable_on_destroy        = false
}

resource "google_project_service" "firestore_api" {
  service = "firestore.googleapis.com"
  
  disable_dependent_services = true
  disable_on_destroy        = false
}

resource "google_project_service" "cloud_build_api" {
  service = "cloudbuild.googleapis.com"
  
  disable_dependent_services = true
  disable_on_destroy        = false
}
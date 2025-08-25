# Configure the Google Cloud Provider
terraform {
  required_version = ">= 1.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# Variables
variable "project_id" {
  description = "The GCP project ID"
  type        = string
}

variable "region" {
  description = "The GCP region"
  type        = string
  default     = "asia-east1"
}

variable "service_name" {
  description = "The name of the Cloud Run service"
  type        = string
  default     = "family-expense-bot"
}

variable "channel_access_token" {
  description = "LINE Channel Access Token"
  type        = string
  sensitive   = true
}

variable "channel_secret" {
  description = "LINE Channel Secret"
  type        = string
  sensitive   = true
}
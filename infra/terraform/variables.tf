# All input variables for the IONOS + Cloudflare stack. Every one is
# required at `plan`/`apply` time; defaulted to empty strings here so
# `terraform validate` passes without a `terraform.tfvars` file
# committed to the repo (which would leak org-specific IDs).

variable "environment" {
  description = "Deployment environment name (staging, production). Used as a tag/label prefix."
  type        = string
}

variable "ionos_datacenter_id" {
  description = "Pre-existing IONOS Datacenter UUID to attach resources to."
  type        = string
  default     = ""
}

variable "ionos_location" {
  description = "IONOS location code (e.g. de/fra for Frankfurt, de/txl for Berlin)."
  type        = string
  default     = "de/fra"
}

variable "postgres_admin_password" {
  description = "Superuser password for the managed Postgres cluster. Comes from the secret store."
  type        = string
  default     = ""
  sensitive   = true
}

variable "postgres_display_name" {
  description = "Human-friendly cluster name shown in the IONOS console."
  type        = string
  default     = "elvoria-postgres"
}

variable "k8s_cluster_name" {
  description = "Managed Kubernetes cluster name."
  type        = string
  default     = "elvoria-k8s"
}

variable "k8s_version" {
  description = "Kubernetes minor version (IONOS-supported releases only)."
  type        = string
  default     = "1.30"
}

variable "media_bucket_name" {
  description = "Object storage bucket for tenant media uploads (P0-5 / P1-14)."
  type        = string
  default     = "elvoria-media"
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID (from the dashboard, not the zone name)."
  type        = string
  default     = ""
}

variable "public_hostname" {
  description = "Public hostname for the CDN + LB (e.g. elvoria.eu)."
  type        = string
  default     = "elvoria.example"
}

variable "origin_hostname" {
  description = "Hostname the CDN points at — usually the LB's public DNS entry on IONOS."
  type        = string
  default     = ""
}

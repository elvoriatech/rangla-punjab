# P0-11: infra stubs (no `apply` from the loop). Provider versions pinned
# so `terraform init` is reproducible; state backend is intentionally
# unset — the human wires remote state (IONOS S3-compatible bucket or
# Terraform Cloud) at deploy time and never puts credentials in this
# file. `terraform validate` passes as-is; `plan`/`apply` require the
# variables in `variables.tf` to be populated from the secret store.

terraform {
  required_version = ">= 1.6"
  required_providers {
    ionoscloud = {
      source  = "ionos-cloud/ionoscloud"
      version = "~> 6.5"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }
}

provider "ionoscloud" {
  # Credentials via IONOS_USERNAME + IONOS_PASSWORD, or IONOS_TOKEN.
  # Never hard-code the token here — the CI/deploy pipeline injects it.
}

provider "cloudflare" {
  # API token via CLOUDFLARE_API_TOKEN. Never hard-code.
}

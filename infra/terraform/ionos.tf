# IONOS-managed resources for the Elvoria stack. Every resource is a
# stub in the same sense as the rest of P0-11 — the fields it needs are
# declared, the values come from `variables.tf`. `terraform validate`
# checks the schema against the pinned provider version. Nothing is
# provisioned from the loop; the human runs `plan`/`apply` from the
# deploy pipeline with the secret-store credentials in scope.

# ---- Datacenter ------------------------------------------------------
# A single datacenter is enough for Phase 3 exit; multi-region comes
# later. Falls back to a new datacenter when `var.ionos_datacenter_id`
# is empty (the default in `variables.tf`) so `plan` on a clean org
# still gets a valid graph.

resource "ionoscloud_datacenter" "elvoria" {
  count       = var.ionos_datacenter_id == "" ? 1 : 0
  name        = "elvoria-${var.environment}"
  location    = var.ionos_location
  description = "Elvoria menu platform — ${var.environment}"
}

locals {
  datacenter_id = coalesce(
    var.ionos_datacenter_id,
    try(ionoscloud_datacenter.elvoria[0].id, ""),
  )
}

# ---- Managed Postgres (DB) ------------------------------------------

resource "ionoscloud_pg_cluster" "primary" {
  postgres_version = "16"
  instances        = 1
  cores            = 2
  ram              = 4096
  storage_size     = 20480
  storage_type     = "SSD Standard"
  display_name     = var.postgres_display_name
  location         = var.ionos_location

  connections {
    datacenter_id = local.datacenter_id
    lan_id        = ionoscloud_lan.private.id
    cidr          = "10.0.1.100/24"
  }

  credentials {
    username = "elvoria"
    password = var.postgres_admin_password
  }

  synchronization_mode = "STRICTLY_SYNCHRONOUS"

  maintenance_window {
    day_of_the_week = "Sunday"
    time            = "03:00:00"
  }
}

# ---- Object storage (P0-5 / P1-14) ----------------------------------
# The IONOS provider maps buckets through the AWS-compatible S3 endpoint;
# resource is `ionoscloud_s3_bucket` in ≥ v6.5.

resource "ionoscloud_s3_bucket" "media" {
  name   = var.media_bucket_name
  region = "de"
}

# ---- Compute: Managed Kubernetes (D2 decision) ----------------------

resource "ionoscloud_k8s_cluster" "elvoria" {
  name        = var.k8s_cluster_name
  k8s_version = var.k8s_version

  maintenance_window {
    day_of_the_week = "Sunday"
    time            = "04:00:00"
  }
}

resource "ionoscloud_k8s_node_pool" "workers" {
  name              = "${var.k8s_cluster_name}-workers"
  datacenter_id     = local.datacenter_id
  k8s_cluster_id    = ionoscloud_k8s_cluster.elvoria.id
  k8s_version       = var.k8s_version
  node_count        = 3
  cores_count       = 2
  ram_size          = 4096
  availability_zone = "AUTO"
  cpu_family        = "INTEL_SKYLAKE"
  storage_size      = 40
  storage_type      = "SSD"

  maintenance_window {
    day_of_the_week = "Sunday"
    time            = "05:00:00"
  }
}

# ---- Networking: LAN + LB ------------------------------------------

resource "ionoscloud_lan" "private" {
  datacenter_id = local.datacenter_id
  name          = "elvoria-private-${var.environment}"
  public        = false
}

resource "ionoscloud_ipblock" "public" {
  location = var.ionos_location
  size     = 1
  name     = "elvoria-lb-${var.environment}"
}

resource "ionoscloud_networkloadbalancer" "public" {
  datacenter_id = local.datacenter_id
  name          = "elvoria-lb-${var.environment}"
  listener_lan  = ionoscloud_lan.private.id
  target_lan    = ionoscloud_lan.private.id
  ips           = ionoscloud_ipblock.public.ips
}

# ---- DNS ------------------------------------------------------------
# IONOS DNS is used as the authoritative zone; Cloudflare (in
# `cloudflare.tf`) proxies for the CDN. Delegation from the registrar
# points at Cloudflare's NS servers.

resource "ionoscloud_dns_zone" "public" {
  name        = var.public_hostname
  description = "Elvoria menu platform — ${var.environment}"
  enabled     = true
}

output "datacenter_id" {
  value       = local.datacenter_id
  description = "IONOS datacenter UUID the stack lives in."
}

output "postgres_dns" {
  value       = try(ionoscloud_pg_cluster.primary.dns_name, "")
  description = "Managed Postgres DNS name — feeds APP_DATABASE_URL after `plan`/`apply`."
}

output "k8s_cluster_id" {
  value       = ionoscloud_k8s_cluster.elvoria.id
  description = "Managed Kubernetes cluster id — pass to kubeconfig fetch."
}

output "load_balancer_ip" {
  value       = try(ionoscloud_ipblock.public.ips[0], "")
  description = "Public IP address bound to the network load balancer."
}

output "media_bucket_name" {
  value       = ionoscloud_s3_bucket.media.name
  description = "Object storage bucket for tenant media (S3_BUCKET in the app env)."
}

# Cloudflare in front of the IONOS origin (roadmap §2). Two-layer split:
# IONOS holds the authoritative DNS zone (see `ionos.tf`); Cloudflare
# handles the CDN + WAF + rate-limits for the public menu route. The
# registrar delegates NS to Cloudflare, and Cloudflare's record set
# points at the IONOS load balancer (`var.origin_hostname`).

resource "cloudflare_record" "root" {
  zone_id = var.cloudflare_zone_id
  name    = "@"
  content = var.origin_hostname
  type    = "CNAME"
  proxied = true
  ttl     = 1
  comment = "elvoria — public menu apex, proxied through Cloudflare"
}

resource "cloudflare_record" "www" {
  zone_id = var.cloudflare_zone_id
  name    = "www"
  content = var.public_hostname
  type    = "CNAME"
  proxied = true
  ttl     = 1
  comment = "elvoria — www → apex"
}

# Aggressive caching on the public menu route; the app already sets
# long-TTL cache headers on `/r/[slug]` (P0-8) and no-store on preview
# URLs, so Cloudflare just needs to honour origin headers.
resource "cloudflare_ruleset" "cache_public_menus" {
  zone_id     = var.cloudflare_zone_id
  name        = "cache-public-menus"
  description = "Honour origin cache-control on /r/*"
  kind        = "zone"
  phase       = "http_request_cache_settings"

  rules {
    action      = "set_cache_settings"
    description = "Respect origin cache headers on the public menu route"
    enabled     = true
    expression  = "starts_with(http.request.uri.path, \"/r/\")"
    action_parameters {
      cache = true
      edge_ttl {
        mode = "respect_origin"
      }
      browser_ttl {
        mode = "respect_origin"
      }
    }
  }
}

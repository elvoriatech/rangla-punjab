/**
 * Trust boundary: in production Guesto sits behind Cloudflare, which strips
 * any inbound `X-Forwarded-For` header and prepends its own view of the
 * client IP. That means the *leftmost* XFF entry is the real remote peer,
 * not a client-supplied lie. Cloudflare also mirrors the same value on
 * `CF-Connecting-IP`, so we prefer that when present because it does not
 * grow through hop-by-hop proxies.
 *
 * Anywhere else (`pnpm dev`, curl straight at the origin), XFF is
 * spoofable. Rate limits keyed by "IP" are only as trustworthy as the
 * frontline proxy, and we accept that in dev because there is no attacker.
 */
export function clientIp(request: Request): string {
  const cf = request.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const [leftmost] = xff.split(",");
    if (leftmost) return leftmost.trim();
  }
  // No proxy in front → we're on `pnpm dev` or a test. Use a stable
  // placeholder so limiter keys stay meaningful.
  return "0.0.0.0";
}

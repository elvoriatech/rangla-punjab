# resto — Deploy on IONOS VPS (white-label, one client per deploy)

Production layout this repo expects:

```
Internet → (optional Cloudflare) → App VPS :443 Caddy → Docker app :3000
                                        │
                                        ├── Redis (Docker)
                                        ├── uploads volume (menu photos)
                                        └── TCP 5432 → DB VPS (private network only)
```

**Two VPS** (recommended): **app** + **database**, linked by IONOS **private network**.  
**One VPS** (budget): run Postgres on the same machine (not covered step-by-step here; use `deploy/db-server-setup.md` with `DB_HOST=127.0.0.1` and open pg_hba for localhost only).

---

## 0. Before you start

- Domain for the menu (e.g. `menu.clientdomain.com`) — set **`APP_URL` / `APP_DOMAIN` before printing QR codes**.
- GitHub repo: `git@github.com:zwebapps/resto.git`
- Secrets ready: Resend API key, Stripe (or plan to enter platform keys in `/admin/settings` after deploy)

Generate on your laptop:

```bash
openssl rand -base64 48    # SESSION_SECRET
openssl rand -base64 24    # DB_OWNER_PASSWORD
```

---

## 1. IONOS: create servers

| Server | Suggested size | OS |
|--------|----------------|-----|
| **App** | VPS M (2 vCPU, 4 GB+) | Ubuntu 24.04 LTS |
| **DB** | VPS S (2 vCPU, 2 GB+) | Ubuntu 24.04 LTS |

1. IONOS Cloud → **Server** → create both in the **same datacenter**.
2. **Private network**: attach both VPS to one private LAN (e.g. `10.0.0.0/24`).
   - App private IP → `APP_PRIVATE_IP` (e.g. `10.0.0.1`)
   - DB private IP → `DB_PRIVATE_IP` (e.g. `10.0.0.2`)
3. **Public IP** only needed on the **app** VPS (SSH + HTTPS). DB should **not** accept Postgres from the internet.

---

## 2. Database VPS (once)

Follow [`deploy/db-server-setup.md`](../deploy/db-server-setup.md) with these names:

| Item | Value |
|------|--------|
| Database | `resto_database` |
| Owner role | `resto_user` |
| Password | same as `DB_OWNER_PASSWORD` in `prod.env` |

After setup, from the **app VPS**:

```bash
psql "postgresql://resto_user:YOUR_PASSWORD@DB_PRIVATE_IP:5432/resto_database?sslmode=disable" -c "select 1"
```

Use **`DB_HOST=DB_PRIVATE_IP`** in `prod.env` (not the DB public IP).

---

## 3. App VPS: install tools

SSH into the **app** server as root or sudo user:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl ca-certificates

# Docker (official convenience script)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
# log out and back in so docker group applies

# Node 22 + pnpm (migrate/seed/build run on the host, not inside the app container)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo corepack enable
corepack prepare pnpm@latest --activate
```

Optional firewall on **app** VPS:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

---

## 4. Clone repo and configure `prod.env`

```bash
sudo mkdir -p /opt/resto
sudo chown "$USER:$USER" /opt/resto
git clone git@github.com:zwebapps/resto.git /opt/resto
cd /opt/resto
```

Copy and edit secrets (never commit this file):

```bash
cp deploy/prod.env.template prod.env
chmod 600 prod.env
nano prod.env   # or vim
```

**Minimum fields to set:**

| Variable | Example |
|----------|---------|
| `APP_URL` | `https://menu.yourdomain.com` |
| `APP_DOMAIN` | `menu.yourdomain.com` (no `https://`) |
| `DB_HOST` | `10.0.0.2` (DB private IP) |
| `DB_OWNER_PASSWORD` | your generated password |
| `SESSION_SECRET` | openssl output |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | platform `/admin` login |
| `OWNER_EMAIL` / `OWNER_PASSWORD` | restaurant `/dashboard` login |
| `EMAIL_TRANSPORT` | `resend` |
| `RESEND_API_KEY` | `re_…` |
| `EMAIL_FROM` | verified domain on Resend |

**Stripe:** either fill `STRIPE_*` here **or** leave placeholders and set keys later in **`/admin/settings`** (encrypted in DB). You still need `SESSION_SECRET` for that.

**Cloudflare:** optional. If you use orange-cloud proxy, point DNS to app public IP and set SSL to **Full (strict)**. If not, point an **A record** to the app public IP; Caddy will obtain Let's Encrypt for `APP_DOMAIN`.

Install deps once on the server (for migrate/seed):

```bash
cd /opt/resto
pnpm install --frozen-lockfile
```

---

## 5. DNS

| Record | Target |
|--------|--------|
| `A` `menu.yourdomain.com` | App VPS **public** IPv4 |

Wait for DNS before the first HTTPS deploy if you rely on Let's Encrypt.

---

## 6. First release

From `/opt/resto`:

```bash
./deploy/deploy.sh release
```

This runs, in order:

1. **`build`** — Docker image `guesto-app:latest` (or `APP_IMAGE` from `prod.env`)
2. **`migrate`** — `prisma migrate deploy` against remote Postgres
3. **`seed`** — platform admin, menu templates, Rangla restaurant (idempotent)
4. **`up`** — Caddy + app + Redis

Check:

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file prod.env ps
curl -sI "https://${APP_DOMAIN}/" | head -5
```

Logins:

- **`https://APP_DOMAIN/login`** → admin email → **`/admin`**
- Owner email → **`/dashboard`**
- Public menu → **`/`**

---

## 7. Later deploys (code updates)

```bash
cd /opt/resto
git pull
./deploy/deploy.sh release
```

Or without re-seed: `./deploy/deploy.sh build && ./deploy/deploy.sh migrate && ./deploy/deploy.sh up`

---

## 8. Backups (required for menu photos)

- **Postgres:** nightly `pg_dump` off the DB VPS (see `deploy/db-server-setup.md` §5 — adjust bucket names for resto).
- **Uploads:** backup Docker volume `elvoria-prod_uploads` (or named prefix from compose project):

```bash
docker run --rm -v elvoria-prod_uploads:/data -v /var/backups:/backup alpine \
  tar czf /backup/uploads-$(date +%F).tar.gz -C /data .
```

---

## 9. Troubleshooting

| Symptom | Check |
|---------|--------|
| App container restarting | `docker compose … logs app` — often missing env or DB unreachable |
| `migrate` fails | From app VPS: `psql` to `DB_HOST`; firewall; `pg_hba.conf` allows `APP_PRIVATE_IP` |
| 502 from Caddy | App health: `docker compose … logs app`; Redis healthy? |
| Emails not sent | `RESEND_API_KEY`, verified `EMAIL_FROM`, `/admin/settings` transport |
| Stripe test mode | Fake provider if secret+webhook unset; set env or `/admin/settings` |

---

## 10. Optional: skip Stripe/Resend on first boot

Minimum to bring the site up:

- `APP_*`, `DB_*`, `SESSION_SECRET`, `REDIS_URL` is set by compose to `redis://redis:6379`
- `EMAIL_TRANSPORT=console` logs mail only (not for real users)

Switch to Resend when DNS and domain are ready.

---

## File map

| Path | Purpose |
|------|---------|
| `prod.env` | Secrets on app VPS only (`chmod 600`) |
| `deploy/docker-compose.prod.yml` | Caddy, app, Redis |
| `deploy/deploy.sh` | build / migrate / seed / up |
| `deploy/Caddyfile` | TLS + reverse proxy |
| `deploy/db-server-setup.md` | Postgres on DB VPS |

More detail: [`docs/DEPLOY.md`](DEPLOY.md).

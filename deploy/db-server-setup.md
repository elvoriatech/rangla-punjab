# Database VPS — native PostgreSQL 16 setup (no Docker)

Postgres runs directly on its own VPS, separate from the app server.
One-time setup, ~30 minutes. Both servers must be in the same IONOS
region with a **private network** between them — the database is never
exposed to the public internet.

Placeholders used below:
- `APP_PRIVATE_IP` — the app VPS's private-network address (e.g. 10.0.0.1)
- `DB_PRIVATE_IP`  — this server's private-network address (e.g. 10.0.0.2)

## 1. Install PostgreSQL 16

```bash
sudo apt update && sudo apt install -y postgresql-16 postgresql-contrib-16
```

## 2. Configure for the private network + monitoring

`/etc/postgresql/16/main/postgresql.conf`:

```conf
listen_addresses = 'localhost, DB_PRIVATE_IP'
shared_preload_libraries = 'pg_stat_statements'   # slow-query reporting expects this
max_connections = 100                              # single app instance stays well under this
```

`/etc/postgresql/16/main/pg_hba.conf` — append (ONLY the app server, ONLY scram):

```conf
# app VPS via private network (single owner role — app connects directly)
host  rangla_database  rangla_user  APP_PRIVATE_IP/32  scram-sha-256
```

```bash
sudo systemctl restart postgresql
```

## 3. Firewall — nothing public

```bash
sudo ufw allow OpenSSH
sudo ufw allow from APP_PRIVATE_IP to any port 5432 proto tcp
sudo ufw enable
```

Port 5432 must NOT be reachable from the internet — verify from your laptop:
`nc -vz <db-public-ip> 5432` should time out.

## 4. Create the database and the owner role

Single restaurant, RLS disabled — one owner role the app connects as directly.

```bash
sudo -u postgres psql <<'SQL'
CREATE DATABASE rangla_database;
CREATE ROLE rangla_user LOGIN PASSWORD '<DB_OWNER_PASSWORD from prod.env>';
ALTER DATABASE rangla_database OWNER TO rangla_user;
\c rangla_database
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS citext;
SQL
```

The migrations (run from the app server as `elvoria`) create every table,
the RLS policies, and grant `elvoria_app` exactly what it needs — grant
nothing else by hand.

## 5. Nightly backups → R2 (off-machine, non-negotiable)

```bash
sudo apt install -y rclone
# configure an rclone remote named r2 for the Cloudflare R2 bucket, then:
sudo tee /etc/cron.d/elvoria-backup <<'CRON'
15 3 * * * postgres pg_dump -Fc guesto_db > /var/backups/guesto-$(date +\%F).dump && rclone copy /var/backups/guesto-$(date +\%F).dump r2:guesto-media/backups/ && find /var/backups -name 'guesto-*.dump' -mtime +7 -delete
CRON
```

Retention on R2: keep 30 days (lifecycle rule on the `backups/` prefix).
Prove restorability quarterly with `scripts/restore-drill.ts` against a
scratch database.

## 6. Verify from the app server

```bash
# owner (migrations path)
psql "postgresql://elvoria:<owner-pw>@DB_PRIVATE_IP:5432/elvoria" -c "select 1"
# app role
psql "postgresql://elvoria_app:<app-pw>@DB_PRIVATE_IP:5432/elvoria" -c "select 1"
```

Both succeed → set `DB_HOST=DB_PRIVATE_IP` plus the two passwords in
`prod.env` on the app server, and continue with `deploy/deploy.sh`.

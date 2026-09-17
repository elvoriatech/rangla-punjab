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
host  resto_database  resto_user  APP_PRIVATE_IP/32  scram-sha-256
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

## 4. Create the database and the roles

Single restaurant, RLS disabled — one owner role the app connects as
directly. Name the database and owner whatever you like; they are only
defaults in the tooling, and `prod.env` is the single place they are
set (`DB_NAME`, `DB_OWNER_USER`). Substitute your own names below.

**`elvoria_app` is not optional, even though nothing connects as it.**
Thirteen historical migrations end with a bare
`GRANT … TO elvoria_app;` — that role was the least-privilege connector
back when production ran with RLS on. Postgres refuses a `GRANT` to a
role that does not exist, so on a fresh database
`prisma migrate deploy` aborts on the first of them with
`role "elvoria_app" does not exist`, and the whole release fails. It is
created `NOLOGIN` here: the grants resolve, and the role cannot be used
to connect at all.

(Fixing this by editing those migrations is the wrong move — they are
already applied elsewhere, and rewriting an applied migration breaks
Prisma's checksum validation. One `NOLOGIN` role is the cheap,
reversible answer.)

```bash
sudo -u postgres psql <<'SQL'
CREATE DATABASE rangla_database;
-- Use a HEX password (`openssl rand -hex 24`). This value is
-- interpolated into a connection URL, and base64's `/` and `+` — or a
-- `#`/`@` — break URL parsing, which Prisma reports as the misleading
-- "P1013 ... invalid port number in database URL".
CREATE ROLE rangla_user LOGIN PASSWORD '<DB_OWNER_PASSWORD from prod.env>';
ALTER DATABASE rangla_database OWNER TO rangla_user;

-- Referenced by historical migrations; never connects. NOLOGIN on purpose.
CREATE ROLE elvoria_app NOLOGIN;

\c rangla_database
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS citext;
SQL
```

Verify both roles exist before you migrate — this is the check that
saves you a failed release:

```bash
sudo -u postgres psql -Atc \
  "select rolname, rolcanlogin from pg_roles where rolname in ('rangla_user','elvoria_app')"
# expect: rangla_user|t   and   elvoria_app|f
```

The migrations (run from the app server) create every table and
extension — grant nothing else by hand beyond the roles above.

## 5. Nightly backups (off-machine)

```bash
sudo apt install -y rclone
# Configure rclone for your object store, then:
sudo mkdir -p /var/backups
sudo tee /etc/cron.d/rangla-backup <<'CRON'
15 3 * * * postgres pg_dump -Fc resto_database > /var/backups/resto-$(date +\%F).dump && rclone copy /var/backups/resto-$(date +\%F).dump REMOTE:backups/resto/ && find /var/backups -name 'resto-*.dump' -mtime +7 -delete
CRON
```

Replace `REMOTE:backups/rangla/` with your bucket path. Keep ~30 days retention.

## 6. Verify from the app server

```bash
psql "postgresql://resto_user:<DB_OWNER_PASSWORD>@DB_PRIVATE_IP:5432/resto_database" -c "select 1"
```

Success → set `DB_HOST=DB_PRIVATE_IP` and `DB_OWNER_PASSWORD` in `prod.env` on the app server, then run `./deploy/deploy.sh release` (see `docs/DEPLOY-IONOS-VPS.md`).

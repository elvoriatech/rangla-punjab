#!/usr/bin/env bash
# rangla-watchdog — runs every minute on BOTH servers; they watch each other.
#
#   ROLE=app  (app VPS)  checks: containers up/healthy, site answers locally,
#                        the DB server is reachable, disk, TLS certificate.
#   ROLE=db   (DB VPS)   checks: Postgres up, disk, last nightly backup, and
#                        the PUBLIC site from outside — so a dead app server
#                        is reported by the DB server, and vice versa.
#
# Self-healing: Docker already restarts a container that EXITS. It does not
# restart one that is running but "unhealthy" (hung) — for those, a check
# with a heal_<id> function below gets ONE automatic restart per incident,
# and the email says whether that worked.
#
# Email (Resend) goes out only on a CHANGE: after FAIL_AFTER consecutive
# failed runs ("DOWN"), again every REMIND_MIN minutes while still down, and
# once when it recovers ("OK again"). A restart blip of one minute stays quiet.
#
# Config: /etc/rangla-watchdog.env (root-only)
#   ROLE, ALERT_TO, EMAIL_FROM, RESEND_API_KEY, DOMAIN, DB_HOST
set -uo pipefail

CONF=/etc/rangla-watchdog.env
# shellcheck disable=SC1090
. "$CONF"
STATE=/var/lib/rangla-watchdog
FAIL_AFTER=${FAIL_AFTER:-2}
REMIND_MIN=${REMIND_MIN:-60}
HOST=$(hostname -I | awk '{print $1}')
mkdir -p "$STATE"

send_mail() { # subject, body
  local payload
  payload=$(python3 -c 'import json,sys; print(json.dumps({"from":sys.argv[1],"to":[sys.argv[2]],"subject":sys.argv[3],"text":sys.argv[4]}))' \
    "$EMAIL_FROM" "$ALERT_TO" "$1" "$2")
  curl -s -o /dev/null -w "%{http_code}" --max-time 20 https://api.resend.com/emails \
    -H "Authorization: Bearer $RESEND_API_KEY" -H "Content-Type: application/json" -d "$payload"
}

# check <id> <human name> <command…>  — records the result and alerts on change.
check() {
  local id=$1 name=$2; shift 2
  local out f="$STATE/$id" fails=0 alerted=0 last=0 healed=0 now heal_note=""
  now=$(date +%s)
  [ -f "$f" ] && read -r fails alerted last healed < "$f"
  healed=${healed:-0}
  if out=$("$@" 2>&1); then
    if [ "$alerted" = 1 ]; then
      send_mail "✅ OK again: $name ($ROLE $HOST)" \
        "Recovered at $(date '+%Y-%m-%d %H:%M %Z').
Check: $name
Server: $ROLE server $HOST" >/dev/null
    fi
    echo "0 0 0 0" > "$f"
  else
    fails=$((fails + 1))
    local heal="heal_${id//-/_}"
    if [ "$fails" -ge "$FAIL_AFTER" ] && [ "$healed" = 0 ] && declare -F "$heal" >/dev/null; then
      if "$heal" >/dev/null 2>&1; then heal_note="Automatic restart: done — it should be back within a minute."
      else heal_note="Automatic restart: FAILED — needs a person."; fi
      healed=1
    fi
    if [ "$fails" -ge "$FAIL_AFTER" ] && { [ "$alerted" = 0 ] || [ $((now - last)) -ge $((REMIND_MIN * 60)) ]; }; then
      local tag="DOWN"; [ "$alerted" = 1 ] && tag="STILL DOWN"
      send_mail "🔴 $tag: $name ($ROLE $HOST)" \
        "Problem detected at $(date '+%Y-%m-%d %H:%M %Z').
Check: $name
Server: $ROLE server $HOST
Details: ${out:-no output}
${heal_note}

Live logs: https://$DOMAIN/logs
Health:    https://$DOMAIN/admin/system

You will get one more email when it is OK again (and a reminder every $REMIND_MIN min while it stays down)." >/dev/null
      alerted=1; last=$now
    fi
    echo "$fails $alerted $last $healed" > "$f"
  fi
}

# ---------- individual checks (exit 0 = fine; print why when not) ----------
container_ok() { # name
  local s
  s=$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$1" 2>&1) || { echo "container $1 missing"; return 1; }
  case "$s" in "running healthy"|"running ") return 0 ;; *) echo "container $1: $s"; return 1 ;; esac
}
http_ok() { # url [resolve-to-ip]
  local code args=(-s -o /dev/null -w "%{http_code}" --max-time 20)
  [ -n "${2:-}" ] && args+=(--resolve "$DOMAIN:443:$2")
  code=$(curl "${args[@]}" "$1") || true
  [ "$code" = 200 ] && return 0; echo "$1 answered HTTP ${code:-no response}"; return 1
}
port_ok() { timeout 5 bash -c "</dev/tcp/$1/$2" 2>/dev/null && return 0; echo "$1:$2 not reachable"; return 1; }
disk_ok() {
  local used; used=$(df --output=pcent / | tail -1 | tr -dc 0-9)
  [ "$used" -lt 85 ] && return 0; echo "disk / is ${used}% full"; return 1
}
cert_ok() {
  local end days
  end=$(echo | openssl s_client -connect 127.0.0.1:443 -servername "$DOMAIN" 2>/dev/null | openssl x509 -noout -enddate | cut -d= -f2)
  [ -n "$end" ] || { echo "no TLS certificate served"; return 1; }
  days=$(( ($(date -d "$end" +%s) - $(date +%s)) / 86400 ))
  [ "$days" -ge 14 ] && return 0; echo "TLS certificate expires in $days days ($end)"; return 1
}
pg_ok() { pg_isready -q -h 127.0.0.1 -p 5432 && return 0; echo "Postgres is not accepting connections"; return 1; }
backup_ok() {
  local newest
  newest=$(find /var/backups/rangla -name 'rangla_database-*.dump' -mmin -1560 | head -1)
  [ -n "$newest" ] && return 0; echo "no database backup newer than 26 h in /var/backups/rangla"; return 1
}

# ---------- automatic repairs (one attempt per incident) ----------
heal_app_container()   { docker restart rangla-prod-app-1; }
heal_caddy_container() { docker restart rangla-prod-caddy-1; }
heal_redis_container() { docker restart rangla-prod-redis-1; }
heal_postgres()        { systemctl restart postgresql@18-main; }

case "$ROLE" in
  app)
    check app-container   "Website app container"  container_ok rangla-prod-app-1
    check caddy-container "Caddy (HTTPS) container" container_ok rangla-prod-caddy-1
    check redis-container "Redis container"        container_ok rangla-prod-redis-1
    check site-local      "Website + menu API"     http_ok "https://$DOMAIN/api/v1/menu" 127.0.0.1
    check db-reachable    "Database server reachable" port_ok "$DB_HOST" 5432
    check disk            "Disk space (app server)" disk_ok
    check cert            "HTTPS certificate"      cert_ok
    ;;
  db)
    check postgres        "PostgreSQL"             pg_ok
    check disk            "Disk space (DB server)" disk_ok
    check backup          "Nightly database backup" backup_ok
    check site-public     "Public website (seen from outside)" http_ok "https://$DOMAIN/"
    check api-public      "Menu API for the phone apps (seen from outside)" http_ok "https://$DOMAIN/api/v1/menu"
    ;;
  *) echo "ROLE must be app or db" >&2; exit 2 ;;
esac

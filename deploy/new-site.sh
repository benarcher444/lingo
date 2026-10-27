#!/usr/bin/env bash
# Add another Node website beside Lingo. Run as root, ON the server. SERVER.md §8.
#
#   /opt/lingo/deploy/new-site.sh [--dry-run] <name> <hostname> <port> <git-url>
#   e.g. new-site.sh blog blog.example.com 3001 https://github.com/me/blog.git
#
# Needs deploy/migrate-caddy.sh to have been run first. Creates, in order: a
# system user, /opt/<name> (a clone), .env with PORT/HOST, a hardened systemd
# service, and /etc/caddy/sites/<name>.caddy. The app has to answer on
# 127.0.0.1:<port> before Caddy is touched, so a broken app cannot affect Lingo
# or any other site. It never touches Lingo's files, service or database.
#
# START_CMD overrides how the app starts (default: npm start), e.g.
#   START_CMD="/usr/bin/node src/server.js" new-site.sh ...
# --dry-run checks everything and prints what it would do, changing nothing.
set -euo pipefail

CADDYFILE=${CADDYFILE:-/etc/caddy/Caddyfile}
SITES_DIR=${SITES_DIR:-/etc/caddy/sites}
APPS_DIR=${APPS_DIR:-/opt}
UNIT_DIR=${UNIT_DIR:-/etc/systemd/system}

die() { echo "✗ $*" >&2; exit 1; }
usage() {
  echo "Usage: new-site.sh [--dry-run] <name> <hostname> <port 3001-3999> <git-url>" >&2
  sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

DRY=0
if [[ "${1:-}" == "--dry-run" ]]; then DRY=1; shift; fi
[[ $# -eq 4 ]] || usage
NAME=$1 SITE_HOST=$2 PORT=$3 REPO=$4
APP="$APPS_DIR/$NAME"
CADDY_FILE="$SITES_DIR/$NAME.caddy"
UNIT="$UNIT_DIR/$NAME.service"
START_CMD=${START_CMD:-"$(command -v npm || echo /usr/bin/npm) start"}

# --- Checks: nothing is changed until all of these pass ---------------------
[[ $DRY == 1 || $EUID -eq 0 ]] || die "run as root (or use --dry-run)"
[[ "$NAME" =~ ^[a-z][a-z0-9-]{1,30}$ ]] || die "name must be lowercase letters, digits and dashes, starting with a letter"
case "$NAME" in lingo|caddy|root|www|sites) die "'$NAME' is reserved" ;; esac
[[ "$PORT" =~ ^[0-9]+$ ]] && (( PORT >= 3001 && PORT <= 3999 )) || die "port must be 3001-3999 (3000 is Lingo)"
[[ "$SITE_HOST" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ && "$SITE_HOST" == *.* ]] || die "hostname looks wrong: $SITE_HOST"
[[ "$REPO" =~ ^(https://|git@) ]] || die "repo must be an https:// or git@ URL"
[[ "$START_CMD" != *$'\n'* ]] || die "START_CMD must be one line"

[[ -f "$CADDYFILE" ]] && grep -q "^import $SITES_DIR/" "$CADDYFILE" \
  || die "Caddy is not on the one-file-per-site layout yet. Run deploy/migrate-caddy.sh first."
grep -q '^(common)' "$CADDYFILE" || die "$CADDYFILE has no (common) snippet; run deploy/migrate-caddy.sh"

[[ ! -e "$APP" ]] || die "$APP already exists"
[[ ! -e "$UNIT" ]] || die "$UNIT already exists"
[[ ! -e "$CADDY_FILE" ]] || die "$CADDY_FILE already exists"
id "$NAME" >/dev/null 2>&1 && die "a user called '$NAME' already exists"
port_in_use() {
  if command -v ss >/dev/null; then
    [[ -n "$(ss -Htln "sport = :$1" 2>/dev/null)" ]]
  else
    (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null   # connects only if something listens
  fi
}
if port_in_use "$PORT"; then
  die "something is already listening on port $PORT (ss -tlnp)"
fi
if compgen -G "$SITES_DIR/*.caddy" >/dev/null; then
  grep -qE "127\.0\.0\.1:$PORT\b" "$SITES_DIR"/*.caddy && die "port $PORT is already used in $SITES_DIR"
  grep -qwF -- "$SITE_HOST" "$SITES_DIR"/*.caddy && die "hostname $SITE_HOST is already served in $SITES_DIR"
fi
if command -v getent >/dev/null && ! getent hosts "$SITE_HOST" >/dev/null; then
  echo "! $SITE_HOST does not resolve yet. Caddy cannot get a certificate until DNS points here (SERVER.md §5)."
fi

echo "Adding '$NAME': https://$SITE_HOST → 127.0.0.1:$PORT, app in $APP"
echo "  starts with: $START_CMD"
if [[ $DRY == 1 ]]; then echo "✓ Checks passed. Dry run: nothing changed."; exit 0; fi

# --- Build -------------------------------------------------------------------
undo() {
  cat >&2 <<EOF

✗ Failed part-way. Nothing has been deleted for you. To undo what was created:
    rm -f $CADDY_FILE; caddy validate --config $CADDYFILE && systemctl reload caddy
    systemctl disable --now $NAME 2>/dev/null; rm -f $UNIT; systemctl daemon-reload
    userdel $NAME 2>/dev/null; rm -rf $APP
EOF
}
trap undo ERR

echo "→ User and folder"
adduser --system --group --no-create-home --home "$APP" "$NAME"
mkdir -p "$APP" && chown "$NAME:$NAME" "$APP"

echo "→ Cloning"
sudo -u "$NAME" -H git clone "$REPO" "$APP"

echo "→ Installing dependencies"
if [[ -f "$APP/package-lock.json" ]]; then
  (cd "$APP" && sudo -u "$NAME" -H npm ci --omit=dev)
else
  (cd "$APP" && sudo -u "$NAME" -H npm install --omit=dev)
fi
sudo -u "$NAME" mkdir -p "$APP/data"

echo "→ Configuration (.env)"
if [[ ! -e "$APP/.env" ]]; then
  install -m 600 -o "$NAME" -g "$NAME" /dev/null "$APP/.env"
  printf 'PORT=%s\nHOST=127.0.0.1\nNODE_ENV=production\n' "$PORT" > "$APP/.env"
fi

echo "→ systemd service"
cat > "$UNIT" <<EOF
[Unit]
Description=$NAME web app
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$NAME
Group=$NAME
WorkingDirectory=$APP
EnvironmentFile=$APP/.env
Environment=NODE_ENV=production
ExecStart=$START_CMD
Restart=on-failure
RestartSec=3

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$APP/data

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now "$NAME"

echo "→ Waiting for it to answer on 127.0.0.1:$PORT"
up=0
for _ in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/" || true)
  if [[ "$code" != "000" ]]; then up=1; break; fi
  sleep 1
done
if [[ $up != 1 ]]; then
  journalctl -u "$NAME" -n 30 --no-pager >&2 || true
  echo "The app never answered on port $PORT. Does it read PORT and HOST from the environment? Caddy was not touched." >&2
  false
fi
echo "✓ App answers (HTTP $code)"

echo "→ Caddy"
cat > "$CADDY_FILE" <<EOF
$SITE_HOST {
	import common
	header X-Frame-Options "DENY"
	reverse_proxy 127.0.0.1:$PORT
}
EOF
if ! out=$(caddy validate --config "$CADDYFILE" 2>&1); then
  echo "$out" >&2
  rm -f "$CADDY_FILE"
  echo "Caddy rejected the new site file and it was removed; Caddy was not reloaded." >&2
  false
fi
systemctl reload caddy
trap - ERR

echo
echo "✓ $NAME is set up. https://$SITE_HOST can take a few seconds to get its first certificate."
echo "  Check:   curl -sI https://$SITE_HOST/ | head -1 ; systemctl is-active lingo caddy $NAME"
echo "  Secrets: add them to $APP/.env (mode 600), then systemctl restart $NAME. Never reuse Lingo's keys."
echo "  Record it: add the site to the table in SERVER.md §10 (and the port in §6)."
echo "  Auto-deploy on push is optional: SERVER.md §8.4."

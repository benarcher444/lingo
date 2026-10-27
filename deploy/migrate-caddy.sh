#!/usr/bin/env bash
# One-time: turn the single-site /etc/caddy/Caddyfile into one file per site, so
# more websites can sit beside Lingo. Run as root, ON the server. SERVER.md §7.
#
#   /opt/lingo/deploy/migrate-caddy.sh
#
# Nothing in the live config is rewritten or guessed at: the existing Caddyfile
# is moved, unchanged, to sites/lingo.caddy, and a small new Caddyfile imports
# every file in sites/. It is validated before Caddy is reloaded, and the
# original is put back if validation fails. Safe to run twice.
set -euo pipefail

CADDYFILE=${CADDYFILE:-/etc/caddy/Caddyfile}
SITES_DIR=${SITES_DIR:-/etc/caddy/sites}
RELOAD=${RELOAD:-1}   # tests set 0

die() { echo "✗ $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run as root"
[[ -s "$CADDYFILE" ]] || die "$CADDYFILE is missing or empty"
command -v caddy >/dev/null || die "caddy is not installed"

if grep -q "^import $SITES_DIR/" "$CADDYFILE"; then
  echo "✓ Already migrated: $CADDYFILE imports $SITES_DIR/"
  exit 0
fi

BAK="$CADDYFILE.bak-$(date +%Y%m%dT%H%M%S)"
cp -a "$CADDYFILE" "$BAK"
echo "→ Backed up the live Caddyfile to $BAK"

restore() {
  cp -a "$BAK" "$CADDYFILE"
  rm -f "$SITES_DIR/lingo.caddy"
  echo "↩ Restored the original Caddyfile. Nothing was reloaded." >&2
}

mkdir -p "$SITES_DIR"
cp -a "$CADDYFILE" "$SITES_DIR/lingo.caddy"

cat > "$CADDYFILE" <<EOF
# One file per site in $SITES_DIR. Add a site with deploy/new-site.sh (SERVER.md).
# New sites say \`import common\` to get these settings.
(common) {
	encode zstd gzip
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		-Server
	}
}

import $SITES_DIR/*.caddy
EOF

if ! out=$(caddy validate --config "$CADDYFILE" 2>&1); then
  echo "$out" >&2
  restore
  die "the new layout did not validate (a global options block in the old file is the usual cause)"
fi
echo "✓ New layout validates"

if [[ "$RELOAD" == 1 ]]; then
  systemctl reload caddy
  sleep 1
  systemctl is-active --quiet caddy || { restore; systemctl reload caddy || true; die "caddy is not active after reload; original restored"; }
  echo "✓ Caddy reloaded. Check the site still answers, e.g. curl -sI https://<lingo host>/login"
fi

echo "  Lingo's block now lives in $SITES_DIR/lingo.caddy; the original is at $BAK."
echo "  Do NOT re-run DEPLOY.md step 8 on this server any more."

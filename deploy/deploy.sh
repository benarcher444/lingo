#!/usr/bin/env bash
# Update the server to the latest code on GitHub and restart.
#
# Runs on every push to main (.github/workflows/deploy.yml), through a copy
# installed at /usr/local/bin/lingo-deploy — the only command the GitHub deploy
# key may run. By hand, from the laptop:
#
#   ssh root@<server> lingo-deploy
#
# After changing this file, reinstall that copy on the server:
#
#   install -m 755 /opt/lingo/deploy/deploy.sh /usr/local/bin/lingo-deploy
#
# Deliberately not automatic: a push must not be able to change what runs as root.
#
# The database is backed up first: migrations run when the app starts, and a
# copy taken just before is the undo button.
set -euo pipefail

APP=/opt/lingo
cd "$APP"

echo "→ Backing up the database"
sudo -u lingo -H "$APP/node_modules/.bin/tsx" scripts/backup-db.ts --label=pre-deploy --keep=10

echo "→ Pulling the latest code"
sudo -u lingo -H git pull --ff-only

echo "→ Installing dependencies"
sudo -u lingo -H npm ci --omit=dev

echo "→ Restarting"
systemctl restart lingo

# Wait for it to answer, so a broken deploy fails loudly — and fails the GitHub
# run — rather than leaving the site down unnoticed.
for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null http://127.0.0.1:3000/login; then
    echo "✓ Lingo is up at $(sudo -u lingo git rev-parse --short HEAD)"
    exit 0
  fi
  sleep 1
done

echo "✗ Lingo did not come back up. Last log lines:"
journalctl -u lingo -n 30 --no-pager
exit 1

#!/usr/bin/env bash
# Update the server to the latest code on GitHub and restart. From the laptop:
#
#   ssh root@<server> bash /opt/lingo/deploy/deploy.sh
#
# Backs the database up first: migrations run when the app starts, and a copy
# taken just before is the undo button.
set -euo pipefail

APP=/opt/lingo
cd "$APP"

echo "→ Backing up the database"
sudo -u lingo -H "$APP/node_modules/.bin/tsx" scripts/backup-db.ts

echo "→ Pulling the latest code"
sudo -u lingo -H git pull --ff-only

echo "→ Installing dependencies"
sudo -u lingo -H npm ci --omit=dev

echo "→ Restarting"
systemctl restart lingo
sleep 3
systemctl --no-pager --lines=8 status lingo

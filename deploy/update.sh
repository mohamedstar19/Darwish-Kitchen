#!/usr/bin/env bash
# Builds the web app on your machine and deploys web + backup API to the server.
# First deploy and every update use the same command (run from the repo root):
#
#   bash deploy/update.sh <[user@]server>
#   e.g. bash deploy/update.sh 192.168.1.116
#
# Set or change the control-panel admins in the same command (phone numbers, comma-separated):
#   ADMIN_PHONES=01001234567 bash deploy/update.sh mk@192.168.1.116
#
# Needs: Node 22 + npm here, SSH access with sudo on the server.
set -euo pipefail

HOST="${1:?usage: bash deploy/update.sh <[user@]server>}"
ADMIN_PHONES="${ADMIN_PHONES:-}"
if [[ -n "$ADMIN_PHONES" && ! "$ADMIN_PHONES" =~ ^[0-9+,\ ]+$ ]]; then
  echo "ADMIN_PHONES may only contain digits, +, commas and spaces" >&2; exit 1
fi
STAMP="$(date +%s)"
LOCAL_DIR="$(mktemp -d)"
REMOTE_DIR="/tmp/kitchen-deploy-$STAMP"

log() { echo -e "\n\033[1;32m==> $1\033[0m"; }
cd "$(dirname "${BASH_SOURCE[0]}")/.."

log "1/4 build web app (served from https://kitchen.darwish-tech.com)"
[[ -d node_modules ]] || npm ci
WEB_BASE_URL="" npm run build:web

log "2/4 bundle"
mkdir -p "$LOCAL_DIR/bundle/deploy"
cp -r dist "$LOCAL_DIR/bundle/web"
mkdir -p "$LOCAL_DIR/bundle/server/seed" && cp -r server/package.json server/package-lock.json server/src "$LOCAL_DIR/bundle/server/"
cp src/data/starter-recipes.json "$LOCAL_DIR/bundle/server/seed/"
cp deploy/install.sh deploy/kitchen-nginx.conf "$LOCAL_DIR/bundle/deploy/"
tar -czf "$LOCAL_DIR/kitchen.tar.gz" -C "$LOCAL_DIR/bundle" .
echo "   size: $(du -h "$LOCAL_DIR/kitchen.tar.gz" | cut -f1)"

log "3/4 upload to $HOST"
scp "$LOCAL_DIR/kitchen.tar.gz" "$HOST:/tmp/kitchen-$STAMP.tar.gz"
rm -rf "$LOCAL_DIR"

log "4/4 install on server"
ssh -t "$HOST" "mkdir -p $REMOTE_DIR && tar -xzf /tmp/kitchen-$STAMP.tar.gz -C $REMOTE_DIR && sudo ADMIN_PHONES='$ADMIN_PHONES' bash $REMOTE_DIR/deploy/install.sh $REMOTE_DIR; rc=\$?; rm -rf $REMOTE_DIR /tmp/kitchen-$STAMP.tar.gz; exit \$rc"

echo -e "\n\033[1;32m✅ Deployed.\033[0m If this is the first time, add kitchen.darwish-tech.com in Cloudflare (see deploy/README.md)."

#!/usr/bin/env bash
# ============================================================================
# Installs or updates Darwish Kitchen on the server (run as root ON the server).
# Normally you don't run this yourself: deploy/update.sh uploads a bundle and runs it.
#
#   sudo bash install.sh <bundle-dir>
#
# - Node.js 22 + nginx + PM2 if missing (the Quran server already has them)
# - system user "kitchen", data in /opt/darwish-kitchen/data (never overwritten)
# - backup API on 127.0.0.1:3020 via PM2 ("kitchen"), auto-start on reboot
# - web app in /opt/darwish-kitchen/web
# - nginx site for kitchen.darwish-tech.com
# Safe to re-run.
# ============================================================================
set -euo pipefail

BUNDLE="${1:?usage: sudo bash install.sh <bundle-dir>}"
APP_USER="kitchen"
APP_HOME="/opt/darwish-kitchen"
NGINX_SITE="/etc/nginx/sites-available/darwish-kitchen.conf"

log() { echo -e "\n\033[1;32m==> $1\033[0m"; }
[[ $EUID -eq 0 ]] || { echo "run as root (sudo)" >&2; exit 1; }

log "1/6 packages"
MISSING=""
for cmd in nginx rsync curl; do command -v "$cmd" >/dev/null || MISSING="$MISSING $cmd"; done
[[ -z "$MISSING" ]] || { apt-get update -qq && apt-get install -y -qq $MISSING ca-certificates >/dev/null; }
NODE_MAJOR="$(node -v 2>/dev/null | grep -oE '^v[0-9]+' | tr -d v || echo 0)"
NODE_MINOR="$(node -v 2>/dev/null | cut -d. -f2 || echo 0)"
if [[ "$NODE_MAJOR" -lt 22 || ( "$NODE_MAJOR" -eq 22 && "$NODE_MINOR" -lt 13 ) ]]; then
  log "   installing Node.js 22 (needs 22.13+ for built-in SQLite)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
command -v pm2 >/dev/null || npm i -g pm2 >/dev/null 2>&1

log "2/6 user and folders"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "$APP_HOME" --shell /bin/bash "$APP_USER"
mkdir -p "$APP_HOME/server" "$APP_HOME/web" "$APP_HOME/data" "$APP_HOME/backups"
chmod 700 "$APP_HOME/data" "$APP_HOME/backups"

log "3/6 backup API"
rsync -a --delete "$BUNDLE/server/" "$APP_HOME/server/" --exclude data
chown -R "$APP_USER:$APP_USER" "$APP_HOME"

log "4/6 web app"
rsync -a --delete "$BUNDLE/web/" "$APP_HOME/web/"
chown -R root:root "$APP_HOME/web" && chmod -R a+rX "$APP_HOME/web"
chmod 755 "$APP_HOME"

log "5/6 PM2"
sudo -u "$APP_USER" -H bash -lc "cd '$APP_HOME/server' && \
  if pm2 describe kitchen >/dev/null 2>&1; then pm2 restart kitchen --update-env; \
  else PORT=3020 HOST=127.0.0.1 DATA_DIR='$APP_HOME/data' pm2 start src/server.mjs --name kitchen --node-args='--disable-warning=ExperimentalWarning'; fi && pm2 save"
env PATH="$PATH" pm2 startup systemd -u "$APP_USER" --hp "$APP_HOME" >/dev/null 2>&1 || true

# Nightly copy of the database (keeps 14 days).
cat > /etc/cron.d/darwish-kitchen-backup <<CRON
15 3 * * * $APP_USER cd $APP_HOME/data && tar -czf $APP_HOME/backups/kitchen-\$(date +\%F).tar.gz kitchen.db* images 2>/dev/null; find $APP_HOME/backups -name 'kitchen-*.tar.gz' -mtime +14 -delete
CRON

log "6/6 nginx"
cp "$BUNDLE/deploy/kitchen-nginx.conf" "$NGINX_SITE"
ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/darwish-kitchen.conf
nginx -t
systemctl reload nginx 2>/dev/null || nginx -s reload 2>/dev/null || nginx

sleep 1
if curl -fsS http://127.0.0.1:3020/api/health >/dev/null; then
  echo -e "\n\033[1;32m✅ Darwish Kitchen is running.\033[0m API: 127.0.0.1:3020 · web: $APP_HOME/web"
else
  echo -e "\n\033[1;31m⚠️  API did not answer. Check: sudo -u $APP_USER pm2 logs kitchen\033[0m"; exit 1
fi

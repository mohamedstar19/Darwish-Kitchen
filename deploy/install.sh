#!/usr/bin/env bash
# ============================================================================
# Installs or updates Darwish Kitchen on the server (run as root ON the server).
# Normally you don't run this yourself: deploy/update.sh uploads a bundle and runs it.
#
#   sudo bash install.sh <bundle-dir>
#
# - Node.js 22 + nginx + PM2 if missing (the Quran server already has them)
# - system user "kitchen", data in /opt/darwish-kitchen/data (never overwritten)
# - backup API on 127.0.0.1 (port 3020, or the next free one) via PM2 ("kitchen"), auto-start on reboot
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
# Stop our own process first so its port counts as free.
sudo -u "$APP_USER" -H bash -lc "pm2 delete kitchen >/dev/null 2>&1 || true"
sleep 1
port_busy() {
  ss -ltnH 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]$1\$" && return 0
  timeout 1 bash -c "echo > /dev/tcp/127.0.0.1/$1" 2>/dev/null
}
# Keep the port from the last deploy; move on if another program took it.
PORT="$(cat "$APP_HOME/port" 2>/dev/null || echo 3020)"
while port_busy "$PORT"; do
  echo "   port $PORT is used by another program — trying $((PORT + 1))"
  PORT=$((PORT + 1))
  [[ $PORT -le 3099 ]] || { echo "no free port between 3020 and 3099" >&2; exit 1; }
done
echo "$PORT" > "$APP_HOME/port"
echo "   API port: $PORT"

cat > "$APP_HOME/server/ecosystem.config.cjs" <<ECOSYSTEM
module.exports = {
  apps: [{
    name: 'kitchen',
    script: 'src/server.mjs',
    cwd: '$APP_HOME/server',
    node_args: '--disable-warning=ExperimentalWarning',
    env: { PORT: '$PORT', HOST: '127.0.0.1', DATA_DIR: '$APP_HOME/data' },
  }],
};
ECOSYSTEM
chown "$APP_USER:$APP_USER" "$APP_HOME/server/ecosystem.config.cjs" "$APP_HOME/port"
sudo -u "$APP_USER" -H bash -lc "cd '$APP_HOME/server' && pm2 start ecosystem.config.cjs && pm2 save"
env PATH="$PATH" pm2 startup systemd -u "$APP_USER" --hp "$APP_HOME" >/dev/null 2>&1 || true

# Nightly copy of the database (keeps 14 days).
cat > /etc/cron.d/darwish-kitchen-backup <<CRON
15 3 * * * $APP_USER cd $APP_HOME/data && tar -czf $APP_HOME/backups/kitchen-\$(date +\%F).tar.gz kitchen.db* images 2>/dev/null; find $APP_HOME/backups -name 'kitchen-*.tar.gz' -mtime +14 -delete
CRON

log "6/6 nginx"
sed "s/127\.0\.0\.1:3020/127.0.0.1:$PORT/" "$BUNDLE/deploy/kitchen-nginx.conf" > "$NGINX_SITE"
ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/darwish-kitchen.conf
nginx -t
systemctl reload nginx 2>/dev/null || nginx -s reload 2>/dev/null || nginx

# Make sure it's really Kitchen answering (not another program on the same port).
for _ in 1 2 3 4 5; do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" 2>/dev/null | grep -q '"ok":true'; then
    echo -e "\n\033[1;32m✅ Darwish Kitchen is running.\033[0m API: 127.0.0.1:$PORT · web: $APP_HOME/web"
    exit 0
  fi
  sleep 1
done
echo -e "\n\033[1;31m⚠️  API did not answer. Check: sudo -u $APP_USER pm2 logs kitchen --lines 30\033[0m"
exit 1

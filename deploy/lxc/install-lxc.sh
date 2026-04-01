#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/sakaii-status/app"
SERVICE_NAME="sakaii-status"
SERVICE_FILE="deploy/lxc/sakaii-status.service"

if [[ $EUID -ne 0 ]]; then
  echo "Run this script as root."
  exit 1
fi

if ! id -u sakaii >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /opt/sakaii-status --shell /usr/sbin/nologin sakaii
fi

run_as_sakaii() {
  runuser -u sakaii -- "$@"
}

apt update
apt install -y nodejs npm git ca-certificates

mkdir -p /opt/sakaii-status
chown -R sakaii:sakaii /opt/sakaii-status

if [[ ! -d "$APP_DIR/.git" ]]; then
  run_as_sakaii git clone https://github.com/Sakaii-Project/sakaii-status.git "$APP_DIR"
else
  run_as_sakaii git -C "$APP_DIR" pull --ff-only
fi

cd "$APP_DIR"
run_as_sakaii npm ci --omit=dev

if [[ ! -f "$APP_DIR/.env" ]]; then
  cp "$APP_DIR/.env.production.example" "$APP_DIR/.env"
  chown sakaii:sakaii "$APP_DIR/.env"
  echo "Created $APP_DIR/.env. Edit it before exposing the service."
fi

if [[ ! -f "$APP_DIR/data.json" ]]; then
  cp "$APP_DIR/data.default.json" "$APP_DIR/data.json"
  chown sakaii:sakaii "$APP_DIR/data.json"
fi

install -m 0644 "$APP_DIR/$SERVICE_FILE" "/etc/systemd/system/${SERVICE_NAME}.service"
systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}.service"
systemctl status "${SERVICE_NAME}.service" --no-pager

#!/usr/bin/env bash
# Запускать на чистом Debian 12 от root:
#   bash setup-server.sh
set -euo pipefail

APP_USER="feosport"
APP_DIR="/opt/feosport2"

echo "=== [1/5] Обновление пакетов ==="
apt-get update -q
apt-get upgrade -y -q

echo "=== [2/5] Установка Docker CE ==="
apt-get install -y -q ca-certificates curl gnupg ufw

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg \
  | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) \
  signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/debian \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update -q
apt-get install -y -q \
  docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin

systemctl enable --now docker

echo "=== [3/5] Создание пользователя $APP_USER ==="
id "$APP_USER" &>/dev/null || useradd -m -s /bin/bash "$APP_USER"
usermod -aG docker "$APP_USER"

echo "=== [4/5] Настройка директории приложения ==="
mkdir -p "$APP_DIR"
chown "$APP_USER":"$APP_USER" "$APP_DIR"

echo "=== [5/5] Настройка firewall (ufw) ==="
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp    # оставить для будущего SSL
ufw --force enable

echo ""
echo "✅ Сервер готов!"
echo "   Docker:  $(docker --version)"
echo "   Compose: $(docker compose version)"
echo ""
echo "Следующий шаг — скопировать проект и запустить deploy.sh"

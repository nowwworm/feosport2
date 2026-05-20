#!/usr/bin/env bash
# Деплой с локальной машины на сервер.
# Использование:
#   bash deploy/deploy.sh user@your-server-ip
set -euo pipefail

SERVER="${1:-}"
APP_DIR="/opt/feosport2"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ -z "$SERVER" ]]; then
  echo "Укажи сервер: bash deploy/deploy.sh user@IP"
  exit 1
fi

echo "=== [1/4] Синхронизация файлов на $SERVER:$APP_DIR ==="
rsync -az --delete \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude 'deploy/.env' \
  "$PROJECT_ROOT/" \
  "$SERVER:$APP_DIR/"

echo "=== [2/4] Проверка .env на сервере ==="
ssh "$SERVER" "
  if [[ ! -f $APP_DIR/deploy/.env ]]; then
    echo '⚠️  Файл $APP_DIR/deploy/.env не найден!'
    echo '   Создай его: cp $APP_DIR/deploy/.env.example $APP_DIR/deploy/.env'
    echo '   Затем заполни пароли и JWT_SECRET и запусти deploy.sh снова.'
    exit 1
  fi
"

echo "=== [3/4] Сборка и запуск контейнеров ==="
ssh "$SERVER" "
  cd $APP_DIR
  docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env \
    up --build -d --remove-orphans
"

echo "=== [4/4] Статус ==="
ssh "$SERVER" "
  cd $APP_DIR
  docker compose -f deploy/docker-compose.prod.yml ps
"

echo ""
echo "✅ Деплой завершён!"
echo "   Открой http://\$(ssh $SERVER hostname -I | awk '{print \$1}')"

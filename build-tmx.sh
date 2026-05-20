#!/bin/bash
# Собирает TMX локально, затем поднимает весь стек через docker-compose.
# Запуск из корня проекта: bash build-tmx.sh

set -e

echo ""
echo "┌─── [1/3] Сборка TMX (локально, без Docker)"
cd "$(dirname "$0")/feoTEST/TMX"

# Установить зависимости если нет node_modules
if [ ! -d "node_modules" ]; then
  echo "│  pnpm install..."
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 ELECTRON_SKIP_BINARY_DOWNLOAD=1 pnpm install
fi

# Собрать с BASE_URL=tmx чтобы пути стали /tmx/assets/...
# Используем vite build напрямую — пропускаем tsc (в TMX есть TypeScript-ошибки
# из-за версионной несовместимости локальных пакетов, но vite собирает без них).
echo "│  vite build (BASE_URL=tmx, без tsc)..."
BASE_URL=tmx pnpm exec rimraf dist
BASE_URL=tmx pnpm exec vite build

echo "│  ✓ TMX собран: feoTEST/TMX/dist/"
cd "$(dirname "$0")/../.."

echo ""
echo "┌─── [2/3] Удаление старого образа tmx (если есть)"
docker rmi feosport2-tmx 2>/dev/null && echo "│  ✓ удалён" || echo "│  не было — пропускаем"

echo ""
echo "┌─── [3/3] Запуск docker-compose"
cd "$(dirname "$0")"
docker-compose -f docker-compose.unified.yml up -d --build

echo ""
echo "┌─── Готово!"
echo "│  http://localhost        — FeoSport2"
echo "│  http://localhost/tmx/   — TMX турнирная сетка"
echo "│  http://localhost/api/healthz — проверка API"
echo ""

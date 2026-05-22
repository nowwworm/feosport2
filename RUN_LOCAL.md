# FeoSport2: локальный запуск без Docker

## Что уже подготовлено

- Portable Node.js 22 лежит в `.tools/node-v22.22.3-win-x64/`.
- Зависимости установлены в `backend/`, `frontend/` и `feoTEST/TMX/`.
- Локальный `.env` создан из `.env.example` и не коммитится.

## 1. Подключить локальный Node.js

Открой PowerShell в корне проекта:

```powershell
cd C:\Users\danie\Desktop\nowwworm\feosport2
$env:Path = "$PWD\.tools\node-v22.22.3-win-x64;$env:Path"
$env:COREPACK_HOME = "$PWD\.tools\corepack"
```

Проверка:

```powershell
node --version
npm --version
corepack pnpm --version
```

## 2. Запустить backend

Нужен работающий PostgreSQL с параметрами из `.env`:

```env
DB_NAME=feosport2
DB_USER=postgres
DB_PASSWORD=postgres
DB_HOST=localhost
DB_PORT=5432
```

Запуск:

```powershell
cd backend
npm run dev
```

Backend по умолчанию слушает `http://localhost:4000`, если `PORT` не задан.

## 3. Запустить frontend

Во втором окне PowerShell:

```powershell
cd C:\Users\danie\Desktop\nowwworm\feosport2
$env:Path = "$PWD\.tools\node-v22.22.3-win-x64;$env:Path"
cd frontend
npm run dev
```

Vite покажет адрес в консоли, обычно `http://localhost:5173`.

## 4. Запустить TMX отдельно

```powershell
cd C:\Users\danie\Desktop\nowwworm\feosport2
$env:Path = "$PWD\.tools\node-v22.22.3-win-x64;$env:Path"
$env:COREPACK_HOME = "$PWD\.tools\corepack"
cd feoTEST\TMX
corepack pnpm run start
```

## 5. Проверка сборки

```powershell
cd C:\Users\danie\Desktop\nowwworm\feosport2
$env:Path = "$PWD\.tools\node-v22.22.3-win-x64;$env:Path"
$env:COREPACK_HOME = "$PWD\.tools\corepack"

cd backend
npm test

cd ..\frontend
npm run build

cd ..\feoTEST\TMX
corepack pnpm run build
```


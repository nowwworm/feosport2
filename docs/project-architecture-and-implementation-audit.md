# FeoSport2: архитектура, изменения и сверка с ТЗ

Дата аудита: 2026-05-21.

Основание: фактическое состояние репозитория `main`, последние 30 коммитов, ТЗ из `FeoSport2_Plan_v2.docx` ("ПЛАН ИНТЕГРАЦИИ v2, FeoSport2 + TMX - Windows 11 + Railway QA").

## 1. Краткий вывод

Проект сейчас является монорепозиторием из четырех основных частей:

1. FeoSport2 frontend: React 18 + Vite, роли, мобильные страницы судей, таблицы, сетка, админка и справка.
2. FeoSport2 backend: Node.js + Express + PostgreSQL + Socket.io, JWT-авторизация, REST API, realtime-результаты и интеграция с FormDesigner.
3. TMX: отдельное TypeScript/Vite-приложение Tournament Management eXtreme, подключенное как отдельный сервис в unified Docker и как статический `tmx-dist` в Windows EXE.
4. Инфраструктура: PostgreSQL, nginx reverse proxy, Docker Compose, Railway-документация, GitHub Actions AQA и сборка Windows installer через Inno Setup.

По ТЗ наиболее существенные пункты реализованы частично или полностью: unified Docker, `/tmx/`, роль/admin-панель, экспорт пилотов, CORS-настройка, AQA, сборка installer с TMX и pgAdmin. Остаются важные пробелы: нет `scripts/migrate.js`, нет `POST /api/admin/import/pilots`, нет `GET /api/admin/backup`, есть несовпадение healthcheck `/api/healthz` vs фактический `/healthz`, Railway все еще требует ручной настройки/проверки, а Socket.io в frontend при пустом `VITE_API_URL` по умолчанию смотрит на `http://localhost:8090`, что рискованно для production/телефонов.

## 2. Архитектура верхнего уровня

```text
Пользователь / судья / главный судья / админ
        |
        v
  nginx reverse proxy
  ├─ /              -> frontend:8080, React SPA
  ├─ /api/*         -> backend:8090, Express REST
  ├─ /socket.io/*   -> backend:8090, Socket.io WebSocket
  ├─ /tmx/*         -> tmx:3000, TMX SPA
  └─ /healthz       -> backend:8090/healthz
        |
        v
  PostgreSQL 16
```

Для Docker-режима это задается в `docker-compose.unified.yml` и `deploy/nginx/nginx.unified.conf`.

Для Windows native/installer-режима backend собирается в `feosport2-server.exe`; тот же процесс Express раздает:

1. `/api/*` и `/socket.io/*` через `backend/src/app.js` и `backend/src/services/socket.js`.
2. основной frontend из `{app}/frontend-dist`.
3. TMX из `{app}/tmx-dist` по `/tmx`.
4. SPA fallback для основного frontend.

## 3. Компоненты проекта

### 3.1 Frontend FeoSport2

Путь: `frontend/`.

Технологии:

1. React 18.
2. React Router 6.
3. Vite 5.
4. Axios.
5. Socket.io-client.
6. MUI и SCSS.

Ключевые точки:

1. `frontend/src/App.jsx` - маршруты и role-based protection.
2. `frontend/src/context/AuthContext.jsx` - хранение JWT и пользователя в `localStorage`.
3. `frontend/src/context/SocketContext.jsx` - WebSocket-подключение с JWT в handshake.
4. `frontend/src/services/api.js` - REST-клиент, `/api` при пустом `VITE_API_URL`.
5. `frontend/src/components/Navigation/Navigation.jsx` - меню по ролям, включая внешнюю ссылку `/tmx/`.
6. `frontend/src/pages/AdminPage/AdminPage.jsx` - управление пользователями и PostgreSQL/pgAdmin.
7. `frontend/public/icon-192.png`, `frontend/public/icon-512.png`, `frontend/public/manifest.json` - PWA-иконки и manifest.

Маршруты:

| Route | Страница | Доступ |
|---|---|---|
| `/login` | `AuthPage` | публично |
| `/` | `LeaderboardPage` | авторизованные |
| `/bracket` | `BracketPage` | авторизованные |
| `/judge` | `JudgePage` | `judge`, `chief_judge`, `admin` |
| `/pilots` | `PilotsPage` | `admin`, `chief_judge` |
| `/participants` | `ParticipantsPage` | `admin` |
| `/admin` | `AdminPage` | `admin` |
| `/docs` | `DocsPage` | `admin`, `chief_judge` |
| `/tmx/` | TMX в новой вкладке | `admin`, `chief_judge` |

### 3.2 Backend FeoSport2

Путь: `backend/`.

Технологии:

1. Node.js.
2. Express.
3. PostgreSQL через `pg`.
4. JWT через `jsonwebtoken`.
5. Password hashing через `bcryptjs`.
6. Socket.io.
7. Jest.

Точки входа:

1. `backend/src/server.js` - dev/server entrypoint, запускает HTTP + Socket.io и периодическую FormDesigner-синхронизацию.
2. `backend/src/server-bundled.js` - entrypoint для Windows EXE, загружает `.env`, раздает frontend и TMX dist.
3. `backend/src/app.js` - Express app, CORS, JSON/urlencoded parser, REST routes, `/healthz`.
4. `backend/src/config/db.js` - Pool config из `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`.
5. `backend/src/config/runtimeEnv.js` - диагностика runtime-окружения для bundled exe.

REST API:

| Prefix | Файл | Назначение |
|---|---|---|
| `/api/auth` | `routes/auth.js` | login, register |
| `/api/competitions` | `routes/competitions.js` | соревнования, bracket, playoff generation |
| `/api/heats` | `routes/heats.js` | заезды, результаты, lock |
| `/api/pilots` | `routes/pilots.js` | пилоты, CRUD, FormDesigner cleanup |
| `/api/webhook` | `routes/webhook.js` | регистрация пилотов из FormDesigner |
| `/api/admin` | `routes/admin.js` | пользователи, DB status, pgAdmin, экспорт CSV, ручной sync |
| `/healthz` | `app.js` | healthcheck backend |

Admin API:

| Endpoint | Статус | Назначение |
|---|---:|---|
| `GET /api/admin/users` | реализовано | список пользователей |
| `POST /api/admin/users` | реализовано | создание пользователя |
| `PATCH /api/admin/users/:id` | реализовано | роль, активность, пароль |
| `GET /api/admin/db/status` | реализовано | состояние PostgreSQL и наличие pgAdmin |
| `POST /api/admin/db/pgadmin/start` | реализовано | запуск pgAdmin на Windows-хосте |
| `GET /api/admin/export/pilots.csv` | реализовано | экспорт пилотов в CSV |
| `POST /api/admin/sync-formdesigner` | реализовано | ручной запуск синхронизации |
| `POST /api/admin/import/pilots` | не найдено | требование ТЗ, импорт CSV |
| `GET /api/admin/backup` | не найдено | требование ТЗ, дамп через pg_dump |

Realtime:

Socket.io требует JWT в `socket.handshake.auth.token`. События:

| Event | Роли | Назначение |
|---|---|---|
| `join_competition` | авторизованные | подписка на room `competition:{id}` |
| `submit_score` | `judge`, `chief_judge`, `admin` | отправка/перезапись результата |
| `edit_score` | `judge`, `chief_judge`, `admin` | правка результата с audit log |
| `lock_heat` | `chief_judge`, `admin` | блокировка заезда |
| `score_update` | broadcast | обновление результата |
| `leaderboard_update` | broadcast | обновление leaderboard |
| `heat_status_change` | broadcast | изменение статуса заезда |

### 3.3 База данных

Путь: `database/init.sql`, `database/seed.sql`, `database/seed-users.sql`.

Основные таблицы:

1. `roles` - `admin`, `chief_judge`, `judge`, `pilot`.
2. `users` - учетные записи и активность.
3. `pilots` - участники/пилоты, FormDesigner `external_id`.
4. `competitions` - соревнования.
5. `heats` - заезды и статусы.
6. `heat_participants` - пилоты в заездах.
7. `results` - результаты с generated `total_time`.
8. `result_audit_log` - история правок результатов.
9. `playoff_brackets` - сетка плей-офф.

Есть индексы на основные foreign keys и `pilots.external_id`.

Пробел относительно ТЗ: таблица `db_migrations` и миграционный механизм `scripts/migrate.js` не найдены.

### 3.4 TMX

Путь: `feoTEST/TMX/`.

Технологии:

1. TypeScript.
2. Vite.
3. pnpm 11.1.2.
4. `tods-competition-factory`, `courthive-components`, `provider-config`, `scoringVisualizations`, `pdf-factory`.
5. Vitest и Playwright E2E.
6. Electron entrypoints присутствуют, но в FeoSport2 используется web/static SPA.

Интеграция:

1. В Docker unified TMX собирается из `feoTEST` через `TMX/Dockerfile` и доступен за nginx по `/tmx/`.
2. В Windows installer TMX собирается в `tmx-dist` и копируется в `{app}/tmx-dist`.
3. В FeoSport2 меню `/tmx/` доступно ролям `admin` и `chief_judge`.
4. В `feoTEST/TMX/vite.config.ts` учтена база для `/tmx/` через `BASE_URL`.

### 3.5 Инфраструктура и деплой

Docker:

1. `docker-compose.yml` - базовый dev stack: `db`, `backend`, `frontend`.
2. `docker-compose.unified.yml` - unified stack: `db`, `backend`, `frontend`, `tmx`, `nginx`.
3. `deploy/docker-compose.prod.yml` - production compose.
4. `deploy/nginx/nginx.unified.conf` - единая маршрутизация frontend/API/WebSocket/TMX.

Railway:

1. `DEPLOY_RAILWAY.md` описывает ручную настройку PostgreSQL, variables, домена и smoke-test.
2. `railway.toml` содержит `dockerfilePath = "docker-compose.unified.yml"` и healthcheck `/api/healthz`.

Замечания:

1. В коде backend healthcheck находится на `/healthz`, а nginx проксирует `/healthz`. В `railway.toml` и `DEPLOY_RAILWAY.md` указан `/api/healthz`; это нужно привести к одному пути.
2. `dockerfilePath = "docker-compose.unified.yml"` выглядит спорно для Railway config-as-code: compose-файл не является Dockerfile. Фактический Railway-деплой нужно проверять на стенде.

Windows:

1. `deploy/windows/build/build-installer.ps1` собирает backend exe, frontend dist, TMX dist, копирует SQL, скачивает PostgreSQL installer, запускает Inno Setup.
2. `deploy/windows/build/feosport2.iss` включает `frontend-dist`, `tmx-dist`, SQL, bundled scripts и ярлыки.
3. Есть два набора deployment-скриптов: `deploy/windows/...` и зеркальный `deploy/windows/FeoSport2-Windows-Package/...`.
4. Добавлены batch/PowerShell-скрипты диагностики, запуска, остановки, seed-data, pgAdmin, check-updates, collect-logs.

CI/CD:

1. `.github/workflows/aqa.yml` - backend Jest, frontend build, TMX Vitest, advisory typecheck, optional Playwright E2E.
2. `.github/workflows/build-installer.yml` - Windows runner, AQA before installer, checkout sibling packages, Node 24, pnpm 11.1.2, pkg, Inno Setup, PostgreSQL cache, frontend/TMX build, installer artifact, release asset on tags.

## 4. Документация по изменениям

Ниже сгруппированы изменения из последних 30 коммитов.

### 4.1 Admin panel и управление пользователями

Коммиты:

1. `80db8a4 Add comprehensive Admin panel for user and database management`.
2. `6757086 Add database status and pgAdmin launcher endpoints to admin API`.
3. `46f734b Add database admin tools for pgAdmin integration`.
4. `7f4c29e Add pgAdmin launcher batch scripts for Windows installer`.
5. `a5cb7e0 Update Windows installer for pgAdmin support and enhanced startup`.

Что сделано:

1. Добавлена страница `/admin` для роли `admin`.
2. Добавлен CRUD-lite для пользователей: список, создание, смена роли, смена активности, смена пароля.
3. Добавлена панель PostgreSQL: host, port, database, user, baseline users, доступность pgAdmin.
4. Добавлен backend-сервис поиска pgAdmin по стандартным Windows-путям и `PGADMIN_PATH`.
5. Добавлен API для запуска pgAdmin с backend-хоста.
6. Добавлены ярлыки и batch-скрипты `open-pgadmin.bat` в Windows installer.

Риски/ограничения:

1. Запуск pgAdmin из backend осмыслен только на Windows-хосте с desktop session.
2. Пользователь не может менять свой аккаунт через `PATCH /api/admin/users/:id`, что защищает от случайной потери admin-доступа.

### 4.2 Экспорт и seed пользователей

Коммиты:

1. `96f3c77 Add seed-users.sql for initial database population`.
2. `80db8a4 Add comprehensive Admin panel for user and database management`.

Что сделано:

1. Добавлен `database/seed-users.sql`.
2. Installer и workflows копируют `seed-users.sql`.
3. Добавлен `GET /api/admin/export/pilots.csv`.
4. CSV экспорт содержит BOM для Excel.

Что не сделано по ТЗ:

1. `POST /api/admin/import/pilots` не найден.
2. `GET /api/admin/backup` не найден.
3. `scripts/migrate.js` не найден.

### 4.3 Runtime env и DB config

Коммиты:

1. `a5a8c5b Add runtime environment config and improve db pool configuration`.
2. `f488187 Add runtime environment logging to backend startup`.
3. `55054fc Improve AuthPage error handling for server errors`.

Что сделано:

1. DB config вынесен в `getPoolConfig()`.
2. Добавлена диагностика runtime env для bundled exe: путь приложения, `.env`, DB host/user/name/port.
3. Auth route логирует PostgreSQL auth failure (`28P01`) с ключевыми DB-параметрами.
4. AuthPage улучшена для server error.

Польза:

1. Легче диагностировать Windows installer и `.env`.
2. Уменьшается риск "черного экрана" или непонятной ошибки при неверном DB password.

### 4.4 CORS и безопасность

Коммиты:

1. `ed93a44 Update GitHub Actions workflows for improved CI/CD` и смежные изменения.
2. Текущий `backend/src/app.js` содержит production CORS allowlist.

Что сделано:

1. В dev CORS открыт.
2. В production используется `ALLOWED_ORIGINS`, если задан.
3. Разрешены запросы без `Origin` для curl, SSR, Postman, мобильных/служебных клиентов.

Что осталось:

1. Нужно обязательно задать `ALLOWED_ORIGINS` на Railway/Windows production.
2. Socket.io CORS в `backend/src/services/socket.js` все еще `origin: '*'`; это стоит синхронизировать с REST CORS.

### 4.5 Unified Docker и TMX

Коммиты:

1. `fbee02f Change default HTTP port from 80 to 4444`.
2. `64e8b90 Fix frontend API URL for Docker environment`.
3. `2fbc460 Fix Windows installer TMX prebuild step`.
4. `b10b693 Build TMX dist before Windows installer`.

Что сделано:

1. `docker-compose.unified.yml` поднимает PostgreSQL, backend, frontend, TMX и nginx.
2. Публичный порт по умолчанию `4444:80`, чтобы не требовать системный порт 80.
3. Nginx проксирует `/`, `/api/`, `/socket.io/`, `/tmx/`, `/healthz`.
4. Frontend в unified-сборке использует относительный `/api`.
5. TMX обслуживается по `/tmx/`.

Риск:

1. `frontend/src/context/SocketContext.jsx` при пустом `VITE_API_URL` использует `http://localhost:8090`. Для unified/nginx и телефонов корректнее использовать `window.location.origin`.

### 4.6 Windows installer и production package

Коммиты:

1. `897b911 Update Inno Setup installer script configuration`.
2. `d5c4330 Enhance Windows installer scripts with diagnostics and auto-updates`.
3. `a5cb7e0 Update Windows installer for pgAdmin support and enhanced startup`.
4. `7f4c29e Add pgAdmin launcher batch scripts for Windows installer`.
5. `b79c883 Improve Windows installer build workflow with better error handling and caching`.
6. `c54adea Fix: upgrade Node.js 22->24 and fix npm rollup cache issue`.
7. `dc6b4f3 Fix: use node18 instead of node20 for pkg compilation`.
8. `80399b9 Fix: correct pkg package name in workflow (@vercel/pkg -> pkg)`.
9. `9b6f2b5 Fix: remove hardcoded Inno Setup version constraint`.

Что сделано:

1. Backend компилируется в `feosport2-server.exe`.
2. Frontend собирается в `frontend-dist`.
3. TMX собирается в `tmx-dist`.
4. SQL-файлы копируются в installer staging.
5. PostgreSQL 16 installer скачивается/кэшируется.
6. Inno Setup собирает `FeoSport2-Setup.exe`.
7. Добавлены ярлыки, pgAdmin launcher, сбор логов, check-updates, диагностика.
8. Добавлена опциональная code signing логика через env-переменные.

Ограничение:

1. Локальный `build-installer.ps1` использует `npm install -g @vercel/pkg`, тогда как workflow использует `npm install -g pkg`; это лучше унифицировать.
2. В package.json target указан `node20-win-x64`, в workflow фактически используется `node18-win-x64`; нужно зафиксировать целевой runtime.

### 4.7 GitHub Actions AQA и installer pipeline

Коммиты:

1. `0be56ca Add AQA CI workflow`.
2. `4297c10 Fix installer workflow pnpm version`.
3. `38119d4 Update installer workflow actions for Node 24`.
4. `bc0bb15 Reduce AQA noise for TMX typecheck`.
5. `954cb33 Fix pnpm argument forwarding in installer workflow`.
6. `ed93a44 Update GitHub Actions workflows for improved CI/CD`.

Что сделано:

1. AQA запускается на push/pull_request в `main`.
2. Backend Jest tests обязательны.
3. Frontend build обязателен.
4. TMX Vitest обязателен.
5. TMX TypeScript check стал advisory: лог сохраняется artifact-ом, pipeline не падает на существующих type issues.
6. TMX Playwright E2E запускается вручную или через workflow_call с `run_e2e=true`.
7. Installer build зависит от AQA.
8. Installer artifact загружается на 30 дней и публикуется в GitHub Release при tag `v*`.

### 4.8 PWA icons

Коммит:

1. `eed1167 Add PWA app icons for frontend`.

Что сделано:

1. Добавлены `frontend/public/icon-192.png` и `frontend/public/icon-512.png`.
2. Manifest уже есть в `frontend/public/manifest.json`.

### 4.9 Railway QA

Что есть:

1. `DEPLOY_RAILWAY.md` с пошаговой инструкцией.
2. `railway.toml`.
3. Переменные `NODE_ENV`, `JWT_SECRET`, `ALLOWED_ORIGINS`, `VITE_API_URL`, `FD_EMAIL`, `FD_PASSWORD` описаны.
4. Описан smoke-test frontend/API/TMX.

Что требует проверки/доработки:

1. Healthcheck путь должен быть `/healthz`, либо нужно добавить `/api/healthz`.
2. `railway.toml` указывает compose как `dockerfilePath`; нужно проверить реальное поведение Railway.
3. В ТЗ указаны отдельные Railway services с root `/backend`, `/frontend`, `/feoTEST`; текущая документация описывает unified compose/nginx. Это рабочая альтернатива, но не один-в-один с ТЗ.

## 5. Сравнение реализации с ТЗ

| Требование ТЗ | Реализация в проекте | Статус | Комментарий |
|---|---|---:|---|
| 3 среды: DEV Mac, Railway QA, Windows PROD | Docker/dev есть, Railway docs есть, Windows installer есть | частично | Railway требует фактической проверки |
| `docker-compose.unified.yml + nginx.unified.conf` | Файлы есть, стек описан | выполнено | Порт по умолчанию `4444` |
| TMX Dockerfile + Vite base path | TMX Dockerfile есть, `BASE_URL=tmx` используется | выполнено | В installer и CI учтено |
| FeoSport2 + TMX под одним localhost | nginx маршрутизирует `/` и `/tmx/` | выполнено технически | Нужен smoke-test запуска |
| Роль admin + AdminPage | `/admin`, API users, DB status | выполнено | Есть управление пользователями |
| Кнопка "Турнирная сетка" для chief_judge | Навигация `/tmx/` для `admin`, `chief_judge` | выполнено | Открывается в новой вкладке |
| Мобильный JudgePage через WiFi | JudgePage есть | не подтверждено | Нет результата ручного mobile smoke-test |
| Railway env vars | Описаны в `DEPLOY_RAILWAY.md` | частично | Healthcheck/config надо привести в порядок |
| Railway QA: все роли, Socket.io, TMX | Есть CI/build и docs | не подтверждено | Нужен прогон на реальном Railway URL |
| Расширить installer для TMX | `build-installer.ps1`, workflow, `.iss` включают `tmx-dist` | выполнено | Реализовано и локально, и в CI |
| Собрать FeoSport2-Setup.exe с TMX | Workflow и скрипт готовы | частично | Артефакт должен быть собран отдельным запуском |
| Установка EXE на Windows 11, тест с телефонов | Installer scripts есть | не подтверждено | Нужен физический/VM smoke-test |
| Сменить default passwords/secrets | CORS/JWT env поддерживаются | не выполнено автоматически | Операционный чек-лист, не код |
| `scripts/migrate.js` | Не найден | не выполнено | Нужно добавить |
| `GET /api/admin/export/pilots.csv` | Реализовано | выполнено | Admin-only |
| `POST /api/admin/import/pilots` | Не найден | не выполнено | Нужно добавить |
| `GET /api/admin/backup` | Не найден | не выполнено | Нужно добавить pg_dump wrapper |
| `db_migrations` table | Не найдена | не выполнено | Нужно добавить миграционный механизм |
| Production CORS ограничить | REST CORS allowlist есть | частично | Socket.io CORS открыт |
| PostgreSQL порт не наружу | Unified compose не публикует DB наружу | выполнено для unified | В базовом `docker-compose.yml` DB публикуется на `5432` для dev |
| Backend не наружу, только nginx | Unified compose backend `expose`, nginx public | выполнено для unified | В базовом dev compose backend публикуется |
| `.env` не в git | По ТЗ уже было | выполнено по ТЗ | Файл не анализировался |

## 6. Открытые технические риски

1. **Socket.io URL в frontend.** При production build с пустым `VITE_API_URL` REST уходит на `/api`, а Socket.io пытается подключиться к `http://localhost:8090`. Для телефонов и nginx-unified это может сломать realtime. Рекомендуется `const SOCKET_URL = import.meta.env.VITE_API_URL || window.location.origin;`.
2. **Railway healthcheck.** Сейчас `railway.toml` и `DEPLOY_RAILWAY.md` используют `/api/healthz`, но backend/nginx дают `/healthz`.
3. **Railway compose config.** `dockerfilePath = "docker-compose.unified.yml"` нужно проверить: если Railway не поддерживает compose так, деплой не стартует.
4. **Миграции БД.** Схема сейчас задается init SQL. Для обновлений поверх существующей Windows DB нужен `db_migrations` + миграционный runner.
5. **Backup/import.** Экспорт пилотов есть, но импорт CSV и полный SQL backup не реализованы.
6. **Секреты.** `JWT_SECRET`, `DB_PASSWORD`, admin password должны меняться операционно перед QA/PROD.
7. **Дублирование deploy/windows.** Есть `deploy/windows/build` и `deploy/windows/FeoSport2-Windows-Package/build`; нужно определить canonical path, чтобы не править два места вручную.
8. **Node/pkg targets.** В workflow, локальном скрипте и `backend/package.json` встречаются разные pkg target/version naming.

## 7. Рекомендуемый следующий план

1. Исправить Socket.io URL для production/nginx.
2. Привести healthcheck к `/healthz` во всех Railway docs/config или добавить alias `/api/healthz`.
3. Добавить `db_migrations` и `backend/scripts/migrate.js`.
4. Добавить `POST /api/admin/import/pilots`.
5. Добавить `GET /api/admin/backup` с безопасным admin-only `pg_dump`.
6. Прогнать unified stack локально: frontend, login, roles, `/tmx/`, Socket.io, admin DB status.
7. Запустить AQA workflow и build-installer workflow.
8. Проверить Windows installer на Windows 11: install-over-old, сохранность PostgreSQL data, телефоны в WiFi, pgAdmin launcher.
9. Проверить Railway QA на реальном домене и обновить `DEPLOY_RAILWAY.md` по фактическому сценарию.


---
name: run-feosport2
description: run, start, launch, test, smoke test, screenshot FeoSport2 backend API server; drive competitions, pilots, heats, auth endpoints
---

# run-feosport2

FeoSport2 is a Node.js/Express backend (port 8090) + React/Vite frontend (port 8080) backed by PostgreSQL 16. The agent path is `driver.mjs` — a curl-style smoke harness that starts the server, exercises CRUD endpoints, and stops cleanly. No Docker needed for backend-only work.

Paths below are relative to the repo root (`feosport2/`).

---

## Prerequisites

```bash
# macOS (Homebrew PostgreSQL already running on :5432)
brew install postgresql@14   # or 16 — already installed if pg_isready works
pg_isready -h localhost -p 5432   # must say "accepting connections"

cd feosport2/backend && npm ci   # install backend deps
```

No extra `apt-get` needed on macOS. On Linux: `apt-get install -y nodejs npm postgresql postgresql-contrib`.

---

## One-time DB setup

```bash
# Create schema (idempotent — safe to re-run)
psql -h localhost -d postgres -c "CREATE DATABASE feosport2;" 2>/dev/null || true
psql -h localhost -d feosport2 -f database/init.sql

# Create the admin test user (password: admin123)
node .claude/skills/run-feosport2/driver.mjs seed-user
```

> **Note:** `database/seed.sql` uses `RETURNING id INTO array[N]` syntax that requires PostgreSQL 16. On PG14 (macOS Homebrew default) it fails — use `seed-user` command above instead for a minimal admin account.

---

## Run — agent path (driver.mjs)

```bash
# Full smoke test: start → healthz + auth + CRUD → stop
node .claude/skills/run-feosport2/driver.mjs smoke

# Individual commands
node .claude/skills/run-feosport2/driver.mjs start      # background server, waits for /healthz
node .claude/skills/run-feosport2/driver.mjs token      # print JWT for admin@feosport.local
node .claude/skills/run-feosport2/driver.mjs stop       # kill server
node .claude/skills/run-feosport2/driver.mjs seed-user  # insert admin user into feosport2 DB
```

After `start`, query any endpoint:

```bash
TOKEN=$(node .claude/skills/run-feosport2/driver.mjs token)
curl -s http://localhost:8090/api/pilots -H "Authorization: Bearer $TOKEN" | jq .
curl -s http://localhost:8090/api/competitions -H "Authorization: Bearer $TOKEN" | jq .
curl -s -X POST http://localhost:8090/api/heats \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"competition_id":1,"name":"Heat 1","round":1}' | jq .
```

Driver writes server PID to `.claude/skills/run-feosport2/.server.pid` — `stop` reads it for clean shutdown.

---

## Run — human path

```bash
# Terminal 1: backend
cd backend && npm run dev      # nodemon, hot-reload, port 8090

# Terminal 2: frontend
cd frontend && npm run dev     # Vite dev server, port 5173
# Open http://localhost:5173
```

This path requires a `.env` at repo root (see `.env` — already present).

---

## DB connection for local dev

The `.env` sets `DB_USER=postgres` — that role doesn't exist on macOS Homebrew installs. The driver overrides it automatically with `process.env.USER`. If you run manually:

```bash
DB_USER=$(whoami) DB_PASSWORD="" node backend/src/server.js
```

Or permanently create the role:

```bash
psql -h localhost -d postgres -c "CREATE ROLE postgres SUPERUSER LOGIN;"
```

---

## API overview

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/auth/login` | — | Returns JWT |
| GET | `/api/pilots` | Bearer | List pilots |
| POST | `/api/pilots` | Bearer | Create pilot |
| GET | `/api/competitions` | Bearer | List competitions |
| POST | `/api/competitions` | Bearer | Create competition |
| GET | `/api/heats?competition_id=N` | Bearer | List heats |
| GET | `/healthz` | — | Health check |

Admin credentials: `admin@feosport.local` / `admin123` (after `seed-user`).

---

## Gotchas

- **`DB_USER=postgres` fails on macOS Homebrew** — Homebrew creates PG with your OS username as superuser, not `postgres`. Driver handles this automatically via `process.env.USER`.
- **seed.sql requires PG16** — `RETURNING id INTO array[N]` is PG16 syntax. On PG14, run `seed-user` command instead.
- **Port 8090 already in use** — `driver.mjs start` calls `stop` first, but if a leftover process owns the port: `lsof -ti:8090 | xargs kill -9`.
- **JWT_SECRET mismatch** — if you start the server with one secret and then try a token from another run, you'll get 401. `driver.mjs start` always uses `dev-secret-feosport2` unless `JWT_SECRET` env is set.
- **`/api/competitions` accepts `date` field but stores as `start_date`** — the route maps the field; don't pass `start_date` in POST body directly.
- **FD_SYNC warnings at startup** — `[fd-sync] FD_EMAIL/FD_PASSWORD не заданы` is normal in dev; FormDesigner sync is disabled, app works fully.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `role "postgres" does not exist` | Set `DB_USER=$(whoami) DB_PASSWORD=""` or create the role (see above) |
| `database "feosport2" does not exist` | Run the one-time DB setup block above |
| `Invalid credentials` on login | Run `node .claude/skills/run-feosport2/driver.mjs seed-user` |
| `EADDRINUSE :8090` | `lsof -ti:8090 | xargs kill -9` |
| `Cannot find module 'bcryptjs'` in seed-user | `cd backend && npm ci` |
| PG16 seed.sql errors | Expected on PG14 — use `seed-user` command, ignore seed.sql |

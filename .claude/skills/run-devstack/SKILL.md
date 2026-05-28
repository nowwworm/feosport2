---
name: run-devstack
description: run, launch, start full dev environment; backend API + React frontend + database
---

# run-devstack

Complete FeoSport2 development environment: PostgreSQL 16 (localhost:5432), backend Node.js (8090), React/Vite frontend (5173). All three services in one command via `docker-compose`.

---

## Prerequisites

```bash
# Must have Docker + Docker Compose
docker --version
docker-compose --version

# Optional: native PostgreSQL on :5432 running (skip if using containers)
# pg_isready -h localhost -p 5432
```

---

## One-time setup

```bash
# Create feosport2 database + schema (if using native Postgres, skip the container step)
psql -h localhost -d postgres -c "CREATE DATABASE feosport2;" 2>/dev/null || true
psql -h localhost -d feosport2 -f database/init.sql

# Seed admin user
node .claude/skills/run-feosport2/driver.mjs seed-user
```

If using **Docker Compose**:

```bash
# Starts all 3 services in background
docker-compose up -d

# Wait ~5s for DB to be ready, then seed
sleep 5
node .claude/skills/run-feosport2/driver.mjs seed-user
```

---

## Run — full stack (docker-compose)

```bash
# Start all services
docker-compose up

# In another terminal, open browser to http://localhost:5173
# Backend API: http://localhost:8090
# Frontend: http://localhost:5173
```

Logs are streamed to terminal. `Ctrl-C` to stop all services.

---

## Run — unified stack (nginx on :80, shared on WiFi)

For multi-device access on the same WiFi (judges/pilots on phones, TMX on the main judge's laptop), use the unified compose file — nginx reverse-proxies everything on port 80.

```bash
docker-compose -f docker-compose.unified.yml up -d --build
```

Then print the URLs other devices on the same WiFi should open:

```bash
./scripts/lan-url.sh
```

Sample output (works on any router — 192.168.x, 10.x, 172.16-31.x; auto-skips VPN tunnels):

```
Interface : en0
Network   : 192.168.1.0/24  (range 192.168.1.1 – 192.168.1.254)

  Frontend : http://192.168.1.44/
  TMX      : http://192.168.1.44/tmx/
  API      : http://192.168.1.44/api/
```

Override port if nginx is bound to something other than 80:
```bash
PORT=4444 ./scripts/lan-url.sh
```

Gotcha: macOS firewall must permit incoming on the nginx port — check `/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate`.

Stop unified stack:
```bash
docker-compose -f docker-compose.unified.yml down
```

---

## Run — minimal (native services only)

Terminal 1 — PostgreSQL (must already be running):
```bash
# Check it's ready
pg_isready -h localhost -p 5432
```

Terminal 2 — backend:
```bash
cd backend && npm run dev
# Ready: http://localhost:8090/healthz
```

Terminal 3 — frontend:
```bash
cd frontend && npm run dev
# Ready: http://localhost:5173
```

Open http://localhost:5173 in browser.

---

## Smoke test — everything working?

```bash
node .claude/skills/run-feosport2/driver.mjs smoke
```

Output on success:
```
healthz: { status: 'ok' }
token: eyJ...
pilots count: 0
created pilot id: 1
created competition id: 1
✅ Smoke test PASSED
```

---

## Services breakdown

| Service | Port | Tech | Status URL |
|---------|------|------|------------|
| PostgreSQL | 5432 | Postgres 16 | `psql -h localhost` |
| Backend API | 8090 | Node.js/Express | `http://localhost:8090/healthz` |
| Frontend | 5173 | Vite/React | `http://localhost:5173/` |
| TMX | 8090/tmx | Static SPA | `http://localhost:8090/tmx/` |

---

## Common commands

```bash
# Stop all (docker-compose)
docker-compose down

# Restart backend only
docker-compose restart backend

# View logs for one service
docker-compose logs -f backend

# Rebuild images (after dependency changes)
docker-compose build --no-cache
```

---

## Gotchas

- **Docker Desktop must be running** — `docker ps` should work
- **Port conflicts** — if 5432, 8090, 5173 in use, stop conflicting services
- **DB schema not loaded** — run `psql -h localhost -d feosport2 -f database/init.sql` manually
- **Frontend can't reach backend** — check `docker-compose.yml` env: `VITE_API_URL: http://localhost:8090`
- **Volumes not updating** — restart with `docker-compose down && docker-compose up`

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `docker: command not found` | Install Docker Desktop; restart terminal after install |
| `error: only one instance of each socket address (protocol/port/0.0.0.0/5432) should be permitted` | Stop existing Postgres: `lsof -ti:5432 \| xargs kill -9` |
| `backend_1 exited with code 1` | Check logs: `docker-compose logs backend` |
| `frontend shows blank page / 404` | `docker-compose restart frontend` |
| `psql: FATAL: role "postgres" does not exist` | Create role: `createuser postgres -s` (macOS Homebrew) |

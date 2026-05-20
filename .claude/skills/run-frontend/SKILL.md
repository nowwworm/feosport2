---
name: run-frontend
description: run, start, launch, develop, screenshot React/Vite frontend; live reload on port 5173
---

# run-frontend

FeoSport2 frontend is a React app built with Vite, served on port 5173 with hot reload. The backend API runs on port 8090; Vite proxies requests via `VITE_API_URL`.

---

## Prerequisites

```bash
# Check Node.js version (need 18+)
node --version

# Install frontend deps
cd frontend && npm ci
```

---

## One-time setup

Start the backend first (see `/run-feosport2` or start manually):

```bash
# In separate terminal
cd backend && npm run dev
# or
node .claude/skills/run-feosport2/driver.mjs start
```

---

## Run — agent path (vite dev server)

```bash
cd frontend && VITE_API_URL=http://localhost:8090 npm run dev
```

Output:
```
VITE v5.x.x  ready in xxx ms

➜  Local:   http://localhost:5173/
```

Open http://localhost:5173 in a browser. Changes auto-reload.

---

## Run — human path

Terminal 1 — backend:
```bash
cd backend && npm run dev
```

Terminal 2 — frontend:
```bash
cd frontend && npm run dev
# Open http://localhost:5173
```

---

## Build for production

```bash
cd frontend && npm run build
# Output: dist/
```

---

## API endpoints available

| Endpoint | Auth | Purpose |
|----------|------|---------|
| POST `/api/auth/login` | — | Login, returns JWT |
| GET `/api/pilots` | Bearer | List all pilots |
| POST `/api/pilots` | Bearer | Create pilot |
| GET `/api/competitions` | Bearer | List competitions |
| POST `/api/competitions` | Bearer | Create competition |

Test credentials (after `node .claude/skills/run-feosport2/driver.mjs seed-user`):
- Email: `admin@feosport.local`
- Password: `admin123`

---

## Env vars

| Var | Default | Purpose |
|-----|---------|---------|
| `VITE_API_URL` | `http://localhost:8090` | Backend API base URL (e.g. for production) |
| `VITE_APP_TITLE` | `FeoSport2` | Browser title, app name |

Vite reads `.env` and `.env.local` (not committed).

---

## Gotchas

- **Port 5173 in use** — `lsof -ti:5173 | xargs kill -9`
- **VITE_API_URL empty string** — production build serves frontend only, no backend
- **API 401 Unauthorized** — backend token expired or not set. Get fresh token: `TOKEN=$(node .claude/skills/run-feosport2/driver.mjs token)`
- **CORS errors** — backend missing `Access-Control-Allow-*` headers. Check `backend/src/middleware/cors.js`
- **Vite HMR timeout** — if webpack takes 30s+, restart dev server

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `npm ERR! Cannot find module 'react'` | `npm ci` in frontend dir |
| `EADDRINUSE :5173` | Kill: `lsof -ti:5173 \| xargs kill -9` |
| `proxy error: connect ECONNREFUSED localhost:8090` | Start backend: `npm run dev` in backend/ |
| Blank page / 404 on `/` | Vite dev server failed. Check terminal for errors |
| Network tab shows 401 on API calls | Login first or use valid Bearer token |

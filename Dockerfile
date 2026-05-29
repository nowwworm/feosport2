# syntax=docker/dockerfile:1.7

# ─── Stage 1: Build frontend (Vite) ──────────────────────────────────────────
# VITE_API_URL пустая — фронт ходит на same-origin (backend отдаёт и API,
# и статику с одного домена; CORS не нужен).
FROM node:24-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
ENV VITE_API_URL=""
RUN npm run build

# ─── Stage 2: Install backend prod dependencies ──────────────────────────────
FROM node:24-alpine AS backend-builder
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev

# ─── Stage 3: Runtime ────────────────────────────────────────────────────────
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Backend
COPY --from=backend-builder /app/backend/node_modules ./backend/node_modules
COPY backend/package*.json ./backend/
COPY backend/src           ./backend/src
COPY backend/scripts       ./backend/scripts

# Database (init.sql + migrations подхватываются backend/scripts/migrate.js)
COPY database ./database

# Frontend dist — статика отдаётся из app.js (см. FRONTEND_DIST)
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

EXPOSE 8090
WORKDIR /app/backend
CMD ["node", "src/server.js"]

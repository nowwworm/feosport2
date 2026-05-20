# ─────────────────────────────────────────────────────────────────────────────
# TMX — pre-built image.
# TMX is built LOCALLY before docker-compose (see build-tmx.sh in project root).
# Docker only serves the pre-built dist/ — no npm install inside the container.
# ─────────────────────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine

# Copy pre-built TMX static assets (built locally via build-tmx.sh)
COPY TMX/dist /usr/share/nginx/html/tmx

# SPA fallback config for /tmx/ sub-path
COPY TMX/nginx-tmx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3000

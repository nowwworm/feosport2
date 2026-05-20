# Деплой FeoSport2 на Railway (QA-стенд)

## Предварительные требования

- Аккаунт Railway (railway.app) с активной подпиской
- Git репозиторий проекта (GitHub / GitLab)
- Docker Hub или Railway Container Registry (для образа TMX)

---

## 1. Подготовка репозитория

TMX собирается локально перед пушем. Убедись, что `feoTEST/TMX/dist/` собран:

```bash
bash build-tmx.sh  # собирает TMX локально, НЕ запускает docker-compose
```

> Если не хочешь коммитить `dist/` — настрой Railway Build Command (шаг 4).

---

## 2. Создание проекта на Railway

1. Открой [railway.app](https://railway.app) → **New Project**
2. Выбери **Deploy from GitHub repo** → выбери `feosport2`
3. Railway обнаружит `docker-compose.unified.yml` автоматически

---

## 3. Добавить PostgreSQL

1. В проекте Railway → **+ New** → **Database** → **PostgreSQL**
2. Railway автоматически создаст переменную `DATABASE_URL`
3. В сервисе `backend` добавь в Variables:
   ```
   DB_HOST     = ${{Postgres.PGHOST}}
   DB_NAME     = ${{Postgres.PGDATABASE}}
   DB_USER     = ${{Postgres.PGUSER}}
   DB_PASSWORD = ${{Postgres.PGPASSWORD}}
   ```

---

## 4. Переменные окружения (Variables)

Скопируй из `.env.railway.example` и заполни в Railway → Variables:

| Переменная | Значение |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | сгенерировать: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `ALLOWED_ORIGINS` | `https://YOUR-APP.up.railway.app` |
| `VITE_API_URL` | `https://YOUR-APP.up.railway.app` |
| `FD_EMAIL` | email FormDesigner (если нужно) |
| `FD_PASSWORD` | пароль FormDesigner (если нужно) |

Railway сам проставляет `PORT` — не переопределяй.

---

## 5. Домен

1. Railway → сервис `nginx` → **Settings** → **Networking** → **Generate Domain**
2. Скопируй домен (`https://feosport2-qa.up.railway.app`)
3. Обнови `ALLOWED_ORIGINS` и `VITE_API_URL` на этот домен
4. Задеплой снова (Railway пересоберёт автоматически после сохранения Variables)

---

## 6. Smoke-тест после деплоя

```bash
# Проверка API
curl https://feosport2-qa.up.railway.app/api/healthz
# → {"status":"ok"}

# Проверка фронтенда
curl -I https://feosport2-qa.up.railway.app/
# → HTTP/2 200

# Проверка TMX
curl -I https://feosport2-qa.up.railway.app/tmx/
# → HTTP/2 200
```

---

## 7. Обновление QA-стенда

```bash
# 1. Пересобрать TMX если были изменения
bash build-tmx.sh

# 2. Закоммитить и запушить
git add feoTEST/TMX/dist
git commit -m "chore: rebuild TMX dist"
git push origin main
```

Railway задеплоит автоматически при пуше в `main`.

---

## Структура сервисов на Railway

```
Railway Project: FeoSport2-QA
├── db          (PostgreSQL 16)
├── backend     (Node.js + Express + Socket.io, порт 8090)
├── frontend    (React + Vite, порт 8080)
├── tmx         (nginx + TMX dist, порт 3000)
└── nginx       (reverse proxy, публичный порт 80/443)
```

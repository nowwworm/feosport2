# FeoSport2 — Сборка и установка на Windows 11

## Что получает конечный пользователь

`FeoSport2-Setup.exe` — один файл (~400 MB), который без каких-либо предустановок:

- Устанавливает **PostgreSQL 16** (опционально, если ещё нет)
- Создаёт базу `feosport2` со схемой и тестовыми данными
- Устанавливает **feosport2-server.exe** — скомпилированный Node.js-сервер (Node.js пользователю не нужен)
- Устанавливает собранный фронтенд **React** и модуль **TMX** (CourtHive)
- Создаёт ярлыки в меню «Пуск» и на рабочем столе

Приложение работает локально: **http://localhost:8090**  
TMX-модуль: **http://localhost:8090/tmx/**

---

## Часть 1 — Сборка EXE (делается один раз разработчиком)

### Требования к машине разработчика

> ⚠️ **Сборка выполняется только на Windows.** Inno Setup (компилятор .exe) работает исключительно под Windows.

| Инструмент | Версия | Как установить |
|---|---|---|
| Windows 10/11 | — | — |
| Node.js | **22 LTS** | https://nodejs.org (TMX требует ≥ 22) |
| pnpm | **8+** | `npm install -g pnpm` |
| @vercel/pkg | latest | `npm install -g @vercel/pkg` |
| Inno Setup 6 | 6.x | см. ниже |
| Git | any | https://git-scm.com |

**Установка Inno Setup 6:**
```powershell
winget install -e --id JRSoftware.InnoSetup --accept-source-agreements --accept-package-agreements
```
Или вручную: https://jrsoftware.org/isdl.php → `innosetup-6.x.x.exe`

**Проверка окружения перед сборкой:**
```powershell
node --version    # должно быть v22.x.x
pnpm --version    # должно быть 8.x или 11.x
pkg --version     # должно быть 5.x
```

---

### Запуск сборки

Открыть **PowerShell от имени Администратора**, перейти в корень проекта:

```powershell
cd C:\path\to\feosport2
powershell -ExecutionPolicy Bypass -File deploy\windows\build\build-installer.ps1
```

#### Что делает скрипт (6 шагов):

| Шаг | Действие | Время |
|---|---|---|
| 1 | `npm install` в `backend/` → `pkg` компилирует `server-bundled.js` в **feosport2-server.exe** | 2–5 мин |
| 2 | `npm install` в `frontend/` → `vite build` → **frontend-dist/** | 1–2 мин |
| 2b | `pnpm install` в `feoTEST/TMX/` → `vite build` → **tmx-dist/** | 2–4 мин |
| 3 | Копирует `database/init.sql` и `database/seed.sql` в staging | < 1 сек |
| 4 | Скачивает **PostgreSQL 16** installer (~300 MB) — только если файл отсутствует | 3–10 мин |
| 5 | Автоматически устанавливает **Inno Setup** — если не установлен | 1 мин |
| 6 | `ISCC.exe` компилирует `feosport2.iss` → **FeoSport2-Setup.exe** | 1–2 мин |

**Итоговый файл:**
```
deploy\windows\output\FeoSport2-Setup.exe
```

#### Повторная сборка (после изменений в коде):

```powershell
# Полная пересборка
powershell -ExecutionPolicy Bypass -File deploy\windows\build\build-installer.ps1

# Если нужно только пересобрать .exe без повторной загрузки PostgreSQL —
# положи postgresql-16-win-x64.exe в deploy\windows\build\deps\ заранее,
# тогда шаг 4 пропускается автоматически.
```

---

### Структура staging (что попадает в установщик)

```
deploy\windows\build\
├── staging\
│   ├── app\
│   │   ├── feosport2-server.exe   ← скомпилированный backend
│   │   └── scripts\seed.js        ← Node.js seed (legacy, не используется)
│   ├── frontend-dist\             ← React SPA
│   ├── tmx-dist\                  ← TMX статика
│   └── database\
│       ├── init.sql               ← схема БД
│       └── seed.sql               ← тестовые данные
├── deps\
│   └── postgresql-16-win-x64.exe  ← PostgreSQL installer (~300 MB)
├── bundled-scripts\               ← BAT/PS1 попадают в {app}\
│   ├── setup-db.ps1
│   ├── start-feosport.bat
│   ├── stop-feosport.bat
│   └── seed-data.bat
├── build-installer.ps1            ← главный скрипт сборки
└── feosport2.iss                  ← Inno Setup сценарий
```

---

### Возможные ошибки при сборке

**`pkg: Error: ENOENT`** — node_modules не установлены:
```powershell
cd backend && npm install && cd ..
```

**TMX build error: `engines.node >= 22 required`** — устаревший Node:
```powershell
# Обновить Node.js до v22 LTS с nodejs.org, затем:
node --version  # v22.x.x
```

**`ISCC.exe не найден`** — Inno Setup не установлен или установлен в нестандартный путь:
```powershell
winget install -e --id JRSoftware.InnoSetup
# Или установи вручную, скрипт найдёт автоматически
```

**Скачивание PostgreSQL зависло** — скачай вручную и положи файл:
```
https://get.enterprisedb.com/postgresql/postgresql-16.3-1-windows-x64.exe
→ deploy\windows\build\deps\postgresql-16-win-x64.exe
```

---

## Часть 2 — Установка на целевой машине (Windows 11)

### Пошаговая установка

1. Скопировать `FeoSport2-Setup.exe` на целевую машину
2. Нажать правой кнопкой → **Запустить от имени администратора**
3. Выбрать компоненты:
   - ✅ **Приложение FeoSport2** — обязательно (нельзя снять)
   - ✅ **PostgreSQL 16** — выбрать, если PostgreSQL не установлен
4. Ввести **пароль суперпользователя postgres**
   - При новой установке: придумать любой пароль, запомнить его
   - При обновлении поверх существующего PostgreSQL: ввести действующий пароль
5. Ввести **пароль пользователя приложения feosport** (можно оставить `feosport2024`)
6. После установки нажать **«Запустить FeoSport2 сейчас»**

Браузер откроется на **http://localhost:8090**

---

### Тестовые учётные записи

Загружаются автоматически при установке.

| Email | Пароль | Роль | Доступные разделы |
|---|---|---|---|
| `admin@feosport.local` | `admin123` | Администратор | Все разделы + TMX |
| `chief@feosport.local` | `judge123` | Главный судья | Таблица, Сетка, Судья, Пилоты, TMX, Справка |
| `judge@feosport.local` | `judge123` | Судья | Таблица, Сетка, Судья |
| `pilot@feosport.local` | `judge123` | Пилот | Таблица, Сетка |

> ⚠️ **Перед использованием на соревновании** смените пароли:  
> Аккаунты → выбрать пользователя → Новый пароль

---

### Ярлыки в меню «Пуск» → FeoSport2

| Ярлык | Действие |
|---|---|
| **FeoSport2** | Запустить сервер + открыть http://localhost:8090 |
| Остановить FeoSport2 | Завершить процесс feosport2-server.exe |
| Загрузить тестовые данные | Повторно применить seed.sql (спрашивает пароль postgres) |
| Удалить FeoSport2 | Деинсталляция (БД и данные не удаляются) |

---

### Файлы после установки

```
C:\Program Files\FeoSport2\
├── feosport2-server.exe   ← запускать этот файл (или через start-feosport.bat)
├── .env                   ← конфиг (порт, пароль БД, JWT secret)
├── frontend-dist\         ← React UI
├── tmx-dist\              ← TMX модуль
├── database\
│   ├── init.sql
│   └── seed.sql
├── start-feosport.bat     ← запуск
├── stop-feosport.bat      ← остановка
├── seed-data.bat          ← загрузка тестовых данных
└── setup-db.ps1           ← настройка БД (запускался при установке)
```

---

## Часть 3 — Эксплуатация

### Запуск и остановка

**Запуск** (через ярлык или вручную):
```
C:\Program Files\FeoSport2\start-feosport.bat
```

**Остановка:**
```
C:\Program Files\FeoSport2\stop-feosport.bat
```

**Запуск с выводом логов в консоль** (для диагностики):
```powershell
cd "C:\Program Files\FeoSport2"
.\feosport2-server.exe
```

### Настройка порта

По умолчанию: `8090`. Чтобы изменить — отредактировать `.env`:
```
PORT=8091
```
Затем перезапустить через `start-feosport.bat`.

### Доступ с других устройств в сети

Приложение слушает на `0.0.0.0:8090`, поэтому с планшета или телефона в той же WiFi-сети доступно по IP машины:
```
http://192.168.1.XXX:8090
```
(заменить XXX на реальный IP Windows-машины)

Брандмауэр: установщик автоматически открывает порт 8090. Если не открылся:
```powershell
New-NetFirewallRule -DisplayName "FeoSport2" -Direction Inbound -Protocol TCP -LocalPort 8090 -Action Allow
```

---

## Часть 4 — Устранение неполадок

**Ошибка входа (500 Internal Server Error)** — PostgreSQL не запущен:
```powershell
Get-Service postgresql* | Start-Service
```

**Страница не открывается** — сервер не запущен. Запустить `start-feosport.bat`, подождать 5 секунд.

**«База уже существует» при повторной установке** — seed.sql проверяет наличие данных и пропускает, если пилоты уже есть. Данные не удаляются при переустановке.

**Тестовые данные не загрузились при установке** — запустить `seed-data.bat` из папки `C:\Program Files\FeoSport2\` и ввести пароль postgres.

**Порт 8090 занят другим приложением:**
```powershell
netstat -ano | findstr :8090   # найти PID
taskkill /PID <PID> /F         # завершить
```
или сменить порт в `.env`.

**Деинсталляция** — через «Пуск → FeoSport2 → Удалить» или «Программы и компоненты». База данных и данные **не удаляются** автоматически. Чтобы удалить БД:
```powershell
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -c "DROP DATABASE feosport2;"
```

# FeoSport2: Docker и Windows-инсталлятор

## Вариант 1. Запуск через Docker Compose

Требуется установленный Docker Desktop.

В корне проекта уже есть `.env` для локального запуска. Если файла нет, создай его из `.env.example` и проверь пароль базы:

```env
DB_NAME=feosport2
DB_USER=postgres
DB_PASSWORD=CHANGE_ME_STRONG_PASSWORD
JWT_SECRET=сгенерируй_длинную_случайную_строку
NODE_ENV=development
```

Запуск:

```powershell
cd C:\Users\danie\Desktop\nowwworm\feosport2
docker compose up --build
```

Адреса:

- Backend API: `http://localhost:8090`
- Frontend: `http://localhost:8080`
- PostgreSQL: `localhost:5432`

Остановка:

```powershell
docker compose down
```

Полная очистка базы Docker:

```powershell
docker compose down -v
```

## Вариант 2. Сборка Windows-инсталлятора

Требуется запуск PowerShell от имени администратора.

Нужно установить:

- Node.js 22 LTS
- pnpm 8+
- Inno Setup 6
- Git

Проверка:

```powershell
node --version
pnpm --version
```

Inno Setup должен иметь `ISCC.exe`, обычно здесь:

```text
C:\Program Files (x86)\Inno Setup 6\ISCC.exe
```

Сборка:

```powershell
cd C:\Users\danie\Desktop\nowwworm\feosport2
powershell -ExecutionPolicy Bypass -File deploy\windows\build\build-installer.ps1
```

Итоговый файл:

```text
deploy\windows\output\FeoSport2-Setup.exe
```

Если скрипт не сможет скачать PostgreSQL installer автоматически, скачай PostgreSQL 16 для Windows вручную и положи файл сюда:

```text
deploy\windows\build\deps\postgresql-16-win-x64.exe
```

После этого запусти `build-installer.ps1` повторно.

## Важное по TMX

TMX требует Node.js `>=22`. В проекте обновлены зависимости TMX:

- `courthive-components@1.8.0`
- `tods-competition-factory@4.1.0`

Проверочная сборка:

```powershell
cd C:\Users\danie\Desktop\nowwworm\feosport2\feoTEST\TMX
pnpm run build
```

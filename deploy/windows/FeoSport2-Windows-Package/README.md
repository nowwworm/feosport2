# FeoSport2 — Установка на Windows 11

## Два варианта запуска

### Вариант А — Docker Desktop (рекомендуется)
Точно такая же среда, как на Mac/Linux. Требует ~6 ГБ RAM.

### Вариант Б — Нативно (Node.js + PostgreSQL)
Без Docker. Немного сложнее, но работает на слабых машинах.

---

## Вариант А — Docker Desktop

### Требования
- Windows 11 (Home или Pro)
- 8 ГБ RAM (рекомендуется)
- Интернет для первой установки

### Шаги

1. Открой PowerShell **от имени Администратора** и выполни:
   ```powershell
   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
   .\deploy\windows\docker\01-install-docker.ps1
   ```
2. После перезагрузки дождись запуска Docker Desktop (иконка в трее)
3. Настрой пароли:
   ```powershell
   .\deploy\windows\docker\02-setup-env.ps1
   ```
4. Запусти приложение:
   ```
   deploy\windows\docker\start.bat
   ```
5. Открой браузер: **http://localhost:8080**

### Управление
| Файл | Действие |
|------|----------|
| `start.bat` | Запустить все сервисы |
| `stop.bat`  | Остановить |
| `logs.bat`  | Смотреть логи |
| `seed.bat`  | Загрузить тестовые данные |

---

## Вариант Б — Нативно

### Требования
- Windows 11
- 4 ГБ RAM
- Интернет для первой установки

### Шаги

1. PowerShell **от имени Администратора**:
   ```powershell
   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
   .\deploy\windows\native\01-install-deps.ps1
   ```
2. Настрой базу данных:
   ```powershell
   .\deploy\windows\native\02-setup-db.ps1
   ```
3. Настрой .env:
   ```powershell
   .\deploy\windows\native\03-setup-env.ps1
   ```
4. Запусти приложение:
   ```
   deploy\windows\native\start.bat
   ```
5. Открой браузер: **http://localhost:8080**

---

## Первый вход
- Email: `admin@feosport.local`
- Пароль: `admin123`

## Тестовые данные (2 команды, 2 соревнования)
```
deploy\windows\docker\seed.bat      # для Docker
deploy\windows\native\seed.bat      # для нативного запуска
```

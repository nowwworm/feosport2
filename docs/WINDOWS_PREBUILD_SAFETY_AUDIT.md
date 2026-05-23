# Windows prebuild safety audit

Дата проверки: 2026-05-23.

## Вывод

В runtime-коде FeoSport2 нет операций, которые меняют Windows PIN, Windows Hello, Microsoft account, UAC, power menu, политики входа или параметры электропитания.

Последние изменения приложения:

- `70d5749` — backend demo-data generator.
- `35ab0b0` — перенос TMX в админку, справка, UX таблицы.
- `7e9f6da` — `.gitignore` для Office lock/docx.

Эти коммиты не содержат Windows registry, `powercfg`, `net user`, `secedit`, `gpupdate`, Winlogon/Policies, Credential Manager, PIN/Hello/NGC или системные account настройки.

## Что реально трогает Windows

| Файл | Действие | Оценка |
|---|---|---|
| `deploy/windows/build/feosport2.iss` | Установщик требует admin, ставит файлы, запускает `setup-db.ps1`, создаёт ярлыки и user-startup shortcut при выбранной задаче | Нормально для installer |
| `deploy/windows/build/bundled-scripts/setup-db.ps1` | Создаёт БД, пользователя `feosport`, пишет `.env`, открывает firewall TCP 8090, запускает PostgreSQL service | Нормально для native PROD |
| `deploy/windows/native/01-install-deps.ps1` | Ставит Node/PostgreSQL через winget, добавляет PostgreSQL bin в Machine PATH | Допустимо, но это dev/native setup, не runtime |
| `deploy/windows/docker/01-install-docker.ps1` | Может включать WSL2/VirtualMachinePlatform и reboot | Было рискованно для неподготовленной машины |
| `deploy/windows/docker/02-setup-env.ps1` | Пишет `deploy\.env`, открывает firewall TCP 80 | Нормально для Docker режима |

## Исправление перед сборкой

Docker setup теперь не включает Windows Optional Features по умолчанию.

Для включения WSL2/VirtualMachinePlatform требуется явный запуск:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\windows\docker\01-install-docker.ps1 -EnableWindowsFeatures
```

Автоматическая перезагрузка выполняется только при явном:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\windows\docker\01-install-docker.ps1 -EnableWindowsFeatures -RestartWhenReady
```

## Рекомендация для Windows-сборки заказчику

Для демо и соревнований использовать native installer `FeoSport2-Setup.exe`, а не Docker setup.

Перед сборкой/установкой:

1. Не запускать `deploy/windows/docker/01-install-docker.ps1` на машине заказчика без отдельного согласования.
2. Проверить, что installer не добавляет системные политики: поиск по `Winlogon`, `Policies`, `powercfg`, `net user`, `secedit`, `gpupdate`, `PassportForWork`, `Ngc` должен быть пустым в installer/runtime ветке.
3. На целевой машине после установки проверять только:
   - `http://localhost:8090`
   - PostgreSQL service
   - firewall rule `FeoSport2`
   - `.env` рядом с exe.

## Что делать, если Windows уже глючит

Симптомы с PIN/Microsoft account/power menu/admin console обычно находятся вне зоны FeoSport2. Проверить стоит:

- Windows Update и pending reboot.
- Включение WSL2/VirtualMachinePlatform/Docker Desktop.
- Политики организации/учётной записи Microsoft.
- Повреждение системных компонентов Windows.

Минимальная безопасная диагностика на проблемной машине:

```powershell
Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux,VirtualMachinePlatform
whoami /groups
Get-LocalGroupMember docker-users -ErrorAction SilentlyContinue
Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" -ErrorAction SilentlyContinue
Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\PolicyManager\default\Settings" -ErrorAction SilentlyContinue
```

Эти команды только читают состояние.

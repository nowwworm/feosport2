; FeoSport2 Inno Setup Script
; Компилировать командой:
;   "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" feosport2.iss
; или запустить build-installer.ps1

#define AppName      "FeoSport2"
#define AppVersion   "1.0"
#define AppPublisher "FeoSport"
#define AppURL       "http://localhost:8090"
#define AppExe       "feosport2-server.exe"
#define InstallDir   "{pf}\FeoSport2"

[Setup]
AppId={{8A3F7C1D-2B4E-4F9A-BC6E-1D3E5F7A9C2B}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
DefaultDirName={#InstallDir}
DefaultGroupName={#AppName}
AllowNoIcons=yes
OutputDir=..\output
OutputBaseFilename=FeoSport2-Setup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
MinVersion=10.0.19041
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\{#AppExe}
CloseApplications=yes
SetupLogging=yes

; Страницы установщика
[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"

[Types]
Name: "full";    Description: "Полная установка"
Name: "compact"; Description: "Только приложение (PostgreSQL уже установлен)"

[Components]
Name: "app";      Description: "Приложение FeoSport2";    Types: full compact; Flags: fixed
Name: "postgres"; Description: "PostgreSQL 16 (если не установлен)"; Types: full

[Tasks]
Name: "desktopicon"; Description: "Создать ярлык на рабочем столе"; GroupDescription: "Дополнительно:"
Name: "autostart";   Description: "Запускать автоматически при входе в Windows"; GroupDescription: "Дополнительно:"

[Files]
; Основной сервер (скомпилированный pkg)
Source: "staging\app\{#AppExe}";         DestDir: "{app}";                   Flags: ignoreversion
Source: "staging\app\scripts\seed.js";   DestDir: "{app}\scripts";           Flags: ignoreversion

; Собранный фронтенд
Source: "staging\frontend-dist\*";       DestDir: "{app}\frontend-dist";     Flags: ignoreversion recursesubdirs createallsubdirs

; TMX (турнирная сетка) — статический SPA, раздаётся сервером по пути /tmx/
Source: "staging\tmx-dist\*";            DestDir: "{app}\tmx-dist";          Flags: ignoreversion recursesubdirs createallsubdirs; Components: app

; База данных
Source: "staging\database\init.sql";     DestDir: "{app}\database";          Flags: ignoreversion
Source: "staging\database\seed-users.sql"; DestDir: "{app}\database";        Flags: ignoreversion
Source: "staging\database\seed.sql";     DestDir: "{app}\database";          Flags: ignoreversion

; Вспомогательные скрипты
Source: "bundled-scripts\setup-db.ps1";     DestDir: "{app}";               Flags: ignoreversion
Source: "bundled-scripts\start-feosport.bat"; DestDir: "{app}";             Flags: ignoreversion
Source: "bundled-scripts\stop-feosport.bat";  DestDir: "{app}";             Flags: ignoreversion
Source: "bundled-scripts\seed-data.bat";      DestDir: "{app}";             Flags: ignoreversion
Source: "bundled-scripts\collect-logs.ps1";   DestDir: "{app}";             Flags: ignoreversion
Source: "bundled-scripts\check-updates.ps1";  DestDir: "{app}";             Flags: ignoreversion
Source: "support\*";                          DestDir: "{app}\support";     Flags: ignoreversion recursesubdirs createallsubdirs

; PostgreSQL installer (опционально, только для компонента postgres)
Source: "deps\postgresql-16-win-x64.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall; Components: postgres

[Icons]
Name: "{group}\{#AppName}";                 Filename: "{app}\start-feosport.bat"; IconFilename: "{app}\{#AppExe}"
Name: "{group}\Остановить {#AppName}";      Filename: "{app}\stop-feosport.bat"
Name: "{group}\Загрузить тестовые данные";  Filename: "{app}\seed-data.bat"
Name: "{group}\Собрать логи {#AppName}";    Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\collect-logs.ps1"""; WorkingDir: "{app}"
Name: "{group}\Проверить обновления {#AppName}"; Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\check-updates.ps1"""; WorkingDir: "{app}"
Name: "{group}\Удалить {#AppName}";         Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}";           Filename: "{app}\start-feosport.bat"; IconFilename: "{app}\{#AppExe}"; Tasks: desktopicon
Name: "{userstartup}\{#AppName}";           Filename: "{app}\start-feosport.bat"; Tasks: autostart

[Run]
; 1. Установить PostgreSQL если выбран компонент
Filename: "{tmp}\postgresql-16-win-x64.exe"; \
    Parameters: "--unattendedmodeui minimal --mode unattended --superpassword ""{code:GetPgPassword}"" --serverport 5432 --enable_acledit 1"; \
    StatusMsg: "Установка PostgreSQL 16..."; \
    Flags: waituntilterminated; \
    Components: postgres

; 2. Настройка БД + автоматический seed (admin, пилоты, соревнования)
Filename: "powershell.exe"; \
    Parameters: "-ExecutionPolicy Bypass -NonInteractive -File ""{app}\setup-db.ps1"" -PgPassword ""{code:GetPgPassword}"" -DbPassword ""{code:GetDbPassword}"" -JwtSecret ""{code:GetJwtSecret}"" -InstallDir ""{app}"" -InitSql ""{app}\database\init.sql"" -SeedUsersSql ""{app}\database\seed-users.sql"" -SeedSql ""{app}\database\seed.sql"""; \
    StatusMsg: "Настройка базы данных и загрузка тестовых данных..."; \
    Flags: waituntilterminated runhidden

; 3. Запустить приложение по завершении
Filename: "{app}\start-feosport.bat"; \
    Description: "Запустить FeoSport2 сейчас"; \
    Flags: postinstall nowait skipifsilent

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-Command ""taskkill /F /IM feosport2-server.exe 2>$null; exit 0"""; Flags: runhidden waituntilterminated

[Code]

{ ──────────────────────────────────────────────────────────────────────────── }
{ Переменные, хранящие введённые пользователем данные                          }
{ ──────────────────────────────────────────────────────────────────────────── }
var
  PgPasswordPage:  TInputQueryWizardPage;
  DbPasswordPage:  TInputQueryWizardPage;
  JwtSecret:       String;

{ Проверка — установлен ли PostgreSQL }
function IsPostgresInstalled: Boolean;
begin
  Result := FileExists('C:\Program Files\PostgreSQL\16\bin\psql.exe') or
            FileExists(ExpandConstant('{pf}') + '\PostgreSQL\16\bin\psql.exe');
end;

{ Инициализация кастомных страниц }
procedure InitializeWizard;
begin
  JwtSecret := '';

  { Страница 1: пароль postgres-суперпользователя }
  PgPasswordPage := CreateInputQueryPage(wpSelectComponents,
    'Пароль PostgreSQL',
    'Введите пароль суперпользователя postgres',
    'Этот пароль нужен для создания базы данных FeoSport2.' + #13#10 +
    'Если PostgreSQL уже установлен — введите существующий пароль.' + #13#10 +
    'Если устанавливается впервые — придумайте новый пароль.');
  PgPasswordPage.Add('Пароль postgres:', True);
  PgPasswordPage.Values[0] := '';

  { Страница 2: пароль пользователя приложения }
  DbPasswordPage := CreateInputQueryPage(PgPasswordPage.ID,
    'Пароль базы данных приложения',
    'Придумайте пароль для пользователя feosport',
    'Этот пароль будет использоваться приложением для подключения к PostgreSQL.' + #13#10 +
    'Запомните его — он потребуется при переустановке.');
  DbPasswordPage.Add('Пароль пользователя feosport:', True);
  DbPasswordPage.Values[0] := 'feosport2024';
end;

{ Валидация заполнения полей }
function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = PgPasswordPage.ID then
  begin
    if Trim(PgPasswordPage.Values[0]) = '' then
    begin
      MsgBox('Пожалуйста, введите пароль postgres.', mbError, MB_OK);
      Result := False;
    end;
  end;
  if CurPageID = DbPasswordPage.ID then
  begin
    if Length(Trim(DbPasswordPage.Values[0])) < 6 then
    begin
      MsgBox('Пароль должен быть не менее 6 символов.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

{ Скрыть компонент postgres если уже установлен }
function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
end;

{ Геттеры для [Run] секции }
function GetPgPassword(Param: String): String;
begin
  Result := PgPasswordPage.Values[0];
end;

function GetDbPassword(Param: String): String;
begin
  Result := DbPasswordPage.Values[0];
end;

function GetJwtSecret(Param: String): String;
begin
  Result := JwtSecret;
end;

{ Показать предупреждение если PostgreSQL не найден и компонент не выбран }
function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if (not IsPostgresInstalled) and (not IsComponentSelected('postgres')) then
  begin
    if MsgBox('PostgreSQL не обнаружен на этом компьютере.' + #13#10 +
              'Без PostgreSQL приложение не запустится.' + #13#10#13#10 +
              'Вернуться назад и выбрать установку PostgreSQL?',
              mbConfirmation, MB_YESNO) = IDYES then
      Result := 'Выбери компонент PostgreSQL 16 на предыдущем шаге.';
  end;
end;

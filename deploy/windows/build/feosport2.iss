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
Name: "desktopicon";       Description: "Создать ярлык запуска FeoSport2 на рабочем столе"; GroupDescription: "Ярлыки:"
Name: "desktoptools";      Description: "Создать ярлыки управления на рабочем столе"; GroupDescription: "Ярлыки:"
Name: "desktopdb";         Description: "Создать ярлык настройки PostgreSQL на рабочем столе"; GroupDescription: "Ярлыки:"
Name: "desktoppgadmin";    Description: "Создать ярлык pgAdmin 4 на рабочем столе"; GroupDescription: "Ярлыки:"
Name: "autostart";         Description: "Запускать FeoSport2 автоматически при входе в Windows"; GroupDescription: "Автозапуск:"

[Files]
; Основной сервер (скомпилированный pkg)
Source: "staging\app\{#AppExe}";         DestDir: "{app}";                   Flags: ignoreversion
Source: "staging\app\scripts\seed.js";   DestDir: "{app}\scripts";           Flags: ignoreversion

; Собранный фронтенд
Source: "staging\frontend-dist\*";       DestDir: "{app}\frontend-dist";     Flags: ignoreversion recursesubdirs createallsubdirs

; TMX отключён в v0.1.x — копируется только README-плейсхолдер из staging\tmx-dist
; skipifsourcedoesntexist защищает от исчезновения каталога; recursesubdirs не нужен (один файл)
Source: "staging\tmx-dist\*";            DestDir: "{app}\tmx-dist";          Flags: ignoreversion skipifsourcedoesntexist; Components: app

; База данных
Source: "staging\database\init.sql";     DestDir: "{app}\database";          Flags: ignoreversion
Source: "staging\database\seed-users.sql"; DestDir: "{app}\database";        Flags: ignoreversion
Source: "staging\database\seed.sql";     DestDir: "{app}\database";          Flags: ignoreversion

; Миграции (накатываются автоматически при старте exe — см. backend/scripts/migrate.js)
Source: "staging\database\migrations\*"; DestDir: "{app}\database\migrations"; Flags: ignoreversion recursesubdirs createallsubdirs

; Вспомогательные скрипты
Source: "bundled-scripts\setup-db.ps1";     DestDir: "{app}";               Flags: ignoreversion
Source: "bundled-scripts\start-feosport.bat"; DestDir: "{app}";             Flags: ignoreversion
Source: "bundled-scripts\stop-feosport.bat";  DestDir: "{app}";             Flags: ignoreversion
Source: "bundled-scripts\seed-data.bat";      DestDir: "{app}";             Flags: ignoreversion
Source: "bundled-scripts\open-pgadmin.bat";   DestDir: "{app}";             Flags: ignoreversion
Source: "bundled-scripts\collect-logs.ps1";   DestDir: "{app}";             Flags: ignoreversion
Source: "bundled-scripts\check-updates.ps1";  DestDir: "{app}";             Flags: ignoreversion
Source: "support\*";                          DestDir: "{app}\support";     Flags: ignoreversion recursesubdirs createallsubdirs

; PostgreSQL installer (опционально, только для компонента postgres)
Source: "deps\postgresql-16-win-x64.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall; Components: postgres

[Icons]
Name: "{group}\{#AppName} — запуск";                  Filename: "{app}\start-feosport.bat"; IconFilename: "{app}\{#AppExe}"
Name: "{group}\{#AppName} — остановка";               Filename: "{app}\stop-feosport.bat"; IconFilename: "{sys}\shell32.dll"; IconIndex: 27
Name: "{group}\{#AppName} — настройка PostgreSQL";    Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\setup-db.ps1"""; WorkingDir: "{app}"; IconFilename: "{sys}\shell32.dll"; IconIndex: 21
Name: "{group}\{#AppName} — тестовые данные";         Filename: "{app}\seed-data.bat"; IconFilename: "{sys}\shell32.dll"; IconIndex: 69
Name: "{group}\{#AppName} — собрать логи";            Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\collect-logs.ps1"""; WorkingDir: "{app}"; IconFilename: "{sys}\shell32.dll"; IconIndex: 70
Name: "{group}\{#AppName} — проверить обновления";    Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\check-updates.ps1"""; WorkingDir: "{app}"; IconFilename: "{sys}\shell32.dll"; IconIndex: 238
Name: "{group}\pgAdmin 4";                            Filename: "{app}\open-pgadmin.bat"; IconFilename: "{sys}\shell32.dll"; IconIndex: 21
Name: "{group}\Удалить {#AppName}";                   Filename: "{uninstallexe}"; IconFilename: "{sys}\shell32.dll"; IconIndex: 31
Name: "{autodesktop}\FeoSport2 — запуск";             Filename: "{app}\start-feosport.bat"; IconFilename: "{app}\{#AppExe}"; Tasks: desktopicon
Name: "{autodesktop}\FeoSport2 — остановка";          Filename: "{app}\stop-feosport.bat"; IconFilename: "{sys}\shell32.dll"; IconIndex: 27; Tasks: desktoptools
Name: "{autodesktop}\FeoSport2 — тестовые данные";    Filename: "{app}\seed-data.bat"; IconFilename: "{sys}\shell32.dll"; IconIndex: 69; Tasks: desktoptools
Name: "{autodesktop}\FeoSport2 — логи";               Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\collect-logs.ps1"""; WorkingDir: "{app}"; IconFilename: "{sys}\shell32.dll"; IconIndex: 70; Tasks: desktoptools
Name: "{autodesktop}\FeoSport2 — PostgreSQL";         Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\setup-db.ps1"""; WorkingDir: "{app}"; IconFilename: "{sys}\shell32.dll"; IconIndex: 21; Tasks: desktopdb
Name: "{autodesktop}\pgAdmin 4";                      Filename: "{app}\open-pgadmin.bat"; IconFilename: "{sys}\shell32.dll"; IconIndex: 21; Tasks: desktoppgadmin
Name: "{userstartup}\FeoSport2 — запуск";             Filename: "{app}\start-feosport.bat"; IconFilename: "{app}\{#AppExe}"; Tasks: autostart

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
  StandardPgPasswordCheck: TNewCheckBox;
  JwtSecret:       String;

{ Проверка — установлен ли PostgreSQL }
function IsPostgresInstalled: Boolean;
begin
  Result := FileExists('C:\Program Files\PostgreSQL\16\bin\psql.exe') or
            FileExists(ExpandConstant('{pf}') + '\PostgreSQL\16\bin\psql.exe');
end;

function GetPgAdminPath(Param: String): String;
begin
  if FileExists('C:\Program Files\pgAdmin 4\runtime\pgAdmin4.exe') then
    Result := 'C:\Program Files\pgAdmin 4\runtime\pgAdmin4.exe'
  else if FileExists('C:\Program Files (x86)\pgAdmin 4\runtime\pgAdmin4.exe') then
    Result := 'C:\Program Files (x86)\pgAdmin 4\runtime\pgAdmin4.exe'
  else if FileExists('C:\Program Files\PostgreSQL\16\pgAdmin 4\runtime\pgAdmin4.exe') then
    Result := 'C:\Program Files\PostgreSQL\16\pgAdmin 4\runtime\pgAdmin4.exe'
  else if FileExists('C:\Program Files\PostgreSQL\15\pgAdmin 4\runtime\pgAdmin4.exe') then
    Result := 'C:\Program Files\PostgreSQL\15\pgAdmin 4\runtime\pgAdmin4.exe'
  else if FileExists('C:\Program Files\PostgreSQL\17\pgAdmin 4\runtime\pgAdmin4.exe') then
    Result := 'C:\Program Files\PostgreSQL\17\pgAdmin 4\runtime\pgAdmin4.exe'
  else
    Result := '';
end;

function IsPgAdminInstalled: Boolean;
begin
  Result := GetPgAdminPath('') <> '';
end;

procedure StandardPgPasswordCheckClick(Sender: TObject);
begin
  if StandardPgPasswordCheck.Checked then
  begin
    PgPasswordPage.Values[0] := '23oleral';
    PgPasswordPage.Edits[0].Enabled := False;
  end
  else
  begin
    PgPasswordPage.Edits[0].Enabled := True;
    PgPasswordPage.Values[0] := '';
  end;
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
  StandardPgPasswordCheck := TNewCheckBox.Create(PgPasswordPage);
  StandardPgPasswordCheck.Parent := PgPasswordPage.Surface;
  StandardPgPasswordCheck.Left := PgPasswordPage.Edits[0].Left;
  StandardPgPasswordCheck.Top := PgPasswordPage.Edits[0].Top + PgPasswordPage.Edits[0].Height + ScaleY(10);
  StandardPgPasswordCheck.Width := PgPasswordPage.SurfaceWidth;
  StandardPgPasswordCheck.Caption := 'Использовать стандартный пароль: 23oleral';
  StandardPgPasswordCheck.Checked := False;
  StandardPgPasswordCheck.OnClick := @StandardPgPasswordCheckClick;

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
    if StandardPgPasswordCheck.Checked then
      PgPasswordPage.Values[0] := '23oleral';

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
  if StandardPgPasswordCheck.Checked then
    Result := '23oleral'
  else
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

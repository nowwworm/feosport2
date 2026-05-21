FeoSport2 support
=================

First login:
- admin@feosport.local / admin123
- chief@feosport.local / judge123
- judge@feosport.local / judge123
- pilot@feosport.local / judge123

Useful files:
- logs\setup-db.log: PostgreSQL and database setup log.
- logs\server-*.log: application server logs.
- .env: local runtime configuration. Passwords and secrets are redacted by log collection.

Start menu actions:
- FeoSport2: starts the local server and opens http://localhost:8090.
- Stop FeoSport2: stops feosport2-server.exe.
- Load test data: reapplies baseline users and demo competition data.
- Collect logs: creates FeoSport2-logs-COMPUTER-YYYYMMDD-HHMMSS.zip on Desktop.
- Check updates: checks GitHub Releases and downloads a new installer when configured.
- Uninstall FeoSport2: removes the installed app files.

Updates:
Set FEOSPORT2_GITHUB_REPO to owner/repo, then run check-updates.ps1.
The updater downloads FeoSport2-Setup.exe only. It does not reinstall automatically.

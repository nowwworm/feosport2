@echo off
chcp 65001 > nul
echo Остановка FeoSport2...
taskkill /F /IM feosport2-server.exe > nul 2>&1
echo Остановлено.

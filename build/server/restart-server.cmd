@echo off
rem Restarts S-ERP Server, e.g. after changing %ProgramData%\Maluti ERP\server.json or installing an update.
net session >nul 2>&1
if errorlevel 1 ( echo Please run this as administrator. & pause & exit /b 1 )
schtasks /End /TN "S-ERP Server" >nul 2>&1
timeout /t 5 /nobreak >nul
schtasks /Run /TN "S-ERP Server"
echo S-ERP Server restarted.
pause

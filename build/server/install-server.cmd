@echo off
rem Installs S-ERP as a server: a background task that starts with Windows and keeps running when nobody is signed in,
rem restarts itself if it stops, and is reachable from the network. Run once, as administrator.
setlocal
net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo  Please run this as administrator: right-click "Install S-ERP Server" and choose "Run as administrator".
  echo.
  pause
  exit /b 1
)
set "TOOLS=%~dp0"
set "DATA=%ProgramData%\Maluti ERP"
if not exist "%DATA%" mkdir "%DATA%"
if not exist "%DATA%\server.json" (
  > "%DATA%\server.json" echo {
  >> "%DATA%\server.json" echo   "port": 8069,
  >> "%DATA%\server.json" echo   "db": { "embedded": true }
  >> "%DATA%\server.json" echo }
)
echo Registering the S-ERP Server background task ...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$a = New-ScheduledTaskAction -Execute '%TOOLS%run-server.cmd';" ^
  "$t = New-ScheduledTaskTrigger -AtStartup;" ^
  "$p = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest;" ^
  "$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -MultipleInstances IgnoreNew;" ^
  "Register-ScheduledTask -TaskName 'S-ERP Server' -Action $a -Trigger $t -Principal $p -Settings $s -Description 'S-ERP server edition (Smartel Money)' -Force | Out-Null"
if errorlevel 1 ( echo Could not register the task. & pause & exit /b 1 )
echo Opening the firewall for S-ERP (ports 8069, 80 and 443) ...
netsh advfirewall firewall delete rule name="S-ERP Server" >nul 2>&1
netsh advfirewall firewall add rule name="S-ERP Server" dir=in action=allow protocol=TCP localport=8069,80,443 >nul
echo Starting S-ERP Server ...
schtasks /Run /TN "S-ERP Server" >nul
echo.
echo  Done. S-ERP Server now starts with Windows.
echo  On this server open      http://localhost:8069
echo  From other computers     http://THIS-SERVER-NAME:8069   (or its IP address)
echo  Settings and log file:   %DATA%
echo  For HTTPS and access from outside the office, see "S-ERP Server - read me" in the Start menu.
echo.
pause

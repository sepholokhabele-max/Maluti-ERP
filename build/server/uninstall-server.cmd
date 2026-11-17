@echo off
rem Removes the S-ERP Server background task and firewall rule. Your data in %ProgramData%\Maluti ERP is kept.
net session >nul 2>&1
if errorlevel 1 ( echo Please run this as administrator. & pause & exit /b 1 )
schtasks /End /TN "S-ERP Server" >nul 2>&1
schtasks /Delete /TN "S-ERP Server" /F >nul 2>&1
netsh advfirewall firewall delete rule name="S-ERP Server" >nul 2>&1
echo S-ERP Server removed. Your data in %ProgramData%\Maluti ERP is kept.
pause

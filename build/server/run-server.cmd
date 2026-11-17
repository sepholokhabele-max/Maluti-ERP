@echo off
rem S-ERP server edition: runs the S-ERP server without a window, using the program's own runtime.
rem Started by the "S-ERP Server" background task (see install-server.cmd). Configuration: %ProgramData%\Maluti ERP\server.json
setlocal
set "APPDIR=%~dp0..\.."
set ELECTRON_RUN_AS_NODE=1
set MALUTI_MODE=server
"%APPDIR%\Maluti ERP.exe" "%APPDIR%\resources\app.asar\server\standalone.js"

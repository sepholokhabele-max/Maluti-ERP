@echo off
setlocal
rem Publishes this source folder to your GitHub repository (first time and for every new version).
rem Needs Git for Windows: https://git-scm.com/download/win  (sign-in happens in your browser).
cd /d "%~dp0"
where git >nul 2>nul || (echo Git is not installed. Opening the download page... & start https://git-scm.com/download/win & pause & exit /b 1)
if not exist ".git" (
  set /p REPO=GitHub repository address, e.g. https://github.com/yourname/maluti-erp :
  git init -b main
  call git remote add origin %%REPO%%
)
git add -A
git -c user.name="S-ERP" -c user.email="noreply@maluti.local" commit -m "S-ERP %date%" || echo Nothing new to commit.
git push -u origin main
echo.
echo Done. GitHub Actions now builds the installers and publishes a release when the version in package.json is new.
echo Installed copies update from Settings - Updates ^& backup.
pause

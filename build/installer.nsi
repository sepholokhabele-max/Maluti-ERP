; Maluti ERP – Windows installer (plain NSIS, per-user, no admin rights needed)
; Build:  makensis -DVERSION=1.2.0 -DSRCDIR=dist/win-unpacked -DOUTFILE=dist/MalutiERP-Setup-1.2.0.exe build/installer.nsi
Unicode true
SetCompressor /SOLID lzma
SetCompressorDictSize 32
RequestExecutionLevel user
ManifestDPIAware true

!ifndef VERSION
  !define VERSION "1.0.0"
!endif
!define APPNAME "Maluti ERP"
!define EXENAME "Maluti ERP.exe"
!define COMPANY "Maluti ERP"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\MalutiERP"

Name "${APPNAME} ${VERSION}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\${APPNAME}"
InstallDirRegKey HKCU "Software\MalutiERP" "InstallDir"
BrandingText "${APPNAME} ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APPNAME}"
VIAddVersionKey "FileDescription" "${APPNAME} Setup"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "CompanyName" "${COMPANY}"
VIAddVersionKey "LegalCopyright" "(c) ${COMPANY}"

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "StrFunc.nsh"
${StrStr}

!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_ABORTWARNING
!ifndef ARCHNAME
  !define ARCHNAME "64-bit"
!endif
!ifndef DBTEXT
  !define DBTEXT "You will need a MySQL (or MariaDB) server. You can enter its details the first time the app opens."
!endif
!define MUI_WELCOMEPAGE_TEXT "This will install ${APPNAME} ${VERSION} (${ARCHNAME}) – ERP and Point of Sale for butcheries, restaurants, bars and retail stores.$\r$\n$\r$\n${DBTEXT}$\r$\n$\r$\nClick Next to continue."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXENAME}"
!define MUI_FINISHPAGE_RUN_TEXT "Start ${APPNAME} now"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "license.txt"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

; ---- simple log: %TEMP%\MalutiERP-Setup.log (helps support diagnose problems)
Var LogH
!macro Log msg
  FileOpen $LogH "$TEMP\MalutiERP-Setup.log" a
  FileSeek $LogH 0 END
  FileWrite $LogH "${msg}$\r$\n"
  FileClose $LogH
!macroend

Function .onInit
  !insertmacro Log "---- Setup ${VERSION} started from $EXEPATH"
  ; the program files can't be replaced while the app is open
  check_running:
  nsExec::ExecToStack 'cmd /c tasklist /FI "IMAGENAME eq ${EXENAME}" /NH'
  Pop $0
  Pop $1
  ${StrStr} $2 $1 "${EXENAME}"
  ${If} $2 != ""
    !insertmacro Log "App is running – asking to close it"
    MessageBox MB_YESNOCANCEL|MB_ICONEXCLAMATION "${APPNAME} is open. Close it now and continue with setup?$\r$\n$\r$\nYes = close it for me    No = I'll close it myself, then check again" IDYES kill IDNO check_running
    Abort
    kill:
    nsExec::Exec 'taskkill /IM "${EXENAME}" /T'
    Sleep 2500
    nsExec::Exec 'taskkill /F /IM "${EXENAME}" /T'
    Sleep 800
  ${EndIf}
FunctionEnd

Section "Install"
  !insertmacro Log "Installing to $INSTDIR"
  SetOutPath "$INSTDIR"
  SetOverwrite on
  ; remove previous program files (data lives in %APPDATA%\Maluti ERP and MySQL, never touched)
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"
  File /r "${SRCDIR}\*.*"
  ${IfNot} ${FileExists} "$INSTDIR\${EXENAME}"
    !insertmacro Log "ERROR: ${EXENAME} missing after copy"
    MessageBox MB_ICONSTOP "Files could not be copied to $INSTDIR. Check that you have free disk space and that antivirus is not blocking ${APPNAME}."
    Abort
  ${EndIf}

  WriteUninstaller "$INSTDIR\Uninstall ${APPNAME}.exe"
  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortCut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\${EXENAME}" "" "$INSTDIR\${EXENAME}" 0
  CreateShortCut "$SMPROGRAMS\${APPNAME}\Uninstall ${APPNAME}.lnk" "$INSTDIR\Uninstall ${APPNAME}.exe"
  CreateShortCut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\${EXENAME}" "" "$INSTDIR\${EXENAME}" 0

  WriteRegStr HKCU "Software\MalutiERP" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "Publisher" "${COMPANY}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\${EXENAME}"
  WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" '"$INSTDIR\Uninstall ${APPNAME}.exe"'
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegDWORD HKCU "${UNINSTKEY}" "EstimatedSize" "$0"
  !insertmacro Log "Install finished OK"
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\${APPNAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APPNAME}"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTKEY}"
  DeleteRegKey HKCU "Software\MalutiERP"
SectionEnd

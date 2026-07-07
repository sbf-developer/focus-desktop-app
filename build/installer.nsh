!macro customHeader
  RequestExecutionLevel admin
!macroend

!macro KillFocusProcesses
  DetailPrint "Closing Focus..."
  CreateDirectory "$APPDATA\focus"
  FileOpen $9 "$APPDATA\focus\focus-quit-install" w
  FileWrite $9 "1"
  FileClose $9
  Sleep 2500
  nsExec::ExecToLog 'taskkill /F /T /IM Focus.exe'
  Sleep 1500
!macroend

!macro CreateFocusShortcuts
  CreateShortcut "$DESKTOP\Focus.lnk" "$INSTDIR\Focus-Admin.bat" "" "$INSTDIR\Focus.exe" 0
  CreateDirectory "$SMPROGRAMS\Focus"
  CreateShortcut "$SMPROGRAMS\Focus\Focus.lnk" "$INSTDIR\Focus-Admin.bat" "" "$INSTDIR\Focus.exe" 0
!macroend

!macro customInit
  !insertmacro KillFocusProcesses
!macroend

!macro customCloseApp
  !insertmacro KillFocusProcesses
!macroend

!macro customInstall
  !insertmacro KillFocusProcesses
  !insertmacro CreateFocusShortcuts
!macroend

!macro customInit
  nsExec::ExecToLog 'taskkill /F /IM Focus.exe /T'
  Sleep 1500
!macroend

@echo off
setlocal

set "DEPLOY_DIR=%~dp0"
set "DEPLOY_CONFIG=%DEPLOY_DIR%upload-admin-console.psd1"
set "DEPLOY_EXAMPLE=%DEPLOY_DIR%upload-admin-console.example.psd1"
set "DEPLOY_SCRIPT=%DEPLOY_DIR%upload-admin-console.ps1"

if not exist "%DEPLOY_CONFIG%" (
  copy /Y "%DEPLOY_EXAMPLE%" "%DEPLOY_CONFIG%" >nul
  if errorlevel 1 (
    echo Unable to create the deployment config.
    pause
    exit /b 1
  )
  echo The deployment config was created:
  echo %DEPLOY_CONFIG%
  echo.
  echo Enter the SSH server settings, save the file, and run this CMD again.
  start "" /wait notepad.exe "%DEPLOY_CONFIG%"
  pause
  exit /b 0
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%DEPLOY_SCRIPT%"
set "DEPLOY_EXIT=%ERRORLEVEL%"

echo.
if "%DEPLOY_EXIT%"=="0" (
  echo Admin console deployment completed successfully.
) else (
  echo Admin console deployment failed with exit code %DEPLOY_EXIT%.
)
pause
exit /b %DEPLOY_EXIT%

@echo off
setlocal

set "PROJECT_DIR=%~dp0"
set "APP_URL=http://127.0.0.1:8000"
set "LISTEN_PORT=8000"

set "PYTHON_EXE=%PROJECT_DIR%.venv-package\Scripts\python.exe"
if exist "%PYTHON_EXE%" goto have_python

where /q python
if %ERRORLEVEL%==0 (
  set "PYTHON_EXE=python"
  goto have_python
)

echo Python 3 was not found. Install Python 3 or use the packaged SignalDeck.exe.
pause
exit /b 1

:have_python

for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:"127\.0\.0\.1:%LISTEN_PORT% .*LISTENING"') do set "RUNNING_PID=%%P"
if defined RUNNING_PID (
  start "" "%APP_URL%"
  exit /b 0
)

start "Signal Deck Server" /D "%PROJECT_DIR%" "%PYTHON_EXE%" -m waitress --listen=127.0.0.1:%LISTEN_PORT% --threads=8 app:app
timeout /t 2 /nobreak >nul
start "" "%APP_URL%"

endlocal

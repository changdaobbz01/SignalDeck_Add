@echo off
setlocal

cd /d "%~dp0"

if exist "%~dp0SignalDeck.exe" (
  start "" "%~dp0SignalDeck.exe"
  endlocal
  exit /b 0
)

set "PYTHON_EXE=%~dp0.venv-package\Scripts\pythonw.exe"
if not exist "%PYTHON_EXE%" set "PYTHON_EXE=%~dp0.venv-package\Scripts\python.exe"
if exist "%PYTHON_EXE%" goto run_launcher

where /q pythonw
if %ERRORLEVEL%==0 (
  set "PYTHON_EXE=pythonw"
  goto run_launcher
)

where /q python
if %ERRORLEVEL%==0 (
  set "PYTHON_EXE=python"
  goto run_launcher
)

echo Python was not found. Install Python 3 or run the packaged SignalDeck.exe.
pause
endlocal
exit /b 1

:run_launcher
start "" "%PYTHON_EXE%" "%~dp0desktop_launcher.py"

endlocal

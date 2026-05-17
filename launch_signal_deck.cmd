@echo off
setlocal

cd /d "%~dp0"

set "PYTHON_EXE=E:\anaconda\pythonw.exe"
if not exist "%PYTHON_EXE%" set "PYTHON_EXE=E:\anaconda\python.exe"
if not exist "%PYTHON_EXE%" set "PYTHON_EXE=python"

start "" "%PYTHON_EXE%" "%~dp0desktop_launcher.py"

endlocal

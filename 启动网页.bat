@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if errorlevel 1 goto folder_error
where py >nul 2>&1
if not errorlevel 1 goto use_py
where python >nul 2>&1
if not errorlevel 1 goto use_python
echo Python was not found. Install Python 3.10 or newer from python.org.
echo Select "Add Python to PATH" during installation, then try again.
pause
exit /b 1

:use_py
py -3 start_local.py
goto finished

:use_python
python start_local.py
goto finished

:finished
set "APP_LAUNCH_STATUS=%ERRORLEVEL%"
echo.
echo The application has stopped. Read the messages above if startup failed.
pause
exit /b %APP_LAUNCH_STATUS%

:folder_error
echo Extract the entire ZIP first, then run this file from the extracted folder.
pause
exit /b 1

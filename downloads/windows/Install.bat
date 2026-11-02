@echo off
title Muse-Carpathron-Setup.exe
cd /d "%~dp0"
echo  Joining Muse-Carpathron-Setup.exe ...
del /q "Muse-Carpathron-Setup.exe" 2>nul
copy /b /y Muse-Carpathron-Setup.part0+Muse-Carpathron-Setup.part1+Muse-Carpathron-Setup.part2+Muse-Carpathron-Setup.part3+Muse-Carpathron-Setup.part4+Muse-Carpathron-Setup.part5 "Muse-Carpathron-Setup.exe" >nul
if errorlevel 1 goto fail
certutil -hashfile "Muse-Carpathron-Setup.exe" SHA256 | findstr /i /c:"33a07b849ba8a000578d8b87d4d8dee6f716727ff88420e21c0b25d3b6226e3f" >nul
if errorlevel 1 (
  echo  The file is damaged. Copy the parts again.
  goto fail
)
echo  OK - starting the installer...
start "" "%~dp0Muse-Carpathron-Setup.exe"
exit /b 0
:fail
echo.
echo  Something went wrong.
pause
exit /b 1

@echo off
title Install Muse Carpathron 1.5.3
cd /d "%~dp0"
echo.
echo  Muse Carpathron 1.5.3 - preparing the installer...
taskkill /im "Muse Carpathron.exe" /f >nul 2>&1
del /q Muse-Carpathron-Setup.exe 2>nul
copy /b /y Muse-Carpathron-Setup.part0+Muse-Carpathron-Setup.part1+Muse-Carpathron-Setup.part2+Muse-Carpathron-Setup.part3+Muse-Carpathron-Setup.part4 Muse-Carpathron-Setup.exe >nul
if errorlevel 1 goto fail
certutil -hashfile Muse-Carpathron-Setup.exe SHA256 | findstr /i /c:"8507e4a593a507239ee9abdbb1717ac4abc185d841206c2a6cc09acfca1cecbb" >nul
if errorlevel 1 (
  echo  The installer file is damaged. Copy the parts again.
  goto fail
)
echo  OK - installing (Windows will ask for permission)...
start "" "%~dp0Muse-Carpathron-Setup.exe"
exit /b 0
:fail
echo.
echo  Something went wrong. See docs/GUIDE.md (Troubleshooting) or open an issue on GitHub.
pause
exit /b 1

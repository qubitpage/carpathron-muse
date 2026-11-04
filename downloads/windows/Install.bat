@echo off
title Muse-Carpathron-Setup.exe
cd /d "%~dp0"
echo  Joining Muse-Carpathron-Setup.exe ...
del /q "Muse-Carpathron-Setup.exe" 2>nul
copy /b /y Muse-Carpathron-Setup.part0+Muse-Carpathron-Setup.part1+Muse-Carpathron-Setup.part2+Muse-Carpathron-Setup.part3+Muse-Carpathron-Setup.part4+Muse-Carpathron-Setup.part5 "Muse-Carpathron-Setup.exe" >nul
if errorlevel 1 goto fail
certutil -hashfile "Muse-Carpathron-Setup.exe" SHA256 | findstr /i /c:"69101338a1b15b5627b56bf6317ab464851ea5b95d192bbdcdab5a7980a713d3" >nul
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

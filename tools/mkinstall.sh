#!/bin/bash
# Splits the Windows installer into ~25 MB parts + Install.bat (joins them, checks SHA-256, runs the installer).
# Handy when the installer must travel through channels with file-size limits.
# usage: tools/mkinstall.sh <version> [installer.exe] [output-dir]
set -e
V=$1; EXE=${2:-apps/desktop/dist/Muse-Carpathron-Setup-$V.exe}; OUT=${3:-dist/installer}
mkdir -p "$OUT"; rm -f "$OUT"/Muse-Carpathron-Setup.part*
split -b ${PART:-25M} -d -a 1 "$EXE" "$OUT/Muse-Carpathron-Setup.part"
PARTS=$(cd "$OUT" && ls Muse-Carpathron-Setup.part* | sort | paste -sd+ -)
H=$(sha256sum "$EXE" | cut -d' ' -f1)
cat > "$OUT/Install.bat" <<BAT
@echo off
title Install Muse Carpathron $V
cd /d "%~dp0"
echo.
echo  Muse Carpathron $V - preparing the installer...
taskkill /im "Muse Carpathron.exe" /f >nul 2>&1
del /q Muse-Carpathron-Setup.exe 2>nul
copy /b /y $PARTS Muse-Carpathron-Setup.exe >nul
if errorlevel 1 goto fail
certutil -hashfile Muse-Carpathron-Setup.exe SHA256 | findstr /i /c:"$H" >nul
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
BAT
sed -i 's/$/\r/' "$OUT/Install.bat"
echo "Wrote $OUT"

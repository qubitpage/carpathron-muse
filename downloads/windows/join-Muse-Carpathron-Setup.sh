#!/bin/sh
# joins the parts into Muse-Carpathron-Setup.exe and checks it
cd "$(dirname "$0")"
cat Muse-Carpathron-Setup.part0 Muse-Carpathron-Setup.part1 Muse-Carpathron-Setup.part2 Muse-Carpathron-Setup.part3 Muse-Carpathron-Setup.part4 Muse-Carpathron-Setup.part5 > "Muse-Carpathron-Setup.exe"
echo "e667fef6e6971b6a5317e10c5b7c92b0c8b898d1652c1a76bc613824c2fb9c37  Muse-Carpathron-Setup.exe" | sha256sum -c - || { echo 'The file is damaged. Copy the parts again.'; exit 1; }

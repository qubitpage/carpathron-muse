#!/bin/sh
# joins the parts into Muse-Carpathron-Setup.exe and checks it
cd "$(dirname "$0")"
cat Muse-Carpathron-Setup.part0 Muse-Carpathron-Setup.part1 Muse-Carpathron-Setup.part2 Muse-Carpathron-Setup.part3 Muse-Carpathron-Setup.part4 Muse-Carpathron-Setup.part5 > "Muse-Carpathron-Setup.exe"
echo "3e80741f21f2eaa220e93e31413e2fbb7d6aff79f4db27f08d1440628b2598d0  Muse-Carpathron-Setup.exe" | sha256sum -c - || { echo 'The file is damaged. Copy the parts again.'; exit 1; }

#!/bin/sh
# joins the parts into Muse-Carpathron-Setup.exe and checks it
cd "$(dirname "$0")"
cat Muse-Carpathron-Setup.part0 Muse-Carpathron-Setup.part1 Muse-Carpathron-Setup.part2 Muse-Carpathron-Setup.part3 Muse-Carpathron-Setup.part4 Muse-Carpathron-Setup.part5 > "Muse-Carpathron-Setup.exe"
echo "ed94e03948fbfaa1461445b5d2807a19d6abb26c7d6a557a909bcd5e9e192b37  Muse-Carpathron-Setup.exe" | sha256sum -c - || { echo 'The file is damaged. Copy the parts again.'; exit 1; }

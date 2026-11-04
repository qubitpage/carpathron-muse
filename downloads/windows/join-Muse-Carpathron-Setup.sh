#!/bin/sh
# joins the parts into Muse-Carpathron-Setup.exe and checks it
cd "$(dirname "$0")"
cat Muse-Carpathron-Setup.part0 Muse-Carpathron-Setup.part1 Muse-Carpathron-Setup.part2 Muse-Carpathron-Setup.part3 Muse-Carpathron-Setup.part4 Muse-Carpathron-Setup.part5 > "Muse-Carpathron-Setup.exe"
echo "69101338a1b15b5627b56bf6317ab464851ea5b95d192bbdcdab5a7980a713d3  Muse-Carpathron-Setup.exe" | sha256sum -c - || { echo 'The file is damaged. Copy the parts again.'; exit 1; }

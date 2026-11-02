#!/bin/sh
# joins the parts into Muse-Carpathron-Setup.exe and checks it
cd "$(dirname "$0")"
cat Muse-Carpathron-Setup.part0 Muse-Carpathron-Setup.part1 Muse-Carpathron-Setup.part2 Muse-Carpathron-Setup.part3 Muse-Carpathron-Setup.part4 Muse-Carpathron-Setup.part5 > "Muse-Carpathron-Setup.exe"
echo "bc4647bcb6c76cb0bbbd0896347318070737083f25027848116907cdb4945cec  Muse-Carpathron-Setup.exe" | sha256sum -c - || { echo 'The file is damaged. Copy the parts again.'; exit 1; }

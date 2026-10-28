#!/bin/bash
# Builds Carpathron Avatar for Meta Quest: Godot export -> Quest/OpenXR patch -> rebuild -> align -> sign.
# Needs: Godot 4.4.1 + Android export templates, JDK 17, apktool 2.11+, zipalign, apksigner, the Khronos OpenXR loader AAR.
set -euo pipefail
cd "$(dirname "$0")"
GODOT=${GODOT:-godot}
APKTOOL=${APKTOOL:-apktool.jar}
LOADER_AAR=${LOADER_AAR:-openxr_loader_for_android-1.1.49.aar}
KS=${KS:?set KS to your keystore}; KS_PASS=${KS_PASS:?set KS_PASS}; KS_ALIAS=${KS_ALIAS:?set KS_ALIAS}
mkdir -p build && rm -rf build/dec build/*.apk build/*.idsig
"$GODOT" --headless --path . --export-${EXPORT:-release} "Quest" build/CarpathronAvatar-unsigned.apk > build/export.log 2>&1 || { tail -20 build/export.log; exit 1; }
java -jar "$APKTOOL" d -f -s -o build/dec build/CarpathronAvatar-unsigned.apk > /dev/null
python3 tools_quest_patch.py build/dec
unzip -o -q -j "$LOADER_AAR" jni/arm64-v8a/libopenxr_loader.so -d build/dec/lib/arm64-v8a
java -jar "$APKTOOL" b -o build/unaligned.apk build/dec > build/apktool.log 2>&1 || { tail -20 build/apktool.log; exit 1; }
zipalign -f -p 4 build/unaligned.apk build/aligned.apk
apksigner sign --ks "$KS" --ks-pass pass:"$KS_PASS" --ks-key-alias "$KS_ALIAS" --key-pass pass:"$KS_PASS" --out build/CarpathronAvatar.apk build/aligned.apk
apksigner verify build/CarpathronAvatar.apk
rm -f build/unaligned.apk build/aligned.apk build/*.idsig
ls -la build/CarpathronAvatar.apk

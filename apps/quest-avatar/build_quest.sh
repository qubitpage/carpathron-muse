#!/bin/bash
# Builds Carpathron Avatar for Meta Quest: Godot export -> Quest/OpenXR patch -> rebuild -> align -> sign.
# Needs: Godot 4.4.1 + Android export templates, JDK 17, apktool 2.11+, zipalign, apksigner, the Khronos OpenXR loader AAR.
set -euo pipefail
cd "$(dirname "$0")"
GODOT=${GODOT:-/home/claude/godot/Godot_v4.4.1-stable_linux.x86_64}
APKTOOL=${APKTOOL:-/home/claude/godot/apktool.jar}
LOADER_AAR=${LOADER_AAR:-/home/claude/godot/loader.aar}
# Store builds must always be signed with the RELEASE key (Meta rejects a different certificate)
KS=${KS:-/home/claude/keys/carpathron-release.keystore}; KS_PASS=${KS_PASS:-$(cat /home/claude/keys/release.pass)}; KS_ALIAS=${KS_ALIAS:-carpathron}
# the keystore password is never stored in export_presets.cfg: Godot reads it from these variables
export GODOT_ANDROID_KEYSTORE_RELEASE_PATH="$KS" GODOT_ANDROID_KEYSTORE_RELEASE_USER="$KS_ALIAS" GODOT_ANDROID_KEYSTORE_RELEASE_PASSWORD="$KS_PASS"
mkdir -p build && rm -rf build/dec build/*.apk build/*.idsig
# 1.5: the Godot OpenXR Vendors plugin (Meta passthrough = mixed reality) is a GDExtension; Godot only exports it with a
# Gradle build, so it is hidden during the export and added to the APK afterwards (library + extension list).
VX=addons/godotopenxrvendors
mv $VX/plugin.gdextension $VX/plugin.gdextension.off
trap 'mv -f $VX/plugin.gdextension.off $VX/plugin.gdextension 2>/dev/null || true' EXIT
"$GODOT" --headless --path . --export-${EXPORT:-release} "Quest" build/CarpathronAvatar-unsigned.apk > build/export.log 2>&1 || { tail -20 build/export.log; exit 1; }
mv -f $VX/plugin.gdextension.off $VX/plugin.gdextension
java -jar "$APKTOOL" d -f -s -o build/dec build/CarpathronAvatar-unsigned.apk > /dev/null
mkdir -p build/dec/assets/.godot build/dec/assets/$VX
cp $VX/plugin.gdextension build/dec/assets/$VX/
printf 'res://%s/plugin.gdextension\n' $VX > build/dec/assets/.godot/extension_list.cfg
cp $VX/.bin/android/template_release/arm64/libgodotopenxrvendors.so build/dec/lib/arm64-v8a/
rm -rf build/dec/assets/$VX/.bin
# 1.5: the headset camera helper (Godot plugin "CarpathronRoomCam", smali -> classes2.dex)
mkdir -p build/dec/smali_classes2 && cp -r android/smali/. build/dec/smali_classes2/
python3 tools_quest_patch.py build/dec
unzip -o -q -j "$LOADER_AAR" jni/arm64-v8a/libopenxr_loader.so -d build/dec/lib/arm64-v8a
java -jar "$APKTOOL" b -o build/unaligned.apk build/dec > build/apktool.log 2>&1 || { tail -20 build/apktool.log; exit 1; }
zipalign -f -p 4 build/unaligned.apk build/aligned.apk
apksigner sign --ks "$KS" --ks-pass pass:"$KS_PASS" --ks-key-alias "$KS_ALIAS" --key-pass pass:"$KS_PASS" --out build/CarpathronAvatar.apk build/aligned.apk
apksigner verify build/CarpathronAvatar.apk
rm -f build/unaligned.apk build/aligned.apk build/*.idsig
ls -la build/CarpathronAvatar.apk

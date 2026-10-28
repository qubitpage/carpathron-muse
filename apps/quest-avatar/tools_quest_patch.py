#!/usr/bin/env python3
"""Turns Godot's plain Android export into a Meta Quest OpenXR app (no Gradle needed):
   - start flags: --xr_mode_openxr --xr-mode on
   - manifest: Khronos OpenXR loader permissions + runtime broker queries, VR head tracking,
     Quest launcher categories, supported devices
   - the official Khronos OpenXR loader (libopenxr_loader.so, arm64) is added by build_quest.sh
Usage: tools_quest_patch.py <apktool-decoded-dir>"""
import re, struct, sys
d = sys.argv[1]
args = ['--xr_mode_openxr', '--xr-mode', 'on', '--fullscreen']
b = struct.pack('<i', len(args))
for a in args:
    e = a.encode(); b += struct.pack('<i', len(e)) + e
open(f'{d}/assets/_cl_', 'wb').write(b)
p = f'{d}/AndroidManifest.xml'; m = open(p).read()
m = re.sub(r'xmlns:n\d+="android" n\d+:name=', 'android:name=', m)
m = m.replace('<uses-feature android:glEsVersion', '''<uses-permission android:name="org.khronos.openxr.permission.OPENXR"/>
    <uses-permission android:name="org.khronos.openxr.permission.OPENXR_SYSTEM"/>
    <uses-feature android:name="android.hardware.vr.headtracking" android:required="true" android:version="1"/>
    <queries>
        <provider android:authorities="org.khronos.openxr.runtime_broker;org.khronos.openxr.system_runtime_broker"/>
        <intent><action android:name="org.khronos.openxr.OpenXRRuntimeService"/></intent>
        <intent><action android:name="org.khronos.openxr.OpenXRApiLayerService"/></intent>
    </queries>
    <uses-feature android:glEsVersion''', 1)
# Store security scan: no cleartext HTTP through Android's Java network stack. (The robot link uses Godot's own
# native sockets, which this setting does not cover, so local robots keep working.)
m = m.replace('<application ', '<application android:usesCleartextTraffic="false" ', 1)
# Meta Horizon Store (VRC.Quest.Packaging): launch activity excluded from recents, release build not debuggable
m = m.replace('android:excludeFromRecents="false"', 'android:excludeFromRecents="true"')
m = m.replace(' android:debuggable="true"', '')
# minSdk 32 / targetSdk 34 (store rule for apps created after March 2026)
y = f'{d}/apktool.yml'
yt = open(y).read()
yt = re.sub(r"minSdkVersion: '?\d+'?", "minSdkVersion: 32", yt)
yt = re.sub(r"targetSdkVersion: '?\d+'?", "targetSdkVersion: 34", yt)
open(y, 'w').write(yt)
m = m.replace('<category android:name="android.intent.category.LAUNCHER"/>', '''<category android:name="android.intent.category.LAUNCHER"/>
                <category android:name="com.oculus.intent.category.VR"/>
                <category android:name="org.khronos.openxr.intent.category.IMMERSIVE_HMD"/>''', 1)
# VRC: focus aware (the app keeps running under the system menu and handles losing input focus)
m = re.sub(r'(<activity [^>]*android:name="com\.godot\.game\.GodotApp"[^>]*>)', r'\1\n            <meta-data android:name="com.oculus.vr.focusaware" android:value="true"/>', m, count=1)
m = m.replace('<meta-data android:name="org.godotengine.editor.version"', '''<meta-data android:name="com.oculus.supportedDevices" android:value="quest2|questpro|quest3|quest3s"/>
        <meta-data android:name="org.godotengine.editor.version"''', 1)
open(p, 'w').write(m)
# apktool decode quirk in Godot's template: a mipmap alias decoded as the literal "false"
import glob, os
for f in glob.glob(f'{d}/res/values*/mipmaps.xml'):
    t = open(f).read()
    if '>false</item>' in t:
        open(f, 'w').write(t.replace('>false</item>', '>@null</item>'))
print('patched', d)

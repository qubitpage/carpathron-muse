# Downloads

Ready-to-install builds of the Carpathron apps.

## 🧠 Muse Carpathron — Windows 10 / 11 / Server 2016+ (v2.3.10)

**[⬇️ Download Muse-Carpathron-Setup.exe (140 MB)](https://github.com/qubitpage/carpathron-muse/releases/latest/download/Muse-Carpathron-Setup.exe)** — from the [latest release](https://github.com/qubitpage/carpathron-muse/releases/latest) ([v2.3.10](https://github.com/qubitpage/carpathron-muse/releases/tag/v2.3.10)).

1. Double-click `Muse-Carpathron-Setup.exe`.
2. If SmartScreen appears: **More info → Run anyway**. The app opens when the install finishes.
3. This hackathon edition does not update itself; to install a newer build run its installer over the old one (chats and settings are kept).

*Alternative:* GitHub limits files inside a repository to 100 MB, so [`windows/`](windows) holds the same installer in 6 parts.
Download all files of that folder into one folder and double-click **`Install.bat`**: it joins the parts, checks the SHA-256 and starts the installer.

SHA-256 of `Muse-Carpathron-Setup.exe`: `9e286e6ccd6408215d86ddca79222429ca752102f9ffdb04ad7eb75d412c4d7b`

## 🥽 Carpathron Avatar — Meta Quest 3 / 3S / Pro / 2 (v1.6.10)

**[⬇️ Download CarpathronAvatar-1.6.10.apk (29 MB)](https://github.com/qubitpage/carpathron-muse/raw/main/downloads/quest/CarpathronAvatar-1.6.10.apk)**

1. Turn on Developer Mode for the headset (Meta Horizon phone app → Devices → Developer Mode).
2. Connect the Quest by USB, open **Meta Quest Developer Hub** → Device manager → **Add build** → pick the APK.
3. In the headset: **Library → Unknown Sources → Carpathron Avatar**.

No robot yet? The app starts a demo robot in a virtual room.
The store version on the Meta Horizon Store is in review.

SHA-256: `78cf57afaeafdbabf2abc1a59aa8c5a9af25e394b0ae5b4f6a1dc9679397a56e`

## 🚗 Baby Carpathron car firmware

Source to flash with Arduino IDE: [`firmware/carpathron_car`](../firmware/carpathron_car) — see [CAR-SETUP](../firmware/carpathron_car/CAR-SETUP.md).

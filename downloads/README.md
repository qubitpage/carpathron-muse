# Downloads

Ready-to-install builds of the Carpathron apps.

## 🧠 Muse Carpathron — Windows 10 / 11 / Server 2016+ (v1.3.0)

The installer is split into 5 parts because GitHub limits single files to 100 MB.

1. Download the whole project: green **Code** button → **Download ZIP**, and unzip it
   (or download every file in [`windows/`](windows) into one folder).
2. Open `downloads/windows` and double-click **`Install.bat`**.
   It joins the parts into `Muse-Carpathron-Setup.exe`, checks the SHA-256 and starts the installer.
3. If SmartScreen appears: **More info → Run anyway**.

SHA-256 of `Muse-Carpathron-Setup.exe`: `9fcbb83d39f23421e64ca79edf25bcf13bc30abf5871ddaa0323dc541c872a9e`

## 🥽 Carpathron Avatar — Meta Quest 3 / 3S / Pro / 2 (v1.1.4)

[**CarpathronAvatar-1.1.4.apk**](quest/CarpathronAvatar-1.1.4.apk) → click **Download raw file** (↓).

1. Turn on Developer Mode for the headset (Meta Horizon phone app → Devices → Developer Mode).
2. Connect the Quest by USB, open **Meta Quest Developer Hub** → Device manager → **Add build** → pick the APK.
3. In the headset: **Library → Unknown Sources → Carpathron Avatar**.

No robot yet? The app starts a demo robot in a virtual room.
The store version on the Meta Horizon Store is in review.

SHA-256: `78cf57afaeafdbabf2abc1a59aa8c5a9af25e394b0ae5b4f6a1dc9679397a56e`

## 🚗 Baby Carpathron car firmware

Source to flash with Arduino IDE: [`firmware/carpathron_car`](../firmware/carpathron_car) — see [CAR-SETUP](../firmware/carpathron_car/CAR-SETUP.md).

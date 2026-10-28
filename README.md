<p align="center">
  <img src="assets/brand/carpathron-social-1280x640.png" alt="Carpathron — robots you can talk to, drive and become" width="100%">
</p>

# Carpathron

**Robots you can talk to, drive and become.** Carpathron connects a small ESP32 camera robot to **Meta's Muse
models**, a **Windows AI agent**, **WhatsApp (text + voice)**, the **browser**, and a native **Meta Quest 3S
avatar app**. One brain (Muse), one open robot protocol, every way you want to reach your robot.

Built for the **Meta Global AI Developer Hackathon 2026 — Startup track**.

| | What it is | Where |
|---|---|---|
| 🧠 **Muse Carpathron** | Windows desktop app: chat + agent on **Meta Muse** (Muse Spark via the Meta Model API, or your Meta account via **Muse Code**), tools, MCP, sub-agents, RAG memory, projects, skills, WhatsApp remote, robot control, room mapping, browser VR | [`apps/desktop`](apps/desktop) |
| 🥽 **Carpathron Avatar** | Native **Meta Quest** app (OpenXR, Godot): see through the robot's eyes, drive with the controllers, turn your head and the robot turns with you, talk to Muse | [`apps/quest-avatar`](apps/quest-avatar) |
| 🚗 **Baby Carpathron firmware** | ESP32-CAM car (KUONGSHUN AD174 4WD kit): live video, drive, photo, Wi-Fi setup, RC-style control | [`firmware/carpathron_car`](firmware/carpathron_car) |
| 🔌 **Carpathron Robot Protocol** | Small open HTTP protocol: any robot that speaks it works with every app | [`protocol/ROBOT-PROTOCOL.md`](protocol/ROBOT-PROTOCOL.md) |
| 📘 **A-to-Z guide** | Setup, everyday use, best practices, troubleshooting | [`docs/GUIDE.md`](docs/GUIDE.md) |

## ⬇️ Download

<p align="center">
  <a href="https://github.com/qubitpage/carpathron-muse/releases/download/v1/Muse-Carpathron-Setup.exe"><img src="https://img.shields.io/badge/Windows-Download_Muse--Carpathron--Setup.exe_(127_MB)-0078D4?style=for-the-badge&logo=windows&logoColor=white" alt="Download for Windows"></a>
  <a href="https://github.com/qubitpage/carpathron-muse/raw/main/downloads/quest/CarpathronAvatar-1.1.4.apk"><img src="https://img.shields.io/badge/Meta_Quest-Download_CarpathronAvatar--1.1.4.apk_(27_MB)-0866FF?style=for-the-badge&logo=meta&logoColor=white" alt="Download for Meta Quest"></a>
</p>

| App | Download | How to install |
|---|---|---|
| 🧠 **Muse Carpathron** – Windows 10 / 11 / Server 2016+ (v1.3.0) | [**Muse-Carpathron-Setup.exe**](https://github.com/qubitpage/carpathron-muse/releases/download/v1/Muse-Carpathron-Setup.exe) | Double-click it. If SmartScreen appears: *More info → Run anyway*. The app opens when the install finishes. |
| 🥽 **Carpathron Avatar** – Meta Quest 3 / 3S / Pro / 2 (v1.1.4) | [**CarpathronAvatar-1.1.4.apk**](https://github.com/qubitpage/carpathron-muse/raw/main/downloads/quest/CarpathronAvatar-1.1.4.apk) | Developer Mode on the headset → Meta Quest Developer Hub → *Device manager → Add build* → open it from *Library → Unknown Sources*. The Meta Horizon Store version is in review. |
| 🚗 **Baby Carpathron** – ESP32-CAM car firmware | [`firmware/carpathron_car`](firmware/carpathron_car) | Arduino IDE, esp32 core 2.0.x, board *AI Thinker ESP32-CAM* – see [CAR-SETUP](firmware/carpathron_car/CAR-SETUP.md). |

All files of this version: **[Release v1](https://github.com/qubitpage/carpathron-muse/releases/tag/v1)** · alternative split installer (5 parts + `Install.bat`) in [`downloads/windows`](downloads/windows) · install notes in [`downloads/README.md`](downloads/README.md).

## How Meta Muse powers every app

| Muse model / tool | Used for | Apps |
|---|---|---|
| **Muse Spark** (Meta Model API) | Chat + agent with tools, sub-agents, vision ("what do you see?"), room-map analysis, auto-memory and auto-skills | Desktop, WhatsApp, Quest |
| **Muse Voice Transcribe** | WhatsApp voice notes and Quest push-to-talk → text → robot commands or the agent | WhatsApp, Quest |
| **Muse Code** (`muse serve`) | Sign in with your Meta account instead of an API key; same chat, tools and approvals | Desktop |

```
              ┌──────────────── Meta Model API ────────────────┐
              │  Muse Spark (chat · tools · vision)            │
              │  Muse Voice Transcribe (speech → text)          │
              └───────────────▲────────────────────────────────┘
                              │ HTTPS
 WhatsApp (text/voice) ──► ┌──┴──────────────────────────┐ ◄── Browser / phone / Quest browser (pairing PIN)
                           │  Muse Carpathron (Windows)   │
 Carpathron Avatar ──────► │  agent · memory · tools · MCP│ ◄── Muse Code (Meta account)
 (Quest, linked once)      └──┬───────────────────────────┘
                              │ Carpathron Robot Protocol (HTTP + MJPEG, LAN)
                       ┌──────▼─────────┐ ◄── Carpathron Avatar can also drive it directly
                       │ Baby Carpathron │
                       │ ESP32-CAM car   │
                       └─────────────────┘
```

## Highlights

- **Talk to your robot anywhere:** "drive forward 1 metre and take a photo" in the app, on WhatsApp, or by voice in the headset.
- **Be the robot:** in the Quest app the robot's camera fills your view; turn your head and the car turns with you.
- **Robot head:** the camera is fixed, so "look left / behind" turns the car's body, takes the photo and turns back.
- **Room mapping:** the car turns a full circle, Muse Spark names what it sees and how far, and you get a top-down map (also on WhatsApp and saved to memory).
- **Real agent:** file and PowerShell tools, MCP servers, parallel sub-agents, approvals (Ask / Auto / Plan), live activity showing what ran locally vs in the cloud.
- **Memory that grows:** BM25 RAG over chats, projects with knowledge files, auto-learned memories and skills.
- **Production details:** single standalone Windows installer (Win 10/11/Server), safety auto-stop on the robot, token-protected LAN access, PIN pairing, 35 backend tests + UI tests + a headless end-to-end Quest test.

## Quick start

1. **Car:** assemble the kit, flash [`firmware/carpathron_car`](firmware/carpathron_car) with Arduino IDE (esp32 core **2.0.12**), put it on your Wi-Fi ([CAR-SETUP](firmware/carpathron_car/CAR-SETUP.md)).
2. **PC:** install Muse Carpathron ([Muse-Carpathron-Setup.exe](https://github.com/qubitpage/carpathron-muse/releases/download/v1/Muse-Carpathron-Setup.exe), or build: `cd apps/desktop && npm ci && npm run dist`). Add your Meta Model API key or sign in with Muse Code. Robot page → **Find my car**.
3. **Phone:** Settings → WhatsApp → scan the QR. Send `/help` or a voice note.
4. **Quest 3S:** sideload [`CarpathronAvatar-1.1.4.apk`](https://github.com/qubitpage/carpathron-muse/raw/main/downloads/quest/CarpathronAvatar-1.1.4.apk) (Developer Mode + Meta Quest Developer Hub), open it from **Library → Unknown Sources**, click **Allow** on the PC once.

The full walk-through is in the **[A-to-Z guide](docs/GUIDE.md)**.

## Build & test

```bash
# Desktop app (Node 20+)
cd apps/desktop && npm ci
npm test                      # 35 end-to-end backend tests (fake Meta API, fake car, fake MCP)
node test/ui-eyes.js          # simulated Quest 3S in browser VR (Playwright)
npm run dist                  # Windows installer (on Linux needs wine)

# Quest app (Godot 4.4.1 + Android templates, JDK 17, apktool 2.11, zipalign, apksigner, Khronos OpenXR loader AAR)
cd apps/quest-avatar
DESKTOP=../desktop GODOT=godot node test_e2e.js      # headless end-to-end: robot + Muse link + voice
KS=my.keystore KS_PASS=... KS_ALIAS=... ./build_quest.sh

# Car firmware: open firmware/carpathron_car/carpathron_car.ino in Arduino IDE (board: AI Thinker ESP32-CAM)
```

## Repository layout

```
apps/desktop/        Electron app: backend (agent, engines, tools, robot, mapper, voice, WhatsApp) + UI + tests
apps/quest-avatar/   Godot 4 OpenXR app: robot_link.gd (protocol + MJPEG), muse_link.gd (Muse via PC), main.gd (VR)
firmware/            ESP32-CAM car firmware + assembly / Wi-Fi setup notes
protocol/            Carpathron Robot Protocol v1
docs/                A-to-Z guide
assets/brand/        Logo, icons, social preview
tools/               Release helpers
```

## License

MIT — see [LICENSE](LICENSE).

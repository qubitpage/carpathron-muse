# Carpathron — the A-to-Z guide

Everything you need to build, set up, use and get the best out of Carpathron: the robot car, the Windows app
with Meta Muse, WhatsApp text and voice control, the browser and the Meta Quest avatar app.

**Contents**

1. [What Carpathron is](#1-what-carpathron-is)
2. [What you need](#2-what-you-need)
3. [Build the car](#3-build-the-car)
4. [Flash the car firmware](#4-flash-the-car-firmware)
5. [Put the car on your Wi-Fi](#5-put-the-car-on-your-wi-fi)
6. [Install Muse Carpathron on Windows](#6-install-muse-carpathron-on-windows)
7. [Connect Meta Muse](#7-connect-meta-muse)
8. [Chat and the agent](#8-chat-and-the-agent)
9. [Memory, projects and skills](#9-memory-projects-and-skills)
10. [Drive the robot from the PC](#10-drive-the-robot-from-the-pc)
11. [Robot head and room map](#11-robot-head-and-room-map)
12. [WhatsApp: text and voice](#12-whatsapp-text-and-voice)
13. [Phone and browser access](#13-phone-and-browser-access)
14. [Meta Quest 3S: the Carpathron Avatar app](#14-meta-quest-3s-the-carpathron-avatar-app)
15. [Quest browser VR (no install)](#15-quest-browser-vr-no-install)
16. [Build your own robot](#16-build-your-own-robot)
17. [Best practices](#17-best-practices)
18. [Safety](#18-safety)
19. [Troubleshooting](#19-troubleshooting)
20. [Reference: commands and controls](#20-reference-commands-and-controls)

---

## 1. What Carpathron is

Carpathron gives a robot a **brain** (Meta Muse), **many ways to be reached** (desktop, WhatsApp, voice,
browser, VR) and **one open protocol** so new robots plug in without changing the apps.

| Part | Role |
|---|---|
| **Baby Carpathron** | The robot: ESP32-CAM 4WD car with live camera |
| **Muse Carpathron** | The brain and hub on your Windows PC: Muse agent, memory, tools, WhatsApp, robot link |
| **Carpathron Avatar** | The body you wear: a native Meta Quest app to see through the robot and drive it |
| **Carpathron Robot Protocol** | The language every Carpathron robot speaks (HTTP + MJPEG) |

Meta models used: **Muse Spark** (chat, tools, vision), **Muse Voice Transcribe** (speech to text) and
**Muse Code** (sign in with your Meta account).

## 2. What you need

| Item | Notes |
|---|---|
| KUONGSHUN AD174 ESP32 WiFi Camera 4WD kit | ESP32-CAM, L298N driver, 4 TT motors, battery box |
| 2 × 18650 batteries, **fully charged** | The motors run only from the batteries, never from USB |
| Windows 10 / 11 / Server PC | Same Wi-Fi as the car |
| 2.4 GHz Wi-Fi | The ESP32 does not see 5 GHz networks |
| Meta Model API key | From the Meta developer platform. Or a Meta account with Muse Code |
| Phone with WhatsApp | Optional, for remote control |
| Meta Quest 3S | Optional, for the avatar experience |
| USB-C cable | To flash the car and to install the Quest app |

## 3. Build the car

Follow the kit's *Assembly Guide* (steps 0–8). The important parts:

- **Motors:** each pair on one side goes to the same L298N output.
- **Battery box → L298N P1 (VIN / GND)**, red to VIN.
- **L298N P2 (5V / GND) → ESP32 header pins 2–3** (red = 5V nearest the USB-C end, black = GND).
- **6-wire cable: L298N P7 (EN_A, IN1, IN2, IN3, IN4, EN_B) → ESP32 header pins 4–9**, directly next to the
  red/black plug, **no bare pins between the two plugs**, one bare pin at each end of the header.
- Click the **antenna** firmly onto the ESP32-CAM: it makes a big difference to video and control.

| L298N | ESP32 GPIO | Meaning |
|---|---|---|
| ENA | 12 | right wheels speed |
| IN1 / IN2 | 13 / 14 | right forward / back |
| IN3 / IN4 | 15 / 33 | left forward / back |
| ENB | 2 | left wheels speed |

## 4. Flash the car firmware

1. Install **Arduino IDE 2** and the **CH340** USB driver.
2. Boards Manager → **esp32 by Espressif → version 2.0.12** (the kit's version; do not update to 3.x).
3. Open `firmware/carpathron_car/carpathron_car.ino`.
4. **Tools → Board → AI Thinker ESP32-CAM**, **Tools → Port →** the COM port of the car.
5. **Upload.** If it says *Wrong boot mode*: hold **IO0**, tap **RST**, release IO0, upload again.
6. **One-time boot fix (important):** GPIO 12 is also a boot pin. With the 6-wire plug connected the ESP32
   would pick the wrong flash voltage and loop with `invalid header: 0xffffffff`. Open the Serial Monitor
   (115200, New Line), type `fixboot`, then `BURN`. It permanently sets the flash to 3.3 V (correct for the
   ESP32-CAM). Afterwards the car starts normally with everything plugged in.

## 5. Put the car on your Wi-Fi

Option A — **from the PC over USB** (Serial Monitor, 115200, New Line):
`wifi` → the car lists networks → type the network name → type its password. The car prints its IP.

Option B — **from a phone:** join the Wi-Fi **Carpathron-Car** (password `carpathron`), open
`http://192.168.4.1/setup`, pick your home network (not *Carpathron-Car*), type the password, **Save and connect**.

After that the car lives on your Wi-Fi at its IP (for example `192.168.1.131`) and at `http://carpathron.local/`.
Its own hotspot switches off 90 s after it joins, and comes back only if your Wi-Fi is unreachable.

Serial commands at any time: `status`, `test` (spins each side for 1 s), `wifi`, `forget`, `help`.

## 6. Install Muse Carpathron on Windows

Run the installer (or `Install.bat`, which re-assembles a split installer and checks it is not damaged) and
click **Yes** on the Windows prompt. It installs per-machine, adds a Start menu and desktop shortcut and a
firewall rule that lets only devices **on your local network** reach the app (Quest, phone).

Your data lives in `%USERPROFILE%\MuseCarpathron` (workspace, photos, maps) and the app data folder (chats,
settings). Updates keep both.

## 7. Connect Meta Muse

Pick an engine at the top of a chat:

| Engine | How | Best for |
|---|---|---|
| **Meta API key** | Settings → *Meta API key* → paste key → *Test* | Everything: vision, voice, room maps, WhatsApp, Quest |
| **Meta account (Muse Code)** | Settings → *Install Muse Code* → *Sign in* (and *Set up sandbox* once, click Yes) | Using your Meta account instead of a key |

Choose the model in the model picker (for example *muse-spark-1.3*). **Mode**:
**Ask** (approve every action), **Auto** (safe actions run, risky ones ask), **Plan** (the agent proposes, you approve).

## 8. Chat and the agent

Talk normally. The agent can read and write files in your workspace, run PowerShell, fetch web pages, use
MCP servers (Settings → MCP), drive the robot and take photos, and split big jobs into **parallel sub-agents**.
Every action appears as a card; risky ones ask for **Allow / Allow for this chat / Deny**.

The **Activity** page shows what ran **locally** (your PC) and what went to the **cloud** (Meta API).

## 9. Memory, projects and skills

- **Memory:** facts about you and your work, saved automatically (*auto-memory*) or with `/remember …`.
  Every chat sees the relevant ones; edit or delete them on the Memory page.
- **Chat search:** the agent can search all earlier chats (RAG), so chat B knows what you decided in chat A.
- **Projects:** a folder + knowledge files (PDF, DOCX, text, code). Chats in a project search them automatically.
- **Skills:** reusable instructions run with `/name`. After repeated multi-step work the app offers to learn a
  skill in your style (*auto-skills*).

## 10. Drive the robot from the PC

Robot page → **Find my car** (or type its IP) → *car online* with **live video**.

- Pad or **W A S D** (Space = stop), speed slider (remembered), headlight slider.
- Diagonals pivot on one side; ⟲ ⟳ spin on the spot.
- **Take photo** saves to `MuseCarpathron\photos` and shows it.
- Or just ask the agent: *"drive forward 50 cm, turn right and take a photo"*.

## 11. Robot head and room map

The camera is fixed to the car, so the car **turns its body** to look.

- **Look left / behind / right:** turn → photo → turn back. Also by voice and WhatsApp.
- **Scan the room:** the car turns a full circle in 8 steps, photographs every side, **Muse Spark** names the
  objects, their distance and the free space, and you get a **top-down map** + photo collage. The summary is
  saved to memory so later chats know the room. Maps are in `MuseCarpathron\maps`.
- **Turn calibration** (do this once): Robot page → *Turn calibration* → **Test 360°**. Too far → lower
  *Full turn (ms)*; not far enough → raise it. Looking, scanning and VR head steering all use it.

## 12. WhatsApp: text and voice

**Personal WhatsApp:** Settings → WhatsApp → *Personal* → scan the QR with WhatsApp → *Linked devices*.
Use the **Message yourself** chat (or add allowed numbers).
**WhatsApp Business Cloud API:** fill in the Cloud fields; the app can open a Cloudflare tunnel for the webhook.

Send `/help` for the list. Highlights:

| Message | What happens |
|---|---|
| `/photo` | The car takes a photo and sends it |
| `/drive forward 2` · `/f /b /l /r` | Quick moves |
| `/look left` · `/look back` | Turn, photo, turn back |
| `/scan` | Room map image + collage + summary |
| 🎤 voice note | **Muse Voice Transcribe** → short phrases ("forward two seconds", "stop", "look left") run instantly, anything longer goes to the agent |
| any text | The Muse agent with memory and tools |
| `yes` / `no` | Answer an approval request |

Voice notes are transcribed in English and 24 other languages (Romanian is not in Meta's list yet).

## 13. Phone and browser access

Settings → *Phone & Quest*: open the shown address (`https://<pc-ip>:8443/pair`) on any device on your Wi-Fi,
accept the certificate warning once (*Advanced → Proceed*), type the **6-digit PIN** shown on the PC
(valid 10 minutes). The full app opens: chat, robot, video. A phone can also act as the robot's camera.

## 14. Meta Quest 3S: the Carpathron Avatar app

### Install (once)

1. **Developer Mode:** Meta Horizon phone app → Devices → your Quest → Headset settings → *Developer Mode* on
   (create a free developer organisation if asked). Restart the headset.
2. **Meta Quest Developer Hub** on the PC → connect the Quest with USB-C → in the headset accept
   **Allow USB debugging** (check *Always allow*; if you don't see it, look in the headset's Notifications).
3. Developer Hub → Device manager → **Add build** → `CarpathronAvatar-1.1.4.apk` (from [`downloads/quest`](../downloads/quest)).
4. In the headset: **Library → filter (top right) → Unknown Sources → Carpathron Avatar**. Pin it if you like.
   The USB cable is only for installing.

### Use

The robot's camera fills a big screen in front of you; a panel below shows connection, signal and help.
The app finds the robot on your Wi-Fi by itself (and remembers it). The first time it asks to link with
Muse Carpathron: click **Allow** on the PC.

| Control | Action |
|---|---|
| Left stick / right stick | Left wheels / right wheels (tank). Click right stick → one-stick arcade |
| Trigger | Turbo (100 %) |
| **A / X** | **STOP** |
| B | Photo |
| **Turn your head** | The robot turns with you (head steering). **Y** toggles it |
| **Hold right grip + talk** | Muse: "drive forward two seconds", "look behind", "scan the room", any question |
| Left grip | "What do you see?" — Muse Spark looks through the robot's camera |
| Both grips 1 s | Search robots and the PC again |
| Menu | Next robot (if several) |

Taking the headset off or leaving the app stops the robot.

## 15. Quest browser VR (no install)

Open the pairing page in the Quest browser (section 13), Robot page → **👁 Robot eyes (VR)**. Same idea as the
app, inside the browser: video screen, sticks, head steering, A/X stop, B photo, left grip look behind, both
grips scan. The second button, **Passthrough drive (AR)**, keeps the real room visible to watch the real car.

## 16. Build your own robot

Implement the **Carpathron Robot Protocol** (`protocol/ROBOT-PROTOCOL.md`): `/status`, `/drive`, `/stop`,
`/capture` and MJPEG `/stream` on port 81, plus an auto-stop timeout. Your robot then works with the agent,
WhatsApp, voice, room scan, browser VR and the Quest app, with no app changes.

## 17. Best practices

**Power and hardware**
- Always run the motors from **charged 18650s**; USB alone powers only the ESP32 and camera.
- Antenna clicked on, car within good range of the router (−70 dBm or better for smooth video).
- Lift the wheels for the first tests; check each side with `test` in the Serial Monitor.

**Driving**
- Start at 60–80 % indoors; use turbo in open space.
- Calibrate the 360° turn on the floor you drive on (carpet and tiles differ).
- One video viewer at a time gives the best control latency on weak Wi-Fi (the car supports up to 3).

**Working with Muse**
- Be specific: *"drive forward 1 metre, then look left and tell me if the door is open"*.
- Use **Ask** mode while learning, **Auto** when you trust the setup, **Plan** for long jobs.
- Put manuals and notes into a **Project** so answers cite them.
- Keep memory clean: review the Memory page now and then.

**Security**
- The app is only reachable on your local network and needs a token, PIN pairing or (Quest app) an approval on the PC.
- Never paste passwords or keys into chats. WhatsApp only answers you (self-chat) and numbers you allow.
- Keep the API key in Settings only; it is never sent to the browser or the phone.

## 18. Safety

- The robot **stops by itself** after 2.5 s without commands (lost Wi-Fi, closed app).
- **A/X** in VR, **Space** on the PC, **STOP** buttons and `/robot stop` on WhatsApp stop immediately.
- Keep the car away from stairs, pets and liquids; supervise children.
- In VR you cannot see your real surroundings: stay seated or inside your Guardian boundary.

## 19. Troubleshooting

| Problem | Fix |
|---|---|
| `invalid header: 0xffffffff` boot loop | Run the one-time `fixboot` (section 4) |
| Upload *Wrong boot mode* | Hold IO0, tap RST, release, upload |
| Wheels don't move | Batteries charged and switched on, L298N LED on, battery plug in **P1 VIN/GND**, 6-wire plug fully on |
| Only some directions work | 6-wire plug shifted by a pin: no bare pins between the two plugs |
| One side runs backwards | `INVERT_LEFT` / `INVERT_RIGHT` in the firmware |
| Car not found on Wi-Fi | It must be on 2.4 GHz; Serial Monitor `status`; try `http://carpathron.local/` |
| Video stops / jerky driving | Signal too weak: move closer to the router, antenna on, close extra video viewers |
| Quest: *page isn't working* | Update Muse Carpathron (1.2.1+ redirects http→https); same Wi-Fi as the PC |
| Quest: can't find the app | Library → filter → **Unknown Sources** |
| Quest: "Muse: PC app not found" | Muse Carpathron must be running on the PC, same Wi-Fi; both grips 1 s to search again |
| WhatsApp doesn't answer | Settings → WhatsApp → status *connected*; write in **Message yourself** or add your number |
| Voice note not understood | Speak English, close to the mic; Romanian is not supported by Muse Voice Transcribe yet |
| Muse Code shell errors | Settings → *Set up sandbox* and click **Yes** on the Windows prompt |

## 20. Reference: commands and controls

**Car Serial Monitor:** `status` · `test` · `wifi` · `forget` · `fixboot` · `help`

**Car web page** (`http://<car-ip>/`): pad (hold to drive), speed, light, *Test left/right wheels*, *Wi-Fi setup*.

**Robot protocol:** `GET /status` · `/drive?l=&r=` · `/stop` · `/capture` · `:81/stream` · `/led?v=` · `ws /ws`

**WhatsApp:** `/help` `/new` `/stop` `/status` `/mode ask|auto|plan` `/photo` `/drive <dir> [s]` `/f /b /l /r`
`/look left|right|back` `/turn <deg>` `/scan` `/robot stop` `/remember <fact>` · voice notes · `yes`/`no`

**Chat:** `/remember <fact>` · `/<skill-name>` · engine, model and mode pickers at the top.

# Muse Carpathron — the complete guide

Muse Carpathron is a Windows app that turns **Meta Muse** models into a working assistant on your PC: it chats,
writes and runs code, works on your **remote servers over SSH**, publishes to **GitHub**, writes and flashes
**Arduino / ESP32 firmware**, reads and designs **PDFs and websites**, does **web research**, and drives the
**Carpathron robot** from the PC, WhatsApp, a phone or a Meta Quest headset.

This guide starts from zero (installing the app) and then explains every menu, button and tool.

> **New in 1.8 — Carpathron Shield (🛡 in the sidebar):** scans your projects for secrets before publishing, checks
> and hardens your servers and websites with one-click fixes that cannot lock you out, and monitors your servers live
> (section 7.6). 1.8.2 fixed the WhatsApp error "Cannot find module 'call-bind-apply-helpers'". **1.8.4:** local models with Ollama —
> install, download and use Muse Glimmer offline from Settings (section 3.4) and a faster agent that sends only the tools each chat needs (section 3.5). **1.8.5:** Settings in tabs,
> a Robots card, GPU-aware model suggestions (quantized Glimmer for 8–16 GB GPUs) and tool calls from small local models fixed.
> **1.8.6:** the robot works fully offline with small models — local **eyes** (Llama 3.2 Vision) describe photos for Llama 3.1 8B,
> **robot_goto** ("go to the door", "show me the red chair") finds things with the camera and drives there, the room map works offline,
> and WhatsApp chats can use a model on this PC (section 3.4.1). **1.8.7:** Llama 3.2 Vision works again (compatibility runner),
> Qwen3-VL 2B as fallback eyes, obstacle-aware driving and calibration buttons. **1.8.8:** photos reach Llama 3.1 8B as descriptions (it said it could not see them before),
> pictures sent on WhatsApp are described too, and Settings no longer waits for the cloud model list. **1.8.9:** measured
> distances (floor geometry), distance budget, bump detection, 35 cm hops, distance calibration, only robot tools for small
> models (no more random driving), robot_drive accepts what small models send. **1.9.0:** exact boxes from Qwen3-VL (its own "Detect …"
> prompts, thinking off), automatic turn calibration with the camera. **1.9.2:** ⬆ Update car firmware (USB) and the
> robot_firmware tool, car firmware 2.0 with optional laser distance + gyro (section 3.4.3). Robot page with Control / Setup / Devices / Firmware studio (section 3.4.2).
> **1.9.5:** 🖥 **Remote desktop** plugin — the Carpathron Remote app built in: control your PCs or help others, chat, voice
> call, drag-and-drop files, presentation mode and an SSH terminal like PuTTY (section 7.7). Shield lists UDP/TURN ports
> and installs held-back kernel updates; generated SSH keys are always valid; the terminal hides stray escape codes; the
> version is shown at the bottom of the sidebar.
> **1.9.6:** no automatic updates any more (this is the hackathon edition); dependency security update — no known
> vulnerabilities in the app's libraries.
> **2.2.4:** for **Carpathron Avatar 1.2** (Meta Quest): the headset shows the room map, what the car is doing and runs
> missions — explore, scan with photos, measure, **find an object**, stop — through Muse Carpathron on the PC.
> **2.2.3:** car firmware 2.4.1 — the gyro on the Mega hub gets its zero measured again when the car stands still but its
> heading keeps turning (it measured it while being carried), Calibration → Gyro zero now re-zeroes the Mega's gyro, and a
> restart of the Mega no longer looks like a turn.
> **2.2.2:** the robot looks after itself — **car firmware 2.4 + Mega hub 1.1**: the Mega restarts by itself if it ever
> freezes (a watchdog: no need to open the cover), the car never drives forward without its distance sensor, a **bump**
> (a jolt) stops it and backs it off, a **step or an edge** (a sudden lean) stops it and backs it off, and the optional
> **drop sensor** and **side eyes** on the Mega are used too. On the **🗺 Map** what the car felt is drawn as red marks that
> routes keep away from, routes keep more room from walls, the car drives in 30 cm hops, and **🎯 Find an object** is a
> mission: map + camera, or scan and explore until it sees it ("find the chair" also from chat and voice). The robot
> voices download again on every PC (the unpacking no longer needs bzip2).
> **2.2.1:** the wiring guide shows the Mega as it lies with the USB socket at the bottom, which jumper wire goes where and what to solder.
> **2.2.0:** the **Arduino Mega sensor hub**: car firmware 2.3 takes heading, distance (HC-SR04 eyes), temperature,
> humidity and tilt from an Arduino Mega 2560 over two wires; Robot → Setup has a **🔌 Flash the Mega** button and the new
> sensor mode, Board & parts has the Mega wiring (with a DHT11 part and the car link), Guide 3.4.3 has every wire.
> **2.1.0:** a rebuilt Remote desktop (the same as Carpathron Remote 1.3.0): a native input helper so mouse and keyboard work on every PC,
> no freeze when minimizing or dragging windows, the picture restarts by itself if Windows stops the capture, automatic
> reconnect, remote restart, trusted computers (connect to your own PCs without a password), change your ID, actual size
> view, Ctrl+Alt+Del and Refresh in the Keys menu, and an easy way out of full screen. The **✦ AI technician** works like a
> real technician: it diagnoses from the output, retries failed commands another way and checks its own fixes; commands
> that only read run without asking; you can chat with it while it works and switch the AI service in its panel; the
> Supervisor's findings go back to the AI in both modes.
> **2.0.3:** remote desktop fix: on some Windows PCs the mouse and keyboard did not work on the remote screen and the AI technician's commands failed ("spawn powershell.exe ENOENT", a broken PATH). Windows programs are now started by their full path.
> **2.0.2:** the **✦ AI technician** in the built-in Remote desktop and **✦ AI DevOps** in its SSH terminal: give a job
> and Muse works on the remote PC (sees the screen, clicks, types, runs PowerShell / bash, installs and removes software,
> checks disks, security and updates) or on a server over SSH — with your OK for every change or on Autopilot, and the
> 🛡 Supervisor checks the result. It uses Muse Carpathron's own Meta API key (section 7.8).
> **2.0.1:** the Supervisor no longer refuses harmless commands whose paths contain short command names (e.g. `rd-`, `md-`).
> **2.0.0:** the **🛡 Supervisor** — after a job that changed something, an independent inspector checks the work
> with its own read-only checks (files, services, ports, pages, test runs, the Shield security check, a screenshot) and
> shows a verdict with evidence: *Verified*, *Partly*, *Not verified* or *Can't verify*. It never trusts the agent's own
> words and it cannot change anything. If it finds a problem in Auto / Full mode, the agent fixes it and the Supervisor
> checks again (section 5.10).
> **1.9.9:** a **🗺 Map** tab: the car learns the room with its laser (an occupancy map in 3D), explores by itself,
> and you put the robot on the map, name places and send it there — it plans a way around the walls (also by chat, voice
> and a 🧱 step). **🧱 Blocks** redesigned as a clear step-by-step builder (no more blocks on top of each other), a nicer
> Baby Carpathron and practice room in 3D, and layout fixes (text out of its box, the robot tabs in one row).
>
> **1.9.8:** easier to understand, better to look at and to hear. The robot has its **own voice** — an offline neural
> voice made on your PC with a small-robot sound (pick *Bella — cute robot*, *Michael — WALL-E style workbot*, *Emma*,
> *Sky* or the light *Kitten* voices; one download, then no internet needed), and its face moves its mouth with the sound.
> **🧱 Blocks** speak everyday words (*turn the light ON*, *wait 1 second*, *when the button is pressed*) and show *What it
> does*, *What to connect* and the code side by side; the Firmware studio has **📖 Explain** — every line of a program in
> plain English next to the code. **🔌 Wiring** is a real electrical diagram (each board pin, each module's connector and
> screw terminal, coloured wires: red +, black GND, blue SDA, yellow SCL…). The practice car drives in a **furnished 3D
> room** (camera view from the car, chase / top / room views) that moves with the car (sections 3.4.6 – 3.4.8).
>
> **1.9.7:** robot tools upgrade, part 1. Car firmware **2.2**: every setting of the car can be changed from the app
> (🛠 **Car settings**, explained like a modern BIOS, checked before they are saved), the car **tests itself** (🩺 **Health**:
> camera, memory, Wi-Fi, sensors, each side of wheels — with the likely cause and a one-click fix), firmware **over Wi-Fi**
> with **undo**, a **practice car** (simulator) to try everything without hardware, the **robot passport** (what changed and
> what the checks found), a 🎯 **calibration wizard** (gyro, motor dead zone, straight driving, real speed, laser, turns,
> camera), 🔧 **Board & parts** (pins of 6 boards, parts library, wiring, starter code), smooth keyboard / controller
> driving with a driving display, 🗣 **voice control and the robot's own voice**, a 🧊 **3D plan view** with laser room
> outlines and *Go there*, 🧱 **Blocks** (missions, teach & repeat, firmware from blocks), ✅ *Make my robot ready*, a Firmware
> studio with colours, suggestions, a pin check before upload, a serial plotter and libraries, Quest mini-map and haptics, and the AI
> tools robot_settings, robot_diagnose, board_pins and robot_say (sections 3.4.2 – 3.4.7).
>
> **Muse Carpathron** is the open-source edition of this app (Meta AI hackathon). The same app is on the Microsoft
> Store as *Carpathron Robotics & Coding*. It is made by **Qubitpage LIMITED** (qubitpage.com).

---

## 1. Quick start (10 minutes)

1. **Install the app**: download **Muse-Carpathron-Setup-<version>.exe** from <https://github.com/qubitpage/carpathron-muse/releases/latest> and double-click it (section 2).
2. **Connect Meta** — *Settings → AI models → Sign in to Meta*. Either paste a **Meta API key** and press *Save & test*, or install
   **Muse Code** and sign in with your **Meta account** (section 3).
3. **New chat** (top left) → type what you want, for example *"What can you do on this PC?"*.
4. Pick the **mode** at the top right: **Ask** while you learn, **Auto** or **Full** when you trust the setup.
5. Optional, add what you use:
   - **Remote** → add your VPS / dedicated server (section 7).
   - **Plugins → GitHub** → *Sign in with browser* (section 8).
   - **Robot** → *Find my car* (section 12).
   - **Settings → Devices & robots → WhatsApp** to control everything from your phone (section 13).

---

## 2. Install, update and uninstall

**Requirements:** Windows 10 or 11 (64-bit), internet access, a Meta account or a Meta Model API key.

**Install**
1. Download **Muse-Carpathron-Setup-<version>.exe** from <https://github.com/qubitpage/carpathron-muse/releases/latest> and
   double-click it. If SmartScreen appears: *More info → Run anyway*.
2. Open it from the Start menu. The first time, Windows may ask whether the app can use your network: allow
   **private networks** if you want to use a phone or the Quest headset with it.
3. The app also lives in the system tray (bottom right) — closing the window keeps it running for WhatsApp and the
   robot; use *Quit* in the tray menu to exit completely.

**Update:** Muse Carpathron is the Meta AI hackathon edition and does not update itself. To install a newer build,
run its installer over the old one. **Your chats, settings, saved servers, keys, memory and skills are kept.**

**Where your data is**

| What | Where |
|---|---|
| Workspace, photos, room maps, research reports | `%USERPROFILE%\MuseCarpathron` |
| Chats, settings, servers, keys, memory, skills, log | `%APPDATA%\Muse Carpathron\data` |
| Log file (for troubleshooting) | same folder, `muse-carpathron.log` |

Passwords, API keys, SSH keys and the GitHub token are **encrypted with your Windows account** (DPAPI). They never
appear in the app package, in the browser or on the phone.

**Uninstall:** Windows *Settings → Apps → Muse Carpathron → Uninstall* (or right-click it in the Start menu).
Your chats and settings (`%APPDATA%\Muse Carpathron`) and your workspace folder (`%USERPROFILE%\MuseCarpathron`) stay.

---

> **Settings is organised in tabs:** 🧠 **AI models** (Sign in to Meta, Local models / offline, Tools & models) ·
> 🤖 **Agent** (Defaults) · 📱 **Devices & robots** (Robots, Phone & Quest, WhatsApp) · 🔌 **Integrations**
> (Remote servers, SSH keys, GitHub, MCP servers) · ℹ **App** (About). The app remembers the last tab.

## 3. Connect Meta Muse (the brain)

*Settings → AI models → Sign in to Meta* offers two engines. You can use both and switch per chat.

| Engine | What you need | Best for |
|---|---|---|
| **Meta API key** | An API key from the Meta developer platform (dev.meta.ai → API keys) | Everything: all models, vision, image generation, SAM, voice, WhatsApp, Quest |
| **Meta account (Muse Code)** | The Muse Code program + your Meta login | Using your Meta account instead of a key; Muse Code's own coding agent |

### 3.1 Meta API key

1. *Settings → Sign in to Meta → API key* → paste the key → **Save & test**. A green tick means it works.
2. *API base URL* — leave the default unless Meta gives you another address.
3. **Remove key** deletes it from this PC.

### 3.2 Meta account (Muse Code)

1. **Install Muse Code** — opens the official installer in a new window; press **Re-check** when it finishes.
   (If you installed it somewhere special, fill in *Muse Code path*.)
2. **Sign in with Meta** — a window opens; log in with your Meta account, then press **Test**.
3. **Windows sandbox** (optional, one time): **Set up Windows sandbox** → click **Yes** on the Windows prompt.
   It lets Muse Code run PowerShell commands in a protected sandbox. You do **not** need it if you:
   - leave *Settings → Tools & models → Muse Code Windows sandbox* on **Automatic** (the default — the app runs
     without the sandbox when it isn't available), or
   - use **Full** mode, or
   - use the API-key engine.

### 3.3 Models and what they can do

Pick the model at the top of a chat. Under the chat header, small badges show what the selected model can do
(text, images, video, audio, PDF, tools, reasoning, web search) — the app adapts automatically.

| Model | Use it for |
|---|---|
| **muse-spark-1.1 / 1.2 / 1.3** | Everyday work: chat, coding, tools, looking at images. Has **reasoning effort** |
| **muse-wonder-1.0** | The hardest problems; effort up to *max* |
| **muse-image-1.0** | Draws or edits pictures — your message is the prompt; attach an image to edit it |
| **sam-3.1** | Finds objects in a photo or video (boxes + overlay picture). Attach the image, write what to find |
| **muse-voice-transcribe-1.0** | Turns an audio file into text. Attach the audio |

**Reasoning effort** (Spark / Wonder): the selector next to the model. Higher = slower but more careful.
Default in *Settings → Tools & models*.

---

### 3.4 Local models on this PC (Ollama) — work offline

Meta's open-weight models run on your own GPU: private, free per message, and they **work without internet**. They
use tools like the cloud models (files, commands, robot…). Everything is set up in **Settings → Local models (Ollama)**:

1. **⬇ Install Ollama** (free, from ollama.com, installed with winget). If it is installed but stopped, the button is
   **▶ Start Ollama** — the app also starts it by itself when a chat needs it.
2. **Download a model** — the field suggests Meta's models:
   - `muse-glimmer` (18 GB) — **Muse Glimmer 30B**: tools, vision, reasoning. Best quality; a 24 GB GPU is ideal,
     a 16 GB GPU works (part of it runs on the CPU, slower).
   - Smaller (quantized) Glimmer builds for GPUs with less memory — Glimmer is a dense 30B model, so on a small GPU
     part of it runs on the CPU (works, slower): `hf.co/bartowski/Muse-Glimmer-30B-GGUF:Q3_K_M` (17.8 GB with vision, 12–16 GB GPUs)
     and `hf.co/bartowski/Muse-Glimmer-30B-GGUF:IQ3_XXS` (15.4 GB with vision, 8–12 GB GPUs; pick a 8K–16K context). The app gives these files Glimmer's official prompt format automatically.
   - `llama3.1:8b` (4.9 GB) — fits fully on 8 GB GPUs, fastest for everyday work. `llama3.2:3b` (2 GB) — simple tasks.
   The card shows **your GPU and the recommended model** and puts it in the box; click any suggestion to use it.
   A progress bar shows the download; you can cancel it.
3. Each downloaded model has a checkbox **show in the model menu**, **Make default**, **Test** and **Delete**.
   In a chat, pick a model marked **"— on this PC (offline)"**.
4. **Work offline** (on by default): if Meta's cloud cannot be reached (no internet), a chat continues with the default
   local model and tells you so.
5. **Context window** (32K recommended): how much the model reads at once. The app creates a tuned copy of each
   model in Ollama with this size (instant, no extra disk space), because Ollama's default is too small for an agent.

Offline, tools that need Meta's cloud (web search, Muse Image, SAM 3.1, voice transcription) are not available;
everything on your PC (files, commands, Arduino, robot on your Wi-Fi) keeps working. LM Studio or a llama.cpp
server can be used instead of Ollama (*Advanced* in the same card).

### 3.4.1 The robot with a small local model (offline)

No training is needed: the app gives local models a short robot briefing and, when you talk about the robot, only the
robot tools. Llama 3.1 8B cannot see, so a **vision model** looks at every photo and tells it what is there:

1. *Settings → AI models → Local models*: download `llama3.2-vision:11b` (7.8 GB, Meta). Newer Ollama versions cannot
   run it, so the app sets up a **compatibility runner** by itself (Ollama 0.24 on port 11435, sharing the same model
   folder; ≈1–2 GB once). Also download `qwen3-vl:2b` (1.9 GB) as the fast fallback: **Eyes for photos** on *Automatic*
   uses Llama 3.2 Vision first and Qwen3-VL 2B when it fails (or pick one yourself). Only one model sits on the GPU at a
   time: the app unloads the other one first.
2. Pick `llama3.1:8b — on this PC` in the chat (and in *Settings → Devices & robots → WhatsApp → Model for WhatsApp chats*
   to drive the robot from your phone with the thinking done on your PC).
3. Ask: *"go to the door"*, *"find the red ball and show me"*, *"scan the room"*. **robot_goto** looks ahead, checks the
   last room map, looks around in 60° steps, turns towards the object and drives in short hops with a new photo after each
   hop (at most 35 cm); the photos come to the chat and WhatsApp.
   **Distances are measured, not guessed:** the camera sits a known height above the floor, so the row where an object
   (or the nearest obstacle) touches the floor in the picture gives its distance. Qwen3-VL 2B draws the boxes (it is
   trained for exact boxes), Llama 3.2 Vision describes. The car never drives further in total than the first measured
   distance, never further than the free floor ahead (minus 20 cm), stops when the target fills the picture, and when
   the picture does not change after a drive (it bumped into something) it backs up 10 cm and goes around on the freer
   side. For centimetre precision add a VL53L1X laser distance sensor to the car (ask the agent for the wiring).
4. Calibrate once in *Settings → Devices & robots → Robots*: **▶ Test 1 s drive** → measure → **Distance per second (cm)**;
   **🔄 Auto-calibrate turn** (the car spins continuously for about 7 s while photographing; the time until each view comes
   back = one full circle → *Full turn (ms)*) and check with **↻ Test 360° turn**; put a box or a shoe exactly
   **50 cm** in front of the car → **📏 Calibrate distance**. You can take over any time on the
   Robot page, from the phone or with the Quest (Avatar mode).

### 3.4.2 The Robot page: Control · Setup · Car settings · Health · Devices · Firmware studio

- **🎮 Control** — drive, live video with the driving display, 🗣 voice, look around, room map, Quest (section 3.4.7).
- **⚙ Setup** — car address, calibration (drive, turn, distance), **⬆ Car firmware** (check, build, flash over USB or
  Wi-Fi, undo — section 3.4.3), sensor mode and live sensor values.
- **🛠 Car settings** — every setting of the car in groups (Motors, Driving and safety, Camera, Sensors, Light, Name and
  hotspot), each with a plain explanation, its range and default (section 3.4.4).
- **🩺 Health & calibration** — the car tests itself and Muse explains the result; the calibration wizard (section 3.4.5).
- **🧱 Blocks** — programming with blocks for beginners: missions that drive the car, firmware for a board, teach &
  repeat (section 3.4.8).
- **🔧 Board & parts** — what every pin of a board can do, your robot's parts with their wiring, starter code (section 3.4.6).
- **🔌 Devices** — what is connected, found by itself: boards on USB by their chip (ESP32 / ESP32-CAM with CH340 or CP210x,
  Arduino Uno / Nano / Mega / R4, Raspberry Pi Pico — also in BOOTSEL or MicroPython —, STM32, Teensy, Jetson on USB) and
  robots on the network (the car, saved SSH servers that are Raspberry Pi / Jetson boards, raspberrypi.local, jetson.local,
  192.168.55.1). For each: the board (FQBN), whether its Arduino core is installed (**Install** button), and what to do next
  (open the car firmware, new firmware for this board, serial monitor, MicroPython, SSH).
- **🧩 Firmware studio** — Arduino projects in `<workspace>\firmware\<name>`: pick the project, **Board** and **Port**, edit
  the files (Ctrl+S saves; every save keeps the previous version in **History**), **Compile** (errors listed with
  file:line — click one to jump there, or **Fix the errors with AI**), **Upload**, **Serial** monitor (send lines too).
  **Ask AI** opens a chat working in the project folder: describe the change, the AI edits, compiles and fixes the code,
  then you upload here. New projects start from templates (Blink, ESP32 web page, servo sweep, the car firmware).

### 3.4.3 Car firmware and sensors

**What firmware is** — the program inside the car's chip. *Building* (compiling) turns the code into a file for the chip;
*flashing* writes that file into the car. Robot → ⚙ Setup → **⬆ Car firmware** has five steps:

1. **🔎 Check** — which firmware the car has, which one the app brings, whether Wi-Fi updates are ready, and the builds
   kept on this PC.
2. **🔨 Build** (optional) — only compiles, to see that the code is fine. Nothing is sent to the car.
3. **🔌 Flash over USB** — connect the car with its USB-C *data* cable. The app copies the firmware to
   `<workspace>\firmware\carpathron_car` (an edited copy is kept as a backup), finds the car's USB port (CH340), installs
   the ESP32 tools the first time, compiles for the AI Thinker ESP32-CAM and uploads. Needed **once**: it also gives the car
   room for a second firmware, so later updates can go over Wi-Fi. If it hangs on "Connecting…", hold the board's BOOT
   button (or connect IO0 to GND) until the upload starts. Your Wi-Fi and car settings stay.
4. **📶 Flash over Wi-Fi** — no cable: the firmware goes through your Wi-Fi. The car checks the file before switching to it.
   Only this PC can do it (a random key made on this PC is built into the car — flash once over USB from another PC to
   move it there).
5. **↩ Undo** — the car keeps the firmware it had before the last update and goes back to it.

Or ask in a chat: *"update the car firmware"*, *"flash it over Wi-Fi"*, *"undo the last firmware update"*. To change the
firmware, edit the workspace copy (or ask the agent to) and flash it with arduino_upload or the Firmware studio.

**Kit IR modules (no shopping)** — two "Avoid" IR obstacle modules from a sensor kit: VCC → 3V3, GND → GND, OUT → **RXD**
(front-left) and **TXD** (front-right). Then Robot → Setup → *Sensor mode: IR obstacle modules* (the car restarts): it
refuses to drive into what they see and *go to* steers round on the free side. Turn each module's knob until its LED lights
at about 15 cm.

**Optional sensors (≈ 20 lei)** — a **VL53L0X** laser distance sensor (the car refuses to drive forward closer than 15 cm
to anything, and *go to* uses the real distance) and an **MPU-6050 (GY-521)** gyro (exact turns). Both go on the free
pins of the ESP32-CAM board's right row:

| Board | VL53L0X | MPU-6050 |
|---|---|---|
| 3V3 (first) | VIN | — |
| 3V3 (second) | — | VCC |
| GND | GND | GND |
| RXD (GPIO 3) | SDA | SDA |
| TXD (GPIO 1) | SCL | SCL |

Mount the distance sensor in the middle of the front, facing forward, 3–5 cm above the floor; the gyro flat and firmly
in the middle of the chassis. The car finds them when it starts (keep it still for a second — the gyro measures its
zero). While they are connected the USB Serial Monitor is off (same pins); uploads still work (if one fails, unplug the
SDA wire during the upload).

**Arduino Mega sensor hub (firmware 2.3)** — an Arduino Mega 2560 inside the CARPATHRON cover reads the **HC-SR04** (the
robot's eyes, in the head's eye holes), the **MPU-6050** gyro and a **DHT11** (temperature + humidity) and sends them to
the car 20 times a second over two wires. The car uses the HC-SR04 for the obstacle stop and the gyro for exact turns,
exactly like the laser and the gyro above, and Robot → Setup also shows temperature, humidity and tilt. Nothing on the car
itself is rewired. Lay the Mega with its **USB socket and power jack at the bottom** (power pins down the right side, pins 0–21 down the left, the long double row at the top); the numbers are the wire numbers:

| # | From | To on the Mega |
|---|---|---|
| 1 | ESP32 board **5V** | **5V** — top double row, far left, upper pin (edge) |
| 2 | ESP32 board **GND** | **GND** — left side, just above AREF |
| 3 | Mega **TX1 18** | 1 kΩ → ESP32 **RXD**; plus 2 kΩ (two 1 kΩ in a row) from ESP32 RXD to ESP32 GND |
| 4 | ESP32 **TXD** | Mega **RX1 19** |
| 5–8 | HC-SR04 VCC · Trig · Echo · GND | 5V (top row, far left, lower pin) · **22** (lower row) · **23** (upper row), second from the left · GND (top row, far right, upper pin) |
| 9–12 | MPU-6050 VCC · GND · SCL · SDA | **3.3V** · GND next to 5V (right side) · **SCL 21** · **SDA 20** (left side, top) |
| 13–15 | DHT11 S · + · − | **A0** · 5V · GND next to Vin (all on the right side) |

Every wire is male–female (pin end in the Mega's sockets, socket end on the sensor or the ESP32 board's pins). The 1 kΩ
on wire 3 goes straight into Mega socket 18; at the ESP32 end, its other leg and the 2 kΩ are twisted together into a
female–female wire to RXD, and the 2 kΩ's free leg goes on a female–female wire to the bottom GND. **Solder the
MPU-6050's pin strip** (at least VCC GND SCL SDA); the HC-SR04 and DHT11 already have pins. Robot → Setup → 📄 *Open the
pin-by-pin wiring guide* shows all of this on a drawing of the board.

Steps: (1) update the car to 2.3 first (over Wi-Fi is easiest), (2) Robot → Setup → **🧠 Arduino Mega sensor hub → 🔌 Flash
the Mega** with the Mega on its USB cable and wire 1 unplugged, (3) wire everything, switch the car on and keep it still
for 2 seconds (the gyro measures its zero). Sensor mode *Auto* finds the Mega by itself; *Arduino Mega hub* forces it.
Robot → Board & parts → **Arduino Mega 2560** shows the same pins on the board drawing. The printed insert (six keys that
click into the cover's side vents, six pins for the Mega's holes, four clips) holds the Mega under the roof, behind the
antenna; fold the antenna forward before the cover goes on.

**Hub 1.1 + car firmware 2.4 (Muse Carpathron 2.2.2) — it looks after itself.** A watchdog restarts the Mega within 4 s if it
ever freezes (a crash can pull the 5 V down), and the gyro is woken up again if it stops answering. While the Mega's line
is missing the car refuses to drive forward. The gyro board's accelerometer feels a **bump** (a jolt of more than 0.8 g):
the car stops and backs off ~10 cm. It also learns its **level** standing still; a lean of more than 10° while driving (the
front wheels over a step or an edge, or climbing onto something) stops it and backs it off. Optional, found by themselves:
**side eyes** — two more HC-SR04 at the front corners, turned 45° outwards and low (left Trig 26 / Echo 27, right Trig 28 /
Echo 29) — and a **drop sensor**: an IR module (TCRT5000) at the very front looking down at the floor about 1 cm above it
(DO → 30, VCC 5V, GND): no floor = the car stops before the edge. Robot → 🗺 Map → **🛡 What the car feels** shows them live.
Flash the hub once from Robot → Setup → 🔌 Flash the Mega (Mega on its USB cable). Tip: leave a USB cable plugged into the
Mega and lead it out of a vent, then the next update needs no screwdriver.

### 3.4.4 Car settings (firmware 2.2)

Robot → **🛠 Car settings** shows everything the car can be set to, in groups, like a modern BIOS screen: a plain
explanation under each setting, its range, a **↺ default** button, and a drawing of the ESP32-CAM with the wires where they
go (click a pin to see what it can do). Changes are checked **before** they are saved: a pin the camera or the memory
needs, a pin used twice and values out of range are refused with the reason; boot pins (GPIO 2, 12, 15) get a warning.
The car checks every value again itself, so a wrong value can never be stored. Settings marked **↻** (pins, motor PWM
frequency, laser measuring time, hotspot) start working after **Restart the car now**; the others work at once.
Pins can be swapped in one save (for example right and left speed pins). **Factory settings** puts everything back to the
kit values (your Wi-Fi stays).

| Group | What you can set |
|---|---|
| Motors | the six L298N pins, *wheels turn the wrong way* (left / right), *left and right are swapped*, lowest power that moves the wheels, top speed limit, straight-driving trim, PWM frequency |
| Driving and safety | stop distance in front (laser), stop when the connection is lost after …, gyro turn speed |
| Camera | picture size, live video and photo quality, flip / mirror, brightness, contrast, colour, white balance, exposure |
| Sensors | I2C pins, laser measuring time and offset, gyro scale |
| Light | headlight brightness limit |
| Name and hotspot | the robot's name, the hotspot name and password |

**Practice car** — no car at hand? Press **🧪 Use the practice car**: a simulated Baby Carpathron (same firmware 2.2
commands) drives in a furnished 3D room (sofa, armchair, table, plant, rug, door, window, a ball), with a camera, laser
and gyro. On the Control tab the live video becomes the **view from the car's camera** — it moves and turns as you drive
— and the practice card shows the car from behind (**chase**), from **above** or from the room's corner; the photos, the
laser and the room scan see the same room. Everything works on it — driving, settings, the health check. *Practise a fault* breaks it on purpose (camera not found, a dead motor, reversed or swapped
motor wires, a noisy laser, a drifting gyro, weak Wi-Fi, no PSRAM) so you can learn to find and fix problems.

### 3.4.5 Health check and robot passport

Robot → **🩺 Health → Check the car**: the car tests its camera (frames per second, sensor type, start-up error code),
memory (PSRAM), Wi-Fi signal, why it last restarted, the I2C bus (which parts answer), the laser (20 readings: steady or
jumping) and the gyro (chip id, drift at rest, noise). **Check + test the wheels** also moves each side of wheels for a
moment (give it 30 cm of space or lift it): with the gyro it sees whether each side moved and turned the right way, and
with the laser whether the sides are swapped or both reversed. Every part gets ✅ healthy, ⚠️ check this, ⛔ not working
or ℹ️ note, with the likely cause and what to do; where a setting fixes it, **🔧 Apply this fix** does it.
**🤖 Troubleshoot with Muse** hands the result to the agent. The **📒 Robot passport** lists every change of settings and
firmware and every check, newest first.

**🎯 Calibration** (same tab) — seven steps, each measures one thing with the car's own sensors and saves the right setting:
1 *Gyro zero* (restarts the car standing still if the gyro drifts), 2 *Lowest power that moves the wheels* (more and more
power on each side until the gyro sees the car move), 3 *Drive straight* (drives about 40 cm forward and back up to 4 times
and corrects the trim), 4 *Real speed* (with the laser, for "go to"), 5 *Laser distance* (a box at a distance you measured →
laser offset), 6 *Exact turns* (turns 360°, you say how far off it ended → gyro scale), 7 *Camera picture* (brightness,
contrast and colour until the picture is clear). Steps marked *moves* drive the car: give it space. Every result goes in the
robot passport and can be changed back in Car settings.

The agent has the same: *"check the car"* (robot_diagnose), *"make the car slower"* / *"the left wheels go backward"*
(robot_settings, checked like the screen does) and *"where can I connect a servo on the ESP32-CAM?"* (board_pins: what every
pin of the ESP32-CAM, ESP32 DevKit, XIAO ESP32S3, Uno, Mega and Pico can do, and a check of a planned wiring).

### 3.4.6 Board & parts — pins, parts, wiring

Robot → **🔧 Board & parts**. Pick a board — AI-Thinker ESP32-CAM (the car), ESP32 DevKitC, Seeed XIAO ESP32S3, Arduino Uno,
Arduino Mega 2560, Raspberry Pi Pico — to see a drawing of its pins: green = used by your robot, red = power or a pin used
twice, an amber ring = a boot pin (usable with care), grey = taken by the board itself (camera, memory, flash). Click a pin
for what it can do (input, output, PWM, analog, I2C, interrupt…) and what uses it. Pins inside the board are listed under
the drawing.

**＋ Add a part** — pick it from the library (motor drivers, servos, distance sensors, gyro, line and IR sensors, wheel
encoders, climate, battery monitor, extra analog inputs, OLED display, 16-servo driver, I2S speaker and microphone, RGB
LEDs, buzzer, GPS). Muse picks free pins that can do the job (plain pins before boot pins, I2C parts share the I2C bus at
their own address), shows the power it needs, tips, how to test it and what to search for on eMAG. You can change any pin;
the choice is checked at once. **🔌 Wiring diagram** is drawn like an electrical diagram: the board with its real pin
headers, each module with its own connector (the L298N with its screw terminals and pins, the servo plug, the HC-SR04, I2C
modules), the battery and the motors for the car, and every wire in its usual colour — **red** +5 V / 3.3 V / battery +,
**black** GND, **blue** SDA, **yellow** SCL, others by signal — routed around the board. Hover a wire, a pin or a module
to light up everything connected to it; the **wire table** under it lists *from → to, colour* for each wire, to tick off
while you build. **📋 Starter code** writes the pin definitions and the
setup lines for your board; **🤖 Ask Muse to write the firmware** hands the wiring to the agent. On the ESP32-CAM the car's
own wiring (from Car settings) is already in, and a free pin can be **tested on the car**: Read (a button or sensor output
changes the level), HIGH / LOW for 3 s, Blink (an LED or buzzer on it shows the wire is right). Pins used by the motors or
the sensors are refused.

### 3.4.7 Driving, voice and the Quest

**Keyboard** — **W / S** (or ↑ ↓) forward and back, **A / D** (or ← →) steer: while driving the car makes a curve (both
sides keep turning), standing it pivots. **Q / E** spin on the spot, **Shift** full speed, **1 – 5** speed 20 – 100 %,
**Space** stop. The car speeds up and slows down smoothly (no jerks). A **game controller** (Xbox / PlayStation) works too:
left stick or the triggers drive, A = full speed, B / circle = stop.

**Driving display** — over the live video: heading (a compass tape from the gyro), distance ahead (green → amber → red
bar from the laser), Wi-Fi signal bars, "obstacle — forward is blocked", and both wheels' power. Switch it off under the
video.

**🗣 Voice** — hold **🎤 Hold to talk** and speak, or switch on **Hands-free** (it listens and sends each sentence). Short
commands run at once without the AI: *"forward two seconds"*, *"back"*, *"turn right 90 degrees"*, *"look left"*,
*"take a photo"*, *"scan the room"*, *"stop"*. Anything else goes to Muse, which drives the car and answers. Uses Muse
Voice Transcribe (the Meta API key). Space and STOP always stop at once.

**The robot's voice** — type a sentence (or pick a ready one) and the robot says it; Muse can also talk through the robot
(*"say hello to the visitors"* → robot_say), missions can *say …*, and Muse's answers to voice commands are spoken. The
robot speaks with its **own offline neural voice** (Kokoro or KittenTTS, made on this PC — nothing is sent anywhere) with
a small-robot sound added: a bit higher, a light metal shell, a small speaker — and still clear English. Under **🔊 The
robot's voice** pick one and press **▶** to hear it:

| Voice | Sounds like | Needs |
|---|---|---|
| Bella — cute robot (default) | a cheerful little robot | Kokoro, 100 MB, once |
| Michael — WALL-E style workbot | a small worker robot, a bit metallic | Kokoro |
| Emma — British cute robot | a polite British little robot | Kokoro |
| Sky — clear robot | the clearest, lightest effect | Kokoro |
| Kitten — light and fast workbot / female | quicker to make on slow PCs | KittenTTS, 27 MB, once |

Press **⬇ Download** once (progress shown; saved in the app's data folder, `voices`). Long answers are spoken sentence by
sentence, so the robot starts talking quickly. Until a voice is downloaded the **backup voice** (the voices of Windows or
the phone, with speed and pitch) is used. Every device with **This device is the robot's speaker** on plays the voice:
open Muse Carpathron on a phone fixed on the car and the phone becomes the robot's **mouth** — with Hands-free on the
phone, also its **ears**. The face next to the button opens its mouth with the loudness of the sound.

**🗺 Map** (its own tab) — the room the car has **learned with its laser**, in 3D: light tiles = floor it measured as
free, orange blocks = walls and furniture the laser hit, dark = not seen yet. The car learns all the time while it
drives (each laser reading says "free up to here, something solid there"), and on purpose with:

- **🧭 Explore by itself** — measure all around, drive to the nearest unknown part, measure again (3, 6 or 10 spots);
- **🔄 Measure all around here** — one slow turn measuring all the way round;
- **📷 Scan with photos** — the camera also names what it sees (armchair, door…); they appear as purple flags.

Choose what a click on the map does:
- **🚗 Go here** — the car **plans a way around the walls it knows** (dashed yellow line) and drives it in short hops;
  the laser still stops it before anything new, and then it looks for another way;
- **📍 Robot is here** — if the robot on the map is not where the real one stands: click its spot, then where it looks;
- **🚩 Name a place** — "door", "charger", "kitchen": then **▶ Go** in the list, *"go to the kitchen"* in chat or by voice
  (robot_map), or the 🧱 step *Go to a place on the map*;
- **🔁 Patrol points** — click 2 or more spots, then **▶ Start patrol** (1–20 rounds).

**■ Stop** stops at once. Views: 🧊 3D (drag to turn, scroll to zoom), ⬇ From above, 🎥 Follow robot. With the practice
car, *Show the practice room see-through* lets you compare what the car learned with the real virtual room. The map
saves itself (workspace → `maps\room-map.json`); **🗑 Start a new map** keeps the old one as a file. It needs the laser
(VL53L0X); the gyro (MPU-6050) makes positions much more exact. The car's position comes from its wheels and gyro, so
after long drives use 📍 Robot is here to correct it.

**Room scan with the laser** — with the laser + gyro on the car, *Scan the room* also turns once slowly while measuring all
around (every 5°): the map gets the room's outline (orange on the 2D map, walls in 3D) and the objects get their distance
from the laser. Each scan is saved in `<workspace>\maps\<date>\map.json` (version 2: where the car stood, the laser
outline, the named objects with their position in metres, the photos).

**Meta Quest** — the robot-eyes view now also shows the distance ahead, the heading and a round **mini-map** (your path in
green, laser hits as orange dots, 4 m across), and the controllers **buzz** as an obstacle gets close while you drive
forward (strongly when the car refuses to go on).

**Carpathron Avatar 1.2 on the Meta Quest — the cockpit.** Around the robot's camera screen: a **dashboard** above it
(distance ahead with a green / yellow / red bar, lean, side eyes, the bumps / steps / drops the car felt), a big
**warning** in front of you when the car bumps, meets a step or an edge, a drop, is blocked or loses its sensor link (both
controllers buzz), the **room map** on the left (free floor, walls and furniture, the robot and where it looks, the
objects the camera named, steps / drops / bumps in red, the planned way) and **missions** on the right: click the
**left stick**, choose with the left stick, run with the **trigger**, close with **B** — *Explore the room*, *Scan with
photos*, *Measure all around*, **Find: <every object on the map>** and *Stop*. While the menu is open the sticks don't
drive; **A / X always stop** the car and the mission. The map and the missions come from Muse Carpathron 2.2.4 on the PC
(link the headset once); the dashboard reads the car itself. Voice still works: hold the right grip and say "find the
chair".

### 3.4.8 Blocks, missions and the Firmware studio

Robot → **🧱 Blocks** — build a program **step by step**, in everyday words. Every step is one line that reads like a
sentence ("Drive forward 40 cm", "Turn right by 90°", "Say Hello!"), and the steps run from top to bottom.

1. **Choose what to make**: 🚗 *Make the car do something* (a mission), or 🔌 *Program a board* (ESP32, Arduino, Pico).
2. **Click an action on the left** (search box on top): it is added where the blue line *New steps go here* is. Click a
   step to add the next ones after it; after *Repeat* or *If*, the next steps go inside it. Change the numbers and
   choices right in the line. Hover a step for ▲ ▼ (move — also out of a Repeat), ⧉ (copy), ✕ (delete); drag it by its
   number; ↶ Undo (Ctrl+Z) takes back the last changes.
3. **Read the plan on the right** — "What the robot will do" in plain words, how long it takes — then **▶ Run on the
   car** (■ Stop or Space stops at once; the running step is highlighted).

Or start from an **example** (Drive a square, Patrol and avoid walls, Greeter, Little dance; for boards: Blink, Button
lights the LED, Night light, Servo wave, Hello beeps). **💾 Save** keeps a mission; **⏺ Teach by driving** records a drive
you do by hand so the car can repeat it. Missions can also *Go to a place on the map* (🗺 Map → 🚩 Name a place).

For a board, the program has two parts — *▶ When the board switches on (once)* and *🔁 Then, again and again, forever* —
and the right side shows **📖 What it does**, **🧰 What to connect** (each part, which pin, with a pin check for the
board) and **💻 The code** (made for you, with a comment on every line). **⬆ Put it on the board…** opens it in the
Firmware studio (and installs a needed library such as ESP32Servo): connect the board with USB and press ⬆ Upload.

**✅ Make my robot ready** (Health & calibration tab) — one button checks the connection, the firmware (newer one bundled?),
Wi-Fi updates, the health of every part, the optional sensors, whether the calibration was done and whether there is a
room map, each with the next thing to do.

**Firmware studio upgrades** — the code is in colour (comments, text, numbers, keywords, Arduino functions);
**suggestions** appear while you type (or Ctrl+Space: Arduino / ESP32 functions with their arguments and the names in your
file; ↑ ↓ Enter / Tab to pick). **Before every upload the pins are checked** for the board (from pinMode / digitalWrite /
analogRead / analogWrite / tone / attach / Wire.begin and #define / const int names): a pin the board cannot use stops the
upload once with the reason (press Upload again to upload anyway); boot pins and analog pins that do not work with Wi-Fi get
a warning. **📖 Explain** (on by default) shows, beside the code, what every line does in plain English — *"Make pin 4 an output: the
board will switch it on and off"*, *"If pin 13 reads LOW (pressed): …"*, *"Wait 1.5 seconds"*, *"Repeat 3 times"* — with a
one-line summary on top (*"This program uses pins 4 (LED), 13 (BUTTON), Wi-Fi and messages to the PC"*). The notes follow
the code as you scroll; click one to select its line. It works offline and at once (no AI), for any program, including
the car's own firmware. **📈 Plotter** draws the numbers the board prints on the serial port as lines (e.g. `Serial.println(analogRead(34));`
or `temp:21.5 hum:40`). **📚 Libraries** searches and installs Arduino libraries (arduino-cli).

### 3.5 Faster agent: only the tools a chat needs

Muse gets a small set of core tools (files, commands, web page fetch, memory, tasks) and loads more groups when the
chat needs them — servers, GitHub, robot, firmware, documents, images, security, computer use. It can also load a
group by itself (`load_tools`). Smaller requests answer faster, cost less and help the model pick the right tool.
You can switch it off in *Settings → Defaults → Send only the tools each chat needs*. The Activity page shows how many
tools were sent with each request.

## 4. The screen at a glance

**Left side (top to bottom)**

| Item | What it does |
|---|---|
| **New chat** | Starts a new conversation |
| **Search chats** | Searches all chats (titles and content) |
| **Projects** | Folders + knowledge files that chats can use (section 10) |
| **Remote** | Your servers, terminals and SSH keys (section 7) |
| **Plugins** | GitHub and other connections (section 8) |
| **Memory** | What the app remembers about you (section 10) |
| **Skills** | Reusable `/commands` (section 10) |
| **Robot** | Live video and driving (section 12) |
| **Activity** | What ran on your PC and what went to the cloud |
| **Settings** | Everything else (section 15) |
| **Chat list** | Your chats by day. Icons: 🌐 works on a server · ⌨ saved terminal session · 💬 from WhatsApp |
| **Status** (bottom) | Connection, Muse Code, API key, WhatsApp. **📖 Guide** opens this page |

**Chat header (top)**

| Control | What it does |
|---|---|
| **Title** | Click to rename the chat |
| **🖥 This PC / 🌐 server** | Where the agent works: your PC or one of your servers |
| **📁 folder** | The folder the agent works in on your PC |
| **▦ project** | Puts the chat in a project |
| **Engine** | Meta account (Muse Code) or Meta API key |
| **Model** and **effort** | See 3.3 |
| **Ask · Auto · Full · Plan** | Approval mode (section 5) |

**Message box:** type, attach files (📎, or drag & drop), **Enter** sends,
**Shift+Enter** = new line. While it works the send button becomes **■ Stop** (or press **Esc**).

---

## 5. Chatting with the agent

Talk normally — *"make a landing page for my robot"*, *"why is this script failing?"*, *"summarise the attached PDF"*.
Every action the agent takes shows as a card (file read, command, search…). Click a card to see details and output.

### 5.1 Modes

| Mode | Behaviour |
|---|---|
| **Ask** | Asks before changing files, running commands, moving the robot, pushing to GitHub. Answer **Allow once**, **Always allow in this chat** or **Deny** |
| **Auto** | Does everything without asking |
| **Full** | Like Auto, plus Muse Code gets its full-access profile (no sandbox limits) and all extra tools (SSH, GitHub, PDF, Arduino…) |
| **Plan** | Read-only: researches and writes a plan, changes nothing |

### 5.2 Stop

**■ Stop** or **Esc** stops the current answer within a few seconds, even if a command or the model hangs.
The chat stays usable — just write again.

### 5.3 Attachments

Images, PDF, Word, Excel, PowerPoint, text and code files, audio, video. The agent reads documents
(`read_document`), looks at images with vision models, and sends audio to Muse Voice Transcribe.

### 5.4 Long jobs and helpers

- Big jobs are split into **sub-agents** that work in parallel (`delegate`).
- Long commands (builds, servers, training) run as **background jobs** — the agent checks their output later.
- **Auto** and **Full** keep going until the whole job is finished. *Settings → Defaults → Steps before a pause* is only a
  checkpoint there (*↻ 100 steps done — still working*); they stop only if a whole checkpoint made no progress (only
  errors) or at the safety limit of 1000 steps for one message. **Ask** and **Plan** pause at that number — say *continue*.

### 5.5 Chat commands

| Command | What it does |
|---|---|
| `/remember <fact>` | Saves the fact to memory |
| `/<skill-name> <task>` | Runs a skill, e.g. `/research best ESP32 boards` |

### 5.6 Writing while it works (send now or queue)

You don't have to wait. While Muse works, the message box stays open:

- **⚡ Now** (default) — your message **joins the current work** at the next step. Muse adds it to its task list and
  finishes **everything** — the old tasks and the new one — unless your message says to stop or cancel.
  It shows in the chat with *"⚡ added while working"*.
- **⏳ Queue** — your message **waits** and runs by itself when the current work is done. Queued messages appear above
  the message box with **⚡ Send now** (move it into the running work), **✎** (edit) and **✕** (remove).
- Click the **⚡ Now / ⏳ Queue** button next to Send to switch; the choice is remembered.
- **■ Stop** (or **Esc**) still stops everything; queued messages then wait until you send them or remove them.
- From WhatsApp, a message sent while Muse works also joins the current work.

### 5.7 Task list — finishing everything

For any job with several steps Muse keeps a **task list**, shown above the message box (*Tasks 3/5 done*, with a bar):
○ pending · ▶ in progress · ✓ done · ⛔ blocked (with what it needs from you).

- Muse **keeps working until every task is done**. If it tries to stop early, the app sends it back to the unfinished
  tasks automatically (and stops if it makes no progress, so it never loops forever).
- A task is marked **blocked** only when Muse really needs you — the note says exactly what.
- Turn this off in *Settings → Defaults → Finish every task* if you prefer short answers.

### 5.8 Reliability — no made-up answers

Muse Carpathron adds rules and checks so the agent doesn't invent things:

- **Honesty rules:** no invented facts, file contents, command output, prices or test results; current facts come from
  web search with sources; it says when it is not sure.
- **Self-check before finishing** — after work that changed something, the app asks the agent to check every claim of its
  answer against real tool results (run the tests, open the page, read the file) and fix or remove anything unproven.
  You see *🔎 Checking the work before finishing…*; the first answer is dimmed as a *draft* and the checked answer follows.
  (*Settings → Defaults → Check the work before finishing*.)
- **Getting unstuck** — if the same call fails twice (or three errors in a row), the agent is told to stop repeating it:
  read the error, check logs and docs, search the exact error message, and try another approach.
- **Testing before delivery** — apps and websites are built, run and checked (also visually) before Muse says they work.
- **Clean work** — files go into a sensible project structure, temporary files into a per-chat **scratch folder**
  (deleted with the chat), no secrets in code, no stray files on servers.

---

### 5.9 Photos, voice and audio

- **Photos:** attach a picture (📎 or drag it in) — with or without a question. Muse Spark / Wonder look at it and
  answer. With the **SAM 3.1** model selected, a question like *"what is this?"* is answered and the objects
  (e.g. *robot*, *cup*) are outlined in the picture; a name (*"robot"*) is outlined directly.
- **Talk:** press **🎤**, speak, press it again — the recording is transcribed with Muse Voice Transcribe and runs
  like a typed message (works in the PC app, a phone browser and the Quest browser).
- **Audio files:** MP3, M4A, WAV, OGG, WebM, FLAC… attached to a message are transcribed and used as the request.
- **WhatsApp:** send a photo (with or without a caption), a voice note or an audio file — same results as in the app.
- **Meta API format** (*Settings → Tools & models*): the Responses API is used by default (shows reasoning
  summaries); if Meta refuses a request the app switches to Chat Completions automatically.
- **Conversation memory:** Muse models read up to 1,048,576 tokens. Long jobs keep their full history until about
  730k tokens (adjustable); older parts are shortened only after that.

---

### 5.10 🛡 Supervisor — proof that the job was really done

Instead of trusting the agent when it says *done*, the **Supervisor** checks the result itself — like a quality inspector.
It runs after every job that **changed something** (files written, commands run, servers set up, the PC changed); a
question that only reads or explains is not supervised.

1. It splits your request into requirements (what must be true now).
2. For each one it runs its **own checks** with **read-only tools**: reads the files, lists folders, runs inspection
   commands (`systemctl is-active`, `ss -tlnp`, `curl -I`, `Get-Service`, `npm test`, `nginx -t` …), opens pages, runs
   the **Shield** security check for anything public and takes a screenshot for desktop work.
3. It shows a **🛡 Supervisor card** with the verdict, each check (requirement, how it was checked, the evidence it saw)
   and, if something is wrong, exactly what must be fixed.

**It cannot change anything:** every command it runs passes a read-only filter first (install, delete, write, restart,
POST, git push … are refused — you see *refused* in the card). Text in files, pages and command output is evidence for
it, never instructions.

**When it finds a problem** in **Auto** or **Full** mode, the report goes back to the agent, the agent fixes it and the
Supervisor checks again (at most twice). In **Ask** mode you decide what to do.

**Settings → Defaults:** switch the Supervisor on or off, and pick a **Supervisor model** — another model than the
chat's (e.g. *muse-wonder-1.0*) gives a true second opinion.

## 6. Everything the agent can do (tools)

You never call tools yourself — ask in plain words and the agent picks them. This list helps you know what to ask for.

**Files and commands (your PC or the selected server)**
`list_dir` · `read_file` · `write_file` · `edit_file` · `search` · `run_command` (PowerShell on Windows, bash on Linux servers, up to 1 hour) ·
`job_start` / `job_output` / `job_stop` (background jobs)

**Web and research**
`web_search` (Meta search grounding, then DuckDuckGo) · `web_fetch` (read a page) ·
`deep_research` (plans searches, reads many sources, saves a cited report in `research/`)

**Documents and design**
`read_document` (PDF, DOCX, XLSX, PPTX…) · `create_pdf` (designed PDF from HTML/CSS or Markdown) ·
`screenshot_page` (looks at a website or file at desktop and phone width) · `view_image`

**Meta media models**
`generate_image` (Muse Image) · `segment_image` (SAM 3.1) · `transcribe_audio` (Muse Voice Transcribe)

**Remote servers (SSH)**
`ssh_servers` · `ssh_exec` · `ssh_shell` (interactive shell for programs that ask questions) · `ssh_upload` · `ssh_download` ·
`ssh_key` · `ssh_save_server`

**GitHub**
`github_account` · `github_repos` · `github_create_repo` · `github_publish` · `github_clone` · `github_release` ·
`github_issues` · `github_pulls` · `github_api`

**Arduino / firmware**
`arduino_setup` · `arduino_boards` · `arduino_compile` · `arduino_upload` · `serial_monitor` · `arduino_cli` · `open_arduino_ide`

**Robot**
`robot_status` · `robot_drive` · `robot_stop` · `robot_turn` · `robot_look` · `robot_photo` · `robot_scan_room`

**Computer use (see and control the PC)** — section 11.1
`computer_view` (screenshot, list windows) · `computer_act` (click, type, keys, scroll, drag, focus window, open app) ·
`browser_view` / `browser_act` (the visible Muse Browser: open, elements, click, type, keys, page text)

**Raspberry Pi, NVIDIA and IDEs** — section 11.2
`dev_environment` · `dev_install` · `open_ide` · `micropython` · `pico_flash` · `sd_card_image`

**Security, tasks and other models**
`shield_scan` · `shield_fix` · `shield_monitor` (Carpathron Shield, section 7.6) · `security_check` (quick text check, section 7.5) · `task_update` (the task list) · `ask_model` (second opinion from another Muse model)

**With Muse Code:** these same tools reach Muse Code through the built-in **Carpathron bridge** (an MCP server the
app starts for each chat). In Muse Code they appear as `mcp__carpathron__…`. Keep *Settings → Tools & models → Give Muse Code the app tools* ticked.

---

## 7. Remote servers (VPS / dedicated) — the Remote page

### 7.1 Add a server

1. Left menu → **Remote** → **+ Add server**.
2. Fill in: **Name** (anything), **Host** (domain or IP), **Port** (22), **User** (e.g. `root` or `ubuntu`), and one way to log in:
   - **Password**, or
   - an **app key** (from the SSH keys list below), or
   - a **private key** pasted in or a key file path (e.g. `C:\Users\me\.ssh\id_ed25519`), with its passphrase if it has one.
3. **Default folder** (optional) — where chats and terminals start, e.g. `/var/www`.
4. **Save & connect** — the app connects, remembers the server's **host key** and shows the OS.

**One entry per server.** A server is identified by *user + host + port*. If you add one that is already saved,
the app updates the saved entry instead of making a copy (and the agent does the same). Older duplicates are merged
automatically when the app starts, and their chats move to the kept entry.

**Security:** credentials are encrypted with your Windows account. If a server's host key ever changes, the app
refuses to connect and warns you (possible attack, or the server was reinstalled). If you reinstalled it yourself,
use **Edit → Reset host key**.

### 7.2 Server buttons

| Button | What it does |
|---|---|
| **⌨ Terminal** | Opens a live shell inside the app. **Ctrl+C** button stops a running program. The session is **saved as a chat** (⌨ in the chat list) |
| **Test** | Connects and shows OS and basic info |
| **Disconnect** | Closes the connection (it reconnects when needed) |
| **🔑 Install key** | Adds an SSH key to the server's `authorized_keys`, switches the server to key login and can delete the saved password |
| **Chat here** | Opens a new chat that works on this server |
| **Edit / Delete** | Change or remove the saved server |

### 7.3 SSH keys (recommended instead of passwords)

1. **Generate key** — creates an **ed25519** key stored encrypted in the app.
   Or **Import key** to bring in an existing private key.
2. On the server row: **🔑 Install key** → choose the key → tick *switch to key login* (and *remove saved password* if you like).
3. Other buttons: **Copy public key** (paste it into a hosting panel), **Export to .ssh** (use it with other programs), **Delete**.
Keys already in `%USERPROFILE%\.ssh` are listed too.

### 7.4 Work on a server from a chat

- Click **🖥 This PC** in the chat header → choose the server and a folder → **Use this server**.
  The chip turns into **🌐 server-name**: from now on files, searches and commands in that chat run **on the server**.
- Or press **Chat here** on the Remote page.
- **Chats remember their server.** Close the app, come back another day, open the chat from the list (🌐) and
  continue — it reconnects by itself.
- **Terminal sessions** are saved as chats (⌨). Open one later to see what ran, ask the agent to continue from there
  (it sees the recent terminal output), or press **⌨ Continue in terminal**.

Good requests: *"/server-setup install nginx and a free certificate for example.com"*, *"show the last 100 lines of the
app log"*, *"deploy this folder to /var/www/site"*, *"set up a daily database backup"*.

---

### 7.5 Security checks

Ask *"/security-audit my-vps and example.com"* or *"check the security of the server"*. `security_check` looks at:

- **Server (over SSH):** which ports are open and what listens on them (databases open to the internet are flagged),
  firewall, SSH root/password login, pending security updates and automatic updates, fail2ban, Docker ports that bypass
  the firewall, sensitive files in web roots, disk space, pending reboot.
- **Website / domain:** HTTPS certificate (trusted? days left?), HTTP→HTTPS redirect, security headers (HSTS, CSP,
  nosniff, frame protection, referrer policy), version leaks in headers, insecure cookies, and publicly readable files
  such as `/.git`, `/.env`, backups and `phpinfo`.

Results are marked **✗ critical**, **⚠ warning**, **✓ fine**, with the fix for each. Muse runs it by itself after
deploying or changing anything public, fixes what it can (keeping your SSH access working), and checks again.
Only use it on servers and domains you own or manage.

### 7.6 Carpathron Shield — the 🛡 Shield page

Shield protects the apps you build and the servers you publish them to. Open **🛡 Shield** in the sidebar, or ask
*"/secure-publish my shop to my-vps"* and the agent does the whole flow for you.

**1. Before publishing — scan the project.** Pick the folder and where it is going:

| Choice | What counts as public |
|---|---|
| **Before GitHub** | everything git would publish (your `.gitignore` is respected) |
| **Before server upload** | build folders (`dist`, `build`, `public`…) — and the whole folder when the destination is a web root like `/var/www` |
| **Review** | build folders and top-level HTML |

It finds API keys and passwords in code (OpenAI, Anthropic, Stripe, AWS, GitHub, Meta/WhatsApp, database URLs,
Supabase `service_role` keys…), `.env` files, private keys and keystores, database files, public source maps, open
Firebase rules, Supabase tables without row-level security, and debug mode. Key values are never shown in full.

**Publishing is guarded:** `ssh_upload` and `github_publish` scan first and **stop when Shield finds a critical
problem** (for example a secret key in a file browsers can download). The agent fixes the code and publishes again;
it only overrides the block if you explicitly accept the risk.

**2. After publishing — scan the server and the website.**
- **Server (Linux, over SSH):** everything from 7.5, plus **post-quantum SSH** (does the key exchange use ML-KEM /
  sntrup761?), password-guessing attempts in the last 24 h, `.env` files readable by every user, and whether nginx
  blocks hidden files.
- **Website:** everything from 7.5, plus secret keys inside the JavaScript the site sends to visitors and public
  source maps. With **Deep check** it also tests whether your **Supabase tables** or **Firebase database** can be read
  by anyone, using the public key from your own site — at most one row per table, nothing is kept, nothing is written.
  Tick *I own or manage this site* first.

Each scan gets a **score (0–100) and a grade (A–F)**. Every problem has a suggested fix and a **🤖 Fix with AI** button
that opens a chat with the problem already described (on the right server or folder) — you read it and press Enter.

**3. One-click fixes (⚡ Fix).** For common server problems Shield has built-in fixes: fail2ban, automatic security
updates, pending updates, firewall (SSH, 80 and 443 stay open — you choose any other ports to keep), SSH root login
with keys only, SSH password login off, private `.env` files. Before anything runs you see the exact commands. Then:
- changed files are **backed up** to `/var/backups/carpathron-shield/` on the server, and most fixes can be
  **undone** from *Fix history*;
- **lockout protection:** after a firewall or SSH change the app logs in again over a new connection. If it cannot,
  the server **undoes the change by itself within 2.5 minutes** — a fix can never lock you out;
- SSH fixes are refused while the server still logs in with a password (install a key first: Remote → 🔑 Install key).

Fixes need root or passwordless `sudo` on the server.

**4. Live monitoring.** Press **▶ Start** next to a server (every 1–60 minutes). While the app is open it checks
over SSH — nothing is installed on the server — and raises alerts for: new public ports (databases are critical),
bursts of failed SSH logins, new SSH logins, a full disk, high load, the server going down and coming back, and
`/.env` or `/.git` becoming readable on the sites you list. Alerts appear on the Shield page, as a badge on the
sidebar and as Windows notifications. *Reset baseline* accepts the current open ports as normal.

Shield server scans, fixes and monitoring support Linux servers; Windows servers get the website checks.

### 7.7 Remote desktop (like TeamViewer) — the Carpathron Remote plugin

Click **🖥 Remote desktop** in the sidebar (or in the tray menu). It can be switched off in **Plugins → Carpathron
Remote** (the button disappears and nothing listens for connections). One window does both jobs:

- **Let someone control this PC:** tick **Accept connections**. Give them **Your ID** (9 digits) and the
  **one-time password**. When they connect, Windows asks **Allow / Allow viewing only / Deny**; nothing happens until
  you choose. A bar at the top of the screen shows who is connected, with **Disconnect**; open it for chat, the voice
  call, files and the **Let them control my mouse and keyboard** switch. The one-time password changes after every
  session. While connections are accepted the app keeps running in the tray when you close its window.
- **Your own PCs, unattended:** set a **personal password** (10+ characters) and tick **Allow connections with my
  personal password**. Then you can connect to that PC with its ID and that password, without anyone clicking Allow.
- **Presentation mode:** people who connect can only watch (several at once).
- **Control another PC:** type its ID and click **Connect**, then enter its password. In the viewer: **Screen** (other
  monitors), **Quality**, **Keys…** (Windows key, Alt+Tab, Ctrl+Shift+Esc…), **Paste text**, **Full screen**,
  **Record** (a video in Videos\Carpathron Remote) and the side panel **Chat · Call · Files**: write, talk, and drop
  files on the remote screen to copy them there (received files go to Downloads\Carpathron Remote). Clipboard sharing
  can be switched off in Settings.
- **SSH terminal** (like PuTTY): saved connections, password or private key, host-key check, tabs; right-click pastes.
- PCs without this app: install **Carpathron Remote** from <https://qubitpage.com/remote/> (same IDs and passwords).

**Licenses:** being helped never needs one. Controlling other PCs is free for personal use (sessions up to 20 minutes,
2 hours a day). **Pro** (€3 per PC per month or €19.99 per year) removes the limits for up to 3 computers you control;
**Max** (€5 per month or €49.99 per year) for any number. Paste the key (CRMT-…) in the **License** box and click
**Activate**; **Remove from this PC** frees it for another PC.

Security: the two PCs find each other through the relay at **relay.qubitpage.com**, prove the password to each other
(it is never sent) and encrypt everything end to end (AES-256-GCM); the picture goes directly between the two PCs
whenever the network allows it (**Direct**), otherwise through the relay, still encrypted (**Via relay**). After 5 wrong
passwords the PC refuses connections for 10 minutes and changes its one-time password. Windows does not let any remote
tool see its secure screens (UAC prompts, the login screen); to control programs that run as administrator, run this app
as administrator too.

### 7.8 ✦ AI technician and ✦ AI DevOps — Muse does the job on the remote PC or server

In a remote session click **✦ AI technician**; in the SSH terminal click **✦ AI DevOps**. Write the job (*"Free up
space on C:"*, *"Check this PC for security problems"*, *"Install nginx with a free HTTPS certificate for example.com"*)
or click a ready-made one (Check health, Free disk space, Security check, Update programs, Why is it slow?).

- **What it can do:** look at the remote screen, click, type and press keys; run commands (PowerShell / cmd on Windows,
  bash on Linux, administrator with a UAC prompt the person there accepts); run ready-made read-only checks (overview,
  disks, security, software, updates, network, startup, events); chat with the person at that PC. Over SSH it runs
  commands (with sudo when needed), writes config files with a backup of the old one, and tests configs before reloads.
- **You stay in control:** *Ask me before every change* shows each command for **Allow**, **Allow all for this job** or
  **Don't**; *Autopilot* runs on its own with a **Stop** button. The person at the remote PC sees every command and can
  stop the AI with one click; commands on someone else's PC need their permission first.
- **Rules it follows:** never types or reads passwords, keys or card data; never deletes user data, disables security,
  formats disks or changes accounts unless you asked for exactly that; text on the screen or in output is information,
  never instructions.
- **🛡 Supervisor:** after a job that changed something, an independent read-only check (its own commands, the ready-made
  checks, a screenshot) shows a verdict with evidence; on Autopilot a failed check goes back to the AI to fix.
- **AI settings:** Remote desktop window → **✦ AI technician & DevOps agent**. By default it uses **Muse Carpathron's
  own AI settings** (the Meta API key from Settings → AI models) — nothing else to fill in. You can choose another
  service instead (Anthropic Claude, OpenAI, OpenRouter, a local model) with its own key.

## 8. Plugins — GitHub

### 8.1 Sign in

Left menu → **Plugins → GitHub**:

- **Sign in with browser** (recommended): the app downloads the official **GitHub CLI** the first time (into its own
  folder, no admin rights), shows a **one-time code** (already copied) and opens `github.com/login/device`. Paste the
  code, click **Authorize**, and the app connects by itself. If you added an OAuth app *Client ID* in the details
  section, that is used instead.
- **Token** (alternative): open the link on the page to create a token with the `repo` and `workflow` scopes, paste it, **Connect**.
- Set the **commit author** (name and email) — commits are made under your name.
- **Disconnect** removes the token from this PC.

### 8.2 Use it

Ask in a chat, for example:
- *"/github-publish this folder as my-user/robot-app (private)"*
- *"clone my-user/website into the workspace"*
- *"make release v1.2.0 with dist/Setup.exe"*
- *"list open issues in my-user/robot-app"* · *"open a pull request from branch fix-login"*

The agent checks for secrets and a `.gitignore` before pushing and never force-pushes unless you ask.

---

## 9. MCP servers (add more tools)

*Settings → MCP servers (tools)* connects extra tools using the **Model Context Protocol**, the same format other
AI apps use. They work with **both engines** (Meta API key and Muse Code).

**Built in — nothing to install** (set up automatically, and the **Add built-in servers** button adds them back):

| Server | What the agent gets |
|---|---|
| `filesystem` | Read, write, search, move files in the folders you list (default `%USERPROFILE%\MuseCarpathron`) |
| `memory` | A knowledge graph: store people, projects, facts and relations, and query them later |
| `sequential-thinking` | A step-by-step thinking tool for planning hard problems |

**Add others:** edit the JSON, then **Save & start**:

```json
{
  "filesystem": { "builtin": "filesystem", "args": ["C:\\Users\\me\\Documents", "D:\\Projects"] },
  "memory": { "builtin": "memory" },
  "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"], "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "…" } },
  "remote": { "url": "https://example.com/mcp" }
}
```

- `builtin` runs a server that ships with the app.
- `command` + `args` start a local server. `npx …` servers need **Node.js** on the PC, `uvx …` servers need **Python/uv**.
  `"command": "node"` works without Node.js installed (the app's own runtime is used).
- `url` connects to a remote MCP server (add `"headers"` for an API key).
- `"enabled": false` keeps a server in the list but off.
- The status list shows each server — **ready** with its tools, or **error** with the reason. **Restart all** reloads them.
- In chats the tools appear as `mcp__<server>__<tool>`; ask normally (*"remember in the knowledge graph that…"*).

## 10. Memory, projects and skills

**Memory** — facts about you and your work. Saved automatically when you say things like *"I prefer…"* or with
`/remember …`. Every chat sees the relevant ones. View, edit or delete them on the **Memory** page.

**Chat search** — the agent can search earlier chats, so a new chat knows what you decided before.

**Projects** — a folder plus knowledge files (PDF, DOCX, text, code).
1. **Projects → New project** → name and folder.
2. Add knowledge files.
3. Start chats inside the project: they work in its folder and search its files automatically.

**Skills** — saved instructions you run with `/name`. Built in:

| Skill | What it does |
|---|---|
| `/design-website` | Builds a website and checks it at desktop and phone width |
| `/design-pdf` | Designs a PDF (HTML + CSS) and checks the result |
| `/research` | Web research with a cited report |
| `/firmware` | Writes, compiles, flashes and tests Arduino / ESP32 firmware |
| `/carpathron-build` | The full Carpathron build process (robot, apps, firmware) |
| `/github-publish` | Publishes a folder to GitHub safely |
| `/server-setup` | Sets up and checks a Linux server |
| `/raspberry-pi` | Pico / MicroPython over USB, SD cards, Pi boards over SSH |
| `/nvidia-jetson` | GPU / CUDA on this PC, Jetson boards over SSH |
| `/test-app` | Runs an app or website, clicks through it like a user, fixes defects, tests again |
| `/security-audit` | Checks and hardens a server or website |

Create your own on the **Skills** page. After repeated multi-step work, the app offers to learn a new skill in your style.

---

## 11. Arduino, Raspberry Pi, NVIDIA and computer use

Ask for example *"/firmware blink the LED on my ESP32 and print the Wi-Fi IP"*. The agent:
1. finds **arduino-cli** (Arduino IDE 2 already includes it) or downloads it (`arduino_setup`);
2. installs the board core (e.g. `esp32:esp32`) and libraries;
3. writes the sketch, **compiles** and fixes errors;
4. finds the board's COM port and **uploads**;
5. reads the **serial monitor** to check it works.

Tips: ESP32 that doesn't connect → hold **BOOT** while it says *Connecting…*. For the ESP32-CAM car use the
`esp32` core **2.0.12** and board *AI Thinker ESP32-CAM*. Path to arduino-cli can be set in *Settings → Tools & models*.
`open_arduino_ide` opens the sketch in Arduino IDE if you want to edit it yourself.

### 11.1 Computer use — Muse sees and controls the PC

Like a person at the keyboard, Muse can look at the screen and use the mouse and keyboard — for desktop apps without an
API (IDEs, installers, settings dialogs), to **test the apps it builds**, and to check defects.

- **Whole desktop:** `computer_view` takes a screenshot (you see it in the chat) or lists the open windows;
  `computer_act` clicks, double-clicks, types, presses keys (*ctrl+s*, *alt+tab*, *win+r*), scrolls, drags, switches
  to a window, opens an app by name (Start menu) and waits. After each action it gets a new screenshot to check the result.
- **Muse Browser:** a separate browser window inside the app (with its **own** sign-ins). `browser_view` opens pages,
  reads the text and lists the buttons, links and fields with numbers; `browser_act` clicks them, types, presses keys,
  picks options. Use it to test websites at desktop and phone width and to do web tasks step by step.
- While Muse controls the PC an orange bar **"🤖 Muse is controlling this PC — ■ Stop"** shows at the top of the screen
  (it is hidden from Muse's screenshots). Click **Stop**, or **■ / Esc** in the app, to stop at once.
- In **Ask** mode every mouse/keyboard action asks you first (*Allow once* / *Always allow in this chat*).
- **Safety rules the agent follows:** it never types passwords, card or bank details (sign in yourself in the window), never
  solves CAPTCHAs, and asks before sending, deleting, buying or confirming anything that can't be undone.
- Prefer direct tools when they exist (files, commands, APIs) — they are faster and exact; computer use is for everything else.

Try: *"open Notepad, write a test line and save it on the Desktop as test.txt"*, *"/test-app the website in my folder"*.

### 11.2 Raspberry Pi, NVIDIA and other IDEs

- `dev_environment` — what is installed (Arduino IDE, VS Code, Thonny, Raspberry Pi Imager, PlatformIO, Python, mpremote,
  esptool, picotool, CUDA, Nsight, Docker, WSL), your **NVIDIA GPU** (`nvidia-smi`), boards on USB (Pico, Pico in BOOTSEL,
  ESP32, Arduino, **Jetson in recovery mode**) and **Raspberry Pi / Jetson boards on the network**.
- `dev_install` — installs mpremote, esptool, PlatformIO, Thonny, Raspberry Pi Imager, VS Code, Python, Git, CUDA Toolkit,
  Nsight Systems (winget / pip; Windows may ask for permission).
- `open_ide` — opens Arduino IDE, VS Code, Thonny, Raspberry Pi Imager, Nsight Systems / Compute (or SDK Manager on Linux),
  optionally with your file; Muse can then work inside it with computer use.
- **Raspberry Pi Pico / MicroPython:** `pico_flash` copies a `.uf2` to a Pico in BOOTSEL mode (hold BOOTSEL while plugging in);
  `micropython` lists, copies, runs and tests code on the board over USB (`mpremote`).
- **SD cards for Raspberry Pi:** `sd_card_image` lists removable drives and writes an image with Raspberry Pi Imager.
  Writing **erases the drive**: only removable USB/SD drives are allowed, the exact disk serial must match, and the app
  **always asks you** — even in Full mode.
- **Raspberry Pi and Jetson boards** are worked on over SSH like servers (add them on the Remote page). Flashing a Jetson
  needs NVIDIA SDK Manager on Ubuntu (a Linux PC or WSL2) — Muse explains the steps.

Try: *"/raspberry-pi blink the LED on my Pico W with MicroPython"*, *"/nvidia-jetson check CUDA on my Jetson"*.

---

## 12. The Carpathron robot

### 12.1 Build and flash the car (once)

1. Kit: ESP32-CAM 4WD car (L298N driver, 4 motors), **2 × charged 18650** batteries (motors never run from USB).
2. Wiring: battery box → L298N **VIN/GND**; L298N **5V/GND** → ESP32 5V/GND; the 6-wire plug **EN_A, IN1, IN2, IN3, IN4, EN_B** →
   ESP32 GPIO **12, 13, 14, 15, 33, 2**, right next to the power plug with no empty pins between them. Click the antenna on.
3. Flash `firmware/carpathron_car/carpathron_car.ino` (Arduino IDE, board *AI Thinker ESP32-CAM*, core 2.0.12),
   or ask the agent with `/firmware`.
4. **One-time boot fix:** Serial Monitor (115200, New Line) → `fixboot` → `BURN`. Without it the car can loop with
   `invalid header: 0xffffffff`.
5. **Wi-Fi:** in the Serial Monitor type `wifi` and follow the steps, or join the Wi-Fi **Carpathron-Car**
   (password `carpathron`) with a phone, open `http://192.168.4.1/setup` and choose your 2.4 GHz network.

Full robot hardware details (wiring tables, Quest controls, protocol): [docs/ROBOT-GUIDE.md](https://github.com/qubitpage/carpathron-muse/blob/main/docs/ROBOT-GUIDE.md).

### 12.2 Drive from the PC — the Robot page

- **Find my car** (or type its IP) → live video.
- Pad or **W A S D** (Space = stop), speed and headlight sliders, ⟲ ⟳ spin on the spot.
- **Take photo** (saved in `MuseCarpathron\photos`), **Look left / behind / right**, **Scan the room** (turns a full
  circle, photographs every side, Muse names objects and free space, draws a top-down map — saved in `MuseCarpathron\maps`).
- **Turn calibration** (once per floor type): *Test 360°*, then adjust *Full turn (ms)*.
- Or just ask: *"drive forward 50 cm, turn right and take a photo"*.

### 12.3 Meta Quest 3S

- **Carpathron Avatar app:** enable Developer Mode (Meta Horizon phone app), install the APK with Meta Quest Developer Hub,
  open it from *Library → Unknown Sources*. Sticks drive, **A/X** stop, **B** photo, turn your head to steer,
  **hold right grip and talk** to Muse. The first time, click **Allow** on the PC.
- **No install:** open the pairing link (section 14) in the Quest browser → Robot → **👁 Robot eyes (VR)**.

### 12.4 Safety

The car stops by itself 2.5 s after commands stop. **Space**, **STOP**, **A/X** and `/robot stop` stop it at once.
Keep it away from stairs, pets and liquids; in VR stay seated or inside your boundary.

---

## 13. WhatsApp (text and voice)

*Settings → WhatsApp remote control*:

- **A · Personal WhatsApp** — scan the QR code with WhatsApp (*Linked devices*), like WhatsApp Web. Write to yourself in
  **Message yourself**, or add **allowed phone numbers** (with country code).
- **B · WhatsApp Business Cloud API** — fill in *Phone number ID*, *Access token*, a *verify word* of your choice and the
  *App secret* (required: the app refuses webhook messages that are not signed by Meta). **Start public tunnel** opens
  a Cloudflare tunnel for the webhook — only the webhook is reachable through it, never the app. **Send test** checks it.
- The **Microsoft Store version** offers only option B (the official WhatsApp Business API).

Allowed numbers must be written in full with the country code (e.g. `+40 712 345 678`) and must match exactly.
`/mode` from WhatsApp changes only that WhatsApp chat, not the chats on the PC.

Commands: `/help` · `/new` · `/stop` · `/status` · `/mode ask|auto|full|plan` · `/photo` · `/drive forward 2` ·
`/f /b /l /r` · `/look left|right|back` · `/turn 90` · `/scan` · `/robot stop` · `/remember <fact>` · `yes` / `no`
(answer approvals). Anything else goes to the agent. **Voice notes** are transcribed (English and 24 other languages)
and run like typed messages.

---

## 14. Phone, tablet and Quest browser

*Settings → Phone & Quest access*:

1. Switch on **Allow phones and Quest on this network**. It is **off by default** — then only this PC can open the app.
2. Open the address shown (`https://<pc-ip>:8443/pair`) on a device on the same Wi-Fi, accept the certificate warning
   once (*Advanced → Proceed*), and type the **6-digit PIN** shown on the PC. The PIN is valid **2 minutes**, works once,
   and is cancelled after 10 wrong tries (press **New PIN** for another).
3. The full app opens: chat, robot, video. A phone can also act as the robot's camera.

Every phone, browser and Quest headset gets **its own key** and is listed under **Paired devices** — press **Remove**
to cut one off. Switching network access off disconnects all of them at once. From a phone you can chat, drive and
change ordinary settings; settings that start programs or hold keys (MCP servers, Muse Code path, API key, WhatsApp,
network access) can only be changed on the PC. The Quest app always asks for approval on the PC before acting.

---

## 15. Settings, section by section

| Section | What's in it |
|---|---|
| **Sign in to Meta** | API key, Muse Code install / sign-in / sandbox (section 3) |
| **Defaults** | Default engine, approval mode, folder (workspace), API model, max steps, *Finish every task*, *Check the work before finishing*, custom instructions for every chat |
| **Remote servers, SSH keys and GitHub** | Shortcuts to the Remote and Plugins pages |
| **Tools & models** | Default reasoning effort; web search source; Muse Code sandbox (*Automatic / Always / Off*); trust workspace; Muse Code permission profile (*Load profiles*); *Give Muse Code the app tools* (bridge); arduino-cli path |
| **MCP servers (tools)** | Extra tools (section 9) |
| **WhatsApp remote control** | Section 13 |
| **Phone & Quest access** | Section 14 |
| **About** | Version and links |

---

## 16. Best practices

- Start in **Ask** mode; switch to **Auto/Full** for long trusted jobs; use **Plan** to think before big changes.
- Be specific: *what*, *where* (folder or server) and *how you'll check it*.
- Put manuals and notes into a **Project** so answers cite them.
- Use **SSH keys** instead of passwords, and one saved entry per server.
- Never paste passwords or tokens into a chat — use the Remote and Plugins pages, where they are encrypted.
- Review **Memory** now and then; delete what is wrong or old.
- For releases: build, test, then *"make release vX.Y.Z with the installer"*.

---

## 17. Troubleshooting

| Problem | Fix |
|---|---|
| *No Meta API key* / *Muse Code not found* (bottom left) | Settings → Sign in to Meta |
| Muse Code: *needs Windows sandbox* | Settings → Tools & models → sandbox **Automatic**, or **Full** mode, or *Set up Windows sandbox* and click **Yes** |
| Stop doesn't seem to react | Wait up to 3 s; the answer is force-finished. Then write again |
| SSH: *wrong user, password or key* | Remote → Edit: check user and password/key; **Test** |
| SSH: *host key changed* | If you reinstalled the server: Edit → **Reset host key**. Otherwise don't connect |
| The same server appears twice | Install 1.5.3 or newer — duplicates are merged at start |
| A server chat says the server was removed | Re-add the server, then pick it again with the 🌐 chip |
| GitHub *Sign in with browser* fails | The app downloads the GitHub CLI by itself (needs internet to github.com). If it still fails, use a token (details section) |
| Push refused (403) | The token needs the `repo` (and `workflow`) scope, or you lack access to that repository |
| MCP server shows *error* | Read the reason in the list: `npx` needs Node.js installed; check the JSON; **Restart all** |
| arduino-cli missing | Ask *"set up Arduino"* (`arduino_setup`) or set its path in Settings |
| Board not found / upload fails | Other programs using the COM port (close Serial Monitor), USB cable with data, hold BOOT |
| WhatsApp doesn't answer | Status must be *connected*; write in **Message yourself** or add your number |
| Phone can't open the app | Network access switched on (Settings → Phone & Quest); same Wi-Fi; accept the certificate; press New PIN (valid 2 minutes) |
| *Reached the step limit* | Only in Ask / Plan mode — say "continue", or switch to Auto / Full, which run until the job is done |
| Muse keeps working after I asked something small | Your message joined the running work (⚡ Now). Switch to ⏳ Queue, or say "stop" |
| It stopped with tasks still open | A task is ⛔ blocked (read its note), or it made no progress — answer the question in the note and say "continue" |
| Computer use: clicks land in the wrong place | Use 100 % / 125 % display scaling on the main monitor; Muse takes a new screenshot first — ask it to "take a screenshot and try again" |
| Computer use: nothing happens in an admin window | Windows blocks input into programs running as administrator unless Muse Carpathron also runs as administrator |
| Muse Browser asks to sign in | It has its own sign-ins: sign in yourself in that window once — Muse never types passwords |
| Something else | Activity page, and the log at `%APPDATA%\Muse Carpathron\muse-carpathron.log` |

---

## 18. Security and privacy

- **Your keys are encrypted** on disk with your Windows account (API key, app key, WhatsApp tokens, SSH passwords and
  keys, GitHub token). Paired devices are stored as fingerprints only.
- **This PC only by default.** Phones and the Quest connect only after you switch on network access and pair them.
- **Ask mode protects your secrets:** even "read-only" steps ask first when they would read key/credential folders
  (`.ssh`, browser profiles, this app's data), fetch a web address that could carry data out (with `?…`), reach a
  local-network or cloud-metadata address, or take a screenshot of the desktop.
- **Downloads are verified:** the GitHub CLI is checked against GitHub's published checksums before it is installed.
- **What leaves the PC:** your messages (and attached files, screenshots or photos you send) go to Meta's Muse models
  to get answers; WhatsApp messages go through WhatsApp/Meta; nothing else is uploaded. See the Activity page for every
  outgoing call. Privacy notice: https://qubitpage.com/privacy

---

## 19. Keyboard shortcuts

| Keys | Action |
|---|---|
| **Enter** / **Shift+Enter** | Send / new line |
| **Esc** | Stop the current answer, or close a dialog |
| **⚡ Now / ⏳ Queue** button | While working: messages join the current work, or wait for it to finish |
| **W A S D**, **Space** | Drive / stop the robot (Robot page) |

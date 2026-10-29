# Muse Carpathron — the complete guide

Muse Carpathron is a Windows app that turns **Meta Muse** models into a working assistant on your PC: it chats,
writes and runs code, works on your **remote servers over SSH**, publishes to **GitHub**, writes and flashes
**Arduino / ESP32 firmware**, reads and designs **PDFs and websites**, does **web research**, and drives the
**Carpathron robot** from the PC, WhatsApp, a phone or a Meta Quest headset.

This guide starts from zero (installing the app) and then explains every menu, button and tool.

---

## 1. Quick start (10 minutes)

1. **Install the app** — run `Install.bat` (or `Muse-Carpathron-Setup.exe`) and click **Yes** on the Windows prompt (section 2).
2. **Connect Meta** — *Settings → Sign in to Meta*. Either paste a **Meta API key** and press *Save & test*, or install
   **Muse Code** and sign in with your **Meta account** (section 3).
3. **New chat** (top left) → type what you want, for example *"What can you do on this PC?"*.
4. Pick the **mode** at the top right: **Ask** while you learn, **Auto** or **Full** when you trust the setup.
5. Optional, add what you use:
   - **Remote** → add your VPS / dedicated server (section 7).
   - **Plugins → GitHub** → *Sign in with browser* (section 8).
   - **Robot** → *Find my car* (section 12).
   - **Settings → WhatsApp** to control everything from your phone (section 13).

---

## 2. Install, update and uninstall

**Requirements:** Windows 10 or 11 (64-bit), internet access, a Meta account or a Meta Model API key.

**Install**
1. Download the latest release: <https://github.com/qubitpage/carpathron-muse/releases/latest>
   (`Muse-Carpathron-Setup.exe`). If you received a folder with `Install.bat` and `.part` files, keep them together
   and double-click **Install.bat** — it joins the parts, checks they are not damaged (SHA-256) and starts the installer.
2. Click **Yes** on the Windows (UAC) prompt. The app installs for all users, adds Start-menu and desktop shortcuts and a
   firewall rule that lets only devices **on your own network** reach it (phone, Quest).
3. The app opens. It also lives in the system tray (bottom right) — closing the window keeps it running for WhatsApp
   and the robot; use *Quit* in the tray menu to exit completely.

**Update:** install the new version over the old one. **Your chats, settings, saved servers, keys, memory and
skills are kept** — they are not in the installer.

**Where your data is**

| What | Where |
|---|---|
| Workspace, photos, room maps, research reports | `%USERPROFILE%\MuseCarpathron` |
| Chats, settings, servers, keys, memory, skills, log | `%APPDATA%\Muse Carpathron\data` |
| Log file (for troubleshooting) | `%APPDATA%\Muse Carpathron\muse-carpathron.log` |

Passwords, API keys, SSH keys and the GitHub token are **encrypted with your Windows account** (DPAPI). They never
appear in the installer, in the repository, in the browser or on the phone.

**Uninstall:** Windows *Settings → Apps → Muse Carpathron → Uninstall*. Your data folders stay; delete them by hand
if you want a clean start.

---

## 3. Connect Meta Muse (the brain)

*Settings → Sign in to Meta* offers two engines. You can use both and switch per chat.

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
- *Settings → Defaults → Max agent steps per message* limits how long one answer may run (default 100).

### 5.5 Chat commands

| Command | What it does |
|---|---|
| `/remember <fact>` | Saves the fact to memory |
| `/<skill-name> <task>` | Runs a skill, e.g. `/research best ESP32 boards` |

---

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

## 8. Plugins — GitHub

### 8.1 Sign in

Left menu → **Plugins → GitHub**:

- **Sign in with browser** (recommended):
  - If the **GitHub CLI** (`gh`) is installed, its login opens in your browser; approve it and the app imports the login.
  - Otherwise the app shows a **code** and opens `github.com/login/device`: type the code, approve, and the app connects
    by itself. (This needs an OAuth app *Client ID* in the details section; the GitHub CLI route needs nothing.)
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
AI apps use. Paste a JSON object, then **Save & start**:

```json
{
  "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\Users\\me\\Documents"] },
  "remote": { "url": "https://example.com/mcp" }
}
```

- `command` + `args` start a local server (Node.js is needed for `npx` ones).
- `url` connects to a remote MCP server.
- The status list shows each server and how many tools it has; **Restart all** reloads them.
- MCP tools are used by the API-key engine. Muse Code gets the app's built-in tools through the Carpathron bridge.

---

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

Create your own on the **Skills** page. After repeated multi-step work, the app offers to learn a new skill in your style.

---

## 11. Arduino and firmware

Ask for example *"/firmware blink the LED on my ESP32 and print the Wi-Fi IP"*. The agent:
1. finds **arduino-cli** (Arduino IDE 2 already includes it) or downloads it (`arduino_setup`);
2. installs the board core (e.g. `esp32:esp32`) and libraries;
3. writes the sketch, **compiles** and fixes errors;
4. finds the board's COM port and **uploads**;
5. reads the **serial monitor** to check it works.

Tips: ESP32 that doesn't connect → hold **BOOT** while it says *Connecting…*. For the ESP32-CAM car use the
`esp32` core **2.0.12** and board *AI Thinker ESP32-CAM*. Path to arduino-cli can be set in *Settings → Tools & models*.
`open_arduino_ide` opens the sketch in Arduino IDE if you want to edit it yourself.

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
  *App secret*. **Start public tunnel** opens a Cloudflare tunnel for the webhook. **Send test** checks it.

Commands: `/help` · `/new` · `/stop` · `/status` · `/mode ask|auto|full|plan` · `/photo` · `/drive forward 2` ·
`/f /b /l /r` · `/look left|right|back` · `/turn 90` · `/scan` · `/robot stop` · `/remember <fact>` · `yes` / `no`
(answer approvals). Anything else goes to the agent. **Voice notes** are transcribed (English and 24 other languages)
and run like typed messages.

---

## 14. Phone, tablet and Quest browser

*Settings → Phone & Quest access*: open the address shown (`https://<pc-ip>:8443/pair`) on a device on the same Wi-Fi,
accept the certificate warning once (*Advanced → Proceed*), type the **6-digit PIN** shown on the PC (valid 10 minutes).
The full app opens: chat, robot, video. A phone can also act as the robot's camera.

---

## 15. Settings, section by section

| Section | What's in it |
|---|---|
| **Sign in to Meta** | API key, Muse Code install / sign-in / sandbox (section 3) |
| **Defaults** | Default engine, approval mode, folder (workspace), API model, max steps, custom instructions for every chat |
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
| GitHub *Sign in with browser* does nothing | Install the GitHub CLI, or add a Client ID in the details, or use a token |
| Push refused (403) | The token needs the `repo` (and `workflow`) scope, or you lack access to that repository |
| arduino-cli missing | Ask *"set up Arduino"* (`arduino_setup`) or set its path in Settings |
| Board not found / upload fails | Other programs using the COM port (close Serial Monitor), USB cable with data, hold BOOT |
| WhatsApp doesn't answer | Status must be *connected*; write in **Message yourself** or add your number |
| Phone can't open the app | Same Wi-Fi; accept the certificate; new PIN after 10 minutes |
| Something else | Activity page, and the log at `%APPDATA%\Muse Carpathron\muse-carpathron.log` |

---

## 18. Keyboard shortcuts

| Keys | Action |
|---|---|
| **Enter** / **Shift+Enter** | Send / new line |
| **Esc** | Stop the current answer, or close a dialog |
| **W A S D**, **Space** | Drive / stop the robot (Robot page) |

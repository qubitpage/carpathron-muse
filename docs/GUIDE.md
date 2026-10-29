# Carpathron Robotics & Coding — the complete guide

Carpathron Robotics & Coding is a Windows app that turns **Meta Muse** models into a working assistant on your PC: it chats,
writes and runs code, works on your **remote servers over SSH**, publishes to **GitHub**, writes and flashes
**Arduino / ESP32 firmware**, reads and designs **PDFs and websites**, does **web research**, and drives the
**Carpathron robot** from the PC, WhatsApp, a phone or a Meta Quest headset.

This guide starts from zero (installing the app) and then explains every menu, button and tool.

> **New name (1.7.0):** the app was called *Muse Carpathron* before. Updating keeps all your chats, settings,
> servers and keys (they stay in the same folders). It is made by **Qubitpage LIMITED** (qubitpage.com).

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

**Uninstall:** Windows *Settings → Apps → Carpathron Robotics & Coding → Uninstall*. Your data folders stay; delete them by hand
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

Carpathron Robotics & Coding adds rules and checks so the agent doesn't invent things:

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
`security_check` (servers and websites, section 7.5) · `task_update` (the task list) · `ask_model` (second opinion from another Muse model)

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
| Computer use: nothing happens in an admin window | Windows blocks input into programs running as administrator unless Carpathron Robotics & Coding also runs as administrator |
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

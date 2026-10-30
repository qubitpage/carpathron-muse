# Muse Carpathron — source code

Windows desktop app (Electron) that runs a Meta Muse agent on your PC, your SSH servers and the Carpathron robot.
User documentation: [`public/guide.md`](public/guide.md) (also inside the app under **📖 Guide & help**).

## Layout

| Path | What it is |
|---|---|
| `main.js`, `preload.js` | Electron main process: window, tray, starts the backend |
| `backend/server.js` | Local HTTPS + WebSocket server and the REST API the UI uses |
| `backend/agent.js` | The agent loop: models, tools, approvals, Stop, memory, skills |
| `backend/engines/` | `api` (Meta Model API, OpenAI-compatible) and `muse` (Muse Code via `@muse-code/sdk`) |
| `backend/tools.js` | Files, commands, web fetch, robot, sub-agents (local or routed to a server) |
| `backend/xtools.js` | SSH, documents, PDF, screenshots, web search, research, jobs, Arduino, Muse Image, SAM, voice |
| `backend/remote.js` | SSH servers (ssh2): connections, SFTP, shells, keys, host-key checks |
| `backend/github.js` | GitHub plugin: token / browser sign-in, repos, publish, releases, issues, PRs |
| `backend/bridge.js` | MCP stdio server that gives Muse Code the app's tools |
| `backend/models.js` | Model capability registry and Muse Image / SAM / Voice calls |
| `backend/secrets.js` | Encryption of passwords, keys and tokens (Windows DPAPI, AES fallback) |
| `backend/store.js` | Chats, settings, index (JSON files in the app data folder) |
| `public/` | The UI (plain HTML/CSS/JS) and the guide |
| `build/` | Build helpers (Muse Code SDK patch, installer resources) |
| `test/` | Backend tests (fake SSH and GitHub servers included) |

## Build

Requirements: Node.js 20+ and npm. The installer is built for Windows x64 (works from Windows, or Linux with Wine).

```bash
npm install          # also applies build/patch-sdk.js
npm test             # backend tests
npm start            # run the app in development
npm run dist         # dist/Muse-Carpathron-Setup-<version>.exe
```

No secrets are stored in this folder: API keys, server passwords, SSH keys and the GitHub token are entered in the
app and saved encrypted in `%APPDATA%\Muse Carpathron\data` on the user's PC.

## License

See [`LICENSE`](../../LICENSE) in the repository root.

## Two editions, one code base

| Edition | Name | Where it ships | Update channel |
|---|---|---|---|
| Hackathon / open source | **Muse Carpathron** | installer (`Muse-Carpathron-Setup-<version>.exe`, GitHub releases) | `muse` |
| Commercial | **Carpathron Robotics & Coding** | Microsoft Store (MSIX) and installer | `store` (installer only) |

The commercial edition is the main source; `node build/edition.js muse <copy>` turns a copy of it into this edition
(names, installer, guide install section, update channel). Every feature is written once and reaches both.

## Automatic updates

Installer builds update themselves with `electron-updater` (`updater.js`): they read
`https://qubitpage.com/downloads/carpathron/<channel>.yml` every 6 hours, download the new installer in the
background and install it on restart (*Settings → Updates*, banner *Restart and update*). qubitpage.com answers from the
assets of the latest GitHub release of this repository, so a release = upload `muse.yml`, `store.yml`, both installers
and their `.blockmap` files. The Microsoft Store (MSIX) version is updated by the Store, never by the app.
Test: `npm run test:electron` (includes `test/updater-feed.js`: feed → redirect → download → SHA-512 check).

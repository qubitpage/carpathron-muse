# Carpathron Robot Protocol v1

One small, open HTTP protocol that every Carpathron robot speaks. Any robot that implements it can be driven,
watched and photographed by **all** Carpathron apps: the Muse Carpathron desktop app (and its AI agent,
WhatsApp remote and browser VR), and the **Carpathron Avatar** Quest app, with no changes to those apps.

The reference implementation is the Baby Carpathron car firmware (`firmware/carpathron_car`, ESP32-CAM).

## Endpoints

| Port | Method & path | Purpose | Answer |
|---|---|---|---|
| 80 | `GET /status` | Discovery + health | JSON, see below. **Must** contain `"name"` |
| 80 | `GET /drive?l=<-100..100>&r=<-100..100>` | Set left / right wheel speed in percent (tank steering) | `ok` |
| 80 | `GET /stop` | Stop all motors | `stopped` |
| 80 | `GET /capture` | One JPEG photo | `image/jpeg` |
| 81 | `GET /stream` | Live video, MJPEG (`multipart/x-mixed-replace`) | JPEG frames |
| 80 | `GET /led?v=<0..255>` | Optional: headlight | `ok` |
| 80 | `GET /ws` (WebSocket) | Optional: low-latency control. Text messages `"l,r"` or `"s"` (stop), answer `"ok"` | |
| 80 | `GET /setup`, `/forgetwifi` | Optional: Wi-Fi setup pages | HTML |

If a robot listens on another port `P` for control, video is expected on `P+1` (for example `192.168.1.50:8080` → video on `8081`).

### `/status` JSON

```json
{
  "name": "Baby Carpathron",
  "ip": "192.168.1.131",
  "mode": "wifi",
  "wifi": "QUBITPAGE",
  "rssi": -71,
  "left": 0,
  "right": 0,
  "camera": true,
  "uptime": 1234
}
```

Only `name` is required. Apps use `rssi` (signal), `camera` and `left`/`right` when present.

## Driving rules (safety)

* A drive command is **kept** until the next command or `/stop` (like an RC transmitter); clients repeat the
  current command as a keep-alive about every 300 ms while a control is held.
* The robot **must stop by itself** if no command arrives for a short time (the car uses 2.5 s). This protects
  against lost Wi-Fi, closed apps and crashed clients.
* Clients send `/stop` three times on release (0, 250, 500 ms) so a single lost packet cannot leave it running.
* Speeds are percentages; the robot maps them to its own motor driver (the car uses PWM 150–255 on an L298N).

## Discovery

Clients scan the local /24 network(s) for `GET /status` answers containing `"name"` (the car also answers at
`carpathron.local` via mDNS and at `192.168.4.1` in hotspot mode).

## Building your own robot

1. Serve the five core endpoints (`/status`, `/drive`, `/stop`, `/capture`, `:81/stream`).
2. Implement the auto-stop timeout.
3. Your robot now works with Muse Carpathron (AI agent, WhatsApp, voice, room scan, browser VR) and the
   Carpathron Avatar Quest app.

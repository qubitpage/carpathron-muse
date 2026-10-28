/*
  Baby Carpathron — firmware for the KUONGSHUN AD174 ESP32 WiFi Camera 4WD car
  (ESP32-CAM + L298N, 4 TT motors, 2x18650)

  What it does
  - First start: makes its own Wi-Fi "Carpathron-Car" (password carpathron). Join it with your phone,
    open http://192.168.4.1/setup, pick your home Wi-Fi and type its password (saved in the car).
    After that it joins your home Wi-Fi by itself (so the PC keeps internet for the Meta AI).
    If your Wi-Fi is not reachable it falls back to the "Carpathron-Car" hotspot again.
  - Web server on port 80:
       /            test page (live video + buttons)
       /drive?l=..&r=..   motor speeds -100..100 (left, right). Muse Carpathron sends this ~10x per second.
       /stop        stop now
       /capture     one JPEG photo (Muse Carpathron uses this for robot photos / WhatsApp)
       /led?v=0..255   headlight
       /status      JSON: ip, signal, motors, uptime
       /setup       Wi-Fi setup page
  - Live video (MJPEG) on port 81:  http://<car-ip>:81/stream
  - Safety: motors stop if no /drive command arrives for 600 ms.

  Arduino IDE setup (same as the kit tutorial)
  - Board package "esp32" by Espressif: works with 2.0.12 (kit) and 3.x.
  - Tools > Board > ESP32 Dev Module (kit instructions). If you see "Camera init failed",
    pick Tools > Board > "AI Thinker ESP32-CAM" instead, or set Tools > PSRAM > Enabled.
  - No extra libraries and NO editing needed: just Upload.
  - Then set up Wi-Fi from the phone (see above). Muse Carpathron > Robot > "Find my car" finds its IP.
*/

#include "esp_arduino_version.h"
#include "esp_camera.h"
#include "esp_http_server.h"
#include "esp_timer.h"
#include <WiFi.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"
#include "esp_efuse.h"
#include "esp_efuse_table.h"
#include "lwip/sockets.h"

// ---------------------------------------------------------------- Wi-Fi
// Optional: you may type your Wi-Fi here instead of using the /setup page.
const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";
Preferences prefs;
String savedSsid, savedPass;
volatile bool wifiChangeRequested = false;
unsigned long staConnectedAt = 0;
// fallback hotspot made by the car when your Wi-Fi is not reachable
const char* AP_SSID = "Carpathron-Car";
const char* AP_PASS = "carpathron";      // at least 8 characters

// ---------------------------------------------------------------- motor pins (from the kit tutorial, L298N)
// Right wheels: ENA=12 (speed), IN1=13 (forward), IN2=14 (backward)
// Left wheels : ENB=2  (speed), IN3=15 (forward), IN4=33 (backward)
const int R_EN = 12, R_FWD = 13, R_BACK = 14;
const int L_EN = 2,  L_FWD = 15, L_BACK = 33;
const int LED_PIN = 4;   // white headlight on the ESP32-CAM

// If a side spins the wrong way, set it to true. If left/right are swapped, set SWAP_SIDES.
const bool INVERT_LEFT = false;
const bool INVERT_RIGHT = false;
const bool SWAP_SIDES = false;

// Camera picture orientation (kit FAQ: ESP32-CAM-V0.3 boards need VFLIP 0)
const int CAM_VFLIP = 1;
const int CAM_HMIRROR = 1;

// PWM (LEDC). Channel 0 / timer 0 is used by the camera clock, so motors use 2 and 4, LED uses 7.
const int PWM_FREQ = 1000, PWM_BITS = 8;   // 1 kHz like the kit (analogWrite): the L298N gives the motors more power at low PWM frequency
const int CH_R = 2, CH_L = 4, CH_LED = 7;
// PWM helpers that work with both the 2.x (kit) and 3.x ESP32 board packages
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  #define PWM_ATTACH(pin, ch) ledcAttachChannel((pin), PWM_FREQ, PWM_BITS, (ch))
  #define PWM_WRITE(pin, ch, duty) ledcWrite((pin), (duty))
#else
  #define PWM_ATTACH(pin, ch) do { ledcSetup((ch), PWM_FREQ, PWM_BITS); ledcAttachPin((pin), (ch)); } while (0)
  #define PWM_WRITE(pin, ch, duty) ledcWrite((ch), (duty))
#endif
const int MIN_DUTY = 150;              // below this TT motors only hum; 150..255 keeps even slow speeds strong
const int STREAM_QUALITY = 16, PHOTO_QUALITY = 10;  // JPEG quality: lower number = sharper and bigger
const unsigned long FAILSAFE_MS = 2500;  // like the kit: a press keeps the car moving until stop; this only catches a lost link (app closed, Wi-Fi gone)

// AI-Thinker ESP32-CAM camera pins (same as the kit code)
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

// ---------------------------------------------------------------- state
volatile int curL = 0, curR = 0;
volatile unsigned long lastDrive = 0;
bool cameraOk = false;
bool apMode = false;
httpd_handle_t web_httpd = NULL;
httpd_handle_t stream_httpd = NULL;

// ---------------------------------------------------------------- motors
int toDuty(int pct) {
  pct = abs(pct);
  if (pct > 100) pct = 100;
  if (pct == 0) return 0;
  return map(pct, 1, 100, MIN_DUTY, 255);
}

void setSide(int enPin, int enCh, int fwdPin, int backPin, int pct) {
  int duty = toDuty(pct);
  digitalWrite(fwdPin, pct > 0 ? HIGH : LOW);
  digitalWrite(backPin, pct < 0 ? HIGH : LOW);
  PWM_WRITE(enPin, enCh, duty);
}

void setLed(int v) { PWM_WRITE(LED_PIN, CH_LED, v); }

void drive(int l, int r) {
  l = constrain(l, -100, 100);
  r = constrain(r, -100, 100);
  curL = l; curR = r;
  if (SWAP_SIDES) { int t = l; l = r; r = t; }
  if (INVERT_LEFT) l = -l;
  if (INVERT_RIGHT) r = -r;
  setSide(L_EN, CH_L, L_FWD, L_BACK, l);
  setSide(R_EN, CH_R, R_FWD, R_BACK, r);
}

void initMotors() {
  int pins[] = { R_FWD, R_BACK, L_FWD, L_BACK };
  for (int p : pins) { pinMode(p, OUTPUT); digitalWrite(p, LOW); }
  PWM_ATTACH(R_EN, CH_R);
  PWM_ATTACH(L_EN, CH_L);
  PWM_ATTACH(LED_PIN, CH_LED);
  drive(0, 0);
  setLed(0);
}

// ---------------------------------------------------------------- camera
bool initCamera() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  if (psramFound()) {
    config.frame_size = FRAMESIZE_UXGA;
    config.jpeg_quality = 10;
    config.fb_count = 2;
    config.fb_location = CAMERA_FB_IN_PSRAM;
    config.grab_mode = CAMERA_GRAB_LATEST;
  } else {
    config.frame_size = FRAMESIZE_SVGA;
    config.jpeg_quality = 12;
    config.fb_count = 1;
    config.fb_location = CAMERA_FB_IN_DRAM;
    config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
  }
  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed with error 0x%x (driving still works)\n", err);
    return false;
  }
  sensor_t* s = esp_camera_sensor_get();
  s->set_framesize(s, FRAMESIZE_VGA);   // 640x480: good for photos to the AI and smooth streaming
  s->set_quality(s, STREAM_QUALITY);    // smaller frames for live video (weak Wi-Fi); /capture switches to sharp for photos
  s->set_vflip(s, CAM_VFLIP);
  s->set_hmirror(s, CAM_HMIRROR);
  return true;
}

// ---------------------------------------------------------------- web handlers
static int queryInt(httpd_req_t* req, const char* key, int def) {
  char q[96], v[16];
  if (httpd_req_get_url_query_str(req, q, sizeof(q)) != ESP_OK) return def;
  if (httpd_query_key_value(q, key, v, sizeof(v)) != ESP_OK) return def;
  return atoi(v);
}

static esp_err_t send_text(httpd_req_t* req, const char* type, const char* body) {
  httpd_resp_set_type(req, type);
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  httpd_resp_set_hdr(req, "Cache-Control", "no-store");
  return httpd_resp_send(req, body, HTTPD_RESP_USE_STRLEN);
}

static esp_err_t drive_handler(httpd_req_t* req) {
  int l = queryInt(req, "l", 0), r = queryInt(req, "r", 0);
  if (l != curL || r != curR) Serial.printf("[drive] left %d  right %d\n", l, r);
  drive(l, r);
  lastDrive = millis();
  return send_text(req, "text/plain", "ok");
}

// RC-style control over one permanent WebSocket (/ws): far fewer packets than one HTTP request per command,
// so it keeps working on weak Wi-Fi. Messages: "l,r" (each -100..100), "s" = stop. The car answers "ok".
static esp_err_t ws_handler(httpd_req_t* req) {
  if (req->method == HTTP_GET) { Serial.println("[ws] controller connected"); return ESP_OK; }
  httpd_ws_frame_t f = {};
  uint8_t buf[64];
  f.payload = buf;
  esp_err_t r = httpd_ws_recv_frame(req, &f, sizeof(buf) - 1);
  if (r != ESP_OK) return r;
  if (f.type != HTTPD_WS_TYPE_TEXT) return ESP_OK;
  buf[f.len] = 0;
  int l = 0, rr = 0;
  if (buf[0] == 's') { if (curL || curR) Serial.println("[drive] stop"); drive(0, 0); lastDrive = millis(); }
  else if (sscanf((const char*)buf, "%d,%d", &l, &rr) == 2) {
    if (l != curL || rr != curR) Serial.printf("[drive] left %d  right %d\n", l, rr);
    drive(l, rr); lastDrive = millis();
  } else return ESP_OK;
  httpd_ws_frame_t a = {};
  a.type = HTTPD_WS_TYPE_TEXT; a.payload = (uint8_t*)"ok"; a.len = 2;
  return httpd_ws_send_frame(req, &a);
}

// Motor self-test: one side forward at full power for 1 s. Shows in Serial Monitor too.
void motorTest(char side) {
  Serial.printf("[test] %s wheels forward, full power, 1 s (pins EN=%d FWD=%d BACK=%d)\n",
                side == 'l' ? "LEFT" : "RIGHT", side == 'l' ? L_EN : R_EN, side == 'l' ? L_FWD : R_FWD, side == 'l' ? L_BACK : R_BACK);
  if (side == 'l') setSide(L_EN, CH_L, L_FWD, L_BACK, 100); else setSide(R_EN, CH_R, R_FWD, R_BACK, 100);
  delay(1000);
  drive(0, 0);
  Serial.println("[test] done");
}

static esp_err_t test_handler(httpd_req_t* req) {
  char q[32], v[4] = "l";
  if (httpd_req_get_url_query_str(req, q, sizeof(q)) == ESP_OK) httpd_query_key_value(q, "s", v, sizeof(v));
  motorTest(v[0] == 'r' ? 'r' : 'l');
  return send_text(req, "text/plain", v[0] == 'r'
    ? "Right wheels test done. Did they spin forward? No movement = check batteries/switch, right motor wires, L298N."
    : "Left wheels test done. Did they spin forward? No movement = check batteries/switch, left motor wires, L298N.");
}

static esp_err_t stop_handler(httpd_req_t* req) {
  drive(0, 0);
  return send_text(req, "text/plain", "stopped");
}

static esp_err_t led_handler(httpd_req_t* req) {
  int v = constrain(queryInt(req, "v", 0), 0, 255);
  setLed(v);
  return send_text(req, "text/plain", "ok");
}

static esp_err_t status_handler(httpd_req_t* req) {
  char json[384];
  bool sta = WiFi.status() == WL_CONNECTED;
  snprintf(json, sizeof(json),
           "{\"name\":\"Baby Carpathron\",\"ip\":\"%s\",\"mode\":\"%s\",\"wifi\":\"%s\",\"wifiIp\":\"%s\",\"connecting\":%s,\"rssi\":%d,\"left\":%d,\"right\":%d,\"camera\":%s,\"psram\":%s,\"uptime\":%lu}",
           (sta ? WiFi.localIP() : WiFi.softAPIP()).toString().c_str(), apMode ? "hotspot" : "wifi", savedSsid.c_str(),
           sta ? WiFi.localIP().toString().c_str() : "", wifiChangeRequested ? "true" : "false", sta ? WiFi.RSSI() : 0, curL, curR,
           cameraOk ? "true" : "false", psramFound() ? "true" : "false", millis() / 1000);
  return send_text(req, "application/json", json);
}

static esp_err_t capture_handler(httpd_req_t* req) {
  if (!cameraOk) { httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "camera not available"); return ESP_FAIL; }
  sensor_t* sn = esp_camera_sensor_get();
  sn->set_quality(sn, PHOTO_QUALITY);
  camera_fb_t* fb = NULL;
  for (int i = 0; i < 3; i++) { fb = esp_camera_fb_get(); if (i < 2 && fb) { esp_camera_fb_return(fb); fb = NULL; } }  // drop frames taken before the switch
  sn->set_quality(sn, STREAM_QUALITY);
  if (!fb) { httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "capture failed"); return ESP_FAIL; }
  httpd_resp_set_type(req, "image/jpeg");
  httpd_resp_set_hdr(req, "Content-Disposition", "inline; filename=capture.jpg");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  httpd_resp_set_hdr(req, "Cache-Control", "no-store");
  esp_err_t res = httpd_resp_send(req, (const char*)fb->buf, fb->len);
  esp_camera_fb_return(fb);
  return res;
}

#define PART_BOUNDARY "123456789000000000000987654321"
static const char* STREAM_CONTENT_TYPE = "multipart/x-mixed-replace;boundary=" PART_BOUNDARY;
static const char* STREAM_BOUNDARY = "\r\n--" PART_BOUNDARY "\r\n";
static const char* STREAM_PART = "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

// Video on port 81: own task + plain sockets so up to 3 viewers (Muse Carpathron, browser, Quest) watch at once.
// The newest viewer always gets in (the oldest is dropped if all 3 slots are busy).
#define MAX_VIEWERS 3
static bool sendAll(int c, const void* data, size_t len) {
  const uint8_t* p = (const uint8_t*)data;
  while (len) {
    int n = send(c, p, len, 0);
    if (n <= 0) return false;
    p += n; len -= n;
  }
  return true;
}
static void addViewer(int c, int* cl) {
  int fl = fcntl(c, F_GETFL, 0); fcntl(c, F_SETFL, fl & ~O_NONBLOCK);
  struct timeval rt = { 1, 0 }, st = { 3, 0 };
  setsockopt(c, SOL_SOCKET, SO_RCVTIMEO, &rt, sizeof(rt));
  setsockopt(c, SOL_SOCKET, SO_SNDTIMEO, &st, sizeof(st));
  int one = 1; setsockopt(c, IPPROTO_TCP, TCP_NODELAY, &one, sizeof(one));
  char req[512]; int got = 0;
  while (got < (int)sizeof(req) - 1) {             // read the request headers
    int n = recv(c, req + got, sizeof(req) - 1 - got, 0);
    if (n <= 0) break;
    got += n; req[got] = 0;
    if (strstr(req, "\r\n\r\n")) break;
  }
  req[got] = 0;
  if (!cameraOk || !strstr(req, "GET /stream")) {
    const char* nf = cameraOk ? "HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\nuse /stream" : "HTTP/1.1 500 Error\r\nConnection: close\r\n\r\ncamera not available";
    sendAll(c, nf, strlen(nf)); close(c); return;
  }
  const char* hdr = "HTTP/1.1 200 OK\r\nContent-Type: multipart/x-mixed-replace;boundary=" PART_BOUNDARY
                    "\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n";
  if (!sendAll(c, hdr, strlen(hdr))) { close(c); return; }
  for (int i = 0; i < MAX_VIEWERS; i++) if (cl[i] < 0) { cl[i] = c; Serial.println("[video] viewer joined"); return; }
  close(cl[0]);                                    // all busy: drop the oldest, keep the newest
  for (int i = 0; i < MAX_VIEWERS - 1; i++) cl[i] = cl[i + 1];
  cl[MAX_VIEWERS - 1] = c;
  Serial.println("[video] viewer joined (oldest viewer dropped)");
}
static void streamTask(void*) {
  int ls = socket(AF_INET, SOCK_STREAM, 0);
  int one = 1; setsockopt(ls, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one));
  struct sockaddr_in a = {};
  a.sin_family = AF_INET; a.sin_port = htons(81); a.sin_addr.s_addr = htonl(INADDR_ANY);
  if (bind(ls, (struct sockaddr*)&a, sizeof(a)) != 0 || listen(ls, 4) != 0) { Serial.println("[video] port 81 failed"); vTaskDelete(NULL); }
  fcntl(ls, F_SETFL, fcntl(ls, F_GETFL, 0) | O_NONBLOCK);
  int cl[MAX_VIEWERS]; for (int i = 0; i < MAX_VIEWERS; i++) cl[i] = -1;
  char part[96];
  for (;;) {
    int c = accept(ls, NULL, NULL);
    if (c >= 0) addViewer(c, cl);
    int viewers = 0; for (int i = 0; i < MAX_VIEWERS; i++) if (cl[i] >= 0) viewers++;
    if (!viewers || !cameraOk) { vTaskDelay(pdMS_TO_TICKS(40)); continue; }
    camera_fb_t* fb = esp_camera_fb_get();
    if (!fb) { vTaskDelay(pdMS_TO_TICKS(20)); continue; }
    int hl = snprintf(part, sizeof(part), "\r\n--" PART_BOUNDARY "\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n", fb->len);
    unsigned long t0 = millis();
    for (int i = 0; i < MAX_VIEWERS; i++) {
      if (cl[i] < 0) continue;
      if (!sendAll(cl[i], part, hl) || !sendAll(cl[i], fb->buf, fb->len)) { close(cl[i]); cl[i] = -1; Serial.println("[video] viewer left"); }
    }
    esp_camera_fb_return(fb);
    // Video must never starve the controls: wait at least as long as the frame took to send
    // (so video uses at most ~half the Wi-Fi airtime), and longer while driving (~6 fps).
    unsigned long took = millis() - t0;
    unsigned long base = (curL || curR) ? 160 : 70;
    vTaskDelay(pdMS_TO_TICKS(took > base ? took : base));
  }
}

static const char INDEX_HTML[] PROGMEM = R"HTML(<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<title>Baby Carpathron</title><style>
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{font-family:system-ui,sans-serif;background:#0d0f12;color:#e8eaed;text-align:center;margin:0;padding:10px;user-select:none;-webkit-user-select:none}
h3{margin:4px 0 8px}#v{width:100%;max-width:640px;border-radius:12px;background:#000;min-height:120px}
#bar{font-size:13px;color:#9aa0a6;margin:6px 0}#bar b{color:#e8eaed}.ok{color:#34c759!important}.bad{color:#ff5b6b!important}
#pad{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;max-width:340px;margin:8px auto}
#pad button{height:84px;font-size:30px;border-radius:16px;border:1px solid #2c313a;background:#1d2128;color:#fff;touch-action:none}
#pad button.on{background:#4f8cff;border-color:#4f8cff}#pad .s{background:#ff5b6b;font-size:18px;font-weight:700}
.row{max-width:340px;margin:10px auto;display:flex;align-items:center;gap:10px;font-size:14px}.row input{flex:1}
.tools{max-width:340px;margin:10px auto;display:flex;flex-wrap:wrap;gap:6px;justify-content:center}
.tools button,.tools a{padding:9px 12px;border-radius:10px;border:1px solid #2c313a;background:#171a1f;color:#e8eaed;font-size:13px;text-decoration:none}
#log{font-size:12px;color:#9aa0a6;min-height:16px}
</style></head><body><h3>Baby Carpathron</h3>
<img id="v" alt="camera">
<div id="bar">car <b id="st">…</b> · link <b id="lat">–</b> · wheels <b id="wh">0 / 0</b></div>
<div id="pad">
<button data-d="0,1">&#8598;</button><button data-d="1,1">&#9650;</button><button data-d="1,0">&#8599;</button>
<button data-d="-1,1">&#10226;</button><button class="s" data-d="0,0">STOP</button><button data-d="1,-1">&#10227;</button>
<button data-d="0,-1">&#8601;</button><button data-d="-1,-1">&#9660;</button><button data-d="-1,0">&#8600;</button>
</div>
<div class="row">speed <input id="sp" type="range" min="30" max="100" value="100"><b id="spv">100%</b></div>
<div class="row">light <input id="li" type="range" min="0" max="255" value="0"></div>
<div class="tools"><button id="tl">Test left wheels</button><button id="tr">Test right wheels</button><a href="/setup">Wi-Fi setup</a></div>
<div id="log">Hold a button to drive. Keys: W A S D / arrows, Space = stop.</div>
<script>
const $=id=>document.getElementById(id);let dir=[0,0],timer=null,held=null;
const v=$('v');function cam(){v.src=location.protocol+'//'+location.hostname+':81/stream?'+Date.now()}v.onerror=()=>setTimeout(cam,1500);cam();
function sp(){return +$('sp').value}$('sp').oninput=()=>$('spv').textContent=sp()+'%';
function q(u,ms){const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);return fetch(u,{cache:'no-store',signal:c.signal}).finally(()=>clearTimeout(t))}
// RC control: one permanent WebSocket. Press = sent at once; held = repeated every 300 ms; release = stop (x3).
let ws=null,wsOk=false,sentAt=0;
function wsOpen(){try{ws=new WebSocket('ws://'+location.host+'/ws')}catch(e){return}
ws.onopen=()=>{wsOk=true;$('lat').textContent='live';$('lat').className='ok'};
ws.onmessage=()=>{$('lat').textContent=Math.round(performance.now()-sentAt)+' ms';$('lat').className='ok'};
ws.onclose=ws.onerror=()=>{wsOk=false;$('lat').textContent='reconnecting';$('lat').className='bad';setTimeout(()=>{if(!ws||ws.readyState>1)wsOpen()},800)}}
wsOpen();
function out(msg){sentAt=performance.now();if(wsOk&&ws.readyState===1&&ws.bufferedAmount<64){ws.send(msg);return}
if(msg==='s')q('/stop',900).catch(()=>{});else{const p=msg.split(',');q('/drive?l='+p[0]+'&r='+p[1],900).catch(()=>{})}}
function send(){const l=Math.round(dir[0]*sp()),r=Math.round(dir[1]*sp());out(l+','+r);$('wh').textContent=l+' / '+r}
function start(d,btn){dir=d;if(held)held.classList.remove('on');held=btn;if(btn)btn.classList.add('on');clearInterval(timer);send();timer=setInterval(send,300)}
function stop(){clearInterval(timer);timer=null;dir=[0,0];if(held)held.classList.remove('on');held=null;
out('s');setTimeout(()=>out('s'),200);setTimeout(()=>out('s'),500);$('wh').textContent='0 / 0'}
document.querySelectorAll('#pad button').forEach(b=>{const d=b.dataset.d.split(',').map(Number);
b.addEventListener('pointerdown',e=>{e.preventDefault();try{b.setPointerCapture(e.pointerId)}catch(_){}if(d[0]||d[1])start(d,b);else stop()});
['pointerup','pointercancel','lostpointercapture'].forEach(n=>b.addEventListener(n,()=>{if(held===b)stop()}));
b.addEventListener('contextmenu',e=>e.preventDefault())});
const keys={w:[1,1],arrowup:[1,1],s:[-1,-1],arrowdown:[-1,-1],a:[-1,1],arrowleft:[-1,1],d:[1,-1],arrowright:[1,-1]};let kd=null;
addEventListener('keydown',e=>{const k=e.key.toLowerCase();if(k===' '){stop();return}if(keys[k]&&kd!==k){kd=k;start(keys[k],null);e.preventDefault()}});
addEventListener('keyup',e=>{if(e.key.toLowerCase()===kd){kd=null;stop()}});
addEventListener('blur',stop);document.addEventListener('visibilitychange',()=>{if(document.hidden)stop()});
$('li').oninput=e=>fetch('/led?v='+e.target.value).catch(()=>{});
function test(s){$('log').textContent='Testing '+(s=='l'?'left':'right')+' wheels: they should spin FORWARD for 1 second…';
fetch('/test?s='+s).then(r=>r.text()).then(t=>$('log').textContent=t).catch(()=>$('log').textContent='Test failed: car not reachable')}
$('tl').onclick=()=>test('l');$('tr').onclick=()=>test('r');
function status(){fetch('/status',{cache:'no-store'}).then(r=>r.json()).then(j=>{$('st').textContent=(j.mode=='wifi'?'on '+j.wifi+' ('+j.ip+', '+j.rssi+' dBm)':'hotspot '+j.ip);$('st').className='ok'})
.catch(()=>{$('st').textContent='offline';$('st').className='bad'})}status();setInterval(status,4000);
</script></body></html>)HTML";

// ---- Wi-Fi setup page
static String urlDecode(const char* s) {
  String out;
  for (; *s; s++) {
    if (*s == '+') out += ' ';
    else if (*s == '%' && s[1] && s[2]) { char h[3] = { s[1], s[2], 0 }; out += (char)strtol(h, NULL, 16); s += 2; }
    else out += *s;
  }
  return out;
}

static String htmlEscape(const String& in) {
  String o;
  for (unsigned int i = 0; i < in.length(); i++) { char c = in[i]; if (c == '<') o += "&lt;"; else if (c == '>') o += "&gt;"; else if (c == '"') o += "&quot;"; else if (c == '&') o += "&amp;"; else o += c; }
  return o;
}

static esp_err_t setup_handler(httpd_req_t* req) {
  int n = WiFi.scanNetworks();
  String opts;
  for (int i = 0; i < n && i < 25; i++) {
    String name = WiFi.SSID(i);
    if (!name.length() || name == AP_SSID || opts.indexOf(">" + htmlEscape(name) + "<") >= 0) continue;  // never offer the car's own hotspot
    opts += "<option>" + htmlEscape(name) + "</option>";
  }
  String page = F("<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'><title>Car Wi-Fi</title>"
                  "<style>body{font-family:sans-serif;background:#0d0f12;color:#e8eaed;max-width:420px;margin:auto;padding:16px}"
                  "input,select,button{width:100%;padding:12px;margin:6px 0;border-radius:10px;border:1px solid #333;background:#171a1f;color:#fff;font-size:16px}"
                  "button{background:#4f8cff;border:0;font-weight:bold}</style></head><body><h2>Baby Carpathron Wi-Fi</h2>"
                  "<p>Pick your home Wi-Fi (2.4 GHz) and type its password. It is stored only in the car.</p>"
                  "<form action='/savewifi' method='get'><select name='ssid'><option value=''>-- choose your Wi-Fi --</option>");
  page += opts;
  page += F("</select><input name='ssid2' placeholder='or type the network name'><input name='pass' type='password' placeholder='Wi-Fi password'>"
            "<button>Save and connect</button></form><p id='st'></p><script>"
            "if(location.search.indexOf('saved')>=0){let s=document.getElementById('st');s.textContent='Connecting…';"
            "let k=0,t=setInterval(()=>fetch('/status').then(r=>r.json()).then(j=>{k++;if(j.wifiIp){clearInterval(t);"
            "s.innerHTML='<b>Connected!</b> Car IP on your Wi-Fi: <b>'+j.wifiIp+'</b><br>Reconnect your phone to your normal Wi-Fi. "
            "In Muse Carpathron press Find my car (or type this IP).'}else if(k>25){clearInterval(t);s.textContent='Could not connect. Check the password and that the network is 2.4 GHz.'}}),1000)}"
            "</script></body></html>");
  return send_text(req, "text/html", page.c_str());
}

static esp_err_t savewifi_handler(httpd_req_t* req) {
  char q[256], v[100];
  String ssid, pass;
  if (httpd_req_get_url_query_str(req, q, sizeof(q)) == ESP_OK) {
    if (httpd_query_key_value(q, "ssid2", v, sizeof(v)) == ESP_OK && strlen(v)) ssid = urlDecode(v);
    else if (httpd_query_key_value(q, "ssid", v, sizeof(v)) == ESP_OK) ssid = urlDecode(v);
    if (httpd_query_key_value(q, "pass", v, sizeof(v)) == ESP_OK) pass = urlDecode(v);
  }
  if (!ssid.length()) return send_text(req, "text/plain", "Pick your home Wi-Fi first. Go back and choose it from the list.");
  if (ssid == AP_SSID) return send_text(req, "text/plain", "That is the car's own hotspot. Go back and pick your home Wi-Fi (for example the one your PC uses).");
  prefs.putString("ssid", ssid);
  prefs.putString("pass", pass);
  savedSsid = ssid; savedPass = pass;
  wifiChangeRequested = true;
  httpd_resp_set_status(req, "302 Found");
  httpd_resp_set_hdr(req, "Location", "/setup?saved=1");
  return httpd_resp_send(req, NULL, 0);
}

static esp_err_t forget_handler(httpd_req_t* req) {
  prefs.remove("ssid"); prefs.remove("pass");
  send_text(req, "text/plain", "Wi-Fi forgotten. Restarting into hotspot mode (Carpathron-Car)...");
  delay(500);
  ESP.restart();
  return ESP_OK;
}

static esp_err_t index_handler(httpd_req_t* req) {
  return send_text(req, "text/html", INDEX_HTML);
}

void startServers() {
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port = 80;
  config.ctrl_port = 32768;
  config.max_uri_handlers = 16;
  config.stack_size = 8192;
  config.lru_purge_enable = true;
  httpd_uri_t uris[] = {
    { "/", HTTP_GET, index_handler, NULL },
    { "/drive", HTTP_GET, drive_handler, NULL },
    { "/stop", HTTP_GET, stop_handler, NULL },
    { "/led", HTTP_GET, led_handler, NULL },
    { "/status", HTTP_GET, status_handler, NULL },
    { "/capture", HTTP_GET, capture_handler, NULL },
    { "/setup", HTTP_GET, setup_handler, NULL },
    { "/savewifi", HTTP_GET, savewifi_handler, NULL },
    { "/forgetwifi", HTTP_GET, forget_handler, NULL },
    { "/test", HTTP_GET, test_handler, NULL },
  };
  if (httpd_start(&web_httpd, &config) == ESP_OK) {
    for (auto& u : uris) httpd_register_uri_handler(web_httpd, &u);
    httpd_uri_t ws = {};
    ws.uri = "/ws"; ws.method = HTTP_GET; ws.handler = ws_handler; ws.is_websocket = true;
    httpd_register_uri_handler(web_httpd, &ws);
  }
  xTaskCreatePinnedToCore(streamTask, "video", 6144, NULL, 2, NULL, 1);
}

// ---------------------------------------------------------------- Wi-Fi
bool connectSta(unsigned long timeoutMs) {
  if (!savedSsid.length()) return false;
  WiFi.begin(savedSsid.c_str(), savedPass.c_str());
  Serial.printf("Connecting to Wi-Fi \"%s\"", savedSsid.c_str());
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < timeoutMs) {
    delay(300);
    Serial.print(".");
    setLed((millis() / 300) % 2 ? 4 : 0);  // faint blink while connecting
  }
  setLed(0);
  Serial.println();
  return WiFi.status() == WL_CONNECTED;
}

void startHotspot() {
  apMode = true;
  WiFi.mode(WIFI_AP_STA);  // AP for setup + STA so the setup page can scan networks
  WiFi.softAP(AP_SSID, AP_PASS);
  Serial.printf("Hotspot \"%s\" (password %s). Open http://192.168.4.1/setup to choose your Wi-Fi.\n", AP_SSID, AP_PASS);
}

void startWifi() {
  prefs.begin("carpathron", false);
  savedSsid = prefs.getString("ssid", "");
  if (savedSsid == AP_SSID) { savedSsid = ""; prefs.remove("ssid"); prefs.remove("pass"); }  // old mistake: own hotspot saved as home Wi-Fi
  savedPass = prefs.getString("pass", "");
  if (!savedSsid.length() && strcmp(WIFI_SSID, "YOUR_WIFI_NAME") != 0 && strlen(WIFI_SSID)) { savedSsid = WIFI_SSID; savedPass = WIFI_PASS; }
  WiFi.setSleep(false);  // lower latency for driving
  WiFi.mode(WIFI_STA);
  WiFi.setTxPower(WIFI_POWER_19_5dBm);  // strongest signal
  if (connectSta(15000)) {
    apMode = false;
    staConnectedAt = millis();
    Serial.print("Car IP: ");
    Serial.println(WiFi.localIP());
  } else {
    startHotspot();
    Serial.print("Car IP (hotspot): ");
    Serial.println(WiFi.softAPIP());
  }
  if (MDNS.begin("carpathron")) MDNS.addService("http", "tcp", 80);
}

// Called from loop(): applies a Wi-Fi saved on the /setup page (keeps the hotspot up until it works).
void handleWifiChange() {
  if (!wifiChangeRequested) return;
  wifiChangeRequested = false;
  drive(0, 0);
  WiFi.disconnect(false);
  if (connectSta(20000)) {
    Serial.print("Joined your Wi-Fi. Car IP: ");
    Serial.println(WiFi.localIP());
    Serial.printf("Open http://%s/ or http://carpathron.local/ from the PC. Muse Carpathron: Robot > Find my car.\n", WiFi.localIP().toString().c_str());
    staConnectedAt = millis();  // hotspot is switched off 90 s later so the phone can still read the new IP
  } else {
    Serial.println("Could not join that Wi-Fi; hotspot stays on.");
  }
}

// ---------------------------------------------------------------- boot fix (GPIO 12)
// GPIO 12 is the right-motor speed pin, but at power-up it also picks the flash voltage. The L298N pulls it HIGH,
// so the ESP32 picks 1.8 V and can't read its program ("invalid header: 0xffffffff"). Burning these eFuses
// (same as: espefuse.py set_flash_voltage 3.3V) fixes the flash at 3.3 V for good. Correct for AI-Thinker ESP32-CAM.
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  #define FUSE_SDIO_TIEH  ESP_EFUSE_XPD_SDIO_TIEH
  #define FUSE_SDIO_FORCE ESP_EFUSE_XPD_SDIO_FORCE
#else
  #define FUSE_SDIO_TIEH  ESP_EFUSE_SDIO_TIEH
  #define FUSE_SDIO_FORCE ESP_EFUSE_SDIO_FORCE
#endif
bool flashFuseSet() {
  return esp_efuse_read_field_bit(FUSE_SDIO_FORCE) && esp_efuse_read_field_bit(ESP_EFUSE_XPD_SDIO_REG) && esp_efuse_read_field_bit(FUSE_SDIO_TIEH);
}
void burnFlashFuse() {
  if (flashFuseSet()) { Serial.println("[fixboot] Already done: flash is fixed at 3.3 V."); return; }
  if (esp_efuse_read_field_bit(FUSE_SDIO_FORCE)) { Serial.println("[fixboot] Flash voltage was already set to another value; not changing it."); return; }
  esp_err_t e1 = esp_efuse_write_field_bit(ESP_EFUSE_XPD_SDIO_REG);
  esp_err_t e2 = esp_efuse_write_field_bit(FUSE_SDIO_TIEH);
  esp_err_t e3 = esp_efuse_write_field_bit(FUSE_SDIO_FORCE);
  Serial.printf("[fixboot] write results: %d %d %d\n", e1, e2, e3);
  Serial.println(flashFuseSet() ? "[fixboot] DONE. Flash fixed at 3.3 V. The car now boots with all wires plugged in."
                                : "[fixboot] Could not set it. See the guide (Troubleshooting).");
}

// ---------------------------------------------------------------- USB Serial Monitor commands
// Lets you set up the car from the PC over the USB cable (Serial Monitor, 115200, "New Line").
String serialLine; int serialStep = 0; String newSsid;
void printHelp() {
  Serial.println("Commands: wifi (set up Wi-Fi), status, test (wheels), forget (back to hotspot), fixboot (one-time GPIO12 boot fix), help");
}
void printStatus() {
  bool sta = WiFi.status() == WL_CONNECTED;
  Serial.printf("[status] mode=%s  wifi=\"%s\" %s  ip=%s  hotspot=%s  camera=%s\n", apMode ? "hotspot" : "wifi", savedSsid.c_str(),
                sta ? "connected" : "not connected", sta ? WiFi.localIP().toString().c_str() : "-",
                apMode ? WiFi.softAPIP().toString().c_str() : "off", cameraOk ? "ok" : "FAILED");
  Serial.printf("[status] boot fix (3.3 V flash): %s\n", flashFuseSet() ? "done" : "NOT done - type fixboot");
  if (sta) Serial.printf("Open http://%s/  (or http://carpathron.local/) from any device on that Wi-Fi.\n", WiFi.localIP().toString().c_str());
}
void handleSerial() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\r') continue;
    if (c != '\n') { if (serialLine.length() < 100) serialLine += c; continue; }
    String line = serialLine; serialLine = "";
    if (serialStep == 3) {
      serialStep = 0; line.trim();
      if (line == "BURN") burnFlashFuse(); else Serial.println("[fixboot] Cancelled.");
      continue;
    }
    if (serialStep == 1) {
      line.trim();
      if (!line.length() || line == AP_SSID) { Serial.println("Cancelled (type the name of your home Wi-Fi)."); serialStep = 0; continue; }
      newSsid = line; serialStep = 2;
      Serial.println("Now type the Wi-Fi password and press Enter (it is stored only in the car):");
      continue;
    }
    if (serialStep == 2) {
      serialStep = 0;
      prefs.putString("ssid", newSsid); prefs.putString("pass", line);
      savedSsid = newSsid; savedPass = line; wifiChangeRequested = true;
      Serial.printf("Saved. Joining \"%s\"...\n", newSsid.c_str());
      continue;
    }
    line.trim(); line.toLowerCase();
    if (line == "wifi") {
      int n = WiFi.scanNetworks();
      Serial.println("Wi-Fi networks the car can see (2.4 GHz only):");
      for (int i = 0; i < n && i < 20; i++) if (WiFi.SSID(i) != AP_SSID) Serial.printf("  %s  (%d dBm)\n", WiFi.SSID(i).c_str(), WiFi.RSSI(i));
      Serial.println("Type your Wi-Fi name exactly and press Enter:");
      serialStep = 1;
    } else if (line == "fixboot") {
      if (flashFuseSet()) { Serial.println("[fixboot] Already done: flash is fixed at 3.3 V."); continue; }
      Serial.println("[fixboot] This permanently fixes the flash voltage at 3.3 V (one-time, cannot be undone; correct for ESP32-CAM).");
      Serial.println("[fixboot] Type BURN (capitals) and press Enter to confirm, anything else cancels:");
      serialStep = 3;
    } else if (line == "status") printStatus();
    else if (line == "test") { motorTest('l'); delay(400); motorTest('r'); }
    else if (line == "forget") { prefs.remove("ssid"); prefs.remove("pass"); Serial.println("Forgotten, restarting..."); delay(300); ESP.restart(); }
    else if (line.length()) printHelp();
  }
}

// ---------------------------------------------------------------- main
void setup() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);  // motors can dip the battery; don't reset on brownout
  Serial.begin(115200);
  Serial.println("\nBaby Carpathron starting…");
  Serial.printf("Reset reason: %d (1=power on, 3=software, 4/5/6=crash/watchdog, 9=low voltage/brownout)\n", (int)esp_reset_reason());
  initMotors();
  cameraOk = initCamera();
  startWifi();
  startServers();
  for (int i = 0; i < 3; i++) { setLed(20); delay(80); setLed(0); delay(80); }  // ready
  Serial.println("Ready. Open http://<car-ip>/ in a browser to test, or add the IP in Muse Carpathron.");
  printHelp();
  if (!flashFuseSet()) Serial.println("NOTE: boot fix not done yet. With the 6-wire plug in, the car may fail to start (invalid header). Type: fixboot");
}

void loop() {
  handleSerial();
  if ((curL || curR) && millis() - lastDrive > FAILSAFE_MS) {
    drive(0, 0);
    Serial.printf("[failsafe] no command for %lu ms (Wi-Fi too weak or app closed), stopped. Signal %d dBm\n", millis() - lastDrive, WiFi.RSSI());
  }
  handleWifiChange();
  if (apMode && staConnectedAt && WiFi.status() == WL_CONNECTED && millis() - staConnectedAt > 90000) {
    WiFi.softAPdisconnect(true);
    WiFi.mode(WIFI_STA);
    apMode = false;
    Serial.println("Hotspot off; running on your Wi-Fi.");
  }
  if (!apMode && WiFi.status() != WL_CONNECTED) {
    drive(0, 0);
    static unsigned long lastTry = 0;
    if (millis() - lastTry > 5000) { lastTry = millis(); WiFi.reconnect(); }
  }
  delay(20);
}

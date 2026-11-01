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
       /status      JSON: ip, signal, motors, uptime, sensors (distance mm, heading)
       /turn?deg=..&speed=..   exact turn with the gyro (needs the MPU-6050), runs by itself, see "turning" in /status
       /safety?mm=..   stop distance in front (needs the VL53L0X; 0 = off, default 150)
       /setup       Wi-Fi setup page
       /settings    all car settings as JSON; /settings?set=<key>&v=<number> (or &s=<text>) changes one after checking it,
                    saved in the car (survives restarts and firmware updates); ?reset=1 back to factory, ?restart=1
       /diag        self-test as JSON: camera, I2C devices, laser, gyro, memory, Wi-Fi, last restart reason;
                    /diag?motors=1 also spins each side for 0.6 s and measures the turn with the gyro
  - Live video (MJPEG) on port 81:  http://<car-ip>:81/stream
  - Safety: motors stop if no /drive command arrives for 600 ms.
  - Optional sensors on the free pins RXD (GPIO 3) = SDA and TXD (GPIO 1) = SCL, powered from 3V3:
       VL53L0X laser distance sensor  -> the car refuses to drive forward closer than 15 cm to anything
       MPU-6050 (GY-521) gyro         -> exact turns (/turn) and the heading in /status
    Or (sensor mode "ir", set from Muse Carpathron or /config?sensors=ir): two IR obstacle modules ("Avoid", active LOW)
    on RXD = front-left and TXD = front-right — the car refuses to drive forward while one of them sees something.
    They are found by themselves at start. While they are connected the USB Serial Monitor is off (the same pins);
    without them everything works as before. The VL53L0X driver is Pololu's (MIT), included in this folder.

  Arduino IDE setup (same as the kit tutorial)
  - Board package "esp32" by Espressif: works with 2.0.12 (kit) and 3.x.
  - Tools > Board > ESP32 Dev Module (kit instructions). If you see "Camera init failed",
    pick Tools > Board > "AI Thinker ESP32-CAM" instead, or set Tools > PSRAM > Enabled.
  - No extra libraries and NO editing needed: just Upload.
  - Then set up Wi-Fi from the phone (see above). Muse Carpathron > Robot > "Find my car" finds its IP.
*/

#define FW_VERSION "2.2.0"   // Muse Carpathron compares this with its bundled firmware ("Update car firmware")
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
#include <Wire.h>
#include "VL53L0X.h"
#include <Update.h>
#include "esp_ota_ops.h"
// Wi-Fi updates (OTA): Muse Carpathron writes ota_key.h (a random key, kept on this PC) next to the sketch when it
// builds the firmware, so only that PC can update the car over Wi-Fi. Without the file, OTA is switched off.
#if __has_include("ota_key.h")
#include "ota_key.h"
#endif
#ifndef OTA_KEY
#define OTA_KEY ""
#endif

// ---------------------------------------------------------------- Wi-Fi
// Optional: you may type your Wi-Fi here instead of using the /setup page.
const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";
Preferences prefs;
String savedSsid, savedPass;
volatile bool wifiChangeRequested = false;
unsigned long staConnectedAt = 0;
// fallback hotspot made by the car when your Wi-Fi is not reachable
String apSsid = "Carpathron-Car";        // changeable in /settings (apSsid, apPass)
String apPass = "carpathron";            // at least 8 characters
String robotName = "Baby Carpathron";

// ---------------------------------------------------------------- settings (saved in the car: /settings)
// Every value that used to be a constant in this file. Numbers only (0/1 for on/off); limits are checked here,
// so a wrong value can never be saved. "restart" = applied at the next start (pins, PWM frequency, laser timing).
struct Setting { const char* key; int def, lo, hi; bool restart; };
enum { S_REN, S_RFWD, S_RBACK, S_LEN, S_LFWD, S_LBACK, S_INVL, S_INVR, S_SWAP, S_PWMHZ, S_MINDUTY, S_MAXPCT, S_TRIM,
       S_FAILMS, S_STOPMM, S_TURNSPD, S_VFLIP, S_HMIRROR, S_FRAME, S_SQUAL, S_PQUAL, S_BRIGHT, S_CONTR, S_SATUR, S_WB, S_AE,
       S_SDA, S_SCL, S_TOFBUD, S_TOFOFF, S_GSCALE, S_LEDMAX, S_COUNT };
static const Setting SETTINGS[S_COUNT] = {
  { "rEn", 12, 0, 39, true },  { "rFwd", 13, 0, 39, true }, { "rBack", 14, 0, 39, true },      // right wheels (L298N ENA, IN1, IN2)
  { "lEn", 2, 0, 39, true },   { "lFwd", 15, 0, 39, true }, { "lBack", 33, 0, 39, true },      // left wheels (ENB, IN3, IN4)
  { "invL", 0, 0, 1, false },  { "invR", 0, 0, 1, false },  { "swap", 0, 0, 1, false },        // wrong direction / sides swapped
  { "pwmHz", 1000, 100, 20000, true },                                                          // motor PWM frequency
  { "minDuty", 150, 0, 255, false },                                                            // lowest power that still moves the wheels
  { "maxPct", 100, 20, 100, false },                                                            // top speed limit in %
  { "trim", 0, -25, 25, false },                                                                // + = more power left (car pulls left = raise)
  { "failMs", 2500, 300, 10000, false },                                                        // stop when no command arrives for this long
  { "stopMm", 150, 0, 1000, false },                                                            // laser: stop this close to obstacles (0 = off)
  { "turnSpd", 70, 50, 100, false },                                                            // gyro turn speed
  { "vflip", 1, 0, 1, false }, { "hmirror", 1, 0, 1, false },                                   // camera picture orientation
  { "frame", 2, 0, 4, false },                                                                  // picture size: 0 QVGA 320x240 · 1 HVGA 480x320 · 2 VGA 640x480 · 3 SVGA 800x600 · 4 XGA 1024x768
  { "sQual", 16, 6, 40, false }, { "pQual", 10, 4, 40, false },                                 // JPEG quality: lower = sharper, bigger
  { "bright", 0, -2, 2, false }, { "contr", 0, -2, 2, false }, { "satur", 0, -2, 2, false },
  { "wb", 0, 0, 4, false },                                                                     // white balance: 0 auto 1 sunny 2 cloudy 3 office 4 home
  { "ae", 0, -2, 2, false },                                                                    // exposure correction
  { "sda", 3, 0, 39, true }, { "scl", 1, 0, 39, true },                                         // I2C pins for the laser + gyro
  { "tofBud", 33, 20, 200, true },                                                              // laser measuring time in ms (longer = steadier)
  { "tofOff", 0, -100, 100, false },                                                            // laser offset in mm (subtracted)
  { "gScale", 1000, 900, 1100, false },                                                         // gyro scale in 1/1000 (1000 = as measured)
  { "ledMax", 255, 0, 255, false },                                                             // headlight brightness limit
};
int cfgv[S_COUNT];    // in use now
int savedv[S_COUNT];  // stored (pin and other restart settings take effect after a restart)
#define CFG(i) (cfgv[i])
bool restartPending = false;
// GPIOs of the AI-Thinker ESP32-CAM free for motors / I2C (the camera, PSRAM and flash use the others; 4 = headlight)
const int FREE_PINS[] = { 1, 2, 3, 12, 13, 14, 15, 33 };
static bool isPinSetting(int i) { return i <= S_LBACK || i == S_SDA || i == S_SCL; }
static bool freePin(int p) { for (int f : FREE_PINS) if (f == p) return true; return false; }
// "" = fine, otherwise why the value is refused
String checkSetting(int i, int v, const int* vals = cfgv) {
  const Setting& d = SETTINGS[i];
  if (v < d.lo || v > d.hi) return String(d.key) + " must be " + d.lo + ".." + d.hi;
  if (isPinSetting(i)) {
    if (!freePin(v)) return String("GPIO ") + v + " is not free on the ESP32-CAM (camera, memory, flash or headlight). Free: 1 2 3 12 13 14 15 33";
    for (int j = 0; j < S_COUNT; j++) if (j != i && isPinSetting(j) && vals[j] == v) return String("GPIO ") + v + " is already used by " + SETTINGS[j].key;
  }
  return "";
}
void loadSettings() {
  Preferences c; c.begin("cfg", true);
  for (int i = 0; i < S_COUNT; i++) { int v = c.getInt(SETTINGS[i].key, SETTINGS[i].def); cfgv[i] = (v < SETTINGS[i].lo || v > SETTINGS[i].hi) ? SETTINGS[i].def : v; }
  robotName = c.getString("name", robotName); apSsid = c.getString("apSsid", apSsid); apPass = c.getString("apPass", apPass);
  c.end();
  // a broken pin set (duplicates, camera pins) falls back to the kit wiring
  bool bad = false;
  for (int i = 0; i < S_COUNT && !bad; i++) if (isPinSetting(i)) { int v = cfgv[i]; cfgv[i] = -1; if (checkSetting(i, v).length()) bad = true; cfgv[i] = v; }
  if (bad) { for (int i = 0; i < S_COUNT; i++) if (isPinSetting(i)) cfgv[i] = SETTINGS[i].def; Serial.println("[settings] pin settings were invalid: using the kit wiring"); }
  if (apPass.length() < 8) apPass = "carpathron";
  memcpy(savedv, cfgv, sizeof(cfgv));
}

// ---------------------------------------------------------------- motor pins (from the kit tutorial, L298N)
// Right wheels: ENA=12 (speed), IN1=13 (forward), IN2=14 (backward)
// Left wheels : ENB=2  (speed), IN3=15 (forward), IN4=33 (backward)
#define R_EN (cfgv[S_REN])
#define R_FWD (cfgv[S_RFWD])
#define R_BACK (cfgv[S_RBACK])
#define L_EN (cfgv[S_LEN])
#define L_FWD (cfgv[S_LFWD])
#define L_BACK (cfgv[S_LBACK])
const int LED_PIN = 4;   // white headlight on the ESP32-CAM

// If a side spins the wrong way, set it to true. If left/right are swapped, set SWAP_SIDES.
#define INVERT_LEFT (cfgv[S_INVL])
#define INVERT_RIGHT (cfgv[S_INVR])
#define SWAP_SIDES (cfgv[S_SWAP])

// Camera picture orientation (kit FAQ: ESP32-CAM-V0.3 boards need VFLIP 0)
#define CAM_VFLIP (cfgv[S_VFLIP])
#define CAM_HMIRROR (cfgv[S_HMIRROR])

// PWM (LEDC). Channel 0 / timer 0 is used by the camera clock, so motors use 2 and 4, LED uses 7.
#define PWM_FREQ (cfgv[S_PWMHZ])
const int PWM_BITS = 8;   // 1 kHz like the kit (analogWrite): the L298N gives the motors more power at low PWM frequency
const int CH_R = 2, CH_L = 4, CH_LED = 7;
// PWM helpers that work with both the 2.x (kit) and 3.x ESP32 board packages
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  #define PWM_ATTACH(pin, ch) ledcAttachChannel((pin), PWM_FREQ, PWM_BITS, (ch))
  #define PWM_WRITE(pin, ch, duty) ledcWrite((pin), (duty))
#else
  #define PWM_ATTACH(pin, ch) do { ledcSetup((ch), PWM_FREQ, PWM_BITS); ledcAttachPin((pin), (ch)); } while (0)
  #define PWM_WRITE(pin, ch, duty) ledcWrite((ch), (duty))
#endif
#define MIN_DUTY (cfgv[S_MINDUTY])             // below this TT motors only hum; 150..255 keeps even slow speeds strong
#define STREAM_QUALITY (cfgv[S_SQUAL])
#define PHOTO_QUALITY (cfgv[S_PQUAL])  // JPEG quality: lower number = sharper and bigger
#define FAILSAFE_MS ((unsigned long)cfgv[S_FAILMS])  // like the kit: a press keeps the car moving until stop; this only catches a lost link (app closed, Wi-Fi gone)

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
// optional sensors (I2C on the serial pins)
#define I2C_SDA (cfgv[S_SDA])            // default RXD (3), TXD (1) on the ESP32-CAM board
#define I2C_SCL (cfgv[S_SCL])
const uint8_t MPU_ADDR = 0x68;
bool tofOk = false, imuOk = false;
bool irOk = false;                        // sensor mode "ir": IR obstacle modules on RXD (left) / TXD (right)
volatile bool irLeft = false, irRight = false;
String sensorMode = "auto";               // "auto" = look for I2C sensors, "ir" = IR obstacle modules, "off"
VL53L0X tof;
volatile int distMm = -1;                // -1 = nothing in range / no sensor
volatile int safetyMm = 150;             // refuse to drive forward when something is closer (0 = off); starts at setting stopMm
volatile bool blocked = false;           // the last forward command was refused / stopped by the distance sensor
volatile float yawDeg = 0;               // heading from the gyro, + = right (clockwise seen from above)
float gyroBias = 0;
volatile float lastDps = 0;              // latest gyro rate (deg/s), for the self-test
volatile bool i2cHold = false, i2cIdle = false;   // the self-test pauses the sensor task to use the I2C bus
bool wireOn = false;
int cameraErr = 0, cameraPid = 0;
volatile bool turning = false;
volatile float turnTarget = 0, turnFrom = 0;
volatile int turnSpeed = 70;
volatile unsigned long turnStarted = 0;
volatile int turnResult = 0;             // 1 = reached, 2 = timeout, 3 = cancelled
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

void setLed(int v) { PWM_WRITE(LED_PIN, CH_LED, min(v, CFG(S_LEDMAX))); }

void drive(int l, int r) {
  l = constrain(l, -100, 100);
  r = constrain(r, -100, 100);
  // distance sensor: never drive forward into something closer than safetyMm (turning and backing up are fine)
  if (l > 0 && r > 0 && ((tofOk && safetyMm > 0 && distMm > 0 && distMm < safetyMm) || (irOk && (irLeft || irRight)))) { l = 0; r = 0; blocked = true; }
  else if (l > 0 || r > 0) blocked = false;
  curL = l; curR = r;
  if (l && r && ((l > 0) == (r > 0))) { l = l * (100 + CFG(S_TRIM)) / 100; r = r * (100 - CFG(S_TRIM)) / 100; }  // straight-driving trim
  l = constrain(l * CFG(S_MAXPCT) / 100, -100, 100); r = constrain(r * CFG(S_MAXPCT) / 100, -100, 100);
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
// ---------------------------------------------------------------- sensors (optional)
static void mpuWrite(uint8_t reg, uint8_t v) { Wire.beginTransmission(MPU_ADDR); Wire.write(reg); Wire.write(v); Wire.endTransmission(); }
static int16_t mpuGyroZ() {
  Wire.beginTransmission(MPU_ADDR); Wire.write(0x47); if (Wire.endTransmission(false) != 0) return 0;
  if (Wire.requestFrom((int)MPU_ADDR, 2) != 2) return 0;
  return (int16_t)((Wire.read() << 8) | Wire.read());
}
static bool i2cPresent(uint8_t addr) { Wire.beginTransmission(addr); return Wire.endTransmission() == 0; }

// Looks for the sensors on RXD/TXD. Only when one answers do the pins stay I2C (the USB Serial Monitor then stops).
static bool serialPins() { return I2C_SDA == 1 || I2C_SDA == 3 || I2C_SCL == 1 || I2C_SCL == 3; }
bool initSensors() {
  { Preferences sp; sp.begin("carpathron", true); sensorMode = sp.getString("sensors", "auto"); sp.end(); }
  if (sensorMode == "off") { Serial.println("Sensors switched off (sensor mode off)."); return false; }
  if (sensorMode == "ir") {
    Serial.println("Sensor mode ir: IR obstacle modules on the I2C pins (SDA = front-left, SCL = front-right).");
    if (serialPins()) { Serial.println("The Serial Monitor stops now (same pins)."); Serial.flush(); delay(50); Serial.end(); }
    pinMode(I2C_SDA, INPUT_PULLUP); pinMode(I2C_SCL, INPUT_PULLUP);
    irOk = true;
    return true;
  }
  Serial.printf("Looking for sensors on GPIO %d / %d (VL53L0X distance, MPU-6050 gyro)...%s\n", I2C_SDA, I2C_SCL, serialPins() ? " the Serial Monitor pauses for a moment." : "");
  Serial.flush(); delay(50);
  if (serialPins()) Serial.end();
  Wire.begin(I2C_SDA, I2C_SCL, 400000);
  Wire.setTimeOut(20);
  bool tofHere = i2cPresent(0x29), imuHere = i2cPresent(MPU_ADDR);
  if (!tofHere && !imuHere) { Wire.end(); if (serialPins()) Serial.begin(115200); Serial.println("No sensors found: Serial Monitor stays on."); return false; }
  wireOn = true;
  if (imuHere) {
    mpuWrite(0x6B, 0x00);      // wake up
    mpuWrite(0x1A, 0x03);      // low-pass filter ~44 Hz
    mpuWrite(0x1B, 0x08);      // gyro ±500 °/s (65.5 per °/s)
    delay(100);
    long sum = 0;              // the car must stand still: measure the gyro's zero
    for (int i = 0; i < 300; i++) { sum += mpuGyroZ(); delay(3); }
    gyroBias = sum / 300.0f;
    imuOk = true;
  }
  if (tofHere) {
    tof.setBus(&Wire);
    tof.setTimeout(100);
    if (tof.init()) { tof.setMeasurementTimingBudget((uint32_t)CFG(S_TOFBUD) * 1000); tof.startContinuous(); tofOk = true; }
  }
  return tofOk || imuOk;
}

// 200 Hz: integrate the gyro, read the distance when a new value is ready, run gyro turns, stop before obstacles.
static void sensorTask(void*) {
  unsigned long last = micros();
  for (;;) {
    if (i2cHold) { i2cIdle = true; vTaskDelay(pdMS_TO_TICKS(5)); last = micros(); continue; }
    i2cIdle = false;
    unsigned long now = micros();
    float dt = (now - last) / 1e6f; last = now;
    if (imuOk) {
      float dps = (mpuGyroZ() - gyroBias) / 65.5f * CFG(S_GSCALE) / 1000.0f;
      lastDps = dps;
      if (fabsf(dps) > 0.4f) yawDeg -= dps * dt;     // MPU-6050 Z up: positive = counter-clockwise → our + = right
    }
    if (irOk) {
      irLeft = digitalRead(I2C_SDA) == LOW; irRight = digitalRead(I2C_SCL) == LOW;   // "Avoid" modules pull LOW on an obstacle
      if (curL > 0 && curR > 0 && (irLeft || irRight)) { drive(0, 0); blocked = true; }
    }
    if (tofOk && (tof.readReg(VL53L0X::RESULT_INTERRUPT_STATUS) & 0x07)) {
      uint16_t mm = tof.readReg16Bit(VL53L0X::RESULT_RANGE_STATUS + 10);
      tof.writeReg(VL53L0X::SYSTEM_INTERRUPT_CLEAR, 0x01);
      distMm = (mm == 0 || mm >= 2000) ? -1 : max(1, (int)mm - CFG(S_TOFOFF));
      if (curL > 0 && curR > 0 && safetyMm > 0 && distMm > 0 && distMm < safetyMm) { drive(0, 0); blocked = true; }
    }
    if (turning) {
      float done = yawDeg - turnFrom, left = turnTarget - done;
      if (fabsf(left) <= 2.0f) { drive(0, 0); turning = false; turnResult = 1; }
      else if (millis() - turnStarted > 8000) { drive(0, 0); turning = false; turnResult = 2; }
      else {
        int sp = fabsf(left) < 25 ? max(55, turnSpeed - 20) : turnSpeed;   // slow down near the end
        if (left > 0) drive(sp, -sp); else drive(-sp, sp);
        lastDrive = millis();                       // the failsafe must not stop a running turn
      }
    }
    vTaskDelay(pdMS_TO_TICKS(5));
  }
}

static void startTurn(float deg, int speed) {
  turnFrom = yawDeg; turnTarget = deg; turnSpeed = constrain(speed, 50, 100);
  turnStarted = millis(); turnResult = 0; turning = true;
}

void applyCamera();
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
    cameraErr = err;
    Serial.printf("Camera init failed with error 0x%x (driving still works)\n", err);
    return false;
  }
  sensor_t* s = esp_camera_sensor_get();
  cameraPid = s->id.PID;
  applyCamera();
  return true;
}
// camera settings from /settings: picture size (VGA 640x480 by default: good for photos to the AI and smooth streaming),
// stream quality (smaller frames for weak Wi-Fi; /capture switches to the sharper photo quality), orientation, image
void applyCamera() {
  sensor_t* s = esp_camera_sensor_get();
  if (!s) return;
  // by name: the numbers behind framesize_t differ between camera driver versions
  static const framesize_t SIZES[] = { FRAMESIZE_QVGA, FRAMESIZE_HVGA, FRAMESIZE_VGA, FRAMESIZE_SVGA, FRAMESIZE_XGA };
  s->set_framesize(s, SIZES[constrain(CFG(S_FRAME), 0, 4)]);
  s->set_quality(s, STREAM_QUALITY);
  s->set_vflip(s, CAM_VFLIP);
  s->set_hmirror(s, CAM_HMIRROR);
  s->set_brightness(s, CFG(S_BRIGHT));
  s->set_contrast(s, CFG(S_CONTR));
  s->set_saturation(s, CFG(S_SATUR));
  s->set_whitebal(s, 1);
  s->set_awb_gain(s, 1);
  s->set_wb_mode(s, CFG(S_WB));
  s->set_ae_level(s, CFG(S_AE));
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
  if (turning) { if (!l && !r) return send_text(req, "text/plain", "turning"); turning = false; turnResult = 3; }
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
  if (buf[0] == 's') { if (turning) { turning = false; turnResult = 3; } if (curL || curR) Serial.println("[drive] stop"); drive(0, 0); lastDrive = millis(); }
  else if (sscanf((const char*)buf, "%d,%d", &l, &rr) == 2) {
    if (turning) { if (!l && !rr) return ESP_OK; turning = false; turnResult = 3; }
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
  if (turning) { turning = false; turnResult = 3; }
  drive(0, 0);
  return send_text(req, "text/plain", "stopped");
}

static esp_err_t led_handler(httpd_req_t* req) {
  int v = constrain(queryInt(req, "v", 0), 0, 255);
  setLed(v);
  return send_text(req, "text/plain", "ok");
}

static esp_err_t turn_handler(httpd_req_t* req) {
  if (!imuOk) return send_text(req, "application/json", "{\"ok\":false,\"error\":\"no gyro (MPU-6050) found\"}");
  int deg = constrain(queryInt(req, "deg", 0), -720, 720), sp = queryInt(req, "speed", CFG(S_TURNSPD));
  if (!deg) return send_text(req, "application/json", "{\"ok\":true,\"turning\":false}");
  startTurn(deg, sp); lastDrive = millis();
  return send_text(req, "application/json", "{\"ok\":true,\"turning\":true}");
}

static esp_err_t safety_handler(httpd_req_t* req) {
  safetyMm = constrain(queryInt(req, "mm", safetyMm), 0, 1000);
  char b[64]; snprintf(b, sizeof(b), "{\"ok\":true,\"stopMm\":%d}", (int)safetyMm);
  return send_text(req, "application/json", b);
}

// Sensor mode: /config?sensors=auto|ir|off — saved in the car, it restarts to apply it
static esp_err_t config_handler(httpd_req_t* req) {
  char q[64], v[12] = "";
  if (httpd_req_get_url_query_str(req, q, sizeof(q)) == ESP_OK) httpd_query_key_value(q, "sensors", v, sizeof(v));
  String m = String(v);
  if (m != "auto" && m != "ir" && m != "off") {
    char b[96]; snprintf(b, sizeof(b), "{\"ok\":true,\"sensors\":\"%s\"}", sensorMode.c_str());
    return send_text(req, "application/json", b);
  }
  { Preferences sp; sp.begin("carpathron", false); sp.putString("sensors", m); sp.end(); }
  send_text(req, "application/json", "{\"ok\":true,\"restarting\":true}");
  delay(400); ESP.restart();
  return ESP_OK;
}

static esp_err_t status_handler(httpd_req_t* req) {
  char json[860];
  bool sta = WiFi.status() == WL_CONNECTED;
  snprintf(json, sizeof(json),
           "{\"name\":\"%s\",\"fw\":\"" FW_VERSION "\",\"restartPending\":%s,\"ip\":\"%s\",\"mode\":\"%s\",\"wifi\":\"%s\",\"wifiIp\":\"%s\",\"connecting\":%s,\"rssi\":%d,\"left\":%d,\"right\":%d,\"camera\":%s,\"psram\":%s,\"uptime\":%lu,"
           "\"sensors\":{\"mode\":\"%s\",\"ir\":%s,\"irLeft\":%s,\"irRight\":%s,\"tof\":%s,\"imu\":%s,\"dist\":%d,\"stopMm\":%d,\"blocked\":%s,\"yaw\":%.1f,\"turning\":%s,\"turnResult\":%d}}",
           robotName.c_str(), restartPending ? "true" : "false", (sta ? WiFi.localIP() : WiFi.softAPIP()).toString().c_str(), apMode ? "hotspot" : "wifi", savedSsid.c_str(),
           sta ? WiFi.localIP().toString().c_str() : "", wifiChangeRequested ? "true" : "false", sta ? WiFi.RSSI() : 0, curL, curR,
           cameraOk ? "true" : "false", psramFound() ? "true" : "false", millis() / 1000,
           sensorMode.c_str(), irOk ? "true" : "false", irLeft ? "true" : "false", irRight ? "true" : "false",
           tofOk ? "true" : "false", imuOk ? "true" : "false", (int)distMm, (int)safetyMm, blocked ? "true" : "false", (float)yawDeg,
           turning ? "true" : "false", (int)turnResult);
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

static String urlDecode(const char* s);
// ---------------------------------------------------------------- /settings: every car setting, checked and saved in the car
static String jsonStr(const String& v) {
  String o = "\"";
  for (unsigned i = 0; i < v.length(); i++) { char c = v[i]; if (c == '"' || c == '\\') o += '\\'; if ((uint8_t)c >= 0x20) o += c; }
  return o + "\"";
}
static String settingsJson(const char* extra) {
  String j = "{\"fw\":\"" FW_VERSION "\",\"board\":\"esp32cam\",\"values\":{";
  for (int i = 0; i < S_COUNT; i++) { if (i) j += ","; j += "\""; j += SETTINGS[i].key; j += "\":"; j += savedv[i]; }
  j += "},\"active\":{";  // values in use now, where they differ (until the restart)
  bool first = true;
  for (int i = 0; i < S_COUNT; i++) if (cfgv[i] != savedv[i]) { if (!first) j += ","; first = false; j += "\""; j += SETTINGS[i].key; j += "\":"; j += cfgv[i]; }
  j += "},\"strings\":{\"name\":" + jsonStr(robotName) + ",\"apSsid\":" + jsonStr(apSsid) + "},\"restartPending\":";
  j += restartPending ? "true" : "false";
  j += extra;
  return j + "}";
}
static esp_err_t settings_handler(httpd_req_t* req) {
  char q[400], key[16] = "", v[300] = "";
  String extra = "";
  if (httpd_req_get_url_query_str(req, q, sizeof(q)) == ESP_OK) {
    if (httpd_query_key_value(q, "restart", v, sizeof(v)) == ESP_OK) { send_text(req, "application/json", "{\"ok\":true,\"restarting\":true}"); drive(0, 0); delay(400); ESP.restart(); }
    if (httpd_query_key_value(q, "reset", v, sizeof(v)) == ESP_OK) {
      Preferences c; c.begin("cfg", false); c.clear(); c.end();
      send_text(req, "application/json", "{\"ok\":true,\"restarting\":true}"); drive(0, 0); delay(400); ESP.restart();
    }
    if (httpd_query_key_value(q, "many", v, sizeof(v)) == ESP_OK) {
      int tmp[S_COUNT]; memcpy(tmp, savedv, sizeof(tmp));
      bool touched[S_COUNT] = {}; String err; char* save = nullptr;
      for (char* tok = strtok_r(v, ",", &save); tok && !err.length(); tok = strtok_r(nullptr, ",", &save)) {
        char* c = strchr(tok, ':'); if (!c) { err = "use many=key:value,key:value"; break; }
        *c = 0; int i = 0; while (i < S_COUNT && strcmp(SETTINGS[i].key, tok)) i++;
        if (i == S_COUNT) err = String("unknown setting ") + tok; else { tmp[i] = atoi(c + 1); touched[i] = true; }
      }
      for (int i = 0; i < S_COUNT && !err.length(); i++) if (touched[i]) err = checkSetting(i, tmp[i], tmp);
      if (err.length()) return send_text(req, "application/json", ("{\"ok\":false,\"error\":" + jsonStr(err) + "}").c_str());
      bool restart = false; Preferences c; c.begin("cfg", false);
      for (int i = 0; i < S_COUNT; i++) if (touched[i]) {
        c.putInt(SETTINGS[i].key, tmp[i]); savedv[i] = tmp[i];
        if (SETTINGS[i].restart) restart = restartPending = true; else cfgv[i] = tmp[i];
      }
      c.end();
      safetyMm = CFG(S_STOPMM); if (cameraOk) applyCamera(); drive(curL, curR);
      extra = String(",\"ok\":true,\"needsRestart\":") + (restart ? "true" : "false");
    }
    if (httpd_query_key_value(q, "set", key, sizeof(key)) == ESP_OK) {
      String err; bool restart = false;
      if (!strcmp(key, "name") || !strcmp(key, "apSsid") || !strcmp(key, "apPass")) {
        String val = httpd_query_key_value(q, "s", v, sizeof(v)) == ESP_OK ? urlDecode(v) : "";
        val.trim();
        if (!strcmp(key, "apPass") && (val.length() < 8 || val.length() > 63)) err = "the hotspot password needs 8 to 63 characters";
        else if (!val.length() || val.length() > 31) err = "use 1 to 31 characters";
        else {
          Preferences c; c.begin("cfg", false); c.putString(key, val); c.end();
          if (!strcmp(key, "name")) robotName = val; else restart = restartPending = true;
        }
      } else {
        int i = 0; while (i < S_COUNT && strcmp(SETTINGS[i].key, key)) i++;
        if (i == S_COUNT) err = String("unknown setting ") + key;
        else if (httpd_query_key_value(q, "v", v, sizeof(v)) != ESP_OK) err = "missing v=<number>";
        else {
          int val = atoi(v); err = checkSetting(i, val, savedv);
          if (!err.length()) {
            Preferences c; c.begin("cfg", false); c.putInt(SETTINGS[i].key, val); c.end();
            savedv[i] = val;
            if (SETTINGS[i].restart) { restart = restartPending = true; }
            else {
              cfgv[i] = val;
              if (i == S_STOPMM) safetyMm = val;
              if (i >= S_VFLIP && i <= S_AE && cameraOk) applyCamera();
              if (i == S_LEDMAX) setLed(0);
              if (i <= S_TRIM) drive(curL, curR);
            }
            Serial.printf("[settings] %s = %d%s\n", key, val, SETTINGS[i].restart ? " (after restart)" : "");
          }
        }
      }
      if (err.length()) return send_text(req, "application/json", ("{\"ok\":false,\"error\":" + jsonStr(err) + "}").c_str());
      extra = String(",\"ok\":true,\"changed\":") + jsonStr(key) + ",\"needsRestart\":" + (restart ? "true" : "false");
    }
  }
  return send_text(req, "application/json", settingsJson(extra.c_str()).c_str());
}

// ---------------------------------------------------------------- /diag: the car tests itself
static const char* resetName(int r) {
  switch (r) {
    case ESP_RST_POWERON: return "power-on"; case ESP_RST_EXT: return "reset-pin"; case ESP_RST_SW: return "software";
    case ESP_RST_PANIC: return "crash"; case ESP_RST_INT_WDT: case ESP_RST_TASK_WDT: case ESP_RST_WDT: return "watchdog";
    case ESP_RST_DEEPSLEEP: return "deep-sleep"; case ESP_RST_BROWNOUT: return "brownout"; default: return "other";
  }
}
static String motorProbe(char side) {
  if (!imuOk) return "null";
  float y0 = yawDeg; int d0 = distMm;
  // 'l' / 'r' = one side forward (the car should pivot right / left); 'b' = both forward briefly (closer to the wall)
  drive(side != 'r' ? 70 : 0, side != 'l' ? 70 : 0); lastDrive = millis();
  delay(side == 'b' ? 350 : 600);
  drive(0, 0);
  delay(350);
  char b[80]; snprintf(b, sizeof(b), "{\"turnDeg\":%.1f,\"distBefore\":%d,\"distAfter\":%d}", (float)(yawDeg - y0), d0, (int)distMm);
  return b;
}
// ---------------------------------------------------------------- /ota: firmware over Wi-Fi, and "undo" (boot the previous one)
// GET /ota → what is possible. POST /ota (body = the .bin, header X-OTA-Key) → write it to the other app slot, restart.
// GET /ota?rollback=1 (header X-OTA-Key) → restart into the firmware that was on the car before the last update.
static bool otaKeyOk(httpd_req_t* req) {
  if (!strlen(OTA_KEY)) return false;
  char k[72] = "";
  if (httpd_req_get_hdr_value_str(req, "X-OTA-Key", k, sizeof(k)) != ESP_OK) return false;
  return strcmp(k, OTA_KEY) == 0;
}
static String slotInfo(const esp_partition_t* p) {
  if (!p) return "null";
  esp_app_desc_t d;
  bool valid = esp_ota_get_partition_description(p, &d) == ESP_OK;
  return String("{\"label\":\"") + p->label + "\",\"valid\":" + (valid ? "true" : "false") + (valid ? String(",\"built\":\"") + d.date + " " + d.time + "\"" : "") + "}";
}
static esp_err_t ota_handler(httpd_req_t* req) {
  const esp_partition_t* next = esp_ota_get_next_update_partition(NULL);
  if (req->method == HTTP_GET) {
    char q[32], v[4];
    if (httpd_req_get_url_query_str(req, q, sizeof(q)) == ESP_OK && httpd_query_key_value(q, "rollback", v, sizeof(v)) == ESP_OK) {
      if (!otaKeyOk(req)) { httpd_resp_set_status(req, "403 Forbidden"); return send_text(req, "application/json", "{\"ok\":false,\"error\":\"wrong or missing OTA key\"}"); }
      esp_app_desc_t d;
      if (!next || esp_ota_get_partition_description(next, &d) != ESP_OK) return send_text(req, "application/json", "{\"ok\":false,\"error\":\"there is no previous firmware on the car\"}");
      if (esp_ota_set_boot_partition(next) != ESP_OK) return send_text(req, "application/json", "{\"ok\":false,\"error\":\"could not switch\"}");
      send_text(req, "application/json", "{\"ok\":true,\"restarting\":true}");
      drive(0, 0); delay(400); ESP.restart();
    }
    String j = String("{\"fw\":\"" FW_VERSION "\",\"ota\":") + (next ? "true" : "false") + ",\"keySet\":" + (strlen(OTA_KEY) ? "true" : "false") +
               ",\"running\":" + slotInfo(esp_ota_get_running_partition()) + ",\"other\":" + slotInfo(next) + "}";
    return send_text(req, "application/json", j.c_str());
  }
  if (!otaKeyOk(req)) { httpd_resp_set_status(req, "403 Forbidden"); return send_text(req, "application/json", "{\"ok\":false,\"error\":\"wrong or missing OTA key: update once over USB from this PC\"}"); }
  if (!next) return send_text(req, "application/json", "{\"ok\":false,\"error\":\"this firmware was flashed without OTA space: update once over USB from Muse Carpathron\"}");
  int left = req->content_len;
  if (left <= 0 || (size_t)left > next->size) return send_text(req, "application/json", "{\"ok\":false,\"error\":\"the firmware file is empty or too big\"}");
  drive(0, 0); turning = false;
  if (!Update.begin(left)) return send_text(req, "application/json", "{\"ok\":false,\"error\":\"could not start the update\"}");
  Serial.printf("[ota] receiving %d bytes\n", left);
  static uint8_t buf[4096];
  int tries = 0;
  while (left > 0) {
    int n = httpd_req_recv(req, (char*)buf, left < (int)sizeof(buf) ? left : sizeof(buf));
    if (n == HTTPD_SOCK_ERR_TIMEOUT && ++tries < 5) continue;
    if (n <= 0) { Update.abort(); return send_text(req, "application/json", "{\"ok\":false,\"error\":\"the upload stopped\"}"); }
    tries = 0;
    if (Update.write(buf, n) != (size_t)n) { Update.abort(); return send_text(req, "application/json", "{\"ok\":false,\"error\":\"writing failed\"}"); }
    left -= n;
    lastDrive = millis();
  }
  if (!Update.end(true)) { String e = String("{\"ok\":false,\"error\":\"the firmware file is damaged (") + Update.errorString() + ")\"}"; return send_text(req, "application/json", e.c_str()); }
  Serial.println("[ota] done, restarting");
  send_text(req, "application/json", "{\"ok\":true,\"restarting\":true}");
  delay(500); ESP.restart();
  return ESP_OK;
}

static esp_err_t diag_handler(httpd_req_t* req) {
  bool motors = queryInt(req, "motors", 0) == 1;
  String j = "{\"fw\":\"" FW_VERSION "\",\"uptime\":" + String(millis() / 1000);
  int rr = (int)esp_reset_reason();
  j += ",\"reset\":{\"code\":" + String(rr) + ",\"name\":\"" + resetName(rr) + "\",\"brownoutDetector\":false}";
  j += ",\"memory\":{\"heapFree\":" + String(ESP.getFreeHeap()) + ",\"psram\":" + (psramFound() ? "true" : "false") + ",\"psramFree\":" + String(ESP.getFreePsram()) + "}";
  bool sta = WiFi.status() == WL_CONNECTED;
  j += ",\"wifi\":{\"mode\":\"" + String(apMode ? "hotspot" : "wifi") + "\",\"connected\":" + (sta ? "true" : "false") + ",\"rssi\":" + String(sta ? WiFi.RSSI() : 0) + "}";
  j += ",\"bootFix\":" + String(flashFuseSet() ? "true" : "false");
  // camera: start-up error, sensor id, frames per second
  float fps = 0;
  if (cameraOk) {
    unsigned long t0 = millis(); int n = 0;
    for (int i = 0; i < 6; i++) { camera_fb_t* fb = esp_camera_fb_get(); if (fb) { n++; esp_camera_fb_return(fb); } }
    unsigned long dt = millis() - t0; fps = dt ? n * 1000.0f / dt : 0;
  }
  char cb[120]; snprintf(cb, sizeof(cb), ",\"camera\":{\"ok\":%s,\"error\":%d,\"pid\":%d,\"fps\":%.1f}", cameraOk ? "true" : "false", cameraErr, cameraPid, fps);
  j += cb;
  // I2C: list every device that answers, read the gyro's WHO_AM_I
  j += ",\"i2c\":{\"sda\":" + String(I2C_SDA) + ",\"scl\":" + String(I2C_SCL) + ",\"mode\":\"" + sensorMode + "\",\"active\":" + (wireOn ? "true" : "false") + ",\"devices\":[";
  int who = -1;
  if (wireOn) {
    i2cHold = true;
    for (int i = 0; i < 40 && !i2cIdle; i++) delay(5);
    bool first = true;
    for (uint8_t a = 1; a < 127; a++) if (i2cPresent(a)) { if (!first) j += ","; j += String(a); first = false; }
    if (i2cPresent(MPU_ADDR)) { Wire.beginTransmission(MPU_ADDR); Wire.write(0x75); if (Wire.endTransmission(false) == 0 && Wire.requestFrom((int)MPU_ADDR, 1) == 1) who = Wire.read(); }
    i2cHold = false;
  }
  j += "]}";
  // laser: 25 readings over 1 s
  int n = 0, none = 0; long sum = 0, sum2 = 0; int lo = 9999, hi = -1;
  if (tofOk) for (int i = 0; i < 25; i++) { int d = distMm; if (d > 0) { n++; sum += d; sum2 += (long)d * d; lo = min(lo, d); hi = max(hi, d); } else none++; delay(40); }
  float mean = n ? (float)sum / n : 0, sd = n > 1 ? sqrtf(max(0.0f, (float)sum2 / n - mean * mean)) : 0;
  char tb[200]; snprintf(tb, sizeof(tb), ",\"tof\":{\"ok\":%s,\"samples\":%d,\"outOfRange\":%d,\"mean\":%.0f,\"sd\":%.1f,\"min\":%d,\"max\":%d,\"stopMm\":%d}",
                         tofOk ? "true" : "false", n, none, mean, sd, n ? lo : -1, hi, (int)safetyMm);
  j += tb;
  // gyro: zero drift and noise while standing still (50 readings, 0.5 s)
  float gs = 0, gs2 = 0; int gn = 0;
  if (imuOk && !curL && !curR) for (int i = 0; i < 50; i++) { float d = lastDps; gs += d; gs2 += d * d; gn++; delay(10); }
  float gm = gn ? gs / gn : 0, gsd = gn > 1 ? sqrtf(max(0.0f, gs2 / gn - gm * gm)) : 0;
  char gb[160]; snprintf(gb, sizeof(gb), ",\"imu\":{\"ok\":%s,\"whoAmI\":%d,\"bias\":%.1f,\"restDps\":%.2f,\"noiseDps\":%.2f,\"yaw\":%.1f}", imuOk ? "true" : "false", who, gyroBias, gm, gsd, (float)yawDeg);
  j += gb;
  j += ",\"ir\":{\"ok\":" + String(irOk ? "true" : "false") + ",\"left\":" + (irLeft ? "true" : "false") + ",\"right\":" + (irRight ? "true" : "false") + "}";
  if (motors) {
    String ml = motorProbe('l'), mr = motorProbe('r');
    j += ",\"motors\":{\"left\":" + ml + ",\"right\":" + mr + ",\"both\":" + (tofOk ? motorProbe('b') : String("null")) + "}";
  }
  j += ",\"pins\":{\"rEn\":" + String(R_EN) + ",\"rFwd\":" + String(R_FWD) + ",\"rBack\":" + String(R_BACK) + ",\"lEn\":" + String(L_EN) + ",\"lFwd\":" + String(L_FWD) + ",\"lBack\":" + String(L_BACK) + ",\"led\":" + String(LED_PIN) + "}}";
  return send_text(req, "application/json", j.c_str());
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
    if (!name.length() || name == apSsid.c_str() || opts.indexOf(">" + htmlEscape(name) + "<") >= 0) continue;  // never offer the car's own hotspot
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
  if (ssid == apSsid.c_str()) return send_text(req, "text/plain", "That is the car's own hotspot. Go back and pick your home Wi-Fi (for example the one your PC uses).");
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
  config.max_uri_handlers = 26;
  config.stack_size = 10240;
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
    { "/turn", HTTP_GET, turn_handler, NULL },
    { "/safety", HTTP_GET, safety_handler, NULL },
    { "/config", HTTP_GET, config_handler, NULL },
    { "/settings", HTTP_GET, settings_handler, NULL },
    { "/diag", HTTP_GET, diag_handler, NULL },
    { "/ota", HTTP_GET, ota_handler, NULL },
    { "/ota", HTTP_POST, ota_handler, NULL },
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
  WiFi.softAP(apSsid.c_str(), apPass.c_str());
  Serial.printf("Hotspot \"%s\" (password %s). Open http://192.168.4.1/setup to choose your Wi-Fi.\n", apSsid.c_str(), apPass.c_str());
}

void startWifi() {
  prefs.begin("carpathron", false);
  savedSsid = prefs.getString("ssid", "");
  if (savedSsid == apSsid.c_str()) { savedSsid = ""; prefs.remove("ssid"); prefs.remove("pass"); }  // old mistake: own hotspot saved as home Wi-Fi
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
      if (!line.length() || line == apSsid.c_str()) { Serial.println("Cancelled (type the name of your home Wi-Fi)."); serialStep = 0; continue; }
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
      for (int i = 0; i < n && i < 20; i++) if (WiFi.SSID(i) != apSsid.c_str()) Serial.printf("  %s  (%d dBm)\n", WiFi.SSID(i).c_str(), WiFi.RSSI(i));
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
  Serial.println("\nBaby Carpathron starting… firmware " FW_VERSION);
  Serial.printf("Reset reason: %d (1=power on, 3=software, 4/5/6=crash/watchdog, 9=low voltage/brownout)\n", (int)esp_reset_reason());
  loadSettings();
  safetyMm = CFG(S_STOPMM);
  initMotors();
  cameraOk = initCamera();
  if (initSensors()) xTaskCreatePinnedToCore(sensorTask, "sensors", 4096, NULL, 3, NULL, 0);
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

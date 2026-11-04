/*
  Baby Carpathron — Arduino Mega 2560 sensor hub
  The Mega reads the sensors and sends them to the car's ESP32-CAM 20 times per second.
  The ESP32 (car firmware 2.3.0 or newer) finds it by itself: exact turns and the obstacle stop then use these readings.

  Wiring (the Mega as it lies with the USB socket at the top right; numbers = the wire numbers in the wiring guide)
    1  ESP32 board 5V  -> Mega 5V   (bottom double row, far right, outer pin)
    2  ESP32 board GND -> Mega GND  (right side, just under AREF)
    3  Mega TX1 18 -> 1 kOhm -> ESP32 RXD,  plus 2 kOhm (two 1 kOhm in a row) from ESP32 RXD to ESP32 GND
    4  ESP32 TXD -> Mega RX1 19
    5-8   HC-SR04: VCC -> 5V (bottom double row, far right, inner pin), Trig -> 22, Echo -> 23, GND -> GND (bottom row, far left)
    9-12  MPU-6050 (GY-521): VCC -> 3.3V, GND -> GND (left side), SCL -> SCL 21, SDA -> SDA 20. Lay it flat.
    13-15 DHT11: S -> A0, + -> 5V (left side), - -> GND (left side)
    PIR HC-SR501 (optional, needs the proto shield for a 5V): OUT -> 25, then set USE_PIR to 1.
  Optional, found by themselves (nothing to set):
    Side eyes: two more HC-SR04 at the front corners, turned 45 deg outwards and low (bumper height):
      left  Trig -> 26, Echo -> 27;  right Trig -> 28, Echo -> 29  (VCC 5V, GND GND)
    Drop sensor (stairs / table edge): an IR line/obstacle module (TCRT5000) at the very front, looking DOWN at the
      floor about 1 cm above it: DO -> 30, VCC -> 5V, GND -> GND. It must light its LED over the floor.

  Upload: Arduino IDE > Tools > Board > Arduino Mega or Mega 2560, pick its port, Upload.
  Before uploading: switch the car off and pull the 5V wire (1), so the PC and the car don't both feed 5V.
  Serial Monitor at 115200 shows every reading twice a second, so you can check each sensor while wiring.

  Link to the ESP32 (Serial1, 115200), one line every 50 ms:
    $CAR,<yaw deg>,<turn rate deg/s>,<distance mm or -1>,<temperature x10>,<humidity %>,<pir 0/1 or -1>,<tilt deg>,<flags>*<XOR checksum hex>
    ...,<flags>,<left mm or -1>,<right mm or -1>,<tilt X deg>,<tilt Y deg>*<checksum>   (hub 1.1: four more fields)
    yaw: + = turning right (clockwise seen from above). flags: 1 gyro, 2 distance sensor, 4 DHT11, 8 bump (a jolt: the car
    hit something), 16 drop (the drop sensor sees no floor), 32 side eyes found, 64 drop sensor found.
    tilt X / Y: signed angles of the board (the car leaning forward/back and sideways); the ESP32 notices steps and edges.
  Hub 1.1: a watchdog restarts the Mega by itself if it ever freezes (for example when the motors pull the 5 V down
  in a crash), the gyro is woken up again if it stops answering, and a short echo dropout close to a wall keeps the
  last distance instead of reporting "nothing there".
  Commands from the ESP32: "$ZERO" sets the heading to 0, "$CAL" measures the gyro zero again (car standing still).
  No extra libraries needed.
*/
#include <Wire.h>
#include <avr/wdt.h>

#define HUB_VERSION "1.1.0"
const uint8_t TRIG_PIN = 22, ECHO_PIN = 23;
const uint8_t DHT_PIN = A0;
const uint8_t PIR_PIN = 25;
#define USE_PIR 0                 // 1 when a PIR motion sensor is wired to pin 25
const uint8_t LED = 13;
const uint8_t TRIG_L = 26, ECHO_L = 27, TRIG_R = 28, ECHO_R = 29, CLIFF_PIN = 30;

uint8_t mpuAddr = 0;              // 0x68 or 0x69, 0 = no gyro found
float gyroBias = 0, yaw = 0, rate = 0, tilt = -1;
int distMm = -1, lastGoodMm = -1; bool sonarSeen = false; unsigned long sonarLastOk = 0;
float accAvg[3] = { 0, 0, 0 }; bool accInit = false; unsigned long bumpUntil = 0, bumps = 0;   // bump = sudden jolt
int sideMm[2] = { -1, -1 }; bool sideSeen = false; uint8_t sonarTurn = 0;
bool cliffSeenFloor = false, cliffNow = false; unsigned long cliffHighSince = 0;
float angX = 0, angY = 0;
uint8_t mpuFails = 0; unsigned long gyroRetry = 0; uint8_t bootReason = 0;
int temp10 = 0, hum = 0; bool dhtOk = false; unsigned long dhtLastOk = 0;
unsigned long lastGyro = 0, lastSonar = 0, lastAccel = 0, lastDht = 0, lastSend = 0, lastPrint = 0;
String cmd;

// ---------------------------------------------------------------- MPU-6050
static bool i2cHere(uint8_t a) { Wire.beginTransmission(a); return Wire.endTransmission() == 0; }
static void mpuWrite(uint8_t reg, uint8_t v) { Wire.beginTransmission(mpuAddr); Wire.write(reg); Wire.write(v); Wire.endTransmission(); }
static bool mpuRead(uint8_t reg, uint8_t n, uint8_t* out) {
  Wire.beginTransmission(mpuAddr); Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(mpuAddr, n) != n) return false;
  for (uint8_t i = 0; i < n; i++) out[i] = Wire.read();
  return true;
}
static bool gyroZ(int16_t& z) { uint8_t b[2]; if (!mpuRead(0x47, 2, b)) { if (mpuFails < 255) mpuFails++; return false; } mpuFails = 0; z = (int16_t)((b[0] << 8) | b[1]); return true; }

static void calibrateGyro() {
  // the car must stand still: average 400 readings; if it moved (big spread), try again
  for (int attempt = 0; attempt < 3; attempt++) {
    long sum = 0; long sum2 = 0; int n = 0;
    for (int i = 0; i < 400; i++) { int16_t z; if (gyroZ(z)) { sum += z; sum2 += (long)z * z; n++; } delay(2); wdt_reset(); }
    if (!n) return;
    float mean = (float)sum / n, var = (float)sum2 / n - mean * mean;
    gyroBias = mean;
    if (var < 400) break;   // about ±0.3 deg/s of noise: it stood still
    Serial.println(F("[gyro] the car moved while measuring the gyro zero, measuring again..."));
  }
  yaw = 0;
}

static void wakeGyro() {
  mpuWrite(0x6B, 0x00);   // wake up
  mpuWrite(0x1A, 0x03);   // low-pass filter ~44 Hz
  mpuWrite(0x1B, 0x08);   // gyro ±500 deg/s (65.5 per deg/s)
  mpuWrite(0x1C, 0x00);   // accel ±2 g
}
// The gyro stopped answering (a dip in the power or a loose wire): wake it up again, keep the heading and the zero.
static void reviveGyro() {
  if (!mpuAddr || mpuFails < 20 || millis() - gyroRetry < 1000) return;
  gyroRetry = millis();
  Wire.end(); Wire.begin(); Wire.setClock(100000);
#if defined(WIRE_HAS_TIMEOUT)
  Wire.setWireTimeout(3000, true);
#endif
  if (i2cHere(mpuAddr)) { wakeGyro(); mpuFails = 0; lastGyro = micros(); Serial.println(F("[gyro] answering again")); }
}

static void initGyro() {
  Wire.begin();
  Wire.setClock(100000);                    // 100 kHz: more tolerant of long jumper wires
#if defined(WIRE_HAS_TIMEOUT)
  Wire.setWireTimeout(3000, true);          // a loose wire must never freeze the hub
#endif
  mpuAddr = i2cHere(0x68) ? 0x68 : (i2cHere(0x69) ? 0x69 : 0);
  if (!mpuAddr) { Serial.println(F("[gyro] MPU-6050 not found: check wires 9-12 (3.3V, GND, SCL 21, SDA 20).")); return; }
  wakeGyro();
  delay(100);
  calibrateGyro();
  Serial.print(F("[gyro] MPU-6050 found at 0x")); Serial.print(mpuAddr, HEX); Serial.print(F(", zero = ")); Serial.println(gyroBias, 1);
}

static void readGyro() {
  unsigned long now = micros();
  float dt = (now - lastGyro) / 1e6f; lastGyro = now;
  if (!mpuAddr || dt > 0.2f) return;
  int16_t z;
  if (!gyroZ(z)) return;
  rate = (z - gyroBias) / 65.5f;
  if (fabs(rate) > 0.4f) yaw -= rate * dt;     // MPU-6050 Z up: positive = counter-clockwise -> our + = right
}

static void readTilt() {
  uint8_t b[6];
  if (!mpuAddr || !mpuRead(0x3B, 6, b)) return;
  float ax = (int16_t)((b[0] << 8) | b[1]), ay = (int16_t)((b[2] << 8) | b[3]), az = (int16_t)((b[4] << 8) | b[5]);
  float g = sqrt(ax * ax + ay * ay + az * az);
  if (g < 1000) return;
  // bump: the acceleration jumps away from its slow average by more than 0.8 g (16384 = 1 g) — a crash, not driving
  if (!accInit) { accAvg[0] = ax; accAvg[1] = ay; accAvg[2] = az; accInit = true; }
  float dx = ax - accAvg[0], dy = ay - accAvg[1], dz = az - accAvg[2];
  if (sqrt(dx * dx + dy * dy + dz * dz) > 13000) { if (millis() > bumpUntil) bumps++; bumpUntil = millis() + 400; }
  for (int i = 0; i < 3; i++) accAvg[i] += ((i == 0 ? ax : i == 1 ? ay : az) - accAvg[i]) * 0.08f;
  tilt = acos(constrain(fabs(az) / g, 0.0f, 1.0f)) * 57.2958f;   // 0 = flat, 90 = on its side
  angX = atan2(ax, fabs(az) < 1 ? 1 : fabs(az)) * 57.2958f;       // signed lean along the board's X and Y
  angY = atan2(ay, fabs(az) < 1 ? 1 : fabs(az)) * 57.2958f;
}

// ---------------------------------------------------------------- HC-SR04
static void readSonar() {
  digitalWrite(TRIG_PIN, LOW); delayMicroseconds(3);
  digitalWrite(TRIG_PIN, HIGH); delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  unsigned long us = pulseIn(ECHO_PIN, HIGH, 12000UL);   // 12 ms = about 2 m, keeps the gyro reading often
  int mm = us ? (int)(us * 343UL / 2000UL) : -1;
  if (mm < 20 || mm > 2000) {
    // no echo: angled or soft surfaces can swallow it. Close to something, keep the last distance for 0.4 s.
    distMm = (lastGoodMm > 0 && lastGoodMm < 800 && millis() - sonarLastOk < 400) ? lastGoodMm : -1;
    return;
  }
  distMm = lastGoodMm = mm; sonarSeen = true; sonarLastOk = millis();
}

// side eyes (optional): one of them per turn, between the front readings, so they don't hear each other
static int pingMm(uint8_t trig, uint8_t echo) {
  digitalWrite(trig, LOW); delayMicroseconds(3);
  digitalWrite(trig, HIGH); delayMicroseconds(10);
  digitalWrite(trig, LOW);
  unsigned long us = pulseIn(echo, HIGH, 9000UL);   // ~1.5 m is plenty for the sides
  int mm = us ? (int)(us * 343UL / 2000UL) : -1;
  return (mm < 20 || mm > 1500) ? -1 : mm;
}
static void readSide(uint8_t which) {
  int mm = which ? pingMm(TRIG_R, ECHO_R) : pingMm(TRIG_L, ECHO_L);
  sideMm[which] = mm;
  if (mm > 0) sideSeen = true;
}
// drop sensor (optional): LOW = it sees the floor. Trusted only after it has seen the floor once (not wired = HIGH).
static void readCliff() {
  bool floorSeen = digitalRead(CLIFF_PIN) == LOW;
  if (floorSeen) { cliffSeenFloor = true; cliffHighSince = 0; cliffNow = false; return; }
  if (!cliffSeenFloor) return;
  if (!cliffHighSince) cliffHighSince = millis();
  cliffNow = millis() - cliffHighSince > 25;          // no floor for 25 ms: an edge, not a crack in the floor
}

// ---------------------------------------------------------------- DHT11 (no library)
static long levelFor(uint8_t level, unsigned long timeoutUs) {
  unsigned long t0 = micros();
  while (digitalRead(DHT_PIN) == level) if (micros() - t0 > timeoutUs) return -1;
  return (long)(micros() - t0);
}
static bool readDht() {
  uint8_t d[5] = { 0, 0, 0, 0, 0 };
  pinMode(DHT_PIN, OUTPUT); digitalWrite(DHT_PIN, LOW); delay(20);   // start signal
  pinMode(DHT_PIN, INPUT_PULLUP); delayMicroseconds(30);
  if (levelFor(HIGH, 100) < 0) return false;        // sensor answers: low 80 us, high 80 us
  if (levelFor(LOW, 120) < 0) return false;
  if (levelFor(HIGH, 120) < 0) return false;
  for (int i = 0; i < 40; i++) {
    if (levelFor(LOW, 100) < 0) return false;
    long h = levelFor(HIGH, 120);
    if (h < 0) return false;
    d[i / 8] <<= 1;
    if (h > 45) d[i / 8] |= 1;                       // ~27 us = 0, ~70 us = 1
  }
  if ((uint8_t)(d[0] + d[1] + d[2] + d[3]) != d[4]) return false;
  hum = d[0];
  temp10 = (d[2] & 0x7F) * 10 + (d[3] % 10);
  if (d[2] & 0x80) temp10 = -temp10;
  return true;
}

// ---------------------------------------------------------------- link to the ESP32
static void sendLine() {
  char ys[12], rs[12], axs[10], ays[10], line[110];
  dtostrf(angX, 1, 1, axs); dtostrf(angY, 1, 1, ays);
  dtostrf(yaw, 1, 1, ys); dtostrf(rate, 1, 1, rs);
  int pir = -1;
#if USE_PIR
  pir = digitalRead(PIR_PIN) == HIGH ? 1 : 0;
#endif
  int flags = (mpuAddr && mpuFails < 20 ? 1 : 0) | (sonarSeen ? 2 : 0) | (dhtOk ? 4 : 0) | (millis() < bumpUntil ? 8 : 0)
            | (cliffNow ? 16 : 0) | (sideSeen ? 32 : 0) | (cliffSeenFloor ? 64 : 0);
  snprintf(line, sizeof(line), "$CAR,%s,%s,%d,%d,%d,%d,%d,%d,%d,%d,%s,%s*", ys, rs, distMm, temp10, hum, pir, (int)(tilt < 0 ? -1 : tilt + 0.5f), flags,
           sideMm[0], sideMm[1], axs, ays);
  uint8_t cs = 0;
  for (char* p = line + 1; *p && *p != '*'; p++) cs ^= (uint8_t)*p;
  Serial1.print(line);
  if (cs < 0x10) Serial1.print('0');
  Serial1.println(cs, HEX);
}

static void readCommands() {
  while (Serial1.available()) {
    char c = Serial1.read();
    if (c == '\n') {
      cmd.trim();
      if (cmd.startsWith("$ZERO")) { yaw = 0; Serial.println(F("[link] heading set to 0")); }
      else if (cmd.startsWith("$CAL") && mpuAddr) { Serial.println(F("[link] measuring the gyro zero, keep the car still")); calibrateGyro(); }
      cmd = "";                                      // anything else is the ESP32's own messages: ignored
    } else if (c != '\r' && cmd.length() < 40) cmd += c;
  }
}

static void printStatus() {
  Serial.print(F("heading ")); Serial.print(yaw, 1); Serial.print(F(" deg  turn ")); Serial.print(rate, 1);
  Serial.print(F(" deg/s  tilt ")); Serial.print(tilt, 0);
  Serial.print(F("  |  distance ")); if (distMm > 0) { Serial.print(distMm); Serial.print(F(" mm")); } else Serial.print(F("--"));
  Serial.print(F("  |  ")); if (dhtOk) { Serial.print(temp10 / 10.0, 1); Serial.print(F(" C  ")); Serial.print(hum); Serial.print(F(" %")); } else Serial.print(F("DHT11 --"));
#if USE_PIR
  Serial.print(F("  |  motion ")); Serial.print(digitalRead(PIR_PIN) == HIGH ? F("YES") : F("no"));
#endif
  Serial.print(F("  |  ")); Serial.print(mpuAddr ? F("gyro ok") : F("NO GYRO"));
  Serial.print(F(", ")); Serial.print(sonarSeen ? F("sonar ok") : F("no echo yet"));
  Serial.print(F(", ")); Serial.print(dhtOk ? F("dht ok") : F("NO DHT11"));
  Serial.print(F("  |  bumps ")); Serial.print(bumps);
  if (sideSeen) { Serial.print(F("  |  sides ")); Serial.print(sideMm[0]); Serial.print('/'); Serial.print(sideMm[1]); }
  if (cliffSeenFloor) Serial.print(cliffNow ? F("  |  DROP!") : F("  |  floor ok"));
  Serial.print(F("  |  lean ")); Serial.print(angX, 0); Serial.print('/'); Serial.println(angY, 0);
}

void setup() {
  bootReason = MCUSR; MCUSR = 0; wdt_disable();
  Serial.begin(115200);
  Serial1.begin(115200);
  pinMode(LED, OUTPUT);
  pinMode(TRIG_PIN, OUTPUT); digitalWrite(TRIG_PIN, LOW);
  pinMode(ECHO_PIN, INPUT);
  pinMode(DHT_PIN, INPUT_PULLUP);
  pinMode(TRIG_L, OUTPUT); digitalWrite(TRIG_L, LOW); pinMode(ECHO_L, INPUT);
  pinMode(TRIG_R, OUTPUT); digitalWrite(TRIG_R, LOW); pinMode(ECHO_R, INPUT);
  pinMode(CLIFF_PIN, INPUT_PULLUP);
#if USE_PIR
  pinMode(PIR_PIN, INPUT);
#endif
  Serial.println(F("\nBaby Carpathron Mega sensor hub " HUB_VERSION));
  Serial.println(F("Keep the car still for 2 seconds: measuring the gyro zero..."));
  initGyro();
  lastDht = millis();                               // first DHT11 reading 2 s from now (it needs 1 s after power-on)
  lastGyro = micros();
  Serial.println(F("Sending to the ESP32 on TX1 18 / RX1 19 at 115200."));
  if (bootReason & _BV(WDRF)) Serial.println(F("[watchdog] the hub had frozen and restarted itself"));
  if (bootReason & _BV(BORF)) Serial.println(F("[power] the 5 V dropped too low (brown-out) and the hub restarted"));
  wdt_enable(WDTO_4S);                              // frozen for 4 s = restart by itself (no need to open the cover)
}

void loop() {
  wdt_reset();
  unsigned long ms = millis();
  reviveGyro();
  readGyro();
  readCommands();
  readCliff();
  if (ms - lastSonar >= 30) {                       // front, side, front, side …: the front every 60 ms
    lastSonar = ms;
    if (sonarTurn % 2 == 0) readSonar(); else readSide(sonarTurn / 2 % 2);
    sonarTurn++;
    readGyro();
  }
  if (ms - lastAccel >= 10) { lastAccel = ms; readTilt(); }     // 100x per second: catches a bump
  if (ms - lastDht >= 2000) {
    lastDht = ms;
    if (readDht()) { dhtOk = true; dhtLastOk = ms; }
    else { if (ms - dhtLastOk > 10000) dhtOk = false; if (!dhtLastOk && ms > 6000 && ms < 8500) Serial.println(F("[dht] DHT11 not answering: check wires 13-15 (S -> A0, + -> 5V, - -> GND).")); }
    readGyro();                                      // the DHT11 read takes ~25 ms: catch up the heading right after
  }
  if (ms - lastSend >= 50) { lastSend = ms; sendLine(); }
  if (ms - lastPrint >= 500) { lastPrint = ms; digitalWrite(LED, !digitalRead(LED)); printStatus(); }
  delay(2);
}

// "📖 Explain" (board code in everyday words): a beginner sketch line by line, and the whole car firmware without gaps.
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { explain } = require('../public/explain');
const src = `#include <ESP32Servo.h>
#define LED_PIN 4
const int BUTTON = 13;
Servo arm;
void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUTTON, INPUT_PULLUP);
  arm.attach(14);
}
void loop() {
  if (digitalRead(BUTTON) == LOW && (millis() > 500)) {
    digitalWrite(LED_PIN, HIGH);
    arm.write(90);
  } else {
    digitalWrite(LED_PIN, LOW);
  }
  for (int i = 0; i < 3; i++) { tone(LED_PIN, 880, 200); delay(300); }
  int light = analogRead(33);
  if (light < 1000) Serial.println("dark");
  delay(1500);
}`;
const r = explain(src), at = (n) => r.notes.filter((x) => x.line === n).map((x) => x.text).join(' | ');
let ok = 0; const t = (name, fn) => { fn(); ok++; console.log(`  ✓ ${name}`); };
t('summary names the pins, the servo and USB messages', () => assert.strictEqual(r.summary, 'This program uses pins 4 (LED_PIN), 13 (BUTTON), 1 servo, messages to the PC over USB.'));
t('setup / loop are explained', () => { assert.match(at(5), /run ONCE/); assert.match(at(11), /again and again/); });
t('pins in words: output, button wiring, servo wire', () => { assert.match(at(7), /pin 4 \("LED_PIN"\) an output/); assert.match(at(8), /between the pin and GND/); assert.match(at(9), /signal wire .* pin 14/); });
t('conditions in words (nested brackets)', () => assert.strictEqual(at(12), 'If pin 13 ("BUTTON") reads LOW (off / pressed) and the time since start (ms) is more than 500:'));
t('else, loops, beeps, waits in seconds', () => { assert.match(at(15), /otherwise/); assert.match(at(18), /^Repeat 3 times/); assert.match(at(18), /Beep on pin 4/); assert.match(at(21), /Wait 1\.5 seconds/); });
t('one-line if with its action', () => assert.match(at(20), /^If light is less than 1000: Send a message to the PC: "dark"/));
t('analog reading explained with its range', () => assert.match(at(19), /0 \(0 V\) to 4095 \(3\.3 V\)/));
t('steps on the same line as setup() { … } and loop() { … }', () => {
  const o = explain('#define LED 16\nvoid setup() { pinMode(LED, OUTPUT); }\nvoid loop() { digitalWrite(LED, HIGH); delay(500); }\n');
  const l = (n) => o.notes.filter((x) => x.line === n).map((x) => x.text);
  assert.ok(l(2).length === 2 && /output/.test(l(2)[1]), JSON.stringify(l(2)));
  assert.ok(l(3).length === 3 && /ON/.test(l(3)[1]) && /Wait 500 milliseconds/.test(l(3)[2]), JSON.stringify(l(3)));
});
const car = explain(fs.readFileSync(path.join(__dirname, '../../../firmware/carpathron_car/carpathron_car.ino'), 'utf8'));
t('the car firmware: Wi-Fi, web server, camera, memory; system headers need nothing installed', () => {
  assert.match(car.summary, /Wi-Fi, a web server, the camera/); assert.match(car.summary, /permanent memory/);
  assert.ok(car.notes.length > 250, car.notes.length);
  assert.ok(car.notes.filter((n) => /built-in ESP32 system code/.test(n.text)).length >= 6);
  assert.ok(car.notes.some((n) => /setup: the steps below run ONCE/.test(n.text)) && car.notes.some((n) => /loop: the steps below/.test(n.text)));
  assert.ok(car.notes.every((n) => n.text && !/undefined|NaN|\[object/.test(n.text)), 'no broken notes');
});
console.log(`\nexplain: ${ok}/${ok} passed`);

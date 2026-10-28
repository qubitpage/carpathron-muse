# Baby Carpathron — car setup (KUONGSHUN AD174 ESP32 WiFi Camera 4WD)

## What's in the kit (from the kit files)
- **ESP32-CAM** board (with camera + white headlight LED on GPIO 4), USB-C programmer base, external antenna.
- **L298N motor driver** board, 4 × TT motors (2 per side, wired in pairs), 4 wheels, acrylic chassis.
- **Battery box for 2 × 18650** (≈7.4 V) with switch → L298N, which also feeds the ESP32.

## Assembly tips (kit Assembly Guide, steps 0–8)
0. Front of the base plate = the side where the round holes are **wider apart**.
2. Motor brackets go on the side **opposite the motor's bump**; bump faces **out**, solder tabs face **in**.
3. Mind the orientation of the L298N board and the battery box.
5. ESP32-CAM goes in its printed frame at the front (camera looking forward); put the nut in first, then join the halves.
6. Antenna wire goes through the hole and clicks onto the ESP32-CAM's antenna connector.
8. Wiring: each pair of motors on one side goes to the same L298N output (left pair / right pair); the 6-wire bundle connects ESP32 ↔ L298N; battery box → L298N power input.

## Pins (from the kit tutorial — already set in the firmware)
| L298N | ESP32 | Meaning |
|---|---|---|
| ENA | 12 | right wheels speed (PWM) |
| IN1 | 13 | right wheels forward |
| IN2 | 14 | right wheels backward |
| IN3 | 15 | left wheels forward |
| IN4 | 33 | left wheels backward |
| ENB | 2 | left wheels speed (PWM) |

## 1. Test the car with the kit's own program (recommended first)
1. Install **Arduino IDE**, the **CH340 driver** and the **esp32 package 2.0.12** (kit folder `2_Programming_Preparation` — do **not** use 3.x).
2. Open `3_Code_and_Tutorial\Make the Car Move\AUTO_GO\AUTO_GO.ino`.
3. Connect the ESP32-CAM base with USB-C. Tools → Board → **ESP32 Dev Module**, Tools → Port → the COM port that appears when you plug it in.
4. Upload. Unplug USB, insert 2 charged 18650s, switch on. The car should go forward/back/left/right 1 s each.
   - Car goes backward when it should go forward → the 6-wire cable is reversed (kit FAQ).

## 2. Flash the Carpathron firmware (no editing needed)
1. Open `C:\carpathron\carpathron_car\carpathron_car.ino` in Arduino IDE.
2. Same board/port as above (**ESP32 Dev Module**, your COM port) → **Upload**.
3. Switch the car on (batteries). The headlight blinks 3× = ready.

## 3. Put the car on your Wi-Fi (once)
1. On your phone, join the Wi-Fi **Carpathron-Car** (password `carpathron`).
2. Open **http://192.168.4.1/setup**, pick your home Wi-Fi (**2.4 GHz**), type its password → **Save and connect**.
3. The page shows the car's new IP. Put your phone back on your normal Wi-Fi.
   (Changing Wi-Fi later: `http://<car-ip>/forgetwifi` returns the car to hotspot mode.)

### Or set up Wi-Fi from the PC (USB cable, no phone needed)
Arduino IDE → Serial Monitor, **115200 baud**, **New Line**. Type `wifi` → the car lists networks → type your Wi-Fi name → type its password. The car prints its new IP.
Other commands: `status` (IP and mode), `test` (spins left then right wheels for 1 s), `forget` (back to hotspot).

## 4. Connect to Muse Carpathron
Robot page → **🔍 Find my car** (or type the IP) → **car online**, **live video**, headlight slider.
- Drive with the pad / W A S D, from WhatsApp (`/drive forward 2`, `/photo`), by asking the AI, or from the Quest (below).

## 5. Meta Quest 3S
1. Quest and PC on the same Wi-Fi. On the PC: Robot page shows an address like `https://192.168.1.130:8443/pair` and a **6-digit PIN**.
2. Quest → **Browser** → type that address → *Advanced → Proceed* (first time) → enter the PIN.
3. Robot page → **Enter Quest drive mode**. You see the real room (passthrough).
   **Tank**: left stick = left wheels, right stick = right wheels. **Arcade**: right stick only. **A / X = STOP**. Leaving VR stops the car.

## Fixes
| Problem | Fix |
|---|---|
| One side turns backwards | `INVERT_LEFT` or `INVERT_RIGHT = true` in the firmware |
| Left/right swapped | `SWAP_SIDES = true` |
| Picture upside down | `CAM_VFLIP = 0` (ESP32-CAM-V0.3 boards) |
| "Camera init failed" | Tools → Board → **AI Thinker ESP32-CAM**, or Tools → PSRAM → Enabled |
| Car only hums at low speed | raise `MIN_DUTY` (e.g. 110) |
| Wi-Fi not found / resets | charge the 18650s; weak batteries make the ESP32 restart when motors start |
| Buttons do nothing | Press **Test left / right wheels** on the car page (or type `test` in Serial Monitor). No movement = batteries/switch/motor wires, not software |
| Upload fails | hold the board's IO0/BOOT button while upload starts, check CH340 driver and COM port |

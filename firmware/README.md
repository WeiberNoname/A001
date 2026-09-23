# Vacuum Burst Lab — controller firmware

ESP32 firmware that runs the machine cycle and streams data to the **Live test** tab of the Vacuum Burst Lab app.

```
IDLE → EVACUATE → LOAD → HEAT → BURST → DRY → VENT → IDLE
                any safety problem → FAULT
```

| State | What happens | Ends when |
|---|---|---|
| EVACUATE | Pump empties the vacuum tank (burst valve closed; lid may be open) | Tank ≤ `tank_kpa` |
| LOAD | Tank held at vacuum. Load food, insert the probe, close the lid | You press **Start** |
| HEAT | Heater brings the food core to `food_c` at normal pressure (vent open) and holds it `hold_s` seconds, then seals the vent | Temperature held; vent sealed |
| BURST | Burst valve opens: the chamber drops to vacuum in milliseconds. Logged at 1 kHz | 1.5 s |
| DRY | Chamber and tank pumped together; gentle heat to `dry_c` | `dry_s` seconds, or `dry_loss` % mass lost |
| VENT | Tank closed, air bleeds back into the chamber | Chamber ≥ 95 kPa: lid can open |
| FAULT | Heater off, burst valve closed, vent open, pump off | You fix the cause and send **RESET** |

## Parts

| Part | Notes |
|---|---|
| ESP32 DevKit (ESP32-WROOM-32) | Any "esp32dev" board |
| 2× absolute pressure transmitter, 0–110 kPa (or −100…0 kPa gauge), 0.5–4.5 V out, 5 V supply | Stainless, with a thread that fits your chamber port |
| 2× MAX31855 board + K-type thermocouple | One food probe (thin needle), one bonded to the heater tray |
| HX711 + load cell (1–5 kg) | Under the food tray |
| 4-channel relay board or SSRs | Heater needs an **SSR** (zero-cross, rated ≥ 2× heater current) |
| Burst valve, **normally closed** | Fast solenoid or pneumatic full-bore valve |
| Vent valve, **normally open** | Small solenoid + **needle valve** in series so venting is gentle |
| Lid microswitch, NC emergency-stop button, optional start button, optional buzzer | |

## Wiring (defaults in `src/config.h`)

| ESP32 pin | Connects to |
|---|---|
| 26 | Heater SSR input |
| 27 | Pump relay |
| 25 | Burst valve relay (energise = open) |
| 33 | Vent valve relay (energise = sealed) |
| 32 | Buzzer (optional) |
| 14 | Lid switch → GND (closed when lid shut) |
| 13 | E-stop **NC** contact → GND |
| 4 | Start button → GND (optional) |
| 34 | Chamber pressure sensor via divider |
| 35 | Tank pressure sensor via divider |
| 18 / 19 | MAX31855 SCK / SO (both boards) |
| 5 | MAX31855 CS — food probe |
| 17 | MAX31855 CS — heater plate |
| 16 / 21 | HX711 DOUT / SCK |

**Pressure sensor divider:** the sensors output up to 4.5 V, the ESP32 pin tolerates about 3.3 V. Put a 10 kΩ resistor from the sensor output to the pin and a 20 kΩ resistor from the pin to GND (ratio 0.667, 4.5 V → 3.0 V).

**Mains safety:** the heater and pump run on 110 V. Keep mains wiring in a closed, earthed enclosure with a fuse and an RCD (漏電斷路器). The e-stop should also **cut heater and pump power directly** through a contactor, not only signal the ESP32. If you're not experienced with mains wiring, have an electrician do this part.

## Build and upload

Install [PlatformIO](https://platformio.org/) (VS Code extension, or `pip install platformio`), then from this folder:

```bash
pio run -t upload
```

The Arduino IDE also works: copy `src/main.cpp` and `src/config.h` into a sketch folder named `main`, and install the **Adafruit MAX31855** and **HX711 (bogde)** libraries.

## First power-up checklist

Do these **with mains power disconnected** from the heater and pump:

1. Open the app → **Live test** → **Connect ESP32**. You should see `# Vacuum Burst Lab controller ready` and data lines.
2. Pressures should read about **101 kPa** (atmosphere). If one is far off, check the divider, then set `P_OFFSET_*` in `config.h`.
3. Press the e-stop: the state must go to **FAULT**. Release it and click **Reset fault**.
4. Open and close the lid: check the lid switch.
5. Warm the food probe in your hand: the food temperature should rise.
6. **Tare scale** with the empty tray, then put a known weight on it and type `CAL 200` (for 200 g) in a serial monitor.
7. Listen to the relays/valves clicking through a dry cycle with no food and no mains power.

Only then connect the heater and pump, and do the first real cycle with an **empty** chamber.

## Commands

The app's buttons send these; you can also type them in any serial monitor at 921600 baud.

| Command | Effect |
|---|---|
| `START` | IDLE → start evacuating; LOAD → start heating (lid must be closed) |
| `ABORT` | Go to VENT from any running state |
| `RESET` | Leave FAULT (e-stop must be released) |
| `TARE` | Zero the scale (IDLE or LOAD) |
| `CAL <grams>` | Calibrate the scale with a known weight on the tared tray |
| `GET` | Print settings |
| `SET <key> <value>` | Change a setting (IDLE, LOAD or FAULT); saved to flash |

Settings: `food_c` (40–98), `hold_s`, `tank_kpa` (0.5–50), `dry_c` (20–90), `dry_s`, `dry_loss` (% mass, 0 = time only).

## Safety features

- Fail-safe valve choice: losing power closes the tank and vents the chamber.
- FAULT on: e-stop, pressure sensor unplugged or shorted, thermocouple fault, heater plate > 190 °C, food > 105 °C, tank not reaching vacuum in 20 min (leak), food not heating in 30 min, chamber not venting in 3 min.
- Heater pauses while the plate is above 160 °C.
- Vent stays open while heating, so warming air can't pressurise the chamber.
- Heating stops if the lid opens.
- Watchdog: if the loop hangs for 2 s the board reboots, and outputs start in the safe state.

These are software protections. They don't replace a vacuum-rated chamber and lid, a mechanical over-temperature cut-off (thermal fuse) on the heater, and proper mains protection.

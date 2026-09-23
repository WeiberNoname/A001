# Vacuum Burst Lab

Firmware for the machine's ESP32 controller is in [`firmware/`](firmware/).

Sizing simulator for an oil-free **vacuum burst puffing** machine (真空爆發膨化機) — the physics of 爆米香, using a sudden vacuum instead of high pressure.

Adjust food load and hardware (chamber, vacuum tank, valve bore, pump) to see final pressure, boiling point, flashed water, pressure-drop time, a puff index, and sizing warnings. Includes the Prototype 1 build spec, control sequence and bill of materials.

## Machine view

The **Machine** tab is an animated 2D cutaway of one full cycle: air molecules drain from the chamber into the tank, the water inside the food flashes to steam and the food puffs, while valves switch, the pump spins and the heater glows. A thermometer shows the food temperature against the boiling point at the current pressure, which is the key to the whole process, and an inset shows the cells inside one piece. The burst plays in slow motion, and each step has a plain-language explanation. The "Try" buttons show what goes wrong with a valve that's too small, food that's too cold, or a tank that's too small.

## Live test station

The **Live test** tab connects to the ESP32 controller over USB serial and shows chamber pressure, tank pressure, food temperature and mass in real time. After each burst it compares the measured pressure drop with the simulation, and you can save the batch (recipe, masses, volumes, crunch score, notes) to a log that exports to CSV. Batches are stored in the app's user data folder (`batches.json`).

**Run demo device** replays a full cycle (evacuate, load, heat, burst, dry, vent) from the current Simulator settings, so you can use the station without hardware.

### Device protocol

One line per sample over USB serial (921600 or 115200 baud). Lines starting with `D,` are data; other lines appear in the device log.

```
D,<millis>,<chamber kPa>,<tank kPa>,<food °C>,<mass g>,<STATE>
```

```cpp
Serial.printf("D,%lu,%.2f,%.2f,%.1f,%.1f,%s
", millis(), pc, pt, tf, mass, state);
```

States: `EVACUATE`, `LOAD`, `HEAT`, `BURST`, `DRY`, `VENT`, `IDLE`. Send at 1 kHz during the burst, 20–100 Hz otherwise. Without a state field, bursts are detected from a chamber drop of more than 15 kPa within 100 ms.

## Run

```bash
npm install
npm start
```

## Build the Windows app

```bash
npm run build
```

Output: `VacuumBurstLab-win32-x64/VacuumBurstLab.exe`

## Model notes

The puff index is a heuristic to be calibrated with real test data. Prices in the bill of materials are rough estimates. Only use chambers rated for full vacuum.

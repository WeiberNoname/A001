# Vacuum Burst Lab

Firmware for the machine's ESP32 controller is in [`firmware/`](firmware/).

Sizing simulator for an oil-free **vacuum burst puffing** machine (真空爆發膨化機) — the physics of 爆米香, using a sudden vacuum instead of high pressure.

Adjust food load and hardware (chamber, vacuum tank, valve bore, pump) to see final pressure, boiling point, flashed water, pressure-drop time, a puff index, and sizing warnings. Includes the Prototype 1 build spec, control sequence and bill of materials.

## Machine view

The **Machine** tab is an animated 2D cutaway of one full cycle. Air molecules drain from the chamber into the tank, the water inside the food flashes to steam and the food puffs, while valves switch, the pump spins and the heater glows.

- **2D or 3D:** switch to a 3D model of the machine (three.js, bundled offline). It has a glass chamber and tank, air and steam particles, food slices that puff, a burst-valve handle that turns, a spinning pump fan, a glowing heater and live dial gauges. Drag to rotate, scroll to zoom. Both views run the same simulation.
- **Water phase map:** the food's temperature against chamber pressure, with the boiling curve. The dot falls across the curve at the burst, then slides along it as boiling cools the food. This is the whole idea of the machine in one picture.
- **Real-time clock:** every step shows its real duration from the physics (pump-down, heating, drying) and how much faster or slower it is being played. The burst plays 20× slower.
- **Each step** has a plain explanation, a "watch for" hint and the formula with this batch's numbers.
- **Energy readout:** heat stored above the boiling point, and how much water it can boil.
- **"Try" buttons** show what goes wrong with a valve that's too small, food that's too cold, or a tank that's too small.

## Inside the food

The Machine tab's **Inside the food** view simulates the food itself: a cross-section of one slice, cell by cell, through the whole cycle. Choose **Apple, Taro, Sweet potato or Rice cake (爆米香)**; each sets its own food properties and typical Simulator settings.

- **Heating:** the surface warms before the centre, and the water in each cell stays liquid.
- **Burst:** each cell's water flashes to steam and inflates the cell. Only about 10 % of the water boils, but at ~13 kPa each gram becomes ~11 litres of steam. Cells stretched past their limit rupture and vent steam; those become the open pores.
- **Drying:** a drying front moves in from the surface. Cell water follows the real mass balance, so the cells always add up to the slice's true moisture.
- **Texture:** cell walls are drawn **rubbery** (thin, pale, stretchy) or **glassy** (thick, golden, rigid). The panel shows moisture, volume, porosity, ruptured cells, Tg, and a verdict on how the snack will feel at room temperature: crunchy, just crisp, leathery or soft.

The **texture map** plots food temperature against moisture with the **glass transition** curve from the Gordon–Taylor equation:

Tg = (w_s·Tg_s + k·w_w·Tg_w) / (w_s + k·w_w), with Tg_w = −135 °C for water.

Above the curve the walls are rubbery, so the food can puff. Below it they are glassy, so the snack is crunchy. The recipe is to puff while hot and moist (rubbery), then dry until the food is well below the curve at room temperature.

This is why sugary apple needs drying to ~5 % moisture to be only just crisp (Tg ≈ 29 °C), while starchy taro or rice sets firmly crunchy (Tg ≈ 80 °C at the same moisture). The Tg values for dry solids and the k constants are typical literature-range estimates; real products vary, so calibrate them with tests.

## Physics model

All tabs share one model in [`physics.js`](physics.js).

**Burst** (solved in 20–100 µs steps over 1.5 s):
- Chamber and tank each hold air and water vapour as ideal gases at 20 °C.
- The mixture flows through the valve as a compressible orifice flow (choked or subsonic), with a mixture gas constant and heat-capacity ratio.
- Water flashes whenever the food is hotter than the boiling point at the chamber pressure (Antoine equation). The latent heat h_fg(T) = 2501 − 2.37·T kJ/kg comes out of the food, whose specific heat follows Siebel's equation, cₚ = 1.675 + 2.51·x kJ/kg·K. So the food cools toward the boiling point. Energy balances within ~3 %.
- Vapour above the saturation pressure of 25 °C walls condenses, and the pump keeps pumping the tank.
- Drop time is when 90 % of the chamber-tank pressure difference has passed through the valve. The Live tab measures it the same way.

**Cycle timing:**
- Pump-down: t = (V/S)·ln(p₀/p).
- Heating: t = m·cₚ·ΔT / P, with a 300 W heater and 60 % reaching the food.
- Drying under vacuum: the water to reach 5 % moisture, divided by the evaporation rate from 200 W. The food sits near the boiling point at the drying pressure because evaporation cools it.

**Assumed values to calibrate on Prototype 1:** valve discharge coefficient (0.7), flash and condensation time constants (20 ms, 0.3 s), food density, heater efficiency. The volume expansion comes from the puff index, a heuristic that needs fitting to measured expansion ratios.

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

# Vacuum Burst Lab

Sizing simulator for an oil-free **vacuum burst puffing** machine (真空爆發膨化機) — the physics of 爆米香, using a sudden vacuum instead of high pressure.

Adjust food load and hardware (chamber, vacuum tank, valve bore, pump) to see final pressure, boiling point, flashed water, pressure-drop time, a puff index, and sizing warnings. Includes the Prototype 1 build spec, control sequence and bill of materials.

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

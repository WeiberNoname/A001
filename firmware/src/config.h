// Hardware configuration for the Vacuum Burst Lab controller.
// Change pins and calibration here; nothing else in the firmware should need editing.
#pragma once

// ---------- Outputs ----------
// Wire valves so that loss of power is safe:
//   burst valve  = normally CLOSED (de-energised keeps the tank isolated)
//   vent valve   = normally OPEN   (de-energised lets air back into the chamber)
constexpr int PIN_HEATER_SSR   = 26;
constexpr int PIN_PUMP_RELAY   = 27;
constexpr int PIN_BURST_VALVE  = 25;   // energise = open
constexpr int PIN_VENT_VALVE   = 33;   // energise = closed (sealed)
constexpr int PIN_BUZZER       = 32;   // optional, -1 to disable
constexpr bool OUTPUT_ACTIVE_HIGH = true;   // false if your relay board is active-low

// ---------- Inputs ----------
constexpr int PIN_LID_SWITCH   = 14;   // switch to GND, closed when the lid is shut
constexpr int PIN_ESTOP        = 13;   // normally-closed e-stop contact to GND; open = STOP
constexpr int PIN_START_BUTTON = 4;    // optional push button to GND, -1 to disable

// ---------- Pressure sensors (analog) ----------
// Absolute pressure transmitters, 0.5–4.5 V output, through a divider so the
// ESP32 pin never sees more than ~3.0 V (e.g. 10k over 20k -> ratio 0.667).
constexpr int   PIN_P_CHAMBER   = 34;  // ADC1 only (ADC2 conflicts with Wi-Fi)
constexpr int   PIN_P_TANK      = 35;
constexpr float P_DIVIDER_RATIO = 0.667f;
constexpr float P_V_MIN = 0.5f;        // sensor volts at P_AT_VMIN
constexpr float P_V_MAX = 4.5f;        // sensor volts at P_AT_VMAX
constexpr float P_AT_VMIN = 0.0f;      // kPa absolute
constexpr float P_AT_VMAX = 110.0f;    // kPa absolute
// For a -100..0 kPa GAUGE sensor instead: P_AT_VMIN = 1.3, P_AT_VMAX = 101.3.
constexpr float P_OFFSET_CHAMBER = 0.0f;   // kPa, set after comparing with a reference gauge
constexpr float P_OFFSET_TANK    = 0.0f;

// ---------- Thermocouples (MAX31855, shared SPI) ----------
constexpr int PIN_TC_SCK       = 18;
constexpr int PIN_TC_MISO      = 19;
constexpr int PIN_TC_CS_FOOD   = 5;    // probe inside the food
constexpr int PIN_TC_CS_PLATE  = 17;   // bonded to the heater tray

// ---------- Load cell (HX711) ----------
constexpr int   PIN_HX_DOUT = 16;
constexpr int   PIN_HX_SCK  = 21;
constexpr float HX_DEFAULT_SCALE = 420.0f;   // counts per gram; use the CAL command

// ---------- Safety limits ----------
constexpr float PLATE_MAX_C        = 160.0f;  // heater pauses above this
constexpr float PLATE_TRIP_C       = 190.0f;  // FAULT above this
constexpr float FOOD_MAX_C         = 105.0f;  // FAULT above this
constexpr float SETTING_FOOD_MAX_C = 98.0f;   // highest food target a user may set
constexpr uint32_t EVACUATE_TIMEOUT_MS = 20UL * 60 * 1000;  // tank can't reach target: leak
constexpr uint32_t HEAT_TIMEOUT_MS     = 30UL * 60 * 1000;
constexpr uint32_t DRY_MAX_MS          = 60UL * 60 * 1000;
constexpr uint32_t VENT_TIMEOUT_MS     = 3UL * 60 * 1000;
constexpr float VENT_DONE_KPA      = 95.0f;   // chamber back near atmosphere
constexpr uint32_t VENT_SETTLE_MS  = 150;     // time for the vent valve to seal before bursting

// ---------- Timing ----------
constexpr uint32_t SERIAL_BAUD      = 921600;
constexpr uint32_t SAMPLE_US_NORMAL = 20000;  // 50 Hz
constexpr uint32_t SAMPLE_US_BURST  = 1000;   // 1 kHz
constexpr uint32_t BURST_LOG_MS     = 1500;   // length of the fast-logging window
constexpr uint32_t SSR_WINDOW_MS    = 1000;   // time-proportional heater window

// ---------- Heater PI ----------
constexpr float HEAT_KP = 0.08f;    // duty per °C of error
constexpr float HEAT_KI = 0.002f;   // duty per °C·s

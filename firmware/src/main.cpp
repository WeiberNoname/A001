// Vacuum Burst Lab — machine controller (ESP32, Arduino framework)
//
// Cycle: IDLE -> EVACUATE -> LOAD -> HEAT -> BURST -> DRY -> VENT -> IDLE
// Any safety problem -> FAULT (heater off, burst valve closed, vent open, pump off).
//
// Serial output (read by the Vacuum Burst Lab app, "Live test" tab):
//   D,<millis>,<chamber kPa>,<tank kPa>,<food °C>,<mass g>,<STATE>
//   # <message>
// Serial commands (one per line):
//   START  ABORT  RESET  TARE  CAL <grams>  GET  SET <key> <value>

#include <Arduino.h>
#include <SPI.h>
#include <Adafruit_MAX31855.h>
#include <HX711.h>
#include <Preferences.h>
#include <esp_task_wdt.h>
#include "config.h"

// ---------------------------------------------------------------- state
enum State { IDLE, EVACUATE, LOAD, HEAT, BURST, DRY, VENT, FAULT };
const char *STATE_NAMES[] = {"IDLE", "EVACUATE", "LOAD", "HEAT", "BURST", "DRY", "VENT", "FAULT"};

struct Settings {
  float foodC   = 85.0f;   // food core target before the burst
  float holdS   = 20.0f;   // seconds held at target so the core is evenly hot
  float tankKPa = 3.0f;    // tank pressure required before the burst
  float dryC    = 55.0f;   // food target while drying under vacuum
  float dryS    = 300.0f;  // maximum drying time
  float dryLoss = 0.0f;    // stop drying at this % mass loss (0 = time only)
} cfg;

struct Readings {
  float pc = NAN, pt = NAN;        // kPa abs
  float food = NAN, plate = NAN;   // °C
  float mass = NAN;                // g
  bool lidClosed = false, estop = false;
} rd;

State state = IDLE;
uint32_t stateSinceMs = 0;
String faultReason;

Adafruit_MAX31855 tcFood(PIN_TC_SCK, PIN_TC_CS_FOOD, PIN_TC_MISO);
Adafruit_MAX31855 tcPlate(PIN_TC_SCK, PIN_TC_CS_PLATE, PIN_TC_MISO);
HX711 scale;
Preferences prefs;

float heaterDuty = 0, heaterInteg = 0;
uint8_t tcFoodFails = 0, tcPlateFails = 0;
bool startRequested = false;
uint32_t holdStartMs = 0;          // 0 = not yet holding at target
uint32_t ventClosedAtMs = 0;       // 0 = vent not yet closed for the burst
uint32_t burstStartMs = 0;
float massAtBurst = NAN;

// ---------------------------------------------------------------- outputs
void setOut(int pin, bool on) {
  if (pin < 0) return;
  digitalWrite(pin, (on == OUTPUT_ACTIVE_HIGH) ? HIGH : LOW);
}
void setHeater(bool on)      { setOut(PIN_HEATER_SSR, on); }
void setPump(bool on)        { setOut(PIN_PUMP_RELAY, on); }
void setBurstValve(bool open){ setOut(PIN_BURST_VALVE, open); }
void setVentSealed(bool sealed) { setOut(PIN_VENT_VALVE, sealed); }

void safeOutputs() {
  heaterDuty = 0; heaterInteg = 0;
  setHeater(false);
  setBurstValve(false);
  setVentSealed(false);   // chamber open to atmosphere
  setPump(false);
}

void beep(uint16_t ms) {
  if (PIN_BUZZER < 0) return;
  setOut(PIN_BUZZER, true); delay(ms); setOut(PIN_BUZZER, false);
}

// ---------------------------------------------------------------- messages
void msg(const char *fmt, ...) {
  char buf[160];
  va_list ap; va_start(ap, fmt); vsnprintf(buf, sizeof buf, fmt, ap); va_end(ap);
  Serial.print("# "); Serial.println(buf);
}

void enter(State s) {
  if (s == state) return;
  msg("state %s -> %s", STATE_NAMES[state], STATE_NAMES[s]);
  state = s;
  stateSinceMs = millis();
  heaterInteg = 0;
  holdStartMs = 0;
  ventClosedAtMs = 0;
}

void fault(const String &why) {
  safeOutputs();
  if (state != FAULT) {
    faultReason = why;
    enter(FAULT);
    msg("FAULT: %s. Fix the cause, then send RESET.", why.c_str());
    beep(600);
  }
}

// ---------------------------------------------------------------- sensors
float readPressure(int pin, float offset, bool &bad) {
  // Average a few conversions; analogReadMilliVolts applies the factory ADC calibration.
  uint32_t mv = 0;
  for (int i = 0; i < 4; i++) mv += analogReadMilliVolts(pin);
  float v = (mv / 4.0f) / 1000.0f / P_DIVIDER_RATIO;
  bad = v < P_V_MIN - 0.3f || v > P_V_MAX + 0.3f;   // unplugged or shorted sensor
  float p = P_AT_VMIN + (v - P_V_MIN) / (P_V_MAX - P_V_MIN) * (P_AT_VMAX - P_AT_VMIN);
  return max(0.0f, p + offset);
}

void readFastSensors() {
  bool badC, badT;
  rd.pc = readPressure(PIN_P_CHAMBER, P_OFFSET_CHAMBER, badC);
  rd.pt = readPressure(PIN_P_TANK, P_OFFSET_TANK, badT);
  if (badC) fault("chamber pressure sensor out of range");
  if (badT) fault("tank pressure sensor out of range");

  rd.lidClosed = digitalRead(PIN_LID_SWITCH) == LOW;
  rd.estop = digitalRead(PIN_ESTOP) == HIGH;   // NC contact: open circuit = stop
  if (rd.estop) fault("emergency stop");
}

void readSlowSensors() {   // every 100 ms (MAX31855 converts at ~10 Hz)
  float f = tcFood.readCelsius(), p = tcPlate.readCelsius();
  if (isnan(f)) { if (++tcFoodFails >= 3) fault("food thermocouple fault"); } else { tcFoodFails = 0; rd.food = f; }
  if (isnan(p)) { if (++tcPlateFails >= 3) fault("plate thermocouple fault"); } else { tcPlateFails = 0; rd.plate = p; }
  if (rd.plate > PLATE_TRIP_C) fault("heater plate over temperature");
  if (rd.food > FOOD_MAX_C) fault("food over temperature");
}

void readScale() {
  if (scale.is_ready()) rd.mass = scale.get_units(1);
}

// ---------------------------------------------------------------- heater
// PI on the food probe, time-proportional SSR drive, paused while the plate is too hot.
void runHeater(float targetC, float dt) {
  if (isnan(rd.food) || isnan(rd.plate)) { setHeater(false); return; }
  float e = targetC - rd.food;
  heaterInteg = constrain(heaterInteg + HEAT_KI * e * dt, 0.0f, 1.0f);
  heaterDuty = constrain(HEAT_KP * e + heaterInteg, 0.0f, 1.0f);
  if (rd.plate > PLATE_MAX_C) heaterDuty = 0;
  setHeater((millis() % SSR_WINDOW_MS) < heaterDuty * SSR_WINDOW_MS);
}

void heaterOff() { heaterDuty = 0; setHeater(false); }

// Keep the tank at its target while waiting; pump runs with a little hysteresis.
void holdTankVacuum() {
  static bool pumping = true;
  if (rd.pt > cfg.tankKPa + 1.0f) pumping = true;
  else if (rd.pt <= cfg.tankKPa) pumping = false;
  setPump(pumping);
}

// ---------------------------------------------------------------- state machine
void step(float dt) {
  const uint32_t now = millis(), inState = now - stateSinceMs;

  switch (state) {
    case IDLE:
      safeOutputs();
      if (startRequested) { startRequested = false; enter(EVACUATE); }
      break;

    case EVACUATE:   // lid may be open; burst valve isolates the tank
      heaterOff(); setBurstValve(false); setVentSealed(false); setPump(true);
      if (rd.pt <= cfg.tankKPa) { msg("tank at %.1f kPa. Load food, close the lid, then START.", rd.pt); beep(80); enter(LOAD); }
      else if (inState > EVACUATE_TIMEOUT_MS) fault("tank did not reach target pressure (leak?)");
      break;

    case LOAD:
      heaterOff(); setBurstValve(false); setVentSealed(false); holdTankVacuum();
      if (startRequested) {
        startRequested = false;
        if (!rd.lidClosed) msg("close the lid first");
        else enter(HEAT);
      }
      break;

    case HEAT:   // at atmosphere; vent stays open so warming air can't build pressure
      setBurstValve(false); holdTankVacuum();
      if (!rd.lidClosed) { heaterOff(); msg("lid opened during heating"); enter(LOAD); break; }
      if (inState > HEAT_TIMEOUT_MS) { fault("food did not reach target temperature"); break; }

      if (ventClosedAtMs == 0) {
        runHeater(cfg.foodC, dt);
        if (rd.food >= cfg.foodC - 0.5f) { if (holdStartMs == 0) holdStartMs = now; }
        else holdStartMs = 0;
        if (holdStartMs && now - holdStartMs >= cfg.holdS * 1000) {
          if (rd.pt > cfg.tankKPa + 1.0f) break;          // wait for the tank to recover
          heaterOff(); setPump(false);
          setVentSealed(true); ventClosedAtMs = now;      // seal the chamber
        }
      } else if (now - ventClosedAtMs >= VENT_SETTLE_MS) {
        massAtBurst = rd.mass;
        enter(BURST);
        burstStartMs = millis();
        setBurstValve(true);                              // the burst
      }
      break;

    case BURST:
      heaterOff(); setVentSealed(true); setBurstValve(true); setPump(true);
      if (inState >= BURST_LOG_MS) enter(DRY);
      break;

    case DRY: {   // chamber and tank pumped together, gentle heat
      setVentSealed(true); setBurstValve(true); setPump(true);
      runHeater(cfg.dryC, dt);
      float loss = (!isnan(massAtBurst) && massAtBurst > 1) ? 100.0f * (massAtBurst - rd.mass) / massAtBurst : 0;
      bool done = inState >= cfg.dryS * 1000 || inState >= DRY_MAX_MS || (cfg.dryLoss > 0 && loss >= cfg.dryLoss);
      if (done) { msg("drying done, mass loss %.1f%%", loss); enter(VENT); }
      break;
    }

    case VENT:   // close the tank, let air back in (fit a needle valve so it's gentle)
      heaterOff(); setBurstValve(false); setVentSealed(false); setPump(true);
      if (rd.pc >= VENT_DONE_KPA) { msg("vented. Lid can be opened."); beep(80); delay(80); beep(80); enter(IDLE); }
      else if (inState > VENT_TIMEOUT_MS) fault("chamber did not vent (vent valve blocked?)");
      break;

    case FAULT:
      safeOutputs();
      break;
  }
}

// ---------------------------------------------------------------- commands
void printSettings() {
  msg("food_c=%.1f hold_s=%.0f tank_kpa=%.1f dry_c=%.1f dry_s=%.0f dry_loss=%.1f scale=%.2f",
      cfg.foodC, cfg.holdS, cfg.tankKPa, cfg.dryC, cfg.dryS, cfg.dryLoss, scale.get_scale());
}

void saveSettings() {
  prefs.putBytes("cfg", &cfg, sizeof cfg);
}

void handleCommand(String line) {
  line.trim();
  if (!line.length()) return;
  String cmd = line, arg1, arg2;
  int s1 = line.indexOf(' ');
  if (s1 > 0) {
    cmd = line.substring(0, s1);
    String rest = line.substring(s1 + 1); rest.trim();
    int s2 = rest.indexOf(' ');
    arg1 = s2 > 0 ? rest.substring(0, s2) : rest;
    arg2 = s2 > 0 ? rest.substring(s2 + 1) : "";
    arg2.trim();
  }
  cmd.toUpperCase();

  if (cmd == "START") {
    if (state == IDLE || state == LOAD) startRequested = true;
    else msg("START ignored in %s", STATE_NAMES[state]);
  } else if (cmd == "ABORT") {
    if (state == FAULT || state == IDLE) msg("nothing to abort");
    else { msg("aborted by user"); enter(VENT); }
  } else if (cmd == "RESET") {
    if (state != FAULT) msg("not in FAULT");
    else if (rd.estop) msg("release the emergency stop first");
    else { faultReason = ""; enter(IDLE); }
  } else if (cmd == "TARE") {
    if (!(state == IDLE || state == LOAD)) msg("tare only in IDLE or LOAD");
    else if (!scale.wait_ready_timeout(500)) msg("load cell not responding");
    else { scale.tare(10); msg("scale tared"); }
  } else if (cmd == "CAL") {
    float grams = arg1.toFloat();
    if (grams <= 0 || !(state == IDLE || state == LOAD)) { msg("usage: CAL <grams> with the known weight on the empty, tared tray"); return; }
    if (!scale.wait_ready_timeout(500)) { msg("load cell not responding"); return; }
    float counts = scale.get_value(10);
    scale.set_scale(counts / grams);
    prefs.putFloat("scale", scale.get_scale());
    msg("scale set to %.2f counts/g", scale.get_scale());
  } else if (cmd == "GET") {
    printSettings();
  } else if (cmd == "SET") {
    if (!(state == IDLE || state == LOAD || state == FAULT)) { msg("change settings in IDLE or LOAD"); return; }
    float v = arg2.toFloat();
    String k = arg1; k.toLowerCase();
    if      (k == "food_c"   && v >= 40 && v <= SETTING_FOOD_MAX_C) cfg.foodC = v;
    else if (k == "hold_s"   && v >= 0  && v <= 600)  cfg.holdS = v;
    else if (k == "tank_kpa" && v >= 0.5f && v <= 50) cfg.tankKPa = v;
    else if (k == "dry_c"    && v >= 20 && v <= 90)   cfg.dryC = v;
    else if (k == "dry_s"    && v >= 0  && v <= DRY_MAX_MS / 1000) cfg.dryS = v;
    else if (k == "dry_loss" && v >= 0  && v <= 90)   cfg.dryLoss = v;
    else { msg("rejected: %s %s (unknown key or out of range)", arg1.c_str(), arg2.c_str()); return; }
    saveSettings();
    printSettings();
  } else {
    msg("unknown command: %s", line.c_str());
  }
}

void pollSerial() {
  static String buf;
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') { handleCommand(buf); buf = ""; }
    else if (buf.length() < 80) buf += c;
  }
}

void pollStartButton() {
  if (PIN_START_BUTTON < 0) return;
  static bool last = true; static uint32_t lastChange = 0;
  bool now = digitalRead(PIN_START_BUTTON);
  if (now != last && millis() - lastChange > 40) {
    lastChange = millis(); last = now;
    if (!now) handleCommand("START");
  }
}

// ---------------------------------------------------------------- setup / loop
void setup() {
  for (int pin : {PIN_HEATER_SSR, PIN_PUMP_RELAY, PIN_BURST_VALVE, PIN_VENT_VALVE, PIN_BUZZER})
    if (pin >= 0) pinMode(pin, OUTPUT);
  safeOutputs();   // first thing: everything safe
  setOut(PIN_BUZZER, false);

  pinMode(PIN_LID_SWITCH, INPUT_PULLUP);
  pinMode(PIN_ESTOP, INPUT_PULLUP);
  if (PIN_START_BUTTON >= 0) pinMode(PIN_START_BUTTON, INPUT_PULLUP);
  analogReadResolution(12);
  analogSetPinAttenuation(PIN_P_CHAMBER, ADC_11db);
  analogSetPinAttenuation(PIN_P_TANK, ADC_11db);

  Serial.setTxBufferSize(8192);
  Serial.begin(SERIAL_BAUD);

  tcFood.begin(); tcPlate.begin();
  scale.begin(PIN_HX_DOUT, PIN_HX_SCK);

  prefs.begin("vbl", false);
  if (prefs.getBytesLength("cfg") == sizeof cfg) prefs.getBytes("cfg", &cfg, sizeof cfg);
  scale.set_scale(prefs.getFloat("scale", HX_DEFAULT_SCALE));
  if (scale.wait_ready_timeout(1000)) scale.tare(10);
  else msg("load cell not detected (mass will read nan)");

#if ESP_ARDUINO_VERSION_MAJOR >= 3
  esp_task_wdt_config_t wdt = {.timeout_ms = 2000, .idle_core_mask = 0, .trigger_panic = true};
  esp_task_wdt_reconfigure(&wdt);
#else
  esp_task_wdt_init(2, true);   // reboot (into safe outputs) if the loop ever hangs for 2 s
#endif
  esp_task_wdt_add(NULL);

  msg("Vacuum Burst Lab controller ready");
  printSettings();
}

void loop() {
  static uint32_t lastSampleUs = 0, lastSlowMs = 0, lastStepMs = 0;
  const uint32_t nowUs = micros(), nowMs = millis();
  esp_task_wdt_reset();

  pollSerial();
  pollStartButton();

  const bool fast = state == BURST;
  if (nowUs - lastSampleUs >= (fast ? SAMPLE_US_BURST : SAMPLE_US_NORMAL)) {
    lastSampleUs = nowUs;
    readFastSensors();
    if (!fast) readScale();
    Serial.printf("D,%lu,%.2f,%.2f,%.1f,%.1f,%s\n",
                  (unsigned long)nowMs, rd.pc, rd.pt, rd.food, rd.mass, STATE_NAMES[state]);
  }

  if (nowMs - lastSlowMs >= 100) {
    lastSlowMs = nowMs;
    readSlowSensors();
  }

  if (nowMs - lastStepMs >= 5) {
    float dt = (nowMs - lastStepMs) / 1000.0f;
    lastStepMs = nowMs;
    step(dt);
  }
}

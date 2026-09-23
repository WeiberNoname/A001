// Vacuum Burst Lab physics model, shared by the Simulator, Machine and Live test tabs.
//
// Burst: chamber and tank each hold air + water vapour (ideal gases, isothermal at 20 °C).
// The mixture flows through the valve as a compressible orifice flow (choked or subsonic).
// Food water flashes to vapour whenever the food is hotter than the boiling point at the
// chamber pressure; the latent heat comes out of the food, so the food cools toward that
// boiling point. Vapour condenses on walls at 25 °C, and the pump keeps pumping the tank.
//
// Cycle timing comes from energy and pumping balances (heater power, pump speed), not guesses.

const PHYS = {
  ATM: 101.325,        // kPa
  R_AIR: 287.05,       // J/kg·K
  R_VAP: 461.5,        // J/kg·K
  T_GAS: 293.15,       // K, gas assumed at room temperature
  K_AIR: 1.40, K_VAP: 1.33,
  CD: 0.7,             // valve discharge coefficient (assumed)
  FOOD_DENSITY: 0.8,   // g/mL (assumed)
  T_WALL: 25,          // °C, chamber/tank wall temperature
  TAU_FLASH: 0.02,     // s, how fast superheated water flashes (assumed; set by piece size)
  TAU_COND: 0.3,       // s, how fast excess vapour condenses on walls (assumed)
  T_START: 25,         // °C, food starting temperature
  HEATER_W: 300, HEAT_EFF: 0.6,   // heating at atmosphere
  DRY_W: 200, DRY_EFF: 0.6,       // heating while drying under vacuum
  DRY_TARGET_X: 0.05,  // dry until 5 % moisture (wet basis)
  LOAD_S: 30, HOLD_S: 20, VENT_S: 30,
  BURST_S: 1.5,
  PUMP_ULTIMATE: 0.05  // kPa, two-stage rotary vane pump floor
};

// Water saturation (Antoine equation). kPa <-> °C
function tsat(PkPa) {
  const mm = PkPa * 7.50062, lg = Math.log10(Math.max(mm, 0.01));
  let T = 1730.63 / (8.07131 - lg) - 233.426;
  if (T > 99) T = 1810.94 / (8.14019 - lg) - 244.485;
  return T;
}
function psat(T) {
  const [A, B, C] = T < 99 ? [8.07131, 1730.63, 233.426] : [8.14019, 1810.94, 244.485];
  return Math.pow(10, A - B / (C + T)) / 7.50062;
}
// Latent heat of vaporisation, J/kg (linear fit, good to ~1 % from 0–100 °C)
const hfg = T => (2501 - 2.37 * T) * 1000;
// Specific heat of moist food above freezing (Siebel), J/kg·K, x = water fraction (wet basis)
const cpFood = x => (1.675 + 2.51 * x) * 1000;

function simulate(v) {
  const P = PHYS, Tg = P.T_GAS;
  const foodL = v.m / P.FOOD_DENSITY / 1000;
  const Vc = Math.max(v.vc - foodL, 0.2) / 1000, Vt = v.vt / 1000;
  const A = Math.PI * Math.pow(v.d / 1000, 2) / 4;
  const S = v.q / 3600;                         // pump speed, m³/s
  const mFood0 = v.m / 1000;
  const solids = mFood0 * (1 - v.x);
  const pvWall = psat(P.T_WALL) * 1000;         // Pa

  // gas inventories (kg)
  let ac = P.ATM * 1000 * Vc / (P.R_AIR * Tg), vc = 0;   // chamber air, vapour
  let at = v.pt * 1000 * Vt / (P.R_AIR * Tg), vt = 0;    // tank air, vapour
  let water = mFood0 * v.x, Tf = v.t, flashed = 0, condensed = 0;
  const airEq = (ac + at) * P.R_AIR * Tg / (Vc + Vt) / 1000;

  const press = (a, w, V) => (a * P.R_AIR + w * P.R_VAP) * Tg / V;
  const pts = [];
  let t = 0, nextS = 0, pmin = P.ATM * 1000, maxRate = 0, tEq = null;
  const dp0 = (P.ATM - v.pt) * 1000;

  while (t <= P.BURST_S + 1e-9) {
    const dt = t < 0.05 ? 2e-5 : 1e-4;
    const pc = press(ac, vc, Vc), pt = press(at, vt, Vt);
    if (t >= nextS - 1e-12) { pts.push([t, pc / 1000, pt / 1000, Tf, flashed * 1000]); nextS += 0.002; }
    if (pc < pmin) pmin = pc;
    if (tEq === null && t > 0 && pc - pt < 0.1 * dp0) tEq = t;   // 90 % of the initial difference gone

    // 1. valve flow of the mixture (upstream properties)
    const cUp = pc >= pt;
    const aU = cUp ? ac : at, wU = cUp ? vc : vt, pU = Math.max(pc, pt), pD = Math.min(pc, pt);
    const mU = aU + wU;
    if (mU > 0 && pU - pD > 1) {
      const fa = aU / mU, fw = wU / mU;
      const R = fa * P.R_AIR + fw * P.R_VAP, k = fa * P.K_AIR + fw * P.K_VAP;
      const r = pD / pU, crit = Math.pow(2 / (k + 1), k / (k - 1));
      let md = r <= crit
        ? P.CD * A * pU * Math.sqrt(k / (R * Tg)) * Math.pow(2 / (k + 1), (k + 1) / (2 * (k - 1)))
        : P.CD * A * pU * Math.sqrt(2 * k / (R * Tg * (k - 1)) * (Math.pow(r, 2 / k) - Math.pow(r, (k + 1) / k)));
      // never overshoot pressure equality
      const dmMax = (pU - pD) / (R * Tg * (1 / Vc + 1 / Vt));
      const dm = Math.min(md * dt, dmMax);
      if (cUp) { ac -= dm * fa; vc -= dm * fw; at += dm * fa; vt += dm * fw; }
      else { at -= dm * fa; vt -= dm * fw; ac += dm * fa; vc += dm * fw; }
      const rate = md * R * Tg / Vc; if (rate > maxRate) maxRate = rate;
    }

    // 2. flash evaporation inside the food
    const Tb = tsat(press(ac, vc, Vc) / 1000);
    if (Tf > Tb && water > 0) {
      const mF = solids + water, cp = cpFood(water / mF);
      const mEq = mF * cp * (Tf - Tb) / hfg(Tf);             // water that would flash to reach Tb
      const dmv = Math.min(water, mEq * dt / P.TAU_FLASH);
      water -= dmv; flashed += dmv; vc += dmv;
      Tf -= dmv * hfg(Tf) / ((solids + water) * cpFood(water / (solids + water)));
    }

    // 3. condensation on cold walls (vapour above wall saturation pressure)
    const vcMax = pvWall * Vc / (P.R_VAP * Tg), vtMax = pvWall * Vt / (P.R_VAP * Tg);
    if (vc > vcMax) { const d = (vc - vcMax) * dt / P.TAU_COND; vc -= d; condensed += d; }
    if (vt > vtMax) { const d = (vt - vtMax) * dt / P.TAU_COND; vt -= d; condensed += d; }

    // 4. pump removes tank gas at constant volume speed
    const tankM = at + vt;
    if (tankM > 0) { const frac = Math.min(1, S * dt / Vt); at -= at * frac; vt -= vt * frac; }

    t += dt;
  }

  const pminK = pmin / 1000;
  // Drop time: until 90 % of the chamber–tank pressure difference has gone through the valve.
  const t90 = tEq === null ? P.BURST_S : tEq;
  const last = pts[pts.length - 1];
  const Pfinal = last[1];
  const Ts = tsat(pminK);
  const superheat = v.t - Ts;

  // Puff index (heuristic, calibrate with tests): superheat, drop speed vs a 0.15 s vapour-escape time, moisture.
  const rateF = 1 / (1 + t90 / 0.15);
  const shF = Math.max(0, Math.min(1, superheat / 40));
  const moistF = v.x < 0.12 ? v.x / 0.12 : (v.x > 0.6 ? Math.max(0.3, 1 - (v.x - 0.6) * 1.8) : 1);
  const idx = Math.round(100 * Math.sqrt(shF * rateF) * moistF);

  const dia = Math.cbrt(4 * v.vc / 1000 / Math.PI);
  const lidKgf = (P.ATM * 1000 - pmin) * Math.PI * dia * dia / 4 / 9.81;
  const firstPump = (Vt / S) * Math.log(P.ATM / v.pt);
  const pumpT = ((Vc + Vt) / S) * Math.log(Math.max(Pfinal, v.pt * 1.0001) / v.pt);

  return {
    pts, t90, P: Pfinal, Pmin: pminK, Pair: airEq, Ts, superheat, idx,
    ms: flashed, water: mFood0 * v.x, condensed, TfEnd: last[3],
    lidKgf, pumpT, firstPump, maxRate, pBoilFood: psat(v.t), dia
  };
}

// Whole cycle with real durations. at(phase, fraction 0..1) returns the machine state.
function cycleModel(v, r) {
  const P = PHYS, S = v.q / 3600, Vt = v.vt / 1000;
  const Vc = Math.max(v.vc - v.m / P.FOOD_DENSITY / 1000, 0.2) / 1000;
  const mF = v.m / 1000, cp0 = cpFood(v.x);
  const solids = mF * (1 - v.x);
  const waterAfterBurst = mF * v.x - r.ms;
  const massAfterBurst = mF - r.ms;
  const finalMass = solids / (1 - P.DRY_TARGET_X);
  const removeDry = Math.max(0, massAfterBurst - finalMass);
  const dryRate = P.DRY_W * P.DRY_EFF / hfg(30);            // kg/s of water
  const heatW = P.HEATER_W * P.HEAT_EFF;
  const tHeatUp = Math.max(0, mF * cp0 * (v.t - P.T_START) / heatW);
  const pvWallK = psat(P.T_WALL);

  const dur = {
    EVACUATE: Math.max(1, (Vt / S) * Math.log(P.ATM / v.pt)),
    LOAD: P.LOAD_S,
    HEAT: tHeatUp + P.HOLD_S,
    BURST: P.BURST_S,
    DRY: Math.max(10, removeDry / dryRate),
    VENT: P.VENT_S
  };
  const pAirDry0 = r.Pair * Math.exp(-S * P.BURST_S / (Vc + Vt));           // air left after the burst
  const pvDry = Math.min(dryRate * P.R_VAP * P.T_GAS / S / 1000, pvWallK);  // vapour partial pressure while drying
  const dryState = tr => {
    const pAir = P.PUMP_ULTIMATE + (pAirDry0 - P.PUMP_ULTIMATE) * Math.exp(-S * tr / (Vc + Vt));
    const p = pAir + pvDry;
    // evaporating food sits just above the boiling point at this pressure (evaporative cooling)
    const Teq = Math.min(tsat(p) + 2, 60);
    return { p, Tf: Teq + (r.TfEnd - Teq) * Math.exp(-tr / 60), removed: Math.min(removeDry, dryRate * tr) };
  };
  const dryEnd = dryState(dur.DRY);

  function interpBurst(tr) {
    const i = Math.min(r.pts.length - 2, Math.floor(tr / 0.002));
    const a = r.pts[i], b = r.pts[i + 1], f = Math.max(0, Math.min(1, (tr - a[0]) / (b[0] - a[0])));
    return a.map((x, k) => x + (b[k] - x) * f);
  }

  function at(name, f) {
    const tr = f * dur[name];
    const o = { name, tr, dur: dur[name], pc: P.ATM, pt: P.ATM, tf: P.T_START, mass: v.m,
      heater: 0, pump: false, burstOpen: false, ventOpen: true, flash: 0, dry: 0 };
    if (name === 'EVACUATE') {
      o.pt = Math.max(v.pt, P.ATM * Math.exp(-S * tr / Vt)); o.pump = true;
    } else if (name === 'LOAD') {
      o.pt = v.pt;
    } else if (name === 'HEAT') {
      o.pt = v.pt;
      o.tf = Math.min(v.t, P.T_START + heatW * tr / (mF * cp0));
      o.heater = o.tf < v.t - 0.2 ? 1 : 0.2;
      o.ventOpen = f < 0.995;
    } else if (name === 'BURST') {
      const s = interpBurst(tr);
      o.pc = s[1]; o.pt = s[2]; o.tf = s[3]; o.mass = v.m - s[4];
      o.flash = r.ms > 0 ? s[4] / (r.ms * 1000) : 0;
      o.burstOpen = true; o.ventOpen = false; o.pump = true;
    } else if (name === 'DRY') {
      const d = dryState(tr);
      o.pc = o.pt = d.p; o.tf = d.Tf; o.mass = (massAfterBurst - d.removed) * 1000;
      o.flash = 1; o.dry = removeDry > 0 ? d.removed / removeDry : 1;
      o.heater = 1; o.pump = true; o.burstOpen = true; o.ventOpen = false;
    } else if (name === 'VENT') {
      o.pc = dryEnd.p + (P.ATM - dryEnd.p) * f;             // choked inflow through the needle valve: ~linear
      o.pt = Math.max(v.pt, dryEnd.p * Math.exp(-S * tr / Vt));
      o.tf = dryEnd.Tf; o.mass = (massAfterBurst - dryEnd.removed) * 1000;
      o.flash = 1; o.dry = 1; o.pump = true;
    }
    o.boil = tsat(o.pc);
    return o;
  }

  return { dur, at, finalMassG: (massAfterBurst - dryEnd.removed) * 1000, removeDryG: removeDry * 1000, waterAfterBurst };
}

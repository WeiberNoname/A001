// Calibrate tab: fit the model's assumed values to measured runs.
//
// Fitted from the burst (first 1.5 s after the valve opens):
//   CD         valve discharge coefficient     -> how fast the chamber pressure falls
//   TAU_FLASH  flash time constant (s)         -> how quickly water boils off, shape of the dip
//   TAU_COND   wall condensation time (s)      -> the slow pressure tail after the drop
// Fitted directly from the heating segment:
//   HEAT_EFF   share of heater power reaching the food = m·cp·(dT/dt) / P_heater
//
// Method: Nelder–Mead on (CD, ln TAU_FLASH, ln TAU_COND), minimising the squared error of chamber
// and tank pressure (1 kPa scale) plus flashed mass (0.5 g scale) summed over all runs.
(() => {
  const $ = id => document.getElementById(id);
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const SIM_IDS = ['m', 'x', 't', 'vc', 'vt', 'pt', 'd', 'q'];
  const sliders = () => Object.fromEntries(SIM_IDS.map(i => [i, parseFloat($(i).value)]));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const KEYS = ['CD', 'TAU_FLASH', 'TAU_COND', 'HEAT_EFF'];
  const DEFAULTS = Object.fromEntries(KEYS.map(k => [k, PHYS[k]]));
  const INFO = {
    CD: ['Valve discharge coefficient', '', 'How freely gas flows through the burst valve (1 = ideal hole).'],
    TAU_FLASH: ['Flash time constant', 's', 'How quickly superheated water boils off inside the food.'],
    TAU_COND: ['Wall condensation time', 's', 'How quickly steam condenses on the cold walls.'],
    HEAT_EFF: ['Heater efficiency', '', 'Share of heater power that ends up in the food.']
  };

  let runs = [], fitted = null, applied = null, selected = 0;

  // ---------- storage ----------
  const store = {
    async load() {
      if (window.lab && window.lab.loadCalibration) return window.lab.loadCalibration();
      try { return JSON.parse(localStorage.getItem('vbl-calibration') || 'null'); } catch { return null; }
    },
    async save(c) {
      if (window.lab && window.lab.saveCalibration) return window.lab.saveCalibration(c);
      try { localStorage.setItem('vbl-calibration', JSON.stringify(c)); } catch {}
    }
  };

  function applyToModel(params) {
    KEYS.forEach(k => { PHYS[k] = params && params[k] != null ? params[k] : DEFAULTS[k]; });
    // refresh every tab that depends on the model
    const first = $(SIM_IDS[0]);
    first.dispatchEvent(new Event('input')); first.dispatchEvent(new Event('change'));
  }

  // ---------- run preparation ----------
  // A run: { name, source, samples:[{t,pc,pt,tf,mass,state}], v:{m,x,vc,vt,d,q} }
  function analyse(run) {
    const s = run.samples;
    let i0 = s.findIndex((p, i) => p.state === 'BURST' && (i === 0 || s[i - 1].state !== 'BURST'));
    if (i0 < 0) {   // no state column: first sample before a >15 kPa drop within 100 ms
      for (let i = 1; i < s.length && i0 < 0; i++) {
        for (let j = i; j < s.length && s[j].t - s[i].t <= 100; j++) if (s[i - 1].pc - s[j].pc > 15) { i0 = i - 1; break; }
      }
    }
    if (i0 < 0) return { ok: false, why: 'no burst found' };
    const t0 = s[i0].t;
    const burst = s.filter(p => p.t >= t0 && p.t <= t0 + 1500).map(p => ({ t: (p.t - t0) / 1000, pc: p.pc, pt: p.pt }));
    const after = s.filter(p => p.t > t0 + 1500 && p.t <= t0 + 2500 && isFinite(p.mass));
    // the scale isn't read during the 1 kHz burst, so use the last valid reading before it
    let massBefore = NaN;
    for (let i = i0; i >= 0 && !isFinite(massBefore); i--) if (isFinite(s[i].mass)) massBefore = s[i].mass;
    const massAfter = after.length ? after.reduce((a, p) => a + p.mass, 0) / after.length : NaN;
    // heating slope from the HEAT segment (needs real-time data longer than 20 s)
    const heat = s.filter(p => p.state === 'HEAT' && isFinite(p.tf));
    let slope = null, heatSpan = 0;
    if (heat.length > 5) {
      const tStart = heat[0].tf, tTop = Math.max(...heat.map(p => p.tf));
      const rise = heat.filter(p => p.tf <= tStart + 0.6 * (tTop - tStart));
      heatSpan = rise.length ? (rise[rise.length - 1].t - rise[0].t) / 1000 : 0;
      if (heatSpan > 20 && rise.length > 5) slope = linSlope(rise.map(p => p.t / 1000), rise.map(p => p.tf));
    }
    return {
      ok: burst.length > 20, why: burst.length > 20 ? '' : 'burst window has too few samples',
      burst, tFood: s[i0].tf, ptStart: s[i0].pt, massBefore, flashedG: isFinite(massAfter) && isFinite(massBefore) ? massBefore - massAfter : null,
      slope, heatSpan
    };
  }

  function linSlope(xs, ys) {
    const n = xs.length, mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
    let num = 0, den = 0; for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
    return den ? num / den : 0;
  }

  function simFor(run, a, params) {
    const saved = Object.fromEntries(KEYS.map(k => [k, PHYS[k]]));
    Object.assign(PHYS, params);
    try {
      return simulate({ ...run.v, t: a.tFood, pt: Math.max(0.5, a.ptStart), m: isFinite(a.massBefore) && a.massBefore > 0 ? a.massBefore : run.v.m });
    } finally { Object.assign(PHYS, saved); }
  }

  function interp(pts, t, k) {
    const i = Math.min(pts.length - 2, Math.max(0, Math.floor(t / 0.002)));
    const a = pts[i], b = pts[i + 1], f = Math.max(0, Math.min(1, (t - a[0]) / (b[0] - a[0])));
    return a[k] + (b[k] - a[k]) * f;
  }

  function runError(run, a, params) {
    const r = simFor(run, a, params);
    let e = 0, n = 0;
    for (const p of a.burst) {
      const dc = (p.pc - interp(r.pts, p.t, 1)) / 1.0, dt = (p.pt - interp(r.pts, p.t, 2)) / 1.0;
      e += dc * dc + 0.5 * dt * dt; n++;
    }
    let err = e / Math.max(1, n);
    if (a.flashedG != null) { const dm = (a.flashedG - r.ms * 1000) / 0.5; err += dm * dm; }
    return err;
  }

  function rmsPressure(run, a, params) {
    const r = simFor(run, a, params);
    let e = 0; for (const p of a.burst) { const d = p.pc - interp(r.pts, p.t, 1); e += d * d; }
    return Math.sqrt(e / a.burst.length);
  }

  // ---------- Nelder–Mead on transformed parameters ----------
  const toX = p => [p.CD, Math.log(p.TAU_FLASH), Math.log(p.TAU_COND)];
  const fromX = x => ({
    CD: Math.max(0.2, Math.min(1.0, x[0])),
    TAU_FLASH: Math.exp(Math.max(Math.log(0.002), Math.min(Math.log(0.5), x[1]))),
    TAU_COND: Math.exp(Math.max(Math.log(0.02), Math.min(Math.log(5), x[2])))
  });

  async function nelderMead(f, x0, steps, maxIter, onIter) {
    const n = x0.length;
    let simplex = [x0, ...steps.map((s, i) => x0.map((v, j) => v + (i === j ? s : 0)))];
    let vals = [];
    for (const x of simplex) vals.push(f(x));
    for (let it = 0; it < maxIter; it++) {
      const order = vals.map((v, i) => i).sort((a, b) => vals[a] - vals[b]);
      simplex = order.map(i => simplex[i]); vals = order.map(i => vals[i]);
      if (Math.abs(vals[n] - vals[0]) < 1e-6 * (1 + Math.abs(vals[0]))) break;
      const c = x0.map((_, j) => simplex.slice(0, n).reduce((a, x) => a + x[j], 0) / n);
      const at = k => c.map((cj, j) => cj + k * (simplex[n][j] - cj));
      const xr = at(-1), fr = f(xr);
      if (fr < vals[0]) { const xe = at(-2), fe = f(xe); if (fe < fr) { simplex[n] = xe; vals[n] = fe; } else { simplex[n] = xr; vals[n] = fr; } }
      else if (fr < vals[n - 1]) { simplex[n] = xr; vals[n] = fr; }
      else {
        const xc = at(0.5), fc = f(xc);
        if (fc < vals[n]) { simplex[n] = xc; vals[n] = fc; }
        else for (let i = 1; i <= n; i++) { simplex[i] = simplex[i].map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j])); vals[i] = f(simplex[i]); }
      }
      if (onIter) { onIter(it, vals[0]); await new Promise(r => setTimeout(r, 0)); }
    }
    const best = vals.indexOf(Math.min(...vals));
    return { x: simplex[best], value: vals[best] };
  }

  async function fit() {
    const usable = runs.map(r => ({ run: r, a: analyse(r) })).filter(o => o.a.ok);
    if (!usable.length) { $('calStatus').textContent = 'Add at least one run with a burst first.'; return; }
    $('calFit').disabled = true;
    const base = Object.fromEntries(KEYS.map(k => [k, PHYS[k]]));
    const total = p => usable.reduce((s, o) => s + runError(o.run, o.a, { ...base, ...p }), 0) / usable.length;
    const before = total({});
    const res = await nelderMead(x => total(fromX(x)), toX(base), [0.1, 0.7, 0.7], 120,
      (it, v) => { $('calStatus').textContent = `Fitting… iteration ${it + 1}, error ${v.toFixed(3)}`; });
    const p = fromX(res.x);
    // heater efficiency: direct from heating slopes
    const effs = usable.filter(o => o.a.slope != null).map(o => {
      const m = (isFinite(o.a.massBefore) && o.a.massBefore > 0 ? o.a.massBefore : o.run.v.m) / 1000;
      return m * cpFood(o.run.v.x) * o.a.slope / PHYS.HEATER_W;
    });
    p.HEAT_EFF = effs.length ? Math.max(0.05, Math.min(1, effs.reduce((a, b) => a + b) / effs.length)) : base.HEAT_EFF;
    fitted = {
      params: p, runs: usable.length, heatRuns: effs.length, date: new Date().toISOString(),
      errBefore: before, errAfter: res.value,
      rmsBefore: usable.map(o => rmsPressure(o.run, o.a, base)), rmsAfter: usable.map(o => rmsPressure(o.run, o.a, { ...base, ...p }))
    };
    $('calFit').disabled = false;
    $('calStatus').textContent = `Done. Fitted on ${usable.length} run${usable.length > 1 ? 's' : ''}` + (effs.length ? `, heater efficiency from ${effs.length}.` : '. No real-time heating data, so heater efficiency was kept.');
    renderResults(); renderChart();
  }

  // ---------- sources of runs ----------
  function addRun(name, source, samples, v) {
    runs.push({ name, source, samples, v: { ...v } });
    selected = runs.length - 1; renderRuns(); renderChart();
  }

  function fromLive() {
    const s = window.VBLLive && window.VBLLive.getRun();
    if (!s || s.length < 50) { $('calStatus').textContent = 'No recorded run on the Live test tab yet.'; return; }
    addRun(`Live run ${new Date().toLocaleTimeString()}`, 'Live test tab', s, sliders());
  }

  function parseCsv(text) {
    const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
    const head = lines[0].split(',').map(h => h.trim());
    const col = n => head.indexOf(n);
    const ci = { t: col('t_ms'), pc: col('chamber_kPa'), pt: col('tank_kPa'), tf: col('food_C'), m: col('mass_g'), st: col('state') };
    if (ci.t < 0 || ci.pc < 0 || ci.pt < 0) throw new Error('expected columns t_ms, chamber_kPa, tank_kPa');
    return lines.slice(1).map(l => {
      const c = l.split(',');
      return { t: +c[ci.t], pc: +c[ci.pc], pt: +c[ci.pt], tf: ci.tf >= 0 ? +c[ci.tf] : NaN, mass: ci.m >= 0 ? +c[ci.m] : NaN, state: ci.st >= 0 ? (c[ci.st] || '').trim() : '' };
    }).filter(p => isFinite(p.t) && isFinite(p.pc));
  }

  // Synthetic run with known "true" values, to check that the fitter recovers them.
  const TRUTH = { CD: 0.55, TAU_FLASH: 0.06, TAU_COND: 0.8, HEAT_EFF: 0.45 };
  function synthetic() {
    const v = sliders();
    const saved = Object.fromEntries(KEYS.map(k => [k, PHYS[k]]));
    Object.assign(PHYS, TRUTH);
    let r; try { r = simulate(v); } finally { Object.assign(PHYS, saved); }
    const noise = a => (Math.random() - 0.5) * 2 * a;
    const s = [];
    const cp = cpFood(v.x), m = v.m / 1000, rate = TRUTH.HEAT_EFF * PHYS.HEATER_W / (m * cp);   // K/s
    const tHeat = (v.t - 25) / rate;
    for (let t = 0; t <= tHeat + 20; t += 1) s.push({ t: t * 1000, pc: 101.3 + noise(0.2), pt: v.pt + noise(0.1), tf: Math.min(v.t, 25 + rate * t) + noise(0.2), mass: v.m + noise(0.2), state: 'HEAT' });
    const t0 = s[s.length - 1].t + 20;
    for (let k = 0; k <= 1500; k++) {
      const p = r.pts[Math.min(r.pts.length - 1, Math.floor(k / 2))];
      s.push({ t: t0 + k, pc: p[1] + noise(0.3), pt: p[2] + noise(0.2), tf: p[3] + noise(0.2), mass: NaN, state: 'BURST' });
    }
    for (let k = 1; k <= 50; k++) s.push({ t: t0 + 1500 + k * 20, pc: r.P + noise(0.3), pt: r.P + noise(0.2), tf: r.TfEnd, mass: v.m - r.ms * 1000 + noise(0.1), state: 'DRY' });
    addRun('Synthetic test (known values)', 'generated', s, v);
    $('calStatus').textContent = `Synthetic run added. True values: CD ${TRUTH.CD}, flash ${TRUTH.TAU_FLASH} s, condensation ${TRUTH.TAU_COND} s, heater ${TRUTH.HEAT_EFF}. Fit should recover them.`;
  }

  // ---------- rendering ----------
  const num = (id, val, step, lbl) => `<label class="calin">${lbl}<input type="number" step="${step}" value="${val}" data-f="${id}"></label>`;
  function renderRuns() {
    const box = $('calRuns');
    if (!runs.length) { box.innerHTML = '<p class="note">No runs yet. Add the current Live run, import a CSV exported from the Live tab, or generate a synthetic test run.</p>'; return; }
    box.innerHTML = runs.map((r, i) => {
      const a = analyse(r);
      const info = a.ok
        ? `burst found · food ${isFinite(a.tFood) ? a.tFood.toFixed(0) : '–'} °C · tank ${a.ptStart.toFixed(1)} kPa · flashed ${a.flashedG != null ? a.flashedG.toFixed(1) + ' g' : '–'} · heating ${a.slope != null ? 'usable' : 'not usable'}`
        : `<span style="color:var(--bad)">${esc(a.why)}</span>`;
      return `<div class="calrun ${i === selected ? 'on' : ''}" data-i="${i}">
        <div class="row" style="justify-content:space-between">
          <button type="button" class="calname" data-sel="${i}">${esc(r.name)}</button>
          <button type="button" class="del" data-del="${i}">Remove</button>
        </div>
        <div class="note">${esc(r.source)} · ${r.samples.length} samples · ${info}</div>
        <div class="row calfields" data-i="${i}">
          ${num('m', r.v.m, 1, 'Food g')}${num('x', r.v.x, 0.01, 'Moisture')}${num('vc', r.v.vc, 0.5, 'Chamber L')}${num('vt', r.v.vt, 1, 'Tank L')}${num('d', r.v.d, 1, 'Valve mm')}${num('q', r.v.q, 1, 'Pump m³/h')}
        </div>
      </div>`;
    }).join('');
    box.querySelectorAll('[data-sel]').forEach(b => b.addEventListener('click', () => { selected = +b.dataset.sel; renderRuns(); renderChart(); }));
    box.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => { runs.splice(+b.dataset.del, 1); selected = Math.max(0, Math.min(selected, runs.length - 1)); renderRuns(); renderChart(); }));
    box.querySelectorAll('.calfields input').forEach(inp => inp.addEventListener('change', () => {
      const i = +inp.closest('.calfields').dataset.i; runs[i].v[inp.dataset.f] = parseFloat(inp.value); renderChart();
    }));
  }

  function fmtP(k, v) { return k === 'CD' || k === 'HEAT_EFF' ? v.toFixed(2) : v.toFixed(3); }
  function renderResults() {
    const box = $('calResults');
    if (!fitted) { box.innerHTML = '<p class="note">No fit yet.</p>'; $('calApply').disabled = true; return; }
    const rows = KEYS.map(k => `<tr><td>${INFO[k][0]}<div class="note">${INFO[k][2]}</div></td><td class="n">${fmtP(k, DEFAULTS[k])} ${INFO[k][1]}</td><td class="n"><b>${fmtP(k, fitted.params[k])}</b> ${INFO[k][1]}</td>${runs.some(r => r.source === 'generated') ? `<td class="n">${fmtP(k, TRUTH[k])}</td>` : ''}</tr>`).join('');
    const rb = fitted.rmsBefore.reduce((a, b) => a + b, 0) / fitted.rmsBefore.length, ra = fitted.rmsAfter.reduce((a, b) => a + b, 0) / fitted.rmsAfter.length;
    box.innerHTML = `<div class="tablewrap"><table>
      <thead><tr><th>Value</th><th style="text-align:right">Default</th><th style="text-align:right">Fitted</th>${runs.some(r => r.source === 'generated') ? '<th style="text-align:right">True (synthetic)</th>' : ''}</tr></thead>
      <tbody>${rows}</tbody></table></div>
      <p class="note">Chamber pressure error (RMS): <b>${rb.toFixed(2)} kPa</b> with defaults → <b>${ra.toFixed(2)} kPa</b> fitted, over ${fitted.runs} run${fitted.runs > 1 ? 's' : ''}. Sensor noise is typically 0.2–0.5 kPa, so a fitted error in that range means the model explains the data.</p>`;
    $('calApply').disabled = false;
  }

  function renderApplied() {
    $('calModel').textContent = applied
      ? `The model is using calibrated values from ${new Date(applied.date).toLocaleString()} (${applied.runs} run${applied.runs > 1 ? 's' : ''}).`
      : 'The model is using the default (assumed) values.';
    $('calReset').disabled = !applied;
  }

  function renderChart() {
    const cv = $('calChart'); const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (!w) return;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const L = 44, R = 12, T = 12, B = 30;
    const run = runs[selected], a = run && analyse(run);
    g.font = '11px ' + css('--mono'); g.fillStyle = css('--muted');
    if (!run || !a.ok) { g.textAlign = 'center'; g.fillText(run ? 'This run has no usable burst' : 'Add a run to compare', w / 2, h / 2); return; }
    const tMax = 0.6, X = t => L + t / tMax * (w - L - R), Y = p => T + (1 - p / 110) * (h - T - B);
    g.strokeStyle = css('--line'); g.lineWidth = 1;
    for (let p = 0; p <= 100; p += 25) { g.beginPath(); g.moveTo(L, Y(p)); g.lineTo(w - R, Y(p)); g.stroke(); g.textAlign = 'right'; g.fillText(p, L - 6, Y(p) + 4); }
    g.textAlign = 'center';
    for (let t = 0; t <= tMax + 1e-9; t += 0.1) g.fillText(Math.round(t * 1000) + ' ms', X(t), h - B + 16);
    const line = (pts, k, color, width, dash) => {
      g.strokeStyle = color; g.lineWidth = width; g.setLineDash(dash || []); g.beginPath();
      let first = true; for (const p of pts) { if (p[0] > tMax) break; const x = X(p[0]), y = Y(p[k]); if (first) { g.moveTo(x, y); first = false; } else g.lineTo(x, y); }
      g.stroke(); g.setLineDash([]);
    };
    const base = Object.fromEntries(KEYS.map(k => [k, DEFAULTS[k]]));
    line(simFor(run, a, base).pts, 1, css('--muted'), 1.5, [6, 4]);
    if (fitted) line(simFor(run, a, { ...base, ...fitted.params }).pts, 1, css('--teal'), 2.2);
    const meas = a.burst.map(p => [p.t, p.pc]);
    g.fillStyle = css('--amber');
    for (const [t, p] of meas) { if (t > tMax) break; g.fillRect(X(t) - 1, Y(p) - 1, 2, 2); }
  }

  // ---------- wiring ----------
  $('calAddLive').addEventListener('click', fromLive);
  $('calSynth').addEventListener('click', synthetic);
  $('calImport').addEventListener('change', async e => {
    for (const f of e.target.files) {
      try { addRun(f.name, 'imported CSV', parseCsv(await f.text()), sliders()); }
      catch (err) { $('calStatus').textContent = `Could not read ${f.name}: ${err.message}`; }
    }
    e.target.value = '';
  });
  $('calFit').addEventListener('click', fit);
  $('calApply').addEventListener('click', async () => {
    applied = { ...fitted.params, date: fitted.date, runs: fitted.runs };
    await store.save(applied); applyToModel(applied); renderApplied();
    $('calStatus').textContent = 'Applied. The Simulator, Machine and Live tabs now use the calibrated values.';
  });
  $('calReset').addEventListener('click', async () => {
    applied = null; await store.save(null); applyToModel(null); renderApplied();
    $('calStatus').textContent = 'Back to the default values.';
  });
  document.querySelectorAll('[data-tab="cal"]').forEach(b => b.addEventListener('click', () => setTimeout(renderChart, 0)));
  window.addEventListener('resize', renderChart);

  renderRuns(); renderResults();
  store.load().then(c => { if (c && KEYS.some(k => c[k] != null)) { applied = c; applyToModel(c); } renderApplied(); });
})();

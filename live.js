// Live test station: ESP32 over USB serial (Web Serial), demo device, burst analysis, batch log.
(() => {
  const $ = id => document.getElementById(id);
  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const SIM_IDS = ['m', 'x', 't', 'vc', 'vt', 'pt', 'd', 'q'];
  const settings = () => Object.fromEntries(SIM_IDS.map(i => [i, parseFloat($(i).value)]));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => (v === '' || v == null || !isFinite(+v)) ? null : +v;

  // ---------- tabs ----------
  document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('[data-tab]').forEach(x => x.setAttribute('aria-selected', String(x === b)));
    document.querySelectorAll('.tabpane').forEach(p => { p.hidden = p.id !== 'tab-' + b.dataset.tab; });
    dirty = true;
  }));

  // ---------- run state ----------
  let run = [];          // samples: {t, pc, pt, tf, mass, state}
  let burst = null;      // {t0, p0, massBefore, tf, done, metrics}
  let lastState = '';
  let source = null;     // {stop()}
  let dirty = true;
  const MAX_SAMPLES = 400000;

  function resetRun() {
    run = []; burst = null; lastState = '';
    $('cmp').innerHTML = '<p class="note">Waiting for a burst. It\'s detected from the device\'s BURST state, or from a chamber drop of more than 15 kPa within 100 ms.</p>';
    dirty = true;
  }

  function ingest(s) {
    if (run.length >= MAX_SAMPLES) run.splice(0, 10000);
    run.push(s);
    if (!burst) {
      let hit = s.state === 'BURST' && lastState !== 'BURST';
      if (!hit && !s.state) {
        for (let i = run.length - 1; i >= 0 && s.t - run[i].t <= 100; i--) {
          if (run[i].pc - s.pc > 15) { hit = true; break; }
        }
      }
      if (hit) {
        // Burst start: the first BURST sample, or the last sample before the chamber
        // fell 2 kPa below its level in the preceding 200 ms (robust to sensor noise).
        let start = run.length - 1;
        if (!s.state) {
          let lo = run.length - 1;
          while (lo > 0 && s.t - run[lo - 1].t <= 200) lo--;
          const top = Math.max(...run.slice(lo).map(r => r.pc));
          start = run.findIndex((r, i) => i >= lo && r.pc < top - 2);
          start = Math.max(lo, start - 1);
        }
        const b = run[start];
        burst = { t0: b.t, p0: b.pc, massBefore: b.mass, tf: b.tf, done: false, metrics: null };
        if (isFinite(b.mass)) $('b_m0').value = b.mass.toFixed(1);
      }
    } else if (!burst.done && s.t - burst.t0 > 1500) {
      burst.done = true;
      analyseBurst();
    }
    if (s.state) lastState = s.state;
    dirty = true;
  }

  function analyseBurst() {
    const win = run.filter(s => s.t >= burst.t0 && s.t <= burst.t0 + 1500);
    if (win.length < 3) return;
    const pmin = Math.min(...win.map(s => s.pc));
    const target = burst.p0 - 0.9 * (burst.p0 - pmin);
    const hit = win.find(s => s.pc <= target);
    const tail = win.filter(s => s.t >= burst.t0 + 1300);
    const pFinal = tail.reduce((a, s) => a + s.pc, 0) / Math.max(1, tail.length);
    const v = settings();
    if (isFinite(burst.tf)) v.t = burst.tf;
    if (isFinite(burst.massBefore) && burst.massBefore > 0) v.m = burst.massBefore;
    const sim = simulate(v); // from the Simulator tab
    burst.sim = sim;
    burst.metrics = {
      t90: hit ? hit.t - burst.t0 : null,
      pFinal,
      simT90: sim.t90 * 1000,
      simP: sim.P,
      foodC: burst.tf,
      massBefore: burst.massBefore
    };
    const m = burst.metrics;
    const row = (k, meas, simv, unit, dp = 1) => {
      const d = (meas != null && simv != null) ? meas - simv : null;
      return `<tr><td>${k}</td><td class="n">${meas == null ? '–' : meas.toFixed(dp)} ${unit}</td><td class="n">${simv == null ? '–' : simv.toFixed(dp)} ${unit}</td><td class="n">${d == null ? '–' : (d > 0 ? '+' : '') + d.toFixed(dp)}</td></tr>`;
    };
    $('cmp').innerHTML = `<div class="tablewrap"><table>
      <thead><tr><th>Burst result</th><th style="text-align:right">Measured</th><th style="text-align:right">Simulated</th><th style="text-align:right">Difference</th></tr></thead>
      <tbody>${row('Pressure drop time (90%)', m.t90, m.simT90, 'ms', 0)}${row('Final chamber pressure', m.pFinal, m.simP, 'kPa')}</tbody></table></div>
      <p class="note">Simulated with the Simulator tab's hardware settings, using the measured food temperature (${isFinite(m.foodC) ? m.foodC.toFixed(1) : '–'} °C) and mass. A measured drop much slower than simulated usually means a restriction in the valve or hose.</p>`;
    if (last() && isFinite(last().mass)) $('b_m1').value = last().mass.toFixed(1);
  }

  const last = () => run[run.length - 1];

  // ---------- gauges ----------
  function updateGauges() {
    const s = last();
    const set = (id, v, unit, dp) => { $(id).innerHTML = (v == null || !isFinite(v)) ? '–' : v.toFixed(dp) + `<span>${unit}</span>`; };
    set('l_pc', s?.pc, 'kPa', 1); set('l_pt', s?.pt, 'kPa', 1); set('l_tf', s?.tf, '°C', 1); set('l_m', s?.mass, 'g', 1);
    const pill = $('statePill');
    pill.textContent = source ? (s?.state || 'STREAMING') : 'OFFLINE';
    pill.className = 'pill' + (source ? (s?.state === 'BURST' ? ' burst' : ' on') : '');
  }

  // ---------- plotting ----------
  function setupCanvas(c) {
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    return { g, w, h };
  }

  function axes(g, w, h, L, R, T, B, yMax, yStep, xLabels, rightMax) {
    g.font = '11px ' + css('--mono'); g.fillStyle = css('--muted'); g.strokeStyle = css('--line'); g.lineWidth = 1;
    for (let v = 0; v <= yMax; v += yStep) {
      const y = T + (1 - v / yMax) * (h - T - B);
      g.beginPath(); g.moveTo(L, y); g.lineTo(w - R, y); g.stroke();
      g.textAlign = 'right'; g.fillText(v, L - 6, y + 4);
      if (rightMax) { g.textAlign = 'left'; g.fillText(Math.round(v / yMax * rightMax), w - R + 6, y + 4); }
    }
    g.textAlign = 'center';
    xLabels.forEach(([x, label]) => g.fillText(label, x, h - B + 18));
  }

  function line(g, pts, color, width, dash) {
    if (pts.length < 2) return;
    g.strokeStyle = color; g.lineWidth = width; g.setLineDash(dash || []);
    g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke(); g.setLineDash([]);
  }

  function drawOverview() {
    const { g, w, h } = setupCanvas($('ov'));
    const L = 40, R = 40, T = 10, B = 28, span = 30000;
    const tEnd = run.length ? last().t : 0, tStart = tEnd - span;
    const x = t => L + (t - tStart) / span * (w - L - R);
    const yP = p => T + (1 - Math.max(0, Math.min(110, p)) / 110) * (h - T - B);
    const yT = c => T + (1 - Math.max(0, Math.min(121, c)) / 121) * (h - T - B);
    const labels = [0, 5, 10, 15, 20, 25, 30].map(s => [x(tStart + s * 1000), (s - 30) + ' s']);
    axes(g, w, h, L, R, T, B, 110, 22, labels, 121);
    let i = run.length - 1; while (i > 0 && run[i - 1].t >= tStart) i--;
    const slice = run.slice(i), step = Math.max(1, Math.floor(slice.length / 1500));
    const pick = slice.filter((_, k) => k % step === 0);
    line(g, pick.filter(s => isFinite(s.tf)).map(s => [x(s.t), yT(s.tf)]), css('--bad'), 1.6);
    line(g, pick.map(s => [x(s.t), yP(s.pt)]), css('--teal'), 2);
    line(g, pick.map(s => [x(s.t), yP(s.pc)]), css('--amber'), 2.2);
    if (!run.length) { g.fillStyle = css('--muted'); g.textAlign = 'center'; g.fillText('No data yet', w / 2, h / 2); }
  }

  function drawBurst() {
    const { g, w, h } = setupCanvas($('bc'));
    const L = 40, R = 14, T = 10, B = 28, span = 1500;
    const x = ms => L + ms / span * (w - L - R);
    const y = p => T + (1 - Math.max(0, Math.min(110, p)) / 110) * (h - T - B);
    axes(g, w, h, L, R, T, B, 110, 22, [0, 250, 500, 750, 1000, 1250, 1500].map(ms => [x(ms), ms + ' ms']));
    if (!burst) { g.fillStyle = css('--muted'); g.textAlign = 'center'; g.fillText('Waiting for a burst', w / 2, h / 2); return; }
    if (burst.sim) {
      const pts = burst.sim.pts, endP = pts[pts.length - 1];
      const ext = [...pts, [1.5, endP[1], endP[2]]];
      line(g, ext.map(p => [x(p[0] * 1000), y(p[1])]), css('--muted'), 1.5, [6, 4]);
      line(g, ext.map(p => [x(p[0] * 1000), y(p[2])]), css('--muted'), 1.5, [2, 4]);
    }
    const win = run.filter(s => s.t >= burst.t0 && s.t <= burst.t0 + span);
    line(g, win.map(s => [x(s.t - burst.t0), y(s.pt)]), css('--teal'), 2);
    line(g, win.map(s => [x(s.t - burst.t0), y(s.pc)]), css('--amber'), 2.4);
  }

  function frame() {
    if (dirty && !$('tab-live').hidden) { drawOverview(); drawBurst(); updateGauges(); dirty = false; }
    requestAnimationFrame(frame);
  }
  window.addEventListener('resize', () => { dirty = true; });

  // ---------- connection UI ----------
  function status(msg) { $('connStatus').textContent = msg; }
  function setRunning(on) {
    $('btnConnect').disabled = on; $('btnDemo').disabled = on; $('btnDisconnect').disabled = !on;
    if (!on) source = null;
    dirty = true;
  }
  function devlog(line) {
    const el = $('devlog');
    const lines = (el.textContent ? el.textContent.split('\n') : []).concat(line).slice(-12);
    el.textContent = lines.join('\n'); el.scrollTop = el.scrollHeight;
  }

  $('btnDisconnect').addEventListener('click', async () => {
    const s = source; setRunning(false);
    if (s) await s.stop();
    status('Stopped. The recorded run stays on screen until you connect again.');
  });

  // ---------- demo device ----------
  $('btnDemo').addEventListener('click', () => {
    const v = settings(), r = simulate(v);
    const phases = [['EVACUATE', 6000], ['LOAD', 1000], ['HEAT', 7000], ['BURST', 1500], ['DRY', 6000], ['VENT', 2500]];
    const cool = r.Ts + 3, steam = r.P - r.Pair;
    const massAfterBurst = v.m - r.ms * 1000 * (1 - Math.exp(-1500 / 200));
    const dryLoss = Math.max(0, r.water - r.ms) * 1000 * 0.3;
    const pDryEnd = v.pt + (r.P - v.pt) * Math.exp(-6000 / 1500);
    const tfDryEnd = cool + (55 - cool) * (1 - Math.exp(-6000 / 2000));
    const noise = a => (Math.random() - 0.5) * a;
    const simAt = ms => { const p = r.pts; return p[Math.min(p.length - 1, Math.floor(ms / 2))]; };
    let t = 0, ph = 0, phT = 0;

    function sample() {
      const [name] = phases[ph];
      let pc = 101.3, pt = 101.3, tf = 25, mass = v.m;
      if (name === 'EVACUATE' || name === 'LOAD') {
        pt = v.pt + (101.3 - v.pt) * Math.exp(-(name === 'LOAD' ? 6000 + phT : phT) / 1200);
      } else if (name === 'HEAT') {
        pt = v.pt; tf = 25 + (v.t - 25) * (1 - Math.exp(-phT / 1800));
      } else if (name === 'BURST') {
        const p = simAt(phT), k = 1 - Math.exp(-phT / 25);
        pc = p[1] + steam * k; pt = p[2] + steam * k;
        tf = v.t - (v.t - cool) * (1 - Math.exp(-phT / 200));
        mass = v.m - r.ms * 1000 * (1 - Math.exp(-phT / 200));
      } else if (name === 'DRY') {
        pc = pt = v.pt + (r.P - v.pt) * Math.exp(-phT / 1500);
        tf = cool + (55 - cool) * (1 - Math.exp(-phT / 2000));
        mass = massAfterBurst - dryLoss * (1 - Math.exp(-phT / 2500));
      } else if (name === 'VENT') {
        pc = 101.3 - (101.3 - pDryEnd) * Math.exp(-phT / 600); pt = pDryEnd;
        tf = tfDryEnd; mass = massAfterBurst - dryLoss * (1 - Math.exp(-6000 / 2500));
      }
      return { t, pc: pc + noise(0.3), pt: pt + noise(0.2), tf: tf + noise(0.3), mass: mass + noise(0.4), state: name };
    }

    resetRun();
    const wallStart = performance.now();
    const timer = setInterval(() => {

      // Catch up to the wall clock so the demo keeps real time when the window is in the background.
      const target = performance.now() - wallStart;
      while (t < target) {
        const step = phases[ph][0] === 'BURST' ? 1 : 10;
        ingest(sample());
        t += step; phT += step;
        if (phT >= phases[ph][1]) {
          if (ph === phases.length - 1) {
            ingest({ ...sample(), state: 'IDLE' });
            clearInterval(timer); setRunning(false);
            status('Demo finished. Try saving it as a batch, or change the Simulator settings and run it again.');
            return;
          }
          phT = 0; ph++;
        }
      }
    }, 20);
    source = { stop: async () => clearInterval(timer) };
    setRunning(true);
    status(`Demo device running (about 24 s): evacuate → load → heat to ${v.t} °C → burst → dry → vent.`);
    devlog('[demo] started with Simulator settings');
  });

  // ---------- serial (ESP32) ----------
  if (window.lab) {
    window.lab.onPorts(list => {
      const box = $('portList');
      box.hidden = false;
      if (!list.length) {
        box.innerHTML = '<p class="note" style="margin:0">No serial ports found. Plug in the ESP32 with a data USB cable and install its USB driver (CP210x or CH340).</p><button type="button" class="btn" data-port="">Cancel</button>';
      } else {
        box.innerHTML = '<p class="note" style="margin:0">Choose the ESP32 port:</p>' +
          list.map(p => `<button type="button" class="btn" data-port="${esc(p.portId)}">${esc(p.name)}${p.portName && p.portName !== p.name ? ' — ' + esc(p.portName) : ''}</button>`).join('') +
          '<button type="button" class="btn" data-port="">Cancel</button>';
      }
      box.querySelectorAll('[data-port]').forEach(b => b.addEventListener('click', () => {
        window.lab.choosePort(b.dataset.port); box.hidden = true; box.innerHTML = '';
      }));
    });
  }

  function parseLine(lineText) {
    if (!lineText) return;
    if (lineText.startsWith('D,')) {
      const p = lineText.split(',');
      const s = { t: +p[1], pc: +p[2], pt: +p[3], tf: +p[4], mass: +p[5], state: (p[6] || '').trim() };
      if (isFinite(s.t) && isFinite(s.pc) && isFinite(s.pt)) ingest(s);
    } else {
      devlog(lineText);
    }
  }

  $('btnConnect').addEventListener('click', async () => {
    if (!('serial' in navigator)) { status('Serial access is not available in this build.'); return; }
    let port;
    try {
      port = await navigator.serial.requestPort();
    } catch {
      status('No port chosen.');
      return;
    }
    try {
      await port.open({ baudRate: parseInt($('baud').value, 10) });
    } catch (e) {
      status('Could not open the port: ' + e.message + '. Close any other program using it (Arduino Serial Monitor) and try again.');
      return;
    }
    const decoder = new TextDecoderStream();
    const piped = port.readable.pipeTo(decoder.writable).catch(() => {});
    const reader = decoder.readable.getReader();
    let stopping = false;
    source = {
      stop: async () => {
        stopping = true;
        try { await reader.cancel(); } catch {}
        await piped;
        try { await port.close(); } catch {}
      }
    };
    resetRun(); setRunning(true);
    status('Connected. Waiting for data lines (D,…).');
    let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let k;
        while ((k = buf.indexOf('\n')) >= 0) { parseLine(buf.slice(0, k).trim()); buf = buf.slice(k + 1); }
        if (buf.length > 10000) buf = '';
      }
    } catch (e) {
      if (!stopping) status('Connection lost: ' + e.message);
    }
    if (!stopping) { setRunning(false); try { await port.close(); } catch {} }
  });

  // ---------- batches ----------
  let batches = [];
  const store = {
    async load() {
      if (window.lab) return window.lab.loadBatches();
      try { return JSON.parse(localStorage.getItem('vbl-batches') || '[]'); } catch { return []; }
    },
    async save(b) {
      if (window.lab) return window.lab.saveBatches(b);
      try { localStorage.setItem('vbl-batches', JSON.stringify(b)); } catch {}
    }
  };

  function renderLog() {
    const fmt = (v, dp, unit = '') => v == null || !isFinite(v) ? '–' : v.toFixed(dp) + unit;
    $('logBody').innerHTML = batches.length ? batches.slice().reverse().map(b => {
      const m = b.measured || {};
      const exp = b.volBefore && b.volAfter ? b.volAfter / b.volBefore : null;
      const loss = b.massBefore && b.massAfter != null ? 100 * (b.massBefore - b.massAfter) / b.massBefore : null;
      return `<tr><td>${esc(new Date(b.date).toLocaleString())}</td><td>${esc(b.recipe) || '–'}${b.notes ? `<div class="note">${esc(b.notes)}</div>` : ''}</td>
        <td class="n">${fmt(m.foodC, 1)}</td><td class="n">${fmt(m.t90, 0)} / ${fmt(m.simT90, 0)}</td><td class="n">${fmt(m.pFinal, 1)}</td>
        <td class="n">${fmt(exp, 2, '×')}</td><td class="n">${fmt(loss, 1, '%')}</td><td class="n">${b.crunch || '–'}</td>
        <td><button type="button" class="del" data-del="${b.id}">Delete</button></td></tr>`;
    }).join('') : '<tr><td colspan="9" class="note">No batches saved yet.</td></tr>';
    $('logBody').querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', async () => {
      batches = batches.filter(b => String(b.id) !== btn.dataset.del);
      await store.save(batches); renderLog();
    }));
  }

  $('batchForm').addEventListener('submit', async e => {
    e.preventDefault();
    const b = {
      id: Date.now(),
      date: new Date().toISOString(),
      recipe: $('b_recipe').value.trim(),
      massBefore: num($('b_m0').value), massAfter: num($('b_m1').value),
      volBefore: num($('b_v0').value), volAfter: num($('b_v1').value),
      crunch: num($('b_crunch').value),
      notes: $('b_notes').value.trim(),
      settings: settings(),
      measured: burst?.metrics || null
    };
    batches.push(b);
    await store.save(batches);
    renderLog();
    $('saveMsg').textContent = 'Saved.' + (b.measured ? '' : ' No burst was recorded, so only your measurements were stored.');
  });

  async function saveCsv(name, rows) {
    const content = rows.map(r => r.map(c => {
      const s = c == null ? '' : String(c);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\r\n');
    if (window.lab) {
      const path = await window.lab.saveCsv(name, '﻿' + content);
      if (path) $('saveMsg').textContent = 'Exported to ' + path;
    }
  }

  $('btnRawCsv').addEventListener('click', () => {
    if (!run.length) { $('saveMsg').textContent = 'Nothing recorded yet.'; return; }
    saveCsv(`run-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`,
      [['t_ms', 'chamber_kPa', 'tank_kPa', 'food_C', 'mass_g', 'state'], ...run.map(s => [s.t, s.pc.toFixed(3), s.pt.toFixed(3), s.tf, s.mass, s.state])]);
  });

  $('btnLogCsv').addEventListener('click', () => {
    if (!batches.length) { $('saveMsg').textContent = 'No batches to export yet.'; return; }
    const head = ['date', 'recipe', 'mass_before_g', 'mass_after_g', 'vol_before_mL', 'vol_after_mL', 'expansion', 'crunch', 'food_C', 'drop90_meas_ms', 'drop90_sim_ms', 'final_meas_kPa', 'final_sim_kPa', ...SIM_IDS.map(i => 'sim_' + i), 'notes'];
    saveCsv('batch-log.csv', [head, ...batches.map(b => {
      const m = b.measured || {};
      return [b.date, b.recipe, b.massBefore, b.massAfter, b.volBefore, b.volAfter,
        b.volBefore && b.volAfter ? (b.volAfter / b.volBefore).toFixed(3) : '', b.crunch,
        m.foodC?.toFixed?.(1), m.t90, m.simT90?.toFixed?.(0), m.pFinal?.toFixed?.(2), m.simP?.toFixed?.(2),
        ...SIM_IDS.map(i => b.settings?.[i]), b.notes];
    })]);
  });

  store.load().then(b => { batches = Array.isArray(b) ? b : []; renderLog(); });
  resetRun();
  requestAnimationFrame(frame);
})();

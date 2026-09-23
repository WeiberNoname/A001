// Machine tab: animated 2D cutaway of one full cycle, driven by the same physics as the Simulator.
(() => {
  const $ = id => document.getElementById(id);
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const SIM_IDS = ['m', 'x', 't', 'vc', 'vt', 'pt', 'd', 'q'];
  const settings = () => Object.fromEntries(SIM_IDS.map(i => [i, parseFloat($(i).value)]));
  const W = 1200, H = 560, ATM = 101.3;

  const PHASES = [
    { name: 'EVACUATE', ms: 6000, title: 'Empty the tank',
      text: 'The pump pulls air out of the big vacuum tank. The burst valve is closed, so the chamber with the food stays at normal air pressure. The tank is storing "emptiness" for later.',
      eq: 'Tank pressure falls exponentially: p(t) = p₀ · e^(−S·t / V)' },
    { name: 'LOAD', ms: 2000, title: 'Load the food',
      text: 'Food goes on the tray, the temperature probe goes into one piece, and the lid closes. The tank waits under vacuum.',
      eq: 'Each piece holds water inside its cells: that water is the fuel for the puff.' },
    { name: 'HEAT', ms: 8000, title: 'Heat the food at normal pressure',
      text: 'The heater warms the food. At normal pressure (101 kPa) water only boils at 100 °C, so the water inside the cells stays liquid even at 85 °C. It is quietly storing heat. Watch the thermometer: the food line stays below the "water boils" line.',
      eq: 'Boiling point depends on pressure. At 101 kPa, 100 °C. At 5 kPa, 33 °C.' },
    { name: 'BURST', ms: 1500, title: 'The burst: 爆',
      text: 'The burst valve opens. Air rushes from the chamber into the empty tank, and the chamber pressure crashes in a fraction of a second. Suddenly water boils far below the food\'s temperature. The stored heat turns water into steam instantly, inside every cell at once. The steam inflates the cells before it can escape, so the food puffs.',
      eq: 'Water flashed = m · cₚ · (T_food − T_boil) / h_fg     (h_fg ≈ 2380 kJ/kg)' },
    { name: 'DRY', ms: 6000, title: 'Dry and set the crunch',
      text: 'The pump keeps the pressure low while gentle heat drives out the remaining water. The stretched cell walls dry out and harden into a light, airy structure. That is the "fried" crunch, made without oil.',
      eq: 'Low pressure lets water evaporate at ~40–55 °C, so colour and nutrients survive.' },
    { name: 'VENT', ms: 3000, title: 'Let the air back in, gently',
      text: 'The burst valve closes and air bleeds back into the chamber through a needle valve. Slowly, so the dry, puffed structure doesn\'t get crushed. Then the lid can open.',
      eq: 'Force on the lid under vacuum = Δp × area, which is why the lid must be vacuum-rated.' }
  ];

  // ---------- cycle model (same physics as the demo device) ----------
  let v, r, maxExp, shf;
  function prepare() {
    v = settings(); r = simulate(v);
    shf = Math.max(0, Math.min(1, (v.t - r.Ts) / 40));
    maxExp = 1 + 1.3 * r.idx / 100;
  }
  function state(ph, phT) {
    const name = PHASES[ph].name;
    const cool = r.Ts + 3, steam = r.P - r.Pair;
    const massAfterBurst = v.m - r.ms * 1000;
    const dryLoss = Math.max(0, r.water - r.ms) * 1000 * 0.3;
    const pDryEnd = v.pt + (r.P - v.pt) * Math.exp(-6000 / 1500);
    const tfDryEnd = cool + (55 - cool) * (1 - Math.exp(-6000 / 2000));
    const o = { name, pc: ATM, pt: ATM, tf: 25, mass: v.m, heater: 0, pump: false, burstOpen: false, ventOpen: true, puff: 0, dry: 0, flash: 0 };
    if (name === 'EVACUATE') { o.pt = v.pt + (ATM - v.pt) * Math.exp(-phT / 1200); o.pump = true; }
    else if (name === 'LOAD') { o.pt = v.pt + (ATM - v.pt) * Math.exp(-(6000 + phT) / 1200); }
    else if (name === 'HEAT') {
      o.pt = v.pt; o.tf = 25 + (v.t - 25) * (1 - Math.exp(-phT / 2000));
      o.heater = o.tf < v.t - 1 ? 1 : 0.35; o.ventOpen = phT < PHASES[ph].ms - 150;
    } else if (name === 'BURST') {
      const p = r.pts[Math.min(r.pts.length - 1, Math.floor(phT / 2))], k = 1 - Math.exp(-phT / 25);
      o.pc = p[1] + steam * k; o.pt = p[2] + steam * k;
      o.tf = v.t - (v.t - cool) * (1 - Math.exp(-phT / 200));
      o.mass = v.m - r.ms * 1000 * (1 - Math.exp(-phT / 200));
      o.burstOpen = true; o.ventOpen = false; o.pump = true;
      const drop = Math.max(0, Math.min(1, (ATM - o.pc) / Math.max(1, ATM - r.P)));
      o.flash = drop * shf; o.puff = o.flash;
    } else if (name === 'DRY') {
      o.pc = o.pt = v.pt + (r.P - v.pt) * Math.exp(-phT / 1500);
      o.tf = cool + (55 - cool) * (1 - Math.exp(-phT / 2000));
      o.mass = massAfterBurst - dryLoss * (1 - Math.exp(-phT / 2500));
      o.heater = 0.6; o.pump = true; o.burstOpen = true; o.ventOpen = false;
      o.puff = shf; o.flash = shf; o.dry = 1 - Math.exp(-phT / 2500);
    } else if (name === 'VENT') {
      o.pc = ATM - (ATM - pDryEnd) * Math.exp(-phT / 700); o.pt = pDryEnd;
      o.tf = tfDryEnd; o.mass = massAfterBurst - dryLoss * (1 - Math.exp(-6000 / 2500));
      o.pump = true; o.puff = shf * (1 - 0.06 * (1 - Math.exp(-phT / 700))); o.flash = shf; o.dry = 1;
    }
    o.boil = tsat(o.pc);
    return o;
  }

  // ---------- geometry ----------
  const CH = { x: 40, y: 170, w: 320, h: 300 };        // chamber
  const TK = { x: 490, y: 140, w: 330, h: 340 };       // tank
  const PIPE_Y = 320, VALVE_X = 425, PUMP = { x: 900, y: 320, r: 40 };
  const VENT = { x: 90, top: 110 };
  const TRAY_Y = 425;
  const FOOD = [95, 160, 225, 290].map(x => ({ x }));
  const CAP_C = 90, CAP_T = 240;

  // ---------- particles ----------
  let parts = [];
  const rnd = (a, b) => a + Math.random() * (b - a);
  function inBox(b, pad = 10) { return { x: rnd(b.x + pad, b.x + b.w - pad), y: rnd(b.y + pad, b.y + b.h - pad) }; }
  function spawn(region, kind, pos) {
    const p = pos || inBox(region === 'C' ? { ...CH, h: TRAY_Y - CH.y } : TK);
    parts.push({ x: p.x, y: p.y, vx: rnd(-1, 1), vy: rnd(-1, 1), region, kind, path: null, t: 0 });
  }
  function resetParticles(s) {
    parts = [];
    const nC = Math.round(s.pc / ATM * CAP_C), nT = Math.round(s.pt / ATM * CAP_T);
    for (let i = 0; i < nC; i++) spawn('C', 'air');
    for (let i = 0; i < nT; i++) spawn('T', 'air');
  }
  const pathC2T = () => [{ x: CH.x + CH.w - 12, y: PIPE_Y + rnd(-8, 8) }, { x: TK.x + 14, y: PIPE_Y + rnd(-8, 8) }, inBox(TK, 20)];
  const pathT2P = () => [{ x: TK.x + TK.w - 12, y: PIPE_Y + rnd(-6, 6) }, { x: PUMP.x, y: PUMP.y }, { x: PUMP.x + 110, y: PUMP.y + rnd(-20, 20) }];
  const pathVent = () => [{ x: VENT.x, y: VENT.top - 30 }, { x: VENT.x, y: CH.y + 12 }, inBox({ ...CH, h: TRAY_Y - CH.y }, 20)];

  function balance(s) {
    const inC = parts.filter(p => p.region === 'C'), inT = parts.filter(p => p.region === 'T');
    const nC = Math.round(s.pc / ATM * CAP_C), nT = Math.round(s.pt / ATM * CAP_T);
    const moveMax = s.name === 'BURST' ? 6 : 4;
    // chamber too full
    let extraC = inC.length - nC;
    if (extraC > 0) {
      const movers = inC.sort((a, b) => b.x - a.x).slice(0, s.burstOpen ? Math.min(extraC, moveMax * 3) : extraC);
      movers.forEach(p => { if (s.burstOpen) { p.region = 'X'; p.path = pathC2T(); p.dest = 'T'; } else p.dead = true; });
    } else if (extraC < 0) {
      const inboundC = parts.filter(p => p.dest === 'C' && p.region === 'X').length;
      const need = Math.min(-extraC - inboundC, moveMax);
      for (let i = 0; i < need; i++) {
        if ((s.name === 'BURST' || s.name === 'DRY') && s.flash > 0.02) {
          const f = FOOD[Math.floor(Math.random() * FOOD.length)];
          spawn('C', 'steam', { x: f.x + rnd(-14, 14), y: TRAY_Y - 18 });
        } else if (s.ventOpen && s.name === 'VENT') {
          spawn('X', 'air', { x: VENT.x, y: VENT.top - 40 }); const p = parts[parts.length - 1]; p.path = pathVent(); p.dest = 'C';
        } else spawn('C', 'air');
      }
    }
    // tank
    let extraT = inT.length - nT;
    if (extraT > 0) {
      const movers = inT.sort((a, b) => b.x - a.x).slice(0, s.pump ? Math.min(extraT, moveMax) : extraT);
      movers.forEach(p => { if (s.pump) { p.region = 'X'; p.path = pathT2P(); p.dest = 'OUT'; } else p.dead = true; });
    } else if (extraT < 0) {
      const inbound = parts.filter(p => p.dest === 'T' && p.region === 'X').length;
      for (let i = 0; i < Math.min(-extraT - inbound, moveMax); i++) spawn('T', 'air');
    }
    // steam trickles off the food while drying
    if (s.name === 'DRY' && Math.random() < 0.15 * (1 - s.dry)) {
      const f = FOOD[Math.floor(Math.random() * FOOD.length)];
      spawn('C', 'steam', { x: f.x + rnd(-14, 14), y: TRAY_Y - 18 });
    }
    parts = parts.filter(p => !p.dead);
  }

  function moveParticles(realDt, slow) {
    const k = realDt / 16.7;
    for (const p of parts) {
      if (p.region === 'X') {
        const tgt = p.path[0], dx = tgt.x - p.x, dy = tgt.y - p.y, d = Math.hypot(dx, dy);
        const sp = (slow ? 4 : 9) * k;
        if (d < sp) { p.path.shift(); if (!p.path.length) { if (p.dest === 'OUT') p.dead = true; else { p.region = p.dest; } } }
        else { p.x += dx / d * sp; p.y += dy / d * sp; }
        continue;
      }
      const b = p.region === 'C' ? { x: CH.x + 6, y: CH.y + 6, w: CH.w - 12, h: TRAY_Y - CH.y - 10 } : { x: TK.x + 6, y: TK.y + 6, w: TK.w - 12, h: TK.h - 12 };
      const jig = p.kind === 'steam' ? 0.5 : 0.35;
      p.vx += rnd(-jig, jig) * k; p.vy += rnd(-jig, jig) * k - (p.kind === 'steam' ? 0.04 * k : 0);
      p.vx *= 0.96; p.vy *= 0.96;
      p.x += p.vx * 1.6 * k; p.y += p.vy * 1.6 * k;
      if (p.x < b.x) { p.x = b.x; p.vx = Math.abs(p.vx); } if (p.x > b.x + b.w) { p.x = b.x + b.w; p.vx = -Math.abs(p.vx); }
      if (p.y < b.y) { p.y = b.y; p.vy = Math.abs(p.vy); } if (p.y > b.y + b.h) { p.y = b.y + b.h; p.vy = -Math.abs(p.vy); }
    }
    parts = parts.filter(p => !p.dead);
  }

  // ---------- drawing ----------
  const cv = $('machineCanvas');
  let g, scale = 0;
  function sizeCanvas() {
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth;
    scale = w / W;
    cv.width = Math.round(w * dpr); cv.height = Math.round(H * scale * dpr);
    g = cv.getContext('2d'); g.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
  }
  function rr(x, y, w, h, rad) { g.beginPath(); g.roundRect(x, y, w, h, rad); }
  function label(t, x, y, align = 'center', color = css('--muted'), size = 12) {
    g.font = `600 ${size}px ${css('--mono')}`; g.fillStyle = color; g.textAlign = align; g.fillText(t, x, y);
  }
  function mix(a, b, t) {
    const pa = a.match(/\w\w/g).map(h => parseInt(h, 16)), pb = b.match(/\w\w/g).map(h => parseInt(h, 16));
    return 'rgb(' + pa.map((c, i) => Math.round(c + (pb[i] - c) * t)).join(',') + ')';
  }

  function drawGauge(cx, cy, rad, val, title) {
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, ang = a0 + (a1 - a0) * Math.min(1, val / 110);
    g.lineWidth = 2; g.strokeStyle = css('--line'); g.fillStyle = css('--surface');
    g.beginPath(); g.arc(cx, cy, rad, 0, Math.PI * 2); g.fill(); g.stroke();
    g.lineWidth = 6; g.strokeStyle = css('--teal'); g.beginPath(); g.arc(cx, cy, rad - 8, a0, a0 + (a1 - a0) * 0.1); g.stroke();
    g.lineWidth = 1.5; g.strokeStyle = css('--muted');
    for (let k = 0; k <= 110; k += 10) {
      const a = a0 + (a1 - a0) * k / 110, r1 = rad - (k % 50 === 0 ? 14 : 9);
      g.beginPath(); g.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); g.lineTo(cx + Math.cos(a) * (rad - 3), cy + Math.sin(a) * (rad - 3)); g.stroke();
    }
    g.strokeStyle = css('--amber'); g.lineWidth = 3;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(ang) * (rad - 12), cy + Math.sin(ang) * (rad - 12)); g.stroke();
    g.fillStyle = css('--ink'); g.beginPath(); g.arc(cx, cy, 4, 0, Math.PI * 2); g.fill();
    label(val.toFixed(1), cx, cy + rad * 0.55, 'center', css('--ink'), 15);
    label('kPa', cx, cy + rad * 0.55 + 13, 'center', css('--muted'), 10);
    label(title, cx, cy - rad - 8, 'center', css('--muted'), 11);
  }

  function drawValve(x, y, open, vertical, name) {
    g.save(); g.translate(x, y); if (vertical) g.rotate(Math.PI / 2);
    g.fillStyle = open ? css('--teal') : css('--surface'); g.strokeStyle = open ? css('--teal') : css('--muted'); g.lineWidth = 2;
    g.beginPath(); g.moveTo(-14, -12); g.lineTo(14, 12); g.lineTo(14, -12); g.lineTo(-14, 12); g.closePath(); g.fill(); g.stroke();
    g.restore();
    label(`${name}: ${open ? 'OPEN' : 'CLOSED'}`, x + (vertical ? 20 : 0), y + (vertical ? 4 : -22), vertical ? 'left' : 'center', open ? css('--teal') : css('--muted'), 11);
  }

  let pumpAngle = 0;
  function drawPump(on, realDt) {
    if (on) pumpAngle += realDt * 0.012;
    g.fillStyle = css('--surface'); g.strokeStyle = css('--ink'); g.lineWidth = 2;
    g.beginPath(); g.arc(PUMP.x, PUMP.y, PUMP.r, 0, Math.PI * 2); g.fill(); g.stroke();
    g.strokeStyle = on ? css('--teal') : css('--muted'); g.lineWidth = 3;
    for (let i = 0; i < 4; i++) {
      const a = pumpAngle + i * Math.PI / 2;
      g.beginPath(); g.moveTo(PUMP.x, PUMP.y); g.lineTo(PUMP.x + Math.cos(a) * (PUMP.r - 8), PUMP.y + Math.sin(a) * (PUMP.r - 8)); g.stroke();
    }
    label(on ? 'PUMP: ON' : 'PUMP: OFF', PUMP.x, PUMP.y + PUMP.r + 18, 'center', on ? css('--teal') : css('--muted'), 11);
    g.strokeStyle = css('--line'); g.lineWidth = 10;
    g.beginPath(); g.moveTo(PUMP.x + PUMP.r, PUMP.y); g.lineTo(PUMP.x + PUMP.r + 50, PUMP.y); g.stroke();
    label('exhaust →', PUMP.x + PUMP.r + 8, PUMP.y - 12, 'left', css('--muted'), 10);
  }

  function drawFood(s) {
    const exp = 1 + (maxExp - 1) * s.puff * (1 - 0.05 * s.dry);
    const raw = '#E9D9A6', done = '#D69A3C';
    const col = mix(raw, done, Math.min(1, s.dry * 0.8 + s.puff * 0.2));
    FOOD.forEach((f, i) => {
      const w = 26 * Math.sqrt(exp), h = 12 * exp;
      g.fillStyle = col; g.strokeStyle = mix(done, '#7A4A12', 0.5); g.lineWidth = 1.5;
      g.beginPath(); g.ellipse(f.x, TRAY_Y - h, w, h, 0, 0, Math.PI * 2); g.fill(); g.stroke();
      // pores
      if (s.puff > 0.05) {
        g.fillStyle = 'rgba(255,255,255,0.55)';
        for (let k = 0; k < 6; k++) {
          const a = k * 1.9 + i, rr2 = (0.25 + (k % 3) * 0.2);
          g.beginPath(); g.arc(f.x + Math.cos(a) * w * rr2, TRAY_Y - h + Math.sin(a) * h * rr2 * 0.8, 1.5 + 2.5 * s.puff, 0, Math.PI * 2); g.fill();
        }
      }
    });
    // probe
    g.strokeStyle = css('--ink'); g.lineWidth = 2;
    g.beginPath(); g.moveTo(CH.x, TRAY_Y - 60); g.lineTo(FOOD[1].x - 5, TRAY_Y - 12 * exp); g.stroke();
    label('food probe', CH.x + 8, TRAY_Y - 66, 'left', css('--muted'), 10);
  }

  function drawThermo(s) {
    const x = 1095, y0 = 500, y1 = 285, t2y = t => y0 - (Math.max(0, Math.min(120, t)) / 120) * (y0 - y1);
    rr(x - 12, y1 - 6, 24, y0 - y1 + 12, 12); g.fillStyle = css('--surface'); g.fill(); g.strokeStyle = css('--line'); g.lineWidth = 2; g.stroke();
    g.fillStyle = css('--bad'); rr(x - 6, t2y(s.tf), 12, y0 - t2y(s.tf), 6); g.fill();
    for (let t = 0; t <= 120; t += 20) { g.strokeStyle = css('--line'); g.lineWidth = 1; g.beginPath(); g.moveTo(x + 14, t2y(t)); g.lineTo(x + 20, t2y(t)); g.stroke(); label(String(t), x + 24, t2y(t) + 4, 'left', css('--muted'), 10); }
    const by = t2y(s.boil);
    g.strokeStyle = css('--teal'); g.lineWidth = 2; g.setLineDash([5, 4]);
    g.beginPath(); g.moveTo(x - 60, by); g.lineTo(x + 14, by); g.stroke(); g.setLineDash([]);
    // Keep the two label pairs apart when the temperatures are close.
    const fy = t2y(s.tf), close = Math.abs(by - fy) < 36;
    const boilY = close ? Math.min(by, fy) - 18 : by - 12;
    const foodY = close ? Math.max(by, fy) + 14 : fy + 16;
    label('water boils', x - 62, boilY, 'right', css('--teal'), 10);
    label(`${s.boil.toFixed(0)} °C`, x - 62, boilY + 13, 'right', css('--teal'), 10);
    label('food', x - 62, foodY, 'right', css('--bad'), 10);
    label(`${s.tf.toFixed(0)} °C`, x - 62, foodY + 13, 'right', css('--bad'), 10);
    label('TEMPERATURE', x, y1 - 16, 'center', css('--muted'), 11);
    const sh = s.tf - s.boil;
    if (sh > 0) label(`superheat +${sh.toFixed(0)} °C → water flashes`, W - 8, y0 + 30, 'right', css('--amber'), 11);
    else label(`${(-sh).toFixed(0)} °C below boiling: stays liquid`, W - 8, y0 + 30, 'right', css('--muted'), 11);
  }

  // Inset: a few cells of one food piece.
  function drawCells(s) {
    const cx = 1095, cy = 150, R = 88;
    g.save();
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fillStyle = css('--surface'); g.fill();
    g.clip();
    const exp = 1 + (maxExp - 1) * s.puff;
    const cell = 30 * Math.sqrt(exp), wall = mix('#C9A45C', '#8A5A1C', s.dry);
    const heatJitter = (s.tf - 25) / 80;
    for (let row = -3; row <= 3; row++) for (let col = -3; col <= 3; col++) {
      const x = cx + (col + (row % 2 ? 0.5 : 0)) * cell, y = cy + row * cell * 0.87;
      g.fillStyle = mix('#F3E7C2', '#E7C27E', s.dry); g.strokeStyle = wall; g.lineWidth = 2.5 - s.dry;
      g.beginPath();
      for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + k * Math.PI / 3; const px = x + Math.cos(a) * cell * 0.56, py = y + Math.sin(a) * cell * 0.56; k ? g.lineTo(px, py) : g.moveTo(px, py); }
      g.closePath(); g.fill(); g.stroke();
      const water = (1 - s.flash) * (1 - s.dry);
      if (water > 0.02) {
        g.fillStyle = 'rgba(60,140,210,0.75)';
        const j = heatJitter * 1.5;
        g.beginPath(); g.arc(x + rnd(-j, j), y + rnd(-j, j), 8 * Math.sqrt(water), 0, Math.PI * 2); g.fill();
      }
      if (s.flash > 0.02 && s.dry < 0.95) {
        g.strokeStyle = 'rgba(160,160,170,0.9)'; g.lineWidth = 1.5;
        g.beginPath(); g.arc(x, y, cell * 0.38 * s.flash, 0, Math.PI * 2); g.stroke();
      }
    }
    g.restore();
    g.strokeStyle = css('--ink'); g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
    label('INSIDE ONE PIECE (cells)', cx, cy - R - 10, 'center', css('--muted'), 11);
    const note = s.dry > 0.5 ? 'walls dried & set: crunchy' : s.flash > 0.3 ? 'steam inflates each cell' : s.tf > 60 ? 'hot water, still liquid' : 'water inside the cells';
    label(note, cx, cy + R + 16, 'center', css('--ink'), 11);
  }

  function draw(s, realDt, slow) {
    g.clearRect(0, 0, W, H);
    // pipes
    g.strokeStyle = css('--line'); g.lineWidth = 16; g.lineCap = 'butt';
    g.beginPath(); g.moveTo(CH.x + CH.w, PIPE_Y); g.lineTo(TK.x, PIPE_Y); g.stroke();
    g.beginPath(); g.moveTo(TK.x + TK.w, PIPE_Y); g.lineTo(PUMP.x - PUMP.r, PIPE_Y); g.stroke();
    g.lineWidth = 10; g.beginPath(); g.moveTo(VENT.x, CH.y); g.lineTo(VENT.x, VENT.top - 30); g.stroke();
    // tank
    rr(TK.x, TK.y, TK.w, TK.h, 40); g.fillStyle = css('--ground'); g.fill(); g.strokeStyle = css('--teal'); g.lineWidth = 3; g.stroke();
    label('VACUUM TANK', TK.x + TK.w / 2, TK.y + TK.h + 22, 'center', css('--teal'), 12);
    // chamber
    rr(CH.x, CH.y, CH.w, CH.h, 8); g.fillStyle = css('--ground'); g.fill(); g.strokeStyle = css('--ink'); g.lineWidth = 3; g.stroke();
    g.strokeStyle = 'rgba(120,170,200,0.7)'; g.lineWidth = 7; g.beginPath(); g.moveTo(CH.x - 4, CH.y); g.lineTo(CH.x + CH.w + 4, CH.y); g.stroke();
    label('clear lid', CH.x + CH.w - 6, CH.y - 8, 'right', css('--muted'), 10);
    label('BURST CHAMBER', CH.x + CH.w / 2, CH.y + CH.h + 22, 'center', css('--ink'), 12);
    // heater + tray
    const glow = s.heater;
    g.fillStyle = glow > 0 ? `rgba(230,90,30,${0.25 + 0.6 * glow})` : css('--line');
    rr(CH.x + 30, TRAY_Y + 12, CH.w - 60, 10, 4); g.fill();
    if (glow > 0) { g.fillStyle = `rgba(230,120,40,${0.12 * glow})`; rr(CH.x + 20, TRAY_Y - 40, CH.w - 40, 70, 20); g.fill(); }
    label(glow > 0 ? 'HEATER: ON' : 'heater: off', CH.x + CH.w / 2, TRAY_Y + 42, 'center', glow > 0 ? css('--amber') : css('--muted'), 10);
    g.strokeStyle = css('--muted'); g.lineWidth = 3; g.beginPath(); g.moveTo(CH.x + 30, TRAY_Y + 4); g.lineTo(CH.x + CH.w - 30, TRAY_Y + 4); g.stroke();
    drawFood(s);
    // particles
    for (const p of parts) {
      g.fillStyle = p.kind === 'steam' ? css('--steam') : css('--teal');
      g.beginPath(); g.arc(p.x, p.y, p.kind === 'steam' ? 3.2 : 2.4, 0, Math.PI * 2); g.fill();
    }
    // valves, pump, gauges, thermo, cells
    drawValve(VALVE_X, PIPE_Y, s.burstOpen, false, 'BURST VALVE');
    drawValve(VENT.x, VENT.top, s.ventOpen, true, 'VENT');
    drawPump(s.pump, realDt);
    drawGauge(265, 78, 56, s.pc, 'CHAMBER');
    drawGauge(655, 60, 44, s.pt, 'TANK');
    drawThermo(s);
    drawCells(s);
    if (slow) label('SLOW MOTION ×1/20', TK.x + TK.w / 2, TK.y + 24, 'center', css('--amber'), 13);
    // legend
    g.fillStyle = css('--teal'); g.beginPath(); g.arc(500, 530, 3, 0, 7); g.fill(); label('air', 508, 534, 'left', css('--muted'), 11);
    g.fillStyle = css('--steam'); g.beginPath(); g.arc(550, 530, 3.5, 0, 7); g.fill(); label('steam from the food', 558, 534, 'left', css('--muted'), 11);
    label('dots ∝ pressure', 720, 534, 'left', css('--muted'), 11);
  }

  // ---------- player ----------
  let ph = 0, phT = 0, playing = false, last = 0, cur;
  const speedSel = $('mSpeed'), slowChk = $('mSlow');

  function restart() {
    prepare(); ph = 0; phT = 0; cur = state(0, 0); resetParticles(cur); updateText(true);
  }
  function updateText(force) {
    const P = PHASES[ph];
    if (force || $('mTitle').dataset.ph !== String(ph)) {
      $('mTitle').dataset.ph = String(ph);
      $('mStep').textContent = `Step ${ph + 1} of ${PHASES.length} · ${P.name}`;
      $('mTitle').textContent = P.title;
      $('mText').textContent = P.text;
      $('mEq').textContent = P.eq;
      document.querySelectorAll('#mPhases [data-ph]').forEach(el => el.classList.toggle('on', +el.dataset.ph === ph));
    }
    const sh = cur.tf - cur.boil;
    $('mNums').innerHTML = [
      ['Chamber', cur.pc.toFixed(1) + ' kPa'], ['Tank', cur.pt.toFixed(1) + ' kPa'],
      ['Food', cur.tf.toFixed(1) + ' °C'], ['Water boils at', cur.boil.toFixed(1) + ' °C'],
      ['Superheat', (sh > 0 ? '+' : '') + sh.toFixed(1) + ' °C'], ['Batch mass', cur.mass.toFixed(1) + ' g'],
      ['Puff (this run)', (1 + (maxExp - 1) * cur.puff).toFixed(2) + '× volume']
    ].map(([k, val]) => `<div><span>${k}</span><b>${val}</b></div>`).join('');
    const tot = PHASES.reduce((a, p) => a + p.ms, 0), done = PHASES.slice(0, ph).reduce((a, p) => a + p.ms, 0) + phT;
    $('mProgress').style.width = (100 * done / tot).toFixed(1) + '%';
  }

  function tick(ts) {
    const realDt = Math.min(50, last ? ts - last : 16); last = ts;
    const visible = !$('tab-machine').hidden;
    if (visible) {
      const slow = slowChk.checked && PHASES[ph].name === 'BURST';
      let simDt = 0;
      if (playing) {
        simDt = realDt * parseFloat(speedSel.value) / (slow ? 20 : 1);
        phT += simDt;
        if (phT >= PHASES[ph].ms) {
          if (ph < PHASES.length - 1) { ph++; phT = 0; }
          else { phT = PHASES[ph].ms; playing = false; $('mPlay').textContent = 'Play'; }
        }
        cur = state(ph, phT);
        balance(cur);
      }
      moveParticles(realDt, slow);
      if (cv.clientWidth && Math.abs(cv.clientWidth / W - scale) > 0.001) sizeCanvas();
      draw(cur, playing ? realDt : 0, slow && playing);
      updateText(false);
    }
    requestAnimationFrame(tick);
  }

  $('mPlay').addEventListener('click', () => {
    if (!playing && ph === PHASES.length - 1 && phT >= PHASES[ph].ms) restart();
    playing = !playing; $('mPlay').textContent = playing ? 'Pause' : 'Play';
  });
  $('mRestart').addEventListener('click', () => { restart(); playing = true; $('mPlay').textContent = 'Pause'; });
  document.querySelectorAll('#mPhases [data-ph]').forEach(el => el.addEventListener('click', () => {
    ph = +el.dataset.ph; phT = 0; cur = state(ph, 0); resetParticles(cur); updateText(true);
  }));

  // Scenarios change the Simulator settings so both tabs agree.
  const SCEN = {
    good: { m: 150, x: 0.35, t: 85, vc: 5, vt: 60, pt: 3, d: 32, q: 8 },
    slowvalve: { m: 150, x: 0.35, t: 85, vc: 5, vt: 60, pt: 3, d: 8, q: 8 },
    cold: { m: 150, x: 0.35, t: 50, vc: 5, vt: 60, pt: 3, d: 32, q: 8 },
    smalltank: { m: 150, x: 0.35, t: 85, vc: 5, vt: 10, pt: 3, d: 32, q: 8 }
  };
  document.querySelectorAll('[data-scen]').forEach(b => b.addEventListener('click', () => {
    const sc = SCEN[b.dataset.scen];
    SIM_IDS.forEach(i => { $(i).value = sc[i]; $(i).dispatchEvent(new Event('input')); });
    restart(); playing = true; $('mPlay').textContent = 'Pause';
  }));
  window.addEventListener('resize', () => { scale = 0; });

  restart();
  requestAnimationFrame(tick);
})();

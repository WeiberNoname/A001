// Inside the food: a cross-section of one slice, simulated cell by cell, plus the texture map
// (glass transition). Driven by the Machine tab's state; machine.js calls FoodSim.render(...).
//
// Science used:
//  - Glass transition (Gordon–Taylor): Tg(x) = (ws·Tgs + k·ww·Tgw) / (ws + k·ww), Tgw = −135 °C.
//    Above Tg the cell walls are rubbery (they stretch, so the food can puff); below Tg they are
//    glassy (rigid, so the snack is crunchy). Dry solids have a high Tg; water lowers it.
//  - Heating a slab: the surface leads the centre (thermal diffusivity ~1.4e-7 m²/s).
//  - Flash: each cell's water boils when the food is hotter than the boiling point at the
//    chamber pressure; the steam inflates the cell. Walls stretched past their limit rupture.
//  - Vacuum drying: a drying front moves in from the surface.
(() => {
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  // Typical literature-range values; real products vary — calibrate with tests.
  const FOODS = {
    apple:  { name: 'Apple 蘋果', note: 'sugary: Tg of dry solids is low, so it must be dried very dry to turn crisp',
              tgs: 60, k: 3.6, raw: '#EFE2B4', done: '#D9A04A', walls: 0.9, sim: { m: 150, x: 0.35, t: 85 } },
    taro:   { name: 'Taro 芋頭', note: 'starchy: high Tg, sets crisp easily',
              tgs: 135, k: 5.0, raw: '#E6DDE8', done: '#C9A57A', walls: 1.1, sim: { m: 250, x: 0.40, t: 90 } },
    sweetpotato: { name: 'Sweet potato 地瓜', note: 'starch plus sugars: in between',
              tgs: 110, k: 4.5, raw: '#F2C27A', done: '#D98A3A', walls: 1.0, sim: { m: 200, x: 0.40, t: 90 } },
    rice:   { name: 'Rice cake 爆米香', note: 'cooked starch pellets: high Tg, strong classic puff',
              tgs: 150, k: 5.5, raw: '#F4EEDC', done: '#E0B870', walls: 1.2, sim: { m: 200, x: 0.18, t: 95 } }
  };
  const TGW = -135, ROOM = 25;
  const tg = (f, x) => ((1 - x) * f.tgs + f.k * x * TGW) / ((1 - x) + f.k * x);

  let food = FOODS.apple, cells = [], trail = [], seed = 1;
  const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

  function reset() {
    seed = 7; cells = []; trail = [];
    const cols = 15, rows = 5;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const u = (c + (r % 2 ? 0.5 : 0) + 0.5) / (cols + 0.5), vv = (r + 0.5) / rows;
      cells.push({
        u, v: vv,
        depth: Math.abs(vv - 0.5) * 2,                  // 0 = centre of the slice, 1 = surface
        grow: 0.75 + rand() * 0.5,                      // cell-to-cell variation in expansion
        breakAt: 0.6 + rand() * 1.2,                    // volume strain at which this wall ruptures
        e: 1, broken: false, burstT: -1, jitter: rand() * 6.28
      });
    }
  }
  reset();

  function setFood(key) { food = FOODS[key] || FOODS.apple; reset(); }

  // ---------- per-cell state from the machine state ----------
  function localState(s, ctx) {
    const { v, maxExp, shf } = ctx;
    const solids = v.m * (1 - v.x);
    const x = Math.max(0, (s.mass - solids) / s.mass);          // overall moisture (wet basis)
    const heating = s.name === 'HEAT' && s.heater > 0.5;
    const grad = heating ? Math.min(12, (v.t - s.tf) * 0.35 + 3) : 0;   // surface hotter than centre
    const dryFrac = s.dry || 0;
    const puff = s.puff || 0;
    const F = Math.max(0, Math.min(1, (s.mass - solids) / (v.m * v.x)));   // water left / water at start
    return { x, grad, dryFrac, puff, maxExp, shf, F };
  }

  function stepCells(s, L, dt) {
    const wantE = 1 + (L.maxExp - 1) * L.puff;
    for (const c of cells) {
      const target = 1 + (wantE - 1) * c.grow;
      // strain beyond this wall's limit -> rupture (only while stretching during the burst)
      const strain = target - 1;
      if (!c.broken && (s.name === 'BURST' || s.name === 'DRY' || s.name === 'VENT') && strain > c.breakAt * 0.6 * food.walls) {
        c.broken = true; c.burstT = 0;
      }
      const goal = c.broken ? 1 + (target - 1) * 0.8 : target;       // ruptured cells relax a little
      c.e += (goal - c.e) * Math.min(1, dt / 90);
      if (c.burstT >= 0) c.burstT += dt;
      if (s.name === 'HEAT' || s.name === 'LOAD' || s.name === 'EVACUATE') { c.broken = false; c.burstT = -1; }
    }
  }

  // ---------- main view ----------
  function render(cv, s, dt, ctx) {
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth;
    if (!w) return;
    const H = Math.round(w * 0.5);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(H * dpr); cv.style.height = H + 'px'; }
    const g = cv.getContext('2d'); const S = w / 1200; g.setTransform(dpr * S, 0, 0, dpr * S, 0, 0);
    g.clearRect(0, 0, 1200, 600);
    const L = localState(s, ctx);
    stepCells(s, L, dt);
    const font = (px, wt = 600) => `${wt} ${px}px ${css('--mono')}`;

    // slice geometry
    const meanE = cells.reduce((a, c) => a + c.e, 0) / cells.length;
    const sx = 40, sw = 800, baseH = 140, sh = baseH * Math.pow(meanE, 0.75), mid = 250, sy = mid - sh / 2;
    g.fillStyle = css('--muted'); g.font = font(12); g.textAlign = 'left';
    g.fillText(`CROSS-SECTION OF ONE ${food.name.split(' ')[0].toUpperCase()} SLICE · cells enlarged, ~3 mm thick`, sx, 40);
    g.fillText('surface', sx + sw + 8, sy + 12); g.fillText('centre', sx + sw + 8, mid + 4); g.fillText('surface', sx + sw + 8, sy + sh - 4);

    // colours
    const doneMix = Math.min(1, L.dryFrac * 0.85 + L.puff * 0.15);
    const col = mix(food.raw, food.done, doneMix);

    // slice body
    g.fillStyle = col; g.strokeStyle = mix(food.done, '#6a3f10', 0.5); g.lineWidth = 3;
    rr(g, sx, sy, sw, sh, 18); g.fill(); g.stroke();

    // cells
    const cols = 15, rows = 5, cw = sw / (cols + 0.5), chh = sh / rows;
    const t = performance.now() / 1000;
    for (const c of cells) {
      const cx = sx + c.u * sw, cy = sy + c.v * sh;
      // local temperature and moisture
      const Tl = s.tf + L.grad * c.depth * c.depth;
      // local water: follows the real mass balance; while drying the surface has less than the centre.
      // The depth profile (1 + D·(0.6 − 1.2·depth)) averages to 1, so the cells add up to the true total.
      const wl = Math.max(0, Math.min(1, L.F * (1 + L.dryFrac * (0.6 - 1.2 * c.depth))));
      const xLocal = Math.max(0, Math.min(0.9, L.x * wl / Math.max(0.01, L.F)));
      const rubbery = Tl > tg(food, xLocal);
      const wob = rubbery && s.name === 'BURST' ? Math.sin(t * 9 + c.jitter) * 0.04 : 0;
      const rx = cw * 0.44 * Math.sqrt(c.e) * (1 + wob), ry = chh * 0.4 * Math.sqrt(c.e) * (1 - wob);
      // wall
      g.lineWidth = rubbery ? 2 : 3.2;
      g.strokeStyle = rubbery ? mix(food.done, '#ffffff', 0.25) : mix(food.done, '#5a3208', 0.55);
      g.fillStyle = mix(col, '#ffffff', 0.35);
      g.beginPath(); hexPath(g, cx, cy, rx, ry, c.broken ? 0.55 : 0);
      g.fill(); g.stroke();
      // water inside (blue), shrinking as it flashes and dries
      const waterR = Math.min(rx, ry) * 0.62 * Math.sqrt(wl);        // flashed water already left the mass
      if (waterR > 0.6) {
        g.fillStyle = `rgba(60,140,210,${0.55 + 0.25 * wl})`;
        const jig = s.name === 'HEAT' ? (Tl - 25) / 60 : 0;
        g.beginPath(); g.ellipse(cx + Math.sin(t * 5 + c.jitter) * jig, cy, waterR, waterR * 0.85, 0, 0, Math.PI * 2); g.fill();
      }
      // steam bubble while flashing
      if ((s.flash || 0) > 0.02 && wl > 0.05 && s.name !== 'VENT') {
        g.strokeStyle = css('--steam'); g.lineWidth = 2;
        g.beginPath(); g.ellipse(cx, cy, rx * 0.8 * Math.min(1, s.flash + 0.2), ry * 0.8 * Math.min(1, s.flash + 0.2), 0, 0, Math.PI * 2); g.stroke();
      }
      // escaping steam from ruptured walls
      if (c.broken && c.burstT >= 0 && c.burstT < 1500) {
        const k = c.burstT / 1500;
        g.fillStyle = css('--steam'); g.globalAlpha = 1 - k;
        for (let j = 0; j < 3; j++) { g.beginPath(); g.arc(cx + (j - 1) * 6, cy - ry - k * 40 - j * 6, 2.5, 0, 7); g.fill(); }
        g.globalAlpha = 1;
      }
    }

    // temperature bar (left of slice)
    const tb = { x: sx + sw + 72, y: sy, h: sh };
    const grd = g.createLinearGradient(0, sy, 0, sy + sh);
    const tS = s.tf + L.grad, tC = s.tf;
    grd.addColorStop(0, heat(tS)); grd.addColorStop(0.5, heat(tC)); grd.addColorStop(1, heat(tS));
    g.fillStyle = grd; rr(g, tb.x, tb.y, 16, tb.h, 6); g.fill();
    g.fillStyle = css('--muted'); g.font = font(11); g.textAlign = 'left';
    g.fillText(`${tS.toFixed(0)}°`, tb.x + 20, sy + 12); g.fillText(`${tC.toFixed(0)}°`, tb.x + 20, mid + 4);

    // properties column
    const mean = cells.reduce((a, c) => a + c.e, 0) / cells.length;
    const broken = cells.filter(c => c.broken).length / cells.length;
    const porosity = 1 - 0.9 / mean;
    const tgNow = tg(food, L.x), rub = s.tf > tgNow;
    const tgRoom = tg(food, L.x);
    const px = 975;
    const rows2 = [
      ['Moisture', (L.x * 100).toFixed(1) + ' %'],
      ['Volume', mean.toFixed(2) + '×'],
      ['Porosity (air)', Math.max(0, porosity * 100).toFixed(0) + ' %'],
      ['Ruptured cells', (broken * 100).toFixed(0) + ' %'],
      ['Glass transition Tg', tgNow.toFixed(0) + ' °C'],
      ['Food now', s.tf.toFixed(0) + ' °C']
    ];
    g.font = font(12); g.textAlign = 'left'; g.fillStyle = css('--muted'); g.fillText('SLICE PROPERTIES', px, 70);
    rows2.forEach(([k, val], i) => {
      const y = 100 + i * 30;
      g.fillStyle = css('--muted'); g.font = font(13, 400); g.fillText(k, px, y);
      g.fillStyle = css('--ink'); g.font = font(14); g.textAlign = 'right'; g.fillText(val, 1180, y); g.textAlign = 'left';
      g.strokeStyle = css('--line'); g.lineWidth = 1; g.beginPath(); g.moveTo(px, y + 9); g.lineTo(1180, y + 9); g.stroke();
    });
    // wall state badge
    const badgeY = 300;
    g.fillStyle = rub ? css('--teal') : css('--amber');
    rr(g, px, badgeY, 205, 34, 6); g.fill();
    g.fillStyle = css('--surface'); g.font = font(13); g.textAlign = 'center';
    g.fillText(rub ? 'WALLS: RUBBERY' : 'WALLS: GLASSY', px + 102, badgeY + 22);
    // texture verdict at room temperature
    const margin = tgRoom - ROOM;
    const verdict = margin > 10 ? ['CRUNCHY', css('--good')] : margin > 0 ? ['CRISP, JUST', css('--warn')] : margin > -20 ? ['LEATHERY / CHEWY', css('--warn')] : ['SOFT', css('--bad')];
    g.textAlign = 'left'; g.fillStyle = css('--muted'); g.font = font(12);
    g.fillText('IF COOLED TO 25 °C NOW:', px, 370);
    g.fillStyle = verdict[1]; g.font = font(18); g.fillText(verdict[0], px, 396);
    g.fillStyle = css('--muted'); g.font = font(11, 400);
    wrap(g, `Tg at this moisture is ${tgRoom.toFixed(0)} °C, ${margin >= 0 ? margin.toFixed(0) + ' °C above' : (-margin).toFixed(0) + ' °C below'} room temperature.`, px, 420, 205, 15);

    // caption under the slice
    g.fillStyle = css('--ink'); g.font = font(14, 400); g.textAlign = 'left';
    wrap(g, caption(s, L, rub, ctx), sx, 430, 820, 20);
    g.fillStyle = css('--muted'); g.font = font(11, 400);
    g.fillText(`${food.name}: ${food.note}.`, sx, 555);
  }

  function caption(s, L, rub, ctx) {
    const r = ctx.r, share = 100 * r.ms / Math.max(1e-9, r.water);
    const litresPerGram = 461.5 * (tsatK(r.Pmin)) / (r.Pmin * 1000);   // steam specific volume, m³/kg = L/g
    switch (s.name) {
      case 'EVACUATE': case 'LOAD': return 'Raw slice: every cell is a small bag of water held by soft cell walls.';
      case 'HEAT': return `Heating: the surface warms first and the centre follows. The water stays liquid (normal pressure), but the walls soften as they warm: they are ${rub ? 'rubbery, ready to stretch' : 'still glassy'}.`;
      case 'BURST': return `Burst: pressure drops and water in each cell boils at once. Only ${share.toFixed(0)} % of the water flashes, but at ${r.Pmin.toFixed(0)} kPa each gram becomes about ${litresPerGram.toFixed(0)} litres of steam, which inflates the cells. Walls are ${rub ? 'rubbery, so they stretch instead of cracking' : 'glassy, so they crack instead of stretching'}. Cells stretched past their limit rupture and vent steam: those become the open pores.`;
      case 'DRY': return 'Drying under vacuum: water leaves from the surface inward (see the drying front). As moisture falls, Tg rises. When Tg passes the food temperature, the stretched walls freeze in place as a rigid, airy glass: the crunch.';
      case 'VENT': return 'Air returns gently so the rigid, porous structure is not crushed. The texture is now set by how dry it got: see the verdict on the right.';
      default: return '';
    }
  }

  // ---------- texture map (glass transition) ----------
  function renderTexture(cv, s, ctx, playing) {
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (!w) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    const L = 44, R = 12, T = 12, B = 34, xMax = 0.5, tMin = -20, tMax = 110;
    const X = x => L + x / xMax * (w - L - R), Y = t => T + (1 - (t - tMin) / (tMax - tMin)) * (h - T - B);
    c.font = '11px ' + css('--mono');
    const curve = () => { for (let i = 0; i <= 100; i++) { const x = i / 100 * xMax; c.lineTo(X(x), Y(Math.max(tMin, Math.min(tMax, tg(food, x))))); } };
    // regions
    c.beginPath(); c.moveTo(X(0), Y(tMax)); curve(); c.lineTo(X(xMax), Y(tMax)); c.closePath(); c.fillStyle = 'rgba(14,110,104,0.12)'; c.fill();
    c.beginPath(); c.moveTo(X(0), Y(tMin)); curve(); c.lineTo(X(xMax), Y(tMin)); c.closePath(); c.fillStyle = 'rgba(200,120,40,0.13)'; c.fill();
    // grid
    c.strokeStyle = css('--line'); c.fillStyle = css('--muted'); c.lineWidth = 1;
    for (let t = 0; t <= 100; t += 25) { c.beginPath(); c.moveTo(L, Y(t)); c.lineTo(w - R, Y(t)); c.stroke(); c.textAlign = 'right'; c.fillText(t, L - 6, Y(t) + 4); }
    c.textAlign = 'center';
    for (let x = 0; x <= xMax + 1e-9; x += 0.1) c.fillText(Math.round(x * 100) + '%', X(x), h - B + 16);
    c.fillText('moisture (wet basis)', (L + w - R) / 2, h - 4);
    c.save(); c.translate(11, (T + h - B) / 2); c.rotate(-Math.PI / 2); c.fillText('food °C', 0, 0); c.restore();
    // room temperature line
    c.strokeStyle = css('--muted'); c.setLineDash([3, 4]); c.beginPath(); c.moveTo(L, Y(ROOM)); c.lineTo(w - R, Y(ROOM)); c.stroke(); c.setLineDash([]);
    c.textAlign = 'right'; c.fillText('room 25 °C', w - R - 4, Y(ROOM) - 5);
    // Tg curve
    c.strokeStyle = css('--amber'); c.lineWidth = 2.5; c.beginPath(); c.moveTo(X(0), Y(Math.min(tMax, food.tgs))); curve(); c.stroke();
    c.textAlign = 'left';
    c.fillStyle = css('--teal'); c.fillText('RUBBERY: walls stretch → can puff', X(0.2), Y(100));
    c.fillStyle = css('--amber'); c.fillText('GLASSY: rigid → crunchy', X(0.01), Y(-12));
    c.fillText('Tg curve', X(0.12) + 8, Y(Math.max(tMin + 4, tg(food, 0.12))) + 4);
    // trail + dot
    const solids = ctx.v.m * (1 - ctx.v.x), x = Math.max(0, (s.mass - solids) / s.mass);
    if (playing) { const lt = trail[trail.length - 1]; if (!lt || Math.abs(lt[0] - x) > 0.002 || Math.abs(lt[1] - s.tf) > 0.3) { trail.push([x, s.tf]); if (trail.length > 600) trail.shift(); } }
    c.strokeStyle = css('--bad'); c.globalAlpha = 0.5; c.lineWidth = 1.5; c.beginPath();
    trail.forEach(([a, b], i) => { if (i) c.lineTo(X(Math.min(xMax, a)), Y(b)); else c.moveTo(X(Math.min(xMax, a)), Y(b)); }); c.stroke(); c.globalAlpha = 1;
    c.fillStyle = css('--bad'); c.beginPath(); c.arc(X(Math.min(xMax, x)), Y(Math.max(tMin, Math.min(tMax, s.tf))), 6, 0, 7); c.fill();
    c.strokeStyle = css('--surface'); c.lineWidth = 2; c.stroke();
  }

  // ---------- helpers ----------
  function tsatK(pKPa) { return tsat(pKPa) + 273.15; }
  function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }
  function hexPath(g, cx, cy, rx, ry, gap) {
    // six-sided cell; a ruptured cell leaves one wall open
    const n = 6;
    for (let k = 0; k <= n; k++) {
      if (gap && k === 1) { const a = Math.PI / 6 + k * Math.PI / 3 - gap; g.moveTo(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry); continue; }
      const a = Math.PI / 6 + k * Math.PI / 3;
      const px = cx + Math.cos(a) * rx, py = cy + Math.sin(a) * ry;
      if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
  }
  function mix(a, b, t) {
    const pa = a.match(/\w\w/g).map(h => parseInt(h, 16)), pb = b.match(/\w\w/g).map(h => parseInt(h, 16));
    return '#' + pa.map((c, i) => Math.round(c + (pb[i] - c) * t).toString(16).padStart(2, '0')).join('');
  }
  function heat(T) { const k = Math.max(0, Math.min(1, (T - 20) / 80)); return mix('#3C8CD2', '#E0452B', k); }
  function wrap(g, text, x, y, maxW, lh) {
    const words = text.split(' '); let line = '';
    for (const wd of words) {
      const test = line ? line + ' ' + wd : wd;
      if (g.measureText(test).width > maxW && line) { g.fillText(line, x, y); line = wd; y += lh; } else line = test;
    }
    if (line) g.fillText(line, x, y);
  }

  window.FoodSim = { FOODS, setFood, reset, render, renderTexture, tg: x => tg(food, x) };
})();

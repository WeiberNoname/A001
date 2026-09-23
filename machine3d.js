// 3D view of the machine (three.js). Driven by the same state as the 2D view: machine.js calls
// Machine3D.reset(state) on jumps and Machine3D.render(state, dtMs, view) every frame.
(() => {
  if (typeof THREE === 'undefined') { window.Machine3D = null; return; }
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const ATM = 101.3;

  let renderer, scene, camera, host, labelBox, ready = false;
  const cam = { theta: -0.55, phi: 1.05, radius: 8.4, target: new THREE.Vector3(0.2, 0.9, 0) };

  // ---------- layout (1 unit ≈ 10 cm) ----------
  const CH = { x: -2.6, r: 0.95, y0: 0.35, h: 1.25 };              // chamber cylinder
  const TK = { x: 1.2, r: 1.15, y0: 0.25, h: 2.3 };                // tank cylinder
  const PIPE_Y = 0.9, VALVE_X = -0.8;
  const PUMP = { x: 3.35, y: 0.45 };
  const TRAY_Y = CH.y0 + 0.28;

  const mats = {};
  const objs = {};
  let gaugeC, gaugeT;

  function steel(color = 0xaab3b7) { return new THREE.MeshStandardMaterial({ color, metalness: 0.75, roughness: 0.32 }); }
  function glass(color = 0xcfe6ee, opacity = 0.16) {
    return new THREE.MeshStandardMaterial({ color, metalness: 0.1, roughness: 0.05, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
  }
  function mesh(geo, mat, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = !mat.transparent; m.receiveShadow = !mat.transparent; scene.add(m); return m; }

  function makeGauge(title) {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    return { c, tex, title, last: -1 };
  }
  function drawGauge(g, val) {
    if (Math.abs(g.last - val) < 0.05) return; g.last = val;
    const x = g.c.getContext('2d'), R = 118, cx = 128, cy = 128;
    x.clearRect(0, 0, 256, 256);
    x.fillStyle = '#f7f8f6'; x.beginPath(); x.arc(cx, cy, R, 0, 7); x.fill();
    x.lineWidth = 10; x.strokeStyle = '#59636a'; x.stroke();
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    x.lineWidth = 3; x.strokeStyle = '#333';
    for (let k = 0; k <= 110; k += 10) {
      const a = a0 + (a1 - a0) * k / 110, r1 = k % 50 ? R - 22 : R - 32;
      x.beginPath(); x.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); x.lineTo(cx + Math.cos(a) * (R - 10), cy + Math.sin(a) * (R - 10)); x.stroke();
    }
    x.fillStyle = '#16201f'; x.font = '600 34px ui-monospace,Consolas,monospace'; x.textAlign = 'center';
    x.fillText(val.toFixed(1), cx, cy + 58); x.font = '600 20px ui-monospace,Consolas,monospace'; x.fillText('kPa ' + g.title, cx, cy + 84);
    const a = a0 + (a1 - a0) * Math.min(1, val / 110);
    x.strokeStyle = '#c0392b'; x.lineWidth = 7; x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(a) * (R - 26), cy + Math.sin(a) * (R - 26)); x.stroke();
    x.fillStyle = '#16201f'; x.beginPath(); x.arc(cx, cy, 10, 0, 7); x.fill();
    g.tex.needsUpdate = true;
  }

  function build() {
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x000000, 18, 40);
    camera = new THREE.PerspectiveCamera(38, 2, 0.1, 100);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x445055, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(4, 8, 6); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7 });
    scene.add(sun);

    // floor / bench
    const floor = mesh(new THREE.BoxGeometry(10, 0.2, 4.4), new THREE.MeshStandardMaterial({ color: 0x3a4447, roughness: 0.9 }), 0.3, -0.1, 0);
    floor.castShadow = false; objs.floor = floor;

    // chamber: glass wall, steel base and rim, glass lid
    const st = steel();
    mesh(new THREE.CylinderGeometry(CH.r + 0.05, CH.r + 0.05, 0.12, 48), st, CH.x, CH.y0 - 0.06, 0);
    mesh(new THREE.CylinderGeometry(CH.r, CH.r, CH.h, 48, 1, true), glass(), CH.x, CH.y0 + CH.h / 2, 0);
    mesh(new THREE.TorusGeometry(CH.r, 0.04, 12, 48), st, CH.x, CH.y0 + CH.h, 0).rotation.x = Math.PI / 2;
    mesh(new THREE.CylinderGeometry(CH.r + 0.06, CH.r + 0.06, 0.05, 48), glass(0xbfe0ff, 0.28), CH.x, CH.y0 + CH.h + 0.03, 0);
    // legs
    [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]].forEach(([dx, dz]) => mesh(new THREE.CylinderGeometry(0.05, 0.05, CH.y0, 12), st, CH.x + dx, CH.y0 / 2 - 0.06, dz));

    // heater plate + tray
    mats.heater = new THREE.MeshStandardMaterial({ color: 0x552a1a, emissive: 0xff5a1f, emissiveIntensity: 0, roughness: 0.6 });
    mesh(new THREE.CylinderGeometry(CH.r - 0.15, CH.r - 0.15, 0.05, 40), mats.heater, CH.x, CH.y0 + 0.15, 0);
    mesh(new THREE.CylinderGeometry(CH.r - 0.1, CH.r - 0.1, 0.03, 40), steel(0xc8cfd2), CH.x, CH.y0 + 0.22, 0);
    objs.heatLight = new THREE.PointLight(0xff6a2a, 0, 2.5); objs.heatLight.position.set(CH.x, CH.y0 + 0.35, 0); scene.add(objs.heatLight);

    // food slices
    mats.food = new THREE.MeshStandardMaterial({ color: 0xe9d9a6, roughness: 0.75 });
    objs.food = [];
    const spots = [[0, 0], [0.42, 0.18], [-0.4, 0.22], [0.15, -0.45], [-0.25, -0.4], [0.35, 0.5 - 0.95]];
    spots.slice(0, 5).forEach(([dx, dz]) => {
      const f = mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.07, 28), mats.food, CH.x + dx, TRAY_Y, dz);
      f.userData.base = new THREE.Vector3(CH.x + dx, TRAY_Y, dz); objs.food.push(f);
    });
    // probe
    const probe = mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.1, 8), steel(0x222222), CH.x - 0.4, TRAY_Y + 0.35, 0);
    probe.rotation.z = -1.0;

    // pipe chamber -> tank with burst valve
    const pipeMat = steel(0x9ea7ab);
    const pipeLen = (TK.x - TK.r) - (CH.x + CH.r);
    const pipe = mesh(new THREE.CylinderGeometry(0.1, 0.1, pipeLen, 20), pipeMat, (CH.x + CH.r + TK.x - TK.r) / 2, PIPE_Y, 0);
    pipe.rotation.z = Math.PI / 2;
    mats.valve = new THREE.MeshStandardMaterial({ color: 0x6b7478, metalness: 0.6, roughness: 0.35, emissive: 0x0e6e68, emissiveIntensity: 0 });
    mesh(new THREE.SphereGeometry(0.22, 24, 16), mats.valve, VALVE_X, PIPE_Y, 0);
    objs.valveStem = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.25, 10), steel(0x333333), VALVE_X, PIPE_Y + 0.3, 0);
    objs.valveHandle = new THREE.Group(); objs.valveHandle.position.set(VALVE_X, PIPE_Y + 0.42, 0); scene.add(objs.valveHandle);
    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.05, 0.08), new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.5 }));
    lever.position.x = 0.25; lever.castShadow = true; objs.valveHandle.add(lever);

    // vent on the lid
    const ventY = CH.y0 + CH.h + 0.05;
    mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 12), pipeMat, CH.x + 0.55, ventY + 0.3, 0);
    mats.vent = new THREE.MeshStandardMaterial({ color: 0x6b7478, metalness: 0.6, roughness: 0.35, emissive: 0x0e6e68, emissiveIntensity: 0 });
    mesh(new THREE.SphereGeometry(0.11, 16, 12), mats.vent, CH.x + 0.55, ventY + 0.45, 0);

    // tank: glass shell, steel ends and bands, feet
    mesh(new THREE.CylinderGeometry(TK.r, TK.r, TK.h, 56, 1, true), glass(0xd6ecf0, 0.14), TK.x, TK.y0 + TK.h / 2, 0);
    const capTop = mesh(new THREE.SphereGeometry(TK.r, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2), glass(0xd6ecf0, 0.14), TK.x, TK.y0 + TK.h, 0);
    capTop.scale.y = 0.35;
    mesh(new THREE.CylinderGeometry(TK.r + 0.02, TK.r + 0.02, 0.1, 56), steel(), TK.x, TK.y0, 0);
    [0.35, 0.65].forEach(f => mesh(new THREE.TorusGeometry(TK.r + 0.01, 0.035, 10, 56), steel(), TK.x, TK.y0 + TK.h * f, 0).rotation.x = Math.PI / 2);
    [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]].forEach(([dx, dz]) => mesh(new THREE.CylinderGeometry(0.06, 0.06, TK.y0, 10), st, TK.x + dx, TK.y0 / 2 - 0.05, dz));

    // pump + pipe
    const p2 = mesh(new THREE.CylinderGeometry(0.08, 0.08, PUMP.x - 0.55 - (TK.x + TK.r), 16), pipeMat, (TK.x + TK.r + PUMP.x - 0.55) / 2, PIPE_Y, 0);
    p2.rotation.z = Math.PI / 2;
    mesh(new THREE.CylinderGeometry(0.08, 0.08, PIPE_Y - PUMP.y, 16), pipeMat, PUMP.x - 0.55, (PIPE_Y + PUMP.y) / 2, 0);
    mesh(new THREE.BoxGeometry(1.1, 0.7, 0.7), new THREE.MeshStandardMaterial({ color: 0x2f5d7c, metalness: 0.4, roughness: 0.45 }), PUMP.x, PUMP.y, 0);
    const motor = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.7, 28), steel(0x7f8a8e), PUMP.x + 0.85, PUMP.y, 0);
    motor.rotation.z = Math.PI / 2;
    objs.fan = new THREE.Group(); objs.fan.position.set(PUMP.x + 1.22, PUMP.y, 0); scene.add(objs.fan);
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.5, 0.1), new THREE.MeshStandardMaterial({ color: 0xdddddd }));
      b.rotation.x = i * Math.PI / 4; objs.fan.add(b);
    }
    // exhaust
    mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 12), pipeMat, PUMP.x, PUMP.y + 0.62, 0);
    objs.exhaustTop = new THREE.Vector3(PUMP.x, PUMP.y + 1.0, 0);

    // gauges on posts
    gaugeC = makeGauge('CHAMBER'); gaugeT = makeGauge('TANK');
    [[gaugeC, CH.x - 0.2, CH.y0 + CH.h + 0.9], [gaugeT, TK.x, TK.y0 + TK.h + 0.95]].forEach(([g, x, y]) => {
      mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8), st, x, y - 0.45, 0);
      const grp = new THREE.Group(); grp.position.set(x, y, 0); scene.add(grp);
      const back = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.08, 40), steel(0x59636a));
      back.rotation.x = Math.PI / 2; grp.add(back);
      const face = new THREE.Mesh(new THREE.CircleGeometry(0.42, 40), new THREE.MeshBasicMaterial({ map: g.tex }));
      face.position.z = 0.045; grp.add(face);
      g.group = grp;
    });

    buildParticles();
  }

  // ---------- particles ----------
  const MAX = 700, CAP_C = 90, CAP_T = 260;
  let parts = [];
  let airPts, steamPts;
  function buildParticles() {
    const mk = (color, size) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX * 3), 3));
      geo.setDrawRange(0, 0);
      const p = new THREE.Points(geo, new THREE.PointsMaterial({ color, size, sizeAttenuation: true, transparent: true, opacity: 0.95, depthWrite: false }));
      scene.add(p); return p;
    };
    airPts = mk(0x2bd0c2, 0.11); steamPts = mk(0xd2c4ff, 0.16);
  }
  const rnd = (a, b) => a + Math.random() * (b - a);
  function inCyl(c, pad, yTop) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * (c.r - pad);
    return new THREE.Vector3(c.x + Math.cos(a) * r, rnd(c.y0 + pad, (yTop ?? c.y0 + c.h) - pad), Math.sin(a) * r);
  }
  const chamberPoint = () => inCyl(CH, 0.12, CH.y0 + CH.h);
  const chamberFree = () => { const p = chamberPoint(); if (p.y < TRAY_Y + 0.15) p.y = TRAY_Y + rnd(0.15, 0.8); return p; };
  const tankPoint = () => inCyl(TK, 0.15, TK.y0 + TK.h);
  function spawn(region, kind, pos) { parts.push({ p: pos || (region === 'C' ? chamberFree() : tankPoint()), v: new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(0.01), region, kind, path: null }); }
  const pathC2T = () => [new THREE.Vector3(CH.x + CH.r - 0.1, PIPE_Y, rnd(-0.05, 0.05)), new THREE.Vector3(TK.x - TK.r + 0.1, PIPE_Y, rnd(-0.05, 0.05)), tankPoint()];
  const pathT2P = () => [new THREE.Vector3(TK.x + TK.r - 0.1, PIPE_Y, 0), new THREE.Vector3(PUMP.x - 0.55, PIPE_Y, 0), new THREE.Vector3(PUMP.x, PUMP.y, 0), objs.exhaustTop.clone().add(new THREE.Vector3(rnd(-0.3, 0.3), rnd(0.2, 1.2), rnd(-0.3, 0.3)))];
  const pathVent = () => [new THREE.Vector3(CH.x + 0.55, CH.y0 + CH.h + 0.9, 0), new THREE.Vector3(CH.x + 0.55, CH.y0 + CH.h - 0.1, 0), chamberFree()];

  function resetParticles(s) {
    parts = [];
    for (let i = 0; i < Math.round(s.pc / ATM * CAP_C); i++) spawn('C', 'air');
    for (let i = 0; i < Math.round(s.pt / ATM * CAP_T); i++) spawn('T', 'air');
  }

  function balance(s) {
    const inC = parts.filter(q => q.region === 'C'), inT = parts.filter(q => q.region === 'T');
    const nC = Math.round(s.pc / ATM * CAP_C), nT = Math.round(s.pt / ATM * CAP_T);
    const moveMax = s.name === 'BURST' ? 6 : 4;
    const extraC = inC.length - nC;
    if (extraC > 0) {
      inC.sort((a, b) => b.p.x - a.p.x).slice(0, s.burstOpen ? Math.min(extraC, moveMax * 3) : extraC)
        .forEach(q => { if (s.burstOpen) { q.region = 'X'; q.path = pathC2T(); q.dest = 'T'; } else q.dead = true; });
    } else if (extraC < 0) {
      const inbound = parts.filter(q => q.dest === 'C' && q.region === 'X').length;
      for (let i = 0; i < Math.min(-extraC - inbound, moveMax); i++) {
        if ((s.name === 'BURST' || s.name === 'DRY') && s.flash > 0.02) {
          const f = objs.food[Math.floor(Math.random() * objs.food.length)].position;
          spawn('C', 'steam', new THREE.Vector3(f.x + rnd(-0.12, 0.12), f.y + 0.1, f.z + rnd(-0.12, 0.12)));
        } else if (s.ventOpen && s.name === 'VENT') {
          spawn('X', 'air', new THREE.Vector3(CH.x + 0.55, CH.y0 + CH.h + 1.0, 0));
          const q = parts[parts.length - 1]; q.path = pathVent(); q.dest = 'C';
        } else spawn('C', 'air');
      }
    }
    const extraT = inT.length - nT;
    if (extraT > 0) {
      inT.sort((a, b) => b.p.x - a.p.x).slice(0, s.pump ? Math.min(extraT, moveMax) : extraT)
        .forEach(q => { if (s.pump) { q.region = 'X'; q.path = pathT2P(); q.dest = 'OUT'; } else q.dead = true; });
    } else if (extraT < 0) {
      const inbound = parts.filter(q => q.dest === 'T' && q.region === 'X').length;
      for (let i = 0; i < Math.min(-extraT - inbound, moveMax); i++) spawn('T', 'air');
    }
    if (s.name === 'DRY' && Math.random() < 0.15 * (1 - s.dry)) {
      const f = objs.food[Math.floor(Math.random() * objs.food.length)].position;
      spawn('C', 'steam', new THREE.Vector3(f.x + rnd(-0.12, 0.12), f.y + 0.1, f.z + rnd(-0.12, 0.12)));
    }
    parts = parts.filter(q => !q.dead);
    if (parts.length > MAX) parts.length = MAX;
  }

  function moveParticles(dt, slow) {
    const k = dt / 16.7, tmp = new THREE.Vector3();
    for (const q of parts) {
      if (q.region === 'X') {
        const tgt = q.path[0]; tmp.subVectors(tgt, q.p); const d = tmp.length(), sp = (slow ? 0.03 : 0.07) * k;
        if (d < sp) { q.path.shift(); if (!q.path.length) { if (q.dest === 'OUT') q.dead = true; else q.region = q.dest; } }
        else q.p.addScaledVector(tmp, sp / d);
        continue;
      }
      const c = q.region === 'C' ? CH : TK, yMin = q.region === 'C' ? TRAY_Y + 0.08 : TK.y0 + 0.1, yMax = c.y0 + c.h - 0.08;
      q.v.x += rnd(-1, 1) * 0.004 * k; q.v.y += rnd(-1, 1) * 0.004 * k + (q.kind === 'steam' ? 0.0006 * k : 0); q.v.z += rnd(-1, 1) * 0.004 * k;
      q.v.multiplyScalar(0.96); q.p.addScaledVector(q.v, 1.5 * k);
      const dx = q.p.x - c.x, dz = q.p.z, rr = Math.hypot(dx, dz), rMax = c.r - 0.08;
      if (rr > rMax) { q.p.x = c.x + dx / rr * rMax; q.p.z = dz / rr * rMax; q.v.x *= -1; q.v.z *= -1; }
      if (q.p.y < yMin) { q.p.y = yMin; q.v.y = Math.abs(q.v.y); }
      if (q.p.y > yMax) { q.p.y = yMax; q.v.y = -Math.abs(q.v.y); }
    }
    parts = parts.filter(q => !q.dead);
    const write = (pts, kind) => {
      const arr = pts.geometry.attributes.position.array; let n = 0;
      for (const q of parts) if (q.kind === kind && n < MAX) { arr[n * 3] = q.p.x; arr[n * 3 + 1] = q.p.y; arr[n * 3 + 2] = q.p.z; n++; }
      pts.geometry.setDrawRange(0, n); pts.geometry.attributes.position.needsUpdate = true;
    };
    write(airPts, 'air'); write(steamPts, 'steam');
  }

  // ---------- labels (HTML, projected from 3D) ----------
  const LABELS = [
    { key: 'ch', pos: () => new THREE.Vector3(CH.x, CH.y0 - 0.25, CH.r + 0.3), text: () => 'Burst chamber' },
    { key: 'tk', pos: () => new THREE.Vector3(TK.x, TK.y0 - 0.2, TK.r + 0.3), text: () => 'Vacuum tank' },
    { key: 'va', pos: () => new THREE.Vector3(VALVE_X, PIPE_Y + 0.8, 0), text: s => 'Burst valve: ' + (s.burstOpen ? 'OPEN' : 'closed'), hot: s => s.burstOpen },
    { key: 've', pos: () => new THREE.Vector3(CH.x + 0.55, CH.y0 + CH.h + 1.05, 0), text: s => 'Vent: ' + (s.ventOpen ? 'open' : 'sealed'), hot: s => s.ventOpen },
    { key: 'pu', pos: () => new THREE.Vector3(PUMP.x + 0.3, PUMP.y - 0.55, 0.5), text: s => 'Pump: ' + (s.pump ? 'ON' : 'off'), hot: s => s.pump },
    { key: 'he', pos: () => new THREE.Vector3(CH.x, CH.y0 + 0.05, CH.r + 0.1), text: s => 'Heater: ' + (s.heater > 0 ? 'ON' : 'off'), warm: s => s.heater > 0 }
  ];
  function updateLabels(s) {
    const w = host.clientWidth, h = host.clientHeight, v = new THREE.Vector3();
    LABELS.forEach(L => {
      if (!L.el) { L.el = document.createElement('div'); L.el.className = 'm3label'; labelBox.appendChild(L.el); }
      v.copy(L.pos()).project(camera);
      const vis = v.z < 1;
      L.el.style.display = vis ? '' : 'none';
      L.el.style.transform = `translate(-50%,-50%) translate(${(v.x * 0.5 + 0.5) * w}px,${(-v.y * 0.5 + 0.5) * h}px)`;
      L.el.textContent = L.text(s);
      L.el.classList.toggle('hot', !!(L.hot && L.hot(s)));
      L.el.classList.toggle('warm', !!(L.warm && L.warm(s)));
    });
  }

  // ---------- camera controls ----------
  function placeCamera() {
    const t = cam.target, r = cam.radius;
    camera.position.set(t.x + r * Math.sin(cam.phi) * Math.sin(cam.theta), t.y + r * Math.cos(cam.phi), t.z + r * Math.sin(cam.phi) * Math.cos(cam.theta));
    camera.lookAt(t);
  }
  function bindControls() {
    let drag = null;
    const el = renderer.domElement;
    el.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointermove', e => {
      if (!drag) return;
      cam.theta -= (e.clientX - drag.x) * 0.006;
      cam.phi = Math.max(0.25, Math.min(1.5, cam.phi - (e.clientY - drag.y) * 0.006));
      drag = { x: e.clientX, y: e.clientY };
    });
    el.addEventListener('pointerup', () => { drag = null; });
    el.addEventListener('wheel', e => { e.preventDefault(); cam.radius = Math.max(4, Math.min(16, cam.radius * (1 + Math.sign(e.deltaY) * 0.08))); }, { passive: false });
  }

  // ---------- public ----------
  let lastFoodCol = new THREE.Color();
  const RAW = new THREE.Color(0xe9d9a6), DONE = new THREE.Color(0xd69a3c);

  function init(container) {
    if (ready) return true;
    host = container;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch (e) { return false; }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    labelBox = document.createElement('div'); labelBox.className = 'm3labels'; host.appendChild(labelBox);
    build(); bindControls();
    ready = true;
    return true;
  }

  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    const cur = renderer.getSize(new THREE.Vector2());
    if (cur.x !== w || cur.y !== h) { renderer.setSize(w, h, false); renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = h + 'px'; camera.aspect = w / h; camera.updateProjectionMatrix(); }
  }

  function render(s, dt, opts) {
    if (!ready) return;
    resize();
    const bg = new THREE.Color(css('--ground') || '#eef0ee');
    scene.background = bg; scene.fog.color = bg;

    // machine state -> visuals
    mats.heater.emissiveIntensity = s.heater * 1.6;
    objs.heatLight.intensity = s.heater * 2.2;
    objs.valveHandle.rotation.y += ((s.burstOpen ? 0 : Math.PI / 2) - objs.valveHandle.rotation.y) * Math.min(1, dt / 120);
    mats.valve.emissiveIntensity = s.burstOpen ? 0.6 : 0;
    mats.vent.emissiveIntensity = s.ventOpen ? 0.6 : 0;
    if (s.pump) objs.fan.rotation.x += dt * 0.03;
    const exp = opts.expansion;
    lastFoodCol.copy(RAW).lerp(DONE, Math.min(1, s.dry * 0.8 + s.puff * 0.2));
    mats.food.color.copy(lastFoodCol);
    objs.food.forEach(f => {
      f.scale.set(Math.sqrt(exp), exp, Math.sqrt(exp));
      f.position.y = f.userData.base.y + 0.035 * (exp - 1);
    });
    drawGauge(gaugeC, s.pc); drawGauge(gaugeT, s.pt);
    [gaugeC, gaugeT].forEach(g => { g.group.rotation.y = Math.atan2(camera.position.x - g.group.position.x, camera.position.z - g.group.position.z); });

    if (opts.playing) balance(s);
    moveParticles(dt, opts.slow);
    placeCamera();
    renderer.render(scene, camera);
    updateLabels(s);
  }

  function reset(s) { if (ready) resetParticles(s); }
  function resetView() { Object.assign(cam, { theta: -0.55, phi: 1.05, radius: 8.4 }); }

  window.Machine3D = { init, render, reset, resetView };
})();

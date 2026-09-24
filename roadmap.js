// Next steps tab: the road from virtual prototype to a manufactured machine.
// Progress is saved on this PC; tasks the app can check itself are ticked automatically.
(() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const batches = () => (window.VBLLive && VBLLive.getBatches ? VBLLive.getBatches() : []);
  const measured = () => batches().filter(b => b.measured);
  const foods = () => new Set(batches().map(b => (b.recipe || '').trim().toLowerCase().split(/[ ,]/)[0]).filter(Boolean));

  // auto: returns true/false (done) or a progress string; tab: which app tab helps
  const PHASES = [
    { name: 'Virtual prototype', goal: 'Understand and size the machine before spending money.', tasks: [
      { id: 'v-physics', title: 'Physics model of the burst', auto: () => true, tab: 'sim',
        why: 'Predicts pressure, boiling point, flashed water and drop time for any hardware choice.' },
      { id: 'v-machine', title: '2D, 3D and food simulations', auto: () => true, tab: 'machine',
        why: 'Shows how the cycle works and how the food turns crisp.' },
      { id: 'v-firmware', title: 'Controller firmware compiles', auto: () => true,
        why: 'Verified with PlatformIO. Runs the six-step cycle with safety interlocks.' },
      { id: 'v-cal', title: 'Calibration tool ready', auto: () => true, tab: 'cal',
        why: 'Turns measured runs into model values.' }
    ] },
    { name: 'Build the test rig', goal: 'A bench prototype that measures, not a product.', tasks: [
      { id: 'r-buy', title: 'Buy the Prototype 1 parts', cost: 'NT$16,000–33,000', time: '1–2 weeks', tab: 'sim',
        why: 'The parts list is at the bottom of the Simulator tab.',
        how: ['Vacuum chamber and tank must be rated for full vacuum', 'Check KF fitting sizes match (KF-40 recommended)', 'Buy a zero-cross SSR rated at least 2× the heater current'] },
      { id: 'r-flash', title: 'Flash the firmware to the ESP32', time: '1 hour',
        why: 'Puts the controller logic on the board.',
        how: ['Install PlatformIO', 'In the firmware folder run: pio run -t upload', 'See firmware/README.md for wiring'] },
      { id: 'r-checklist', title: 'First power-up checklist (no mains power)', time: '2 hours', tab: 'live',
        why: 'Catches wiring and sensor faults safely before anything gets hot or evacuated.',
        how: ['Pressures read ~101 kPa', 'E-stop triggers FAULT', 'Lid switch and food probe respond', 'Tare and calibrate the scale (CAL 200)', 'Relays click through a dry cycle'] },
      { id: 'r-empty', title: 'First full cycle with an empty chamber', time: '1 day', tab: 'live',
        why: 'Proves the vacuum holds, valves switch and the controller finishes the cycle.',
        how: ['Watch the tank pump-down time against the Simulator', 'Check for leaks: the tank pressure should not rise while holding'] }
    ] },
    { name: 'Measure and calibrate', goal: 'Replace assumptions with numbers from your machine.', tasks: [
      { id: 'm-runs', title: 'Record 3–5 real burst runs', auto: () => measured().length >= 3 ? true : `${measured().length} of 3`, tab: 'live',
        why: 'Each run gives a real pressure curve to fit.',
        how: ['Use the same food and settings for the first runs', 'Save each run as a batch and export the raw CSV'] },
      { id: 'm-cal', title: 'Calibrate and apply', auto: () => !!(window.VBLCal && VBLCal.isApplied()), tab: 'cal',
        why: 'Every tab then predicts your real machine.',
        how: ['Import the runs', 'Fit, check the error is near 0.2–0.5 kPa', 'Apply'] },
      { id: 'm-foods', title: 'Food trials: 4 foods, varied moisture and temperature', auto: () => foods().size >= 4 ? true : `${foods().size} of 4 foods`, tab: 'live',
        cost: 'NT$2,000–5,000 of ingredients', time: '2–4 weeks',
        why: 'Finds the recipes that puff best and turn crunchy.',
        how: ['Apple, taro, sweet potato, rice cake', 'Measure volume before and after (seed displacement)', 'Score crunch 1–5 in the batch log'] },
      { id: 'm-puff', title: 'Fit the puff index to measured expansion', tab: 'sim',
        why: 'The expansion estimate is the last heuristic in the model; real volume ratios fix it.' }
    ] },
    { name: 'Engineering design', goal: 'From a bench rig to a real product design.', tasks: [
      { id: 'e-cad', title: '3D CAD of the product', time: '1–2 months',
        why: 'Chamber, lid and hinge, clamps, tank, valve, frame and enclosure as real parts.',
        how: ['Fusion 360 or SolidWorks', 'Size parts from the calibrated Simulator'] },
      { id: 'e-struct', title: 'Structural check of chamber and lid under vacuum',
        why: 'With the default settings about 240 kgf presses on a 185 mm lid (the Simulator shows it for yours). Walls must not buckle and the seal must hold.',
        how: ['Wall thickness and buckling check (or FEA)', 'O-ring groove design', 'Safety factor ≥ 4 on the lid'] },
      { id: 'e-valve', title: 'Choose the production burst valve',
        why: 'Must open fast (the Simulator shows how bore affects drop time) and survive thousands of cycles.' },
      { id: 'e-thermal', title: 'Thermal design',
        why: 'Even heating of the tray, insulation, and a tank that stays cold enough to condense steam.' },
      { id: 'e-pcb', title: 'Control PCB and mains wiring',
        why: 'Replace loose modules with a proper board and a certified power section.' }
    ] },
    { name: 'Safety and certification', goal: 'Required before anyone can sell it.', tasks: [
      { id: 's-fmea', title: 'Risk assessment (FMEA)',
        why: 'Lists every way it can fail (implosion, burns, stuck valve, electrical fault) and the protection for each.' },
      { id: 's-hw', title: 'Hardware interlocks',
        why: 'Mechanical lid lock under vacuum, thermal fuse, e-stop that cuts power directly. Software alone is not enough.' },
      { id: 's-food', title: 'Food-contact material compliance',
        why: 'Every surface that touches food must be food-grade (stainless, silicone).' },
      { id: 's-bsmi', title: 'BSMI certification (標準檢驗局)', cost: 'NT$50,000–200,000', time: '1–3 months',
        why: 'Mandatory for electrical appliances sold in Taiwan. Run pre-compliance tests first.' }
    ] },
    { name: 'Manufacturing', goal: 'Make it affordably and repeatably.', tasks: [
      { id: 'f-target', title: 'Pick the market: home, night-market stall or franchise shop',
        why: 'Sets size, price, materials and volume.' },
      { id: 'f-dfm', title: 'Design for manufacturing',
        why: 'Deep-drawn chamber, stamped frame, moulded enclosure: fewer parts, lower cost.' },
      { id: 'f-bom', title: 'Bill of materials with real supplier quotes',
        why: 'The true unit cost decides the price and the franchise model.' },
      { id: 'f-oem', title: 'Find an OEM/ODM partner in Taiwan',
        why: 'The Taichung machinery cluster can build it with you.' }
    ] },
    { name: 'Protect and launch', goal: 'Own the design and prove it sells.', tasks: [
      { id: 'p-search', title: 'Patent search', time: '1–2 weeks',
        why: 'Vacuum puffing itself is known; find what is new in your design before filing.' },
      { id: 'p-patent', title: 'File a utility patent (新型專利) and trademark', cost: 'NT$20,000–60,000',
        why: 'Fast, low-cost protection in Taiwan for the machine design and the brand.' },
      { id: 'p-lab', title: 'University or lab partnership',
        why: 'Independent tests for oil-free and nutrition claims, and shelf life.' },
      { id: 'p-pilot', title: 'Pilot stall and franchise package',
        why: 'Real sales data from a night market or 市集 is the strongest proof for partners and franchisees.' }
    ] }
  ];

  let state = {};   // id -> { done, notes }
  const store = {
    async load() {
      if (window.lab && window.lab.loadRoadmap) return window.lab.loadRoadmap();
      try { return JSON.parse(localStorage.getItem('vbl-roadmap') || 'null'); } catch { return null; }
    },
    async save() {
      if (window.lab && window.lab.saveRoadmap) return window.lab.saveRoadmap(state);
      try { localStorage.setItem('vbl-roadmap', JSON.stringify(state)); } catch {}
    }
  };

  function status(t) {
    if (t.auto) { const a = t.auto(); return a === true ? { done: true, auto: true } : { done: false, auto: true, note: a || '' }; }
    return { done: !!(state[t.id] && state[t.id].done), auto: false };
  }

  const TAB_NAMES = { sim: 'Simulator', machine: 'Machine', live: 'Live test', cal: 'Calibrate' };
  const openTab = tab => document.querySelector(`[data-tab="${tab}"]`).click();

  function render() {
    const all = PHASES.flatMap(p => p.tasks), doneN = all.filter(t => status(t).done).length;
    $('rmBar').style.width = (100 * doneN / all.length).toFixed(0) + '%';
    $('rmCount').textContent = `${doneN} of ${all.length} steps done`;

    // next task
    let next = null, nextPhase = null;
    for (const p of PHASES) { const t = p.tasks.find(x => !status(x).done); if (t) { next = t; nextPhase = p; break; } }
    $('rmNext').innerHTML = next ? `
      <div class="eyebrow">Do this next · ${esc(nextPhase.name)}</div>
      <h2>${esc(next.title)}</h2>
      <p style="margin:6px 0 0;max-width:68ch">${esc(next.why)}</p>
      ${next.how ? `<ul class="rmhow">${next.how.map(h => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
      <div class="row" style="margin-top:12px">
        ${next.tab ? `<button type="button" class="btn primary" data-open="${next.tab}">Open ${TAB_NAMES[next.tab]}</button>` : ''}
        ${!status(next).auto ? `<button type="button" class="btn" data-done="${next.id}">Mark done</button>` : ''}
        ${[next.cost, next.time].filter(Boolean).map(x => `<span class="pill">${esc(x)}</span>`).join('')}
      </div>` : '<h2>All steps done</h2><p class="note">From virtual prototype to a product on the market.</p>';

    $('rmPhases').innerHTML = PHASES.map((p, pi) => {
      const n = p.tasks.filter(t => status(t).done).length;
      return `<section class="panel rmphase">
        <div class="row" style="justify-content:space-between">
          <div><div class="eyebrow">Phase ${pi + 1}</div><h3 style="margin:0;color:var(--ink);font-size:16px;letter-spacing:0;text-transform:none;font-family:var(--sans)">${esc(p.name)}</h3></div>
          <span class="pill ${n === p.tasks.length ? 'on' : ''}">${n}/${p.tasks.length}</span>
        </div>
        <p class="note" style="margin:4px 0 10px">${esc(p.goal)}</p>
        ${p.tasks.map(t => {
          const st = status(t), notes = (state[t.id] && state[t.id].notes) || '';
          return `<details class="rmtask ${st.done ? 'done' : ''}" ${t === next ? 'open' : ''}>
            <summary>
              <input type="checkbox" id="rm-${t.id}" data-check="${t.id}" ${st.done ? 'checked' : ''} ${st.auto ? 'disabled' : ''} aria-label="${esc(t.title)} done">
              <span class="rmtitle">${esc(t.title)}</span>
              ${st.auto ? `<span class="rmtag">${st.done ? 'auto' : esc(st.note || 'auto')}</span>` : ''}
              ${[t.cost, t.time].filter(Boolean).map(x => `<span class="rmtag">${esc(x)}</span>`).join('')}
            </summary>
            <div class="rmbody">
              <p style="margin:0">${esc(t.why)}</p>
              ${t.how ? `<ul class="rmhow">${t.how.map(h => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
              ${t.tab ? `<button type="button" class="btn" data-open="${t.tab}">Open ${TAB_NAMES[t.tab]}</button>` : ''}
              <label class="rmnotes" for="rmn-${t.id}">Notes<textarea id="rmn-${t.id}" rows="2" data-notes="${t.id}" placeholder="Supplier, quotes, results, who is doing it…">${esc(notes)}</textarea></label>
            </div>
          </details>`;
        }).join('')}
      </section>`;
    }).join('');

    document.querySelectorAll('#tab-roadmap [data-open]').forEach(b => b.addEventListener('click', () => openTab(b.dataset.open)));
    document.querySelectorAll('#tab-roadmap [data-done]').forEach(b => b.addEventListener('click', () => setDone(b.dataset.done, true)));
    document.querySelectorAll('#tab-roadmap [data-check]').forEach(c => {
      c.addEventListener('click', e => e.stopPropagation());
      c.addEventListener('change', () => setDone(c.dataset.check, c.checked));
    });
    document.querySelectorAll('#tab-roadmap [data-notes]').forEach(ta => ta.addEventListener('change', () => {
      const id = ta.dataset.notes; state[id] = { ...(state[id] || {}), notes: ta.value }; store.save();
    }));
  }

  function setDone(id, done) { state[id] = { ...(state[id] || {}), done }; store.save(); render(); }

  document.querySelectorAll('[data-tab="roadmap"]').forEach(b => b.addEventListener('click', render));
  store.load().then(s => { state = s && typeof s === 'object' ? s : {}; render(); });
})();

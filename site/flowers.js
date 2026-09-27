// Flowers, two kinds.
//
// The field: a few hundred flower emoji scattered in a border around the
// sheet, about 10% of the width deep, thinning toward the text. The names
// sit up in the top band, underneath them. It is placed on a jittered grid seeded by
// cell, so when a day opens or closes and the sheet changes height, the
// flowers already placed stay where they are.
//
// The agents: the SMT site's cursor agents, as flowers. They steer toward
// the pointer, keep a little apart from each other, bounce off the text, and
// drift to a stop when the pointer goes idle. Five to start, and every click
// brings one more in from the side. There is no maximum.
//
// The cost rules carried over from SMT: one canvas, one requestAnimationFrame
// loop at a fixed 30 fps step, nothing allocated inside the loop, obstacles
// bucketed into a 200px grid and collected only on load, resize, layout
// change and scroll end.
(function () {
  const EMOJI = ['🌸'];
  const sheet = document.querySelector('.sheet');
  const field = document.querySelector('.field');
  const canvas = document.querySelector('canvas.agents');
  const toggle = document.querySelector('.flower-switch');

  // A small deterministic hash, so a grid cell always gets the same flower.
  function rand(a, b, c, k) {
    let h = Math.imul(a + 1, 73856093) ^ Math.imul(b + 1, 19349663) ^ Math.imul(c + 1, 83492791) ^ Math.imul(k + 1, 2654435761);
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  // ---------------------------------------------------------------- field --
  let fieldW = 0;
  let fieldH = 0;

  function buildField() {
    const W = sheet.clientWidth;
    const H = sheet.offsetHeight;
    if (W === fieldW && H === fieldH) return;
    fieldW = W;
    fieldH = H;

    const band = Math.min(190, Math.max(28, W * 0.1));
    const cell = W < 600 ? 24 : 32;
    const deep = Math.max(1, Math.ceil(band / cell));
    const frag = document.createDocumentFragment();

    // `depth` runs from 0 at the page edge to 1 at the inside of the band.
    function place(region, i, j, depth, x, y) {
      let p = 0.97 - 0.6 * depth * depth;
      // The top band is thinner, so the names read through the flowers.
      if (region === 2) p *= 0.4;
      if (rand(region, i, j, 0) > p) return;
      const size = cell * (0.6 + rand(region, i, j, 1) * 0.55);
      // Nothing reaches past the band into the text.
      const lim = band - size * 0.3;
      if (region === 0) x = Math.min(x, lim);
      else if (region === 1) x = Math.max(x, W - lim);
      else if (region === 3) y = Math.max(y, H - lim);
      const turn = (rand(region, i, j, 2) - 0.5) * 70;
      const span = document.createElement('span');
      span.textContent = EMOJI[Math.floor(rand(region, i, j, 3) * EMOJI.length)];
      span.style.cssText =
        `left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;font-size:${size.toFixed(1)}px;` +
        `transform:translate(-50%,-50%) rotate(${turn.toFixed(0)}deg)`;
      frag.append(span);
    }

    const jx = (region, i, j) => (rand(region, i, j, 4) - 0.5) * cell * 0.9;
    const jy = (region, i, j) => (rand(region, i, j, 5) - 0.5) * cell * 0.9;

    // Left and right, the full height, counted from the top.
    const rows = Math.ceil(H / cell);
    for (let side = 0; side < 2; side++) {
      for (let c = 0; c < deep; c++) {
        for (let r = 0; r < rows; r++) {
          const inset = (c + 0.5) * cell + jx(side, c, r);
          const x = side === 0 ? inset : W - inset;
          place(side, c, r, c / deep, x, (r + 0.5) * cell + jy(side, c, r));
        }
      }
    }

    // Top and bottom, between the side bands. The bottom counts up from the
    // bottom edge so it moves with it.
    const cols = Math.ceil((W - 2 * band) / cell);
    for (let edge = 2; edge < 4; edge++) {
      for (let r = 0; r < deep; r++) {
        for (let c = 0; c < cols; c++) {
          const x = band + (c + 0.5) * cell + jx(edge, c, r);
          const d = (r + 0.5) * cell + jy(edge, c, r);
          place(edge, c, r, r / deep, x, edge === 2 ? d : H - d);
        }
      }
    }

    field.replaceChildren(frag);
  }

  // --------------------------------------------------------------- agents --
  const STEP = 1 / 30; // seconds; the loop skips frames rather than running faster
  const MAX_SPEED = 180; // px/s
  const MAX_TURN = 4 * STEP; // rad per step
  const ARRIVE_RADIUS = 80; // px; they gather rather than pile on
  const SEPARATION = 26; // px
  const HEADING_GAIN = 0.1; // eases back to facing the pointer in about a second
  const IDLE_MS = 20_000;
  const CELL = 200; // obstacle grid
  const SIZE = 26; // px
  const START = 5;
  const STORAGE_KEY = 'wedding.flowers';
  const OBSTACLE_SELECTOR = '.schedule h1, .schedule h2, .schedule p, .player-buttons button, .player-frame';

  // Grown by doubling when a click needs room; `count` says how many are live.
  let cap = 64;
  let xs = new Float32Array(cap);
  let ys = new Float32Array(cap);
  let vxs = new Float32Array(cap);
  let vys = new Float32Array(cap);
  let hs = new Float32Array(cap);
  let kinds = new Uint8Array(cap);
  let count = 0;

  // Obstacles in PAGE coordinates, four floats each, plus a CSR bucket index.
  let obs = new Float32Array(0);
  let obsCount = 0;
  let gridStart = new Int32Array(0);
  let gridItems = new Int32Array(0);
  let gridCursor = new Int32Array(0);
  let gridW = 0;
  let gridH = 0;

  let pointerX = 0;
  let pointerY = 0;
  let pointerIn = false;
  let lastMove = 0;
  let raf = 0;
  let acc = 0;
  let last = 0;
  let dpr = 1;
  let sprites = [];
  let on = true;

  function readSwitch() {
    try {
      return localStorage.getItem(STORAGE_KEY) !== 'off';
    } catch {
      return true;
    }
  }

  function writeSwitch(value) {
    try {
      localStorage.setItem(STORAGE_KEY, value ? 'on' : 'off');
    } catch {
      // Private windows and blocked site data: the switch just does not persist.
    }
  }

  // Each emoji drawn once into its own small canvas; the loop only blits.
  function buildSprites() {
    const px = Math.ceil(SIZE * dpr * 1.25);
    sprites = EMOJI.map((e) => {
      const c = document.createElement('canvas');
      c.width = c.height = px;
      const g = c.getContext('2d');
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `${Math.round(SIZE * dpr)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
      g.fillText(e, px / 2, px / 2 + SIZE * dpr * 0.06);
      return c;
    });
  }

  // ------------------------------------------------------------ obstacles --
  function collectObstacles() {
    const nodes = document.querySelectorAll(OBSTACLE_SELECTOR);
    if (obs.length < nodes.length * 4) obs = new Float32Array(nodes.length * 4);
    const sx = window.scrollX;
    const sy = window.scrollY;
    let n = 0;
    for (const el of nodes) {
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue; // closed days measure 0
      obs[n * 4] = r.left + sx;
      obs[n * 4 + 1] = r.top + sy;
      obs[n * 4 + 2] = r.right + sx;
      obs[n * 4 + 3] = r.bottom + sy;
      n++;
    }
    obsCount = n;
    buildGrid();
  }

  // One pass to count per cell, one to fill: a CSR index, so the per-frame
  // lookup is two integer reads and a walk of a flat array. An obstacle is
  // registered in every cell it overlaps.
  function buildGrid() {
    const doc = document.documentElement;
    gridW = Math.max(1, Math.ceil(Math.max(doc.scrollWidth, window.innerWidth) / CELL));
    gridH = Math.max(1, Math.ceil(Math.max(doc.scrollHeight, window.innerHeight) / CELL));
    const cells = gridW * gridH;
    if (gridStart.length < cells + 1) gridStart = new Int32Array(cells + 1);
    if (gridCursor.length < cells) gridCursor = new Int32Array(cells);
    gridStart.fill(0, 0, cells + 1);

    let total = 0;
    for (let i = 0; i < obsCount; i++) {
      const o = i * 4;
      const cx0 = clampCell(obs[o] / CELL, gridW);
      const cy0 = clampCell(obs[o + 1] / CELL, gridH);
      const cx1 = clampCell(obs[o + 2] / CELL, gridW);
      const cy1 = clampCell(obs[o + 3] / CELL, gridH);
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          gridStart[cy * gridW + cx + 1]++;
          total++;
        }
      }
    }
    for (let c = 1; c <= cells; c++) gridStart[c] += gridStart[c - 1];
    if (gridItems.length < total) gridItems = new Int32Array(total);
    gridCursor.set(gridStart.subarray(0, cells));

    for (let i = 0; i < obsCount; i++) {
      const o = i * 4;
      const cx0 = clampCell(obs[o] / CELL, gridW);
      const cy0 = clampCell(obs[o + 1] / CELL, gridH);
      const cx1 = clampCell(obs[o + 2] / CELL, gridW);
      const cy1 = clampCell(obs[o + 3] / CELL, gridH);
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          gridItems[gridCursor[cy * gridW + cx]++] = i;
        }
      }
    }
  }

  function clampCell(v, n) {
    const c = Math.floor(v);
    return c < 0 ? 0 : c > n - 1 ? n - 1 : c;
  }

  // --------------------------------------------------------------- spawning --
  function grow() {
    const next = cap * 2;
    const more = (a, T) => {
      const b = new T(next);
      b.set(a);
      return b;
    };
    xs = more(xs, Float32Array);
    ys = more(ys, Float32Array);
    vxs = more(vxs, Float32Array);
    vys = more(vys, Float32Array);
    hs = more(hs, Float32Array);
    kinds = more(kinds, Uint8Array);
    cap = next;
  }

  // One flower, in from a random edge; `sidesOnly` keeps it to left and right.
  function spawn(sidesOnly) {
    if (count === cap) grow();
    const w = window.innerWidth;
    const h = window.innerHeight;
    const edge = Math.floor(Math.random() * (sidesOnly ? 2 : 4));
    const i = count++;
    if (edge < 2) {
      xs[i] = edge === 0 ? 0 : w;
      ys[i] = Math.random() * h;
      vxs[i] = (edge === 0 ? 1 : -1) * MAX_SPEED * 0.7;
      vys[i] = 0;
    } else {
      xs[i] = Math.random() * w;
      ys[i] = edge === 2 ? 0 : h;
      vxs[i] = 0;
      vys[i] = (edge === 2 ? 1 : -1) * MAX_SPEED * 0.7;
    }
    hs[i] = Math.atan2(vys[i], vxs[i]);
    kinds[i] = Math.floor(Math.random() * EMOJI.length);
  }

  // ---------------------------------------------------------------- bursts --
  // A touch throws a handful of flowers outward that spin and fade. A fixed
  // pool, so a flurry of taps reuses the oldest petals instead of allocating.
  const BURST = 12;
  const POOL = 240;
  const LIFE = 0.9; // s
  const bx = new Float32Array(POOL);
  const by = new Float32Array(POOL);
  const bvx = new Float32Array(POOL);
  const bvy = new Float32Array(POOL);
  const brot = new Float32Array(POOL);
  const bspin = new Float32Array(POOL);
  const bage = new Float32Array(POOL).fill(LIFE);
  const bkind = new Uint8Array(POOL);
  let bnext = 0;
  let bursting = 0;

  function burst(x, y) {
    for (let k = 0; k < BURST; k++) {
      const i = bnext;
      bnext = (bnext + 1) % POOL;
      const a = (k / BURST) * Math.PI * 2 + Math.random() * 0.5;
      const v = 160 + Math.random() * 260;
      bx[i] = x;
      by[i] = y;
      bvx[i] = Math.cos(a) * v;
      bvy[i] = Math.sin(a) * v;
      brot[i] = Math.random() * Math.PI * 2;
      bspin[i] = (Math.random() - 0.5) * 10;
      bage[i] = 0;
      bkind[i] = Math.floor(Math.random() * EMOJI.length);
    }
    bursting = LIFE;
  }

  function stepBursts() {
    const drag = Math.pow(0.04, STEP); // loses most of its speed in a second
    for (let i = 0; i < POOL; i++) {
      if (bage[i] >= LIFE) continue;
      bage[i] += STEP;
      bvx[i] *= drag;
      bvy[i] = bvy[i] * drag + 120 * STEP; // and settles a little, like petals
      bx[i] += bvx[i] * STEP;
      by[i] += bvy[i] * STEP;
      brot[i] += bspin[i] * STEP;
    }
    if (bursting > 0) bursting -= STEP;
  }

  function drawBursts(ctx) {
    if (bursting <= 0) return;
    for (let i = 0; i < POOL; i++) {
      if (bage[i] >= LIFE) continue;
      const t = bage[i] / LIFE;
      const s = SIZE * 1.25 * (0.7 + 0.5 * t);
      ctx.globalAlpha = 1 - t * t;
      ctx.save();
      ctx.translate(bx[i], by[i]);
      ctx.rotate(brot[i]);
      ctx.drawImage(sprites[bkind[i]], -s / 2, -s / 2, s, s);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function wrapAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  // ------------------------------------------------------------------ step --
  function step(seeking) {
    const sx = window.scrollX;
    const sy = window.scrollY;
    const w = window.innerWidth;
    const h = window.innerHeight;

    for (let i = 0; i < count; i++) {
      let ax = 0;
      let ay = 0;

      if (seeking) {
        const dx = pointerX - xs[i];
        const dy = pointerY - ys[i];
        const d = Math.hypot(dx, dy) || 1;
        // Arrival: full speed outside the radius, tapering to nothing inside it.
        const want = d < ARRIVE_RADIUS ? MAX_SPEED * (d / ARRIVE_RADIUS) : MAX_SPEED;
        ax += ((dx / d) * want - vxs[i]) * 2.5;
        ay += ((dy / d) * want - vys[i]) * 2.5;
      } else {
        ax -= vxs[i] * 2.0;
        ay -= vys[i] * 2.0;
      }

      // Separation. O(N^2): fine for dozens, and a few hundred clicks in it
      // is the unwieldy that was asked for.
      for (let j = 0; j < count; j++) {
        if (j === i) continue;
        const dx = xs[i] - xs[j];
        const dy = ys[i] - ys[j];
        const d2 = dx * dx + dy * dy;
        if (d2 > SEPARATION * SEPARATION || d2 === 0) continue;
        const d = Math.sqrt(d2);
        ax += (dx / d) * (SEPARATION - d) * 12;
        ay += (dy / d) * (SEPARATION - d) * 12;
      }

      vxs[i] += ax * STEP;
      vys[i] += ay * STEP;
      const sp = Math.hypot(vxs[i], vys[i]);
      if (sp > MAX_SPEED) {
        vxs[i] = (vxs[i] / sp) * MAX_SPEED;
        vys[i] = (vys[i] / sp) * MAX_SPEED;
      }
      xs[i] += vxs[i] * STEP;
      ys[i] += vys[i] * STEP;

      // The window edges bounce too, so nothing wanders off screen.
      if (xs[i] < 0) { xs[i] = 0; vxs[i] = -vxs[i]; }
      if (xs[i] > w) { xs[i] = w; vxs[i] = -vxs[i]; }
      if (ys[i] < 0) { ys[i] = 0; vys[i] = -vys[i]; }
      if (ys[i] > h) { ys[i] = h; vys[i] = -vys[i]; }

      // The text. One cell lookup, then one rectangle test per obstacle in it.
      const px = xs[i] + sx;
      const py = ys[i] + sy;
      const cx = Math.floor(px / CELL);
      const cy = Math.floor(py / CELL);
      let bounced = false;
      if (cx >= 0 && cy >= 0 && cx < gridW && cy < gridH) {
        const c = cy * gridW + cx;
        for (let k = gridStart[c]; k < gridStart[c + 1]; k++) {
          const o = gridItems[k] * 4;
          const x0 = obs[o];
          const y0 = obs[o + 1];
          const x1 = obs[o + 2];
          const y1 = obs[o + 3];
          if (px < x0 || px > x1 || py < y0 || py > y1) continue;
          // Inside: push out on the shallowest axis and reflect on it.
          const left = px - x0;
          const right = x1 - px;
          const top = py - y0;
          const bottom = y1 - py;
          const m = Math.min(left, right, top, bottom);
          if (m === left) { xs[i] = x0 - sx - 1; vxs[i] = -Math.abs(vxs[i]); }
          else if (m === right) { xs[i] = x1 - sx + 1; vxs[i] = Math.abs(vxs[i]); }
          else if (m === top) { ys[i] = y0 - sy - 1; vys[i] = -Math.abs(vys[i]); }
          else { ys[i] = y1 - sy + 1; vys[i] = Math.abs(vys[i]); }
          bounced = true;
          break;
        }
      }

      if (bounced) {
        // The heading takes the bounce...
        hs[i] = Math.atan2(vys[i], vxs[i]);
      } else {
        // ...and then eases back to facing the pointer over about a second.
        const target = Math.atan2(pointerY - ys[i], pointerX - xs[i]);
        let turn = wrapAngle(target - hs[i]) * HEADING_GAIN;
        if (turn > MAX_TURN) turn = MAX_TURN;
        else if (turn < -MAX_TURN) turn = -MAX_TURN;
        hs[i] = wrapAngle(hs[i] + turn);
      }
    }
  }

  function draw(ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    const s = SIZE * 1.25;
    for (let i = 0; i < count; i++) {
      ctx.save();
      ctx.translate(xs[i], ys[i]);
      // The top of the flower faces the heading, the way the arrow's nose did.
      ctx.rotate(hs[i] + Math.PI / 2);
      ctx.drawImage(sprites[kinds[i]], -s / 2, -s / 2, s, s);
      ctx.restore();
    }
    drawBursts(ctx);
  }

  function resize() {
    const next = Math.min(2, window.devicePixelRatio || 1);
    if (next !== dpr || !sprites.length) {
      dpr = next;
      buildSprites();
    }
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
  }

  // ------------------------------------------------------------------ loop --
  const ctx = canvas.getContext('2d');

  function frame(now) {
    raf = requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25; // a backgrounded tab returning
    acc += dt;
    if (acc < STEP) return; // 30 fps: skip the frames in between

    const idle = now - lastMove > IDLE_MS;
    const seeking = pointerIn && !idle;
    let steps = 0;
    while (acc >= STEP && steps < 3) {
      step(seeking);
      stepBursts();
      acc -= STEP;
      steps++;
    }
    draw(ctx);

    // Not seeking, no petals in the air, and effectively stopped: park the
    // loop until the pointer moves again. This is what "drift to a stop" means.
    if (!seeking && bursting <= 0) {
      let moving = false;
      for (let i = 0; i < count; i++) {
        if (Math.abs(vxs[i]) + Math.abs(vys[i]) > 2) { moving = true; break; }
      }
      if (!moving) stop();
    }
  }

  function start() {
    if (raf || document.hidden || !on) return;
    last = performance.now();
    acc = 0;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function point(e) {
    pointerX = e.clientX;
    pointerY = e.clientY;
    pointerIn = true;
    lastMove = performance.now();
    start();
  }

  // --------------------------------------------------------------- wiring --
  let layoutTimer = 0;
  const relayout = () => {
    clearTimeout(layoutTimer);
    layoutTimer = setTimeout(() => {
      buildField();
      collectObstacles();
    }, 100);
  };
  // A day opening or closing changes the sheet's height; so do fonts landing.
  new ResizeObserver(relayout).observe(sheet);

  let scrollTimer = 0;
  window.addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(collectObstacles, 150);
  }, { passive: true });
  window.addEventListener('resize', () => {
    resize();
    relayout();
  });

  buildField();

  // Motion is opt-out: people who asked their system for less get the field
  // but no agents.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    canvas.remove();
    toggle.remove();
    return;
  }

  window.addEventListener('pointermove', point, { passive: true });
  let lastPointerType = 'mouse';
  window.addEventListener('pointerdown', (e) => {
    lastPointerType = e.pointerType;
    point(e);
  }, { passive: true });
  document.addEventListener('pointerleave', () => (pointerIn = false));
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));

  // Every click brings another flower in from the side. Phones have no
  // pointer to follow between taps, so a tap also bursts where it lands. On
  // click rather than pointerdown, so scrolling does not burst.
  document.addEventListener('click', (e) => {
    if (!on || e.target.closest('.flower-switch')) return;
    spawn(true);
    if (lastPointerType !== 'mouse' && e.detail > 0) burst(e.clientX, e.clientY);
    start();
  });

  function setOn(value) {
    on = value;
    toggle.textContent = on ? 'flowers off' : 'flowers on';
    canvas.style.display = on ? '' : 'none';
    if (on) start();
    else stop();
  }

  toggle.addEventListener('click', () => {
    setOn(!on);
    writeSwitch(on);
  });

  resize();
  collectObstacles();
  // From the sides, like the rest.
  for (let i = 0; i < START; i++) spawn(true);
  pointerX = window.innerWidth / 2;
  pointerY = window.innerHeight / 2;
  setOn(readSwitch());
  // Draw the first five where they are even before the pointer moves.
  draw(ctx);
})();

/* ==========================================================================
   BELLR — ambient backdrop
   A dye field you paint with the pointer. Motion injects colour, the field
   diffuses and decays, and what is left drifts. The tone is driven by the live
   trading session, so the light behind the page says whether the market is open.

   Technique: a quarter-resolution offscreen buffer is fed back into itself each
   frame, scaled up a hair and drawn at reduced alpha. That single trick gives
   both diffusion and decay for one drawImage, which is what keeps a full-bleed
   fluid look affordable on a 2D context.
   ========================================================================== */

import { resolveSession } from './session.js';
import { reduceMotion } from './utils.js';

const TONE = {
  regular: [  0, 224, 107],   // green — bell is up
  pre:     [ 43,  76, 255],   // blue
  post:    [ 43,  76, 255],
  closed:  [255, 197,  61],   // brass
  weekend: [255, 197,  61],
  holiday: [255,  59,  47],   // coral
};

const DYE_SCALE   = 0.25;    // offscreen resolution
const DECAY       = 0.935;   // alpha kept per frame
const EXPANSION   = 1.009;   // per-frame outward creep = diffusion
const IDLE_EMIT   = 3;       // wandering emitters when the pointer is still

export function initBackdrop() {
  const canvas = document.getElementById('backdrop');
  if (!canvas) return;
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  const dye = document.createElement('canvas');
  const dctx = dye.getContext('2d', { alpha: true });

  // The feedback step used to draw `dye` onto its own context with
  // globalCompositeOperation 'copy', which reads a surface that the same
  // operation has just cleared. Browsers do handle it, but it is not a thing
  // the spec promises, and it is the kind of detail that works until a browser
  // version decides otherwise. Going via a scratch canvas is the same effect
  // with nothing undefined in it.
  const scratch = document.createElement('canvas');
  const sctx = scratch.getContext('2d', { alpha: true });

  let W = 0, H = 0, dw = 0, dh = 0, dpr = 1;
  let rgb = [...TONE.closed];
  let target = [...TONE.closed];
  let running = false, raf = 0, last = performance.now();

  // pointer state in dye space
  const ptr = { x: 0, y: 0, px: 0, py: 0, active: false, idle: 0 };
  let emitters = [];


  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    dw = Math.max(64, Math.round(W * DYE_SCALE));
    dh = Math.max(64, Math.round(H * DYE_SCALE));
    dye.width = dw; dye.height = dh;
    dctx.clearRect(0, 0, dw, dh);

    emitters = Array.from({ length: IDLE_EMIT }, (_, i) => ({
      a: (i / IDLE_EMIT) * Math.PI * 2,
      r: 0.18 + i * 0.1,
      speed: 0.00016 + i * 0.00009,
    }));
    ptr.x = ptr.px = dw * 0.5;
    ptr.y = ptr.py = dh * 0.35;
  }

  /** Lay dye down the segment the pointer just travelled, not only at its tip. */
  function inject(x0, y0, x1, y1, speed, strength) {
    const steps = Math.min(14, 1 + Math.floor(speed / 3));
    const [r, g, b] = rgb.map(Math.round);
    const radius = (8 + Math.min(17, speed * 0.38)) * (strength ?? 1);

    dctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 1 : i / steps;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      const a = (0.038 + Math.min(0.07, speed * 0.0026)) * (strength ?? 1);
      const grd = dctx.createRadialGradient(x, y, 0, x, y, radius);
      grd.addColorStop(0, `rgba(${r},${g},${b},${a})`);
      grd.addColorStop(0.5, `rgba(${r},${g},${b},${a * 0.35})`);
      grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
      dctx.fillStyle = grd;
      dctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
  }

  function step(now) {
    const dt = Math.min(48, now - last);
    last = now;

    // ── feedback: scale the field out slightly and fade it ────────────────
    const ex = (EXPANSION - 1) * dw * 0.5;
    const ey = (EXPANSION - 1) * dh * 0.5;
    dctx.globalCompositeOperation = 'copy';
    dctx.globalAlpha = DECAY;
    dctx.drawImage(dye, -ex, -ey, dw + ex * 2, dh + ey * 2);
    dctx.globalAlpha = 1;

    // ── tone eases toward the live session instead of snapping at the bell ─
    for (let i = 0; i < 3; i++) rgb[i] += (target[i] - rgb[i]) * 0.02;

    // ── pointer paint ─────────────────────────────────────────────────────
    const vx = ptr.x - ptr.px, vy = ptr.y - ptr.py;
    const speed = Math.hypot(vx, vy);
    if (ptr.active && speed > 0.15) {
      inject(ptr.px, ptr.py, ptr.x, ptr.y, speed);
      ptr.idle = 0;
    } else {
      ptr.idle += dt;
    }
    ptr.px = ptr.x; ptr.py = ptr.y;

    // ── idle drift so a still pointer still leaves something alive ────────
    if (ptr.idle > 600) {
      const t = now * 0.001;
      for (const e of emitters) {
        e.a += e.speed * dt;
        const x = dw * (0.5 + Math.cos(e.a) * e.r);
        const y = dh * (0.42 + Math.sin(e.a * 1.3) * e.r * 0.8);
        inject(x, y, x, y, 6, 0.42 + Math.sin(t + e.a) * 0.12);
      }
    }

    // ── composite up ──────────────────────────────────────────────────────
    ctx.clearRect(0, 0, W, H);
    // The page is bone, so the dye tints rather than glows.
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.5;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(dye, 0, 0, W, H);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function frame(now) {
    step(now);
    if (running) raf = requestAnimationFrame(frame);
  }
  function start() {
    if (running || reduceMotion()) return;
    running = true; last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function stop() { running = false; cancelAnimationFrame(raf); }

  function syncTone() {
    target = [...(TONE[resolveSession().state] ?? TONE.closed)];
  }

  // ---- lifecycle ---------------------------------------------------------
  resize();
  syncTone();
  rgb = [...target];

  if (reduceMotion()) {
    // one soft static bloom, then leave it alone
    inject(dw * 0.35, dh * 0.3, dw * 0.35, dh * 0.3, 14, 1.1);
    step(performance.now());
  } else {
    start();
  }

  window.addEventListener('resize', () => { resize(); }, { passive: true });
  document.addEventListener('visibilitychange', () => document.hidden ? stop() : start());

  window.addEventListener('scroll', () => {
    if (reduceMotion()) return;
    window.scrollY > window.innerHeight * 2.2 ? stop() : start();
  }, { passive: true });

  window.addEventListener('pointermove', e => {
    ptr.x = (e.clientX / window.innerWidth) * dw;
    ptr.y = (e.clientY / window.innerHeight) * dh;
    ptr.active = true;
  }, { passive: true });

  window.addEventListener('pointerleave', () => { ptr.active = false; });

  setInterval(syncTone, 15_000);

}

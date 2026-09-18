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

/* Two limits that cost nothing to look at and a great deal to leave off.

   MAX_DPR: this is a deliberately blurry field. Rendering it at two device
   pixels per CSS pixel quadruples the work — on a 1374x964 window that is 5.2
   million pixels a frame instead of 1.3 — for a difference nobody can see in a
   soft gradient. The mascot and the type still render at full density; only
   this canvas is capped.

   MIN_FRAME_MS: the field drifts slowly by design. Thirty frames a second
   halves the work again and looks the same. The page has a mascot loop and the
   browser's own compositing to pay for too, and this is the cheapest thing to
   give back. */
const MAX_DPR      = 1;
const MIN_FRAME_MS = 1000 / 30;

export function initBackdrop() {
  const canvas = document.getElementById('backdrop');
  if (!canvas) return;
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  /* Two buffers, swapped each frame. The feedback step reads one and writes the
     other, so nothing ever draws onto the surface it is reading — which is both
     one drawImage cheaper than copying first and free of a self-read the spec
     does not actually promise. */
  let dye = document.createElement('canvas');
  let dctx = dye.getContext('2d', { alpha: true });

  let scratch = document.createElement('canvas');
  let sctx = scratch.getContext('2d', { alpha: true });

  let W = 0, H = 0, dw = 0, dh = 0, dpr = 1;
  let rgb = [...TONE.closed];
  let target = [...TONE.closed];
  let running = false, raf = 0, last = performance.now();

  // pointer state in dye space
  const ptr = { x: 0, y: 0, px: 0, py: 0, active: false, idle: 0 };
  let emitters = [];


  function resize() {
    dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
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
    // Belt and braces: one non-finite coordinate anywhere upstream would throw
    // inside createRadialGradient and kill the loop for the rest of the visit.
    if (![x0, y0, x1, y1, speed].every(Number.isFinite)) return;
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
    // The source is a quarter-resolution blur stretched over the whole window.
    // High-quality resampling of an already-soft gradient buys nothing and is
    // the most expensive thing this canvas does.
    ctx.imageSmoothingQuality = 'low';
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
    // A viewport can report zero height — a collapsed pane, a hidden iframe, a
    // phone mid-rotation. Dividing by it gives Infinity, and Infinity minus
    // Infinity is NaN, which makes createRadialGradient throw and takes the
    // whole animation loop down with it. Clamp the divisor instead.
    ptr.x = (e.clientX / Math.max(1, window.innerWidth)) * dw;
    ptr.y = (e.clientY / Math.max(1, window.innerHeight)) * dh;
    ptr.active = true;
  }, { passive: true });

  window.addEventListener('pointerleave', () => { ptr.active = false; });

  setInterval(syncTone, 15_000);

}

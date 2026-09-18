/* ==========================================================================
   BELLR — Tolly watches the cursor
   Three things separate this from a linear "iris follows mouse":

   1. The iris is clamped to an ELLIPSE, not a box. Box-clamping lets a
      diagonal glance travel further than a straight one, which reads wrong.
   2. The response saturates. Real gaze does not keep rotating once a target
      is well off to the side.
   3. Micro-saccades. Eyes do not glide — they jump and hold. A little
      random re-fixation is most of what makes a gaze feel alive.
   ========================================================================== */

import { reduceMotion } from './utils.js';

const FACE_X = 500, FACE_Y = 480;
const VB_X = -40, VB_Y = -40, VB_W = 1100, VB_H = 1100;
const REACH_X = 820, REACH_Y = 620;

/* Travel inside the sclera. Vertical is smaller, as in a real eye. */
const EYE_RX = 30, EYE_RY = 20;
const TILT_DEG = 3.4, TILT_X = 15;

const EYE_TAU = 62;      /* glance settles fast  */
const TILT_TAU = 280;    /* the body drifts after it */

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
/* Saturating response: linear near the face, easing off further out. */
const soften = n => Math.tanh(n * 1.25);

export function initMascotEyes() {
  const svg = document.querySelector('svg.tolly');
  const looks = svg ? [...svg.querySelectorAll('.t-look')] : [];
  const tilt = svg?.querySelector('.t-tilt');
  if (!svg || !looks.length || !tilt || reduceMotion()) return;

  let aimX = 0, aimY = 0;            // -1..1, where the gaze wants to be
  let jitterX = 0, jitterY = 0;      // current micro-saccade offset
  let eyeX = 0, eyeY = 0, leanX = 0;
  let raf = 0, last = 0, nextSaccade = 0;

  function aim(clientX, clientY) {
    const r = svg.getBoundingClientRect();
    if (!r.width || !r.height) return;

    // The viewBox is offset and wider than 1000 to hold the animation
    // envelope, so map through it rather than assuming a 0..1000 box.
    const ux = VB_X + ((clientX - r.left) / r.width) * VB_W;
    const uy = VB_Y + ((clientY - r.top) / r.height) * VB_H;

    aimX = soften((ux - FACE_X) / REACH_X);
    aimY = soften((uy - FACE_Y) / REACH_Y);

    const near = clientX > r.left - 170 && clientX < r.right + 170
              && clientY > r.top - 170 && clientY < r.bottom + 170;
    svg.classList.toggle('is-awake', near);
    start();
  }

  function frame(now) {
    const dt = last ? Math.min(120, now - last) : 16;
    last = now;

    /* A new fixation every 1.4–3.2s, tiny and instant — that is a saccade. */
    if (now > nextSaccade) {
      nextSaccade = now + 1400 + Math.random() * 1800;
      jitterX = (Math.random() - 0.5) * 0.17;
      jitterY = (Math.random() - 0.5) * 0.11;
    }

    /* Clamp the target to an ellipse so every direction has the same reach. */
    let tx = clamp(aimX + jitterX, -1, 1);
    let ty = clamp(aimY + jitterY, -1, 1);
    const mag = Math.hypot(tx, ty);
    if (mag > 1) { tx /= mag; ty /= mag; }

    const kEye = 1 - Math.exp(-dt / EYE_TAU);
    const kTilt = 1 - Math.exp(-dt / TILT_TAU);
    eyeX += (tx * EYE_RX - eyeX) * kEye;
    eyeY += (ty * EYE_RY - eyeY) * kEye;
    leanX += (aimX - leanX) * kTilt;

    const t = `translate(${eyeX.toFixed(2)} ${eyeY.toFixed(2)})`;
    for (const look of looks) look.setAttribute('transform', t);
    tilt.setAttribute(
      'transform',
      `translate(${(leanX * TILT_X).toFixed(2)} 0) rotate(${(leanX * TILT_DEG).toFixed(2)} 500 240)`
    );

    /* Saccades mean there is always a next move, so never fully park while
       the cursor is engaged — but idle away from the page and it settles. */
    raf = requestAnimationFrame(frame);
  }

  /* Scrolled past the mascot, there is nothing to animate. Without this the
     loop keeps writing SVG transforms sixty times a second to something nobody
     can see — each write invalidating style for that subtree — for the whole
     rest of the page. The backdrop already parks itself on scroll; this is the
     other half of that. */
  let onScreen = true;

  function start() { if (!raf && onScreen) { last = 0; raf = requestAnimationFrame(frame); } }
  function stop() { cancelAnimationFrame(raf); raf = 0; }

  function release() {
    aimX = 0; aimY = 0;
    svg.classList.remove('is-awake');
    start();
    setTimeout(() => { if (!svg.classList.contains('is-awake')) stop(); }, 1600);
  }

  window.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return;
    aim(e.clientX, e.clientY);
  }, { passive: true });
  window.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') aim(e.clientX, e.clientY);
  }, { passive: true });

  document.addEventListener('pointerleave', release);
  window.addEventListener('blur', release);
  document.addEventListener('visibilitychange', () => document.hidden ? stop() : start());

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      if (!onScreen) stop();
      else if (svg.classList.contains('is-awake')) start();
    }, { rootMargin: '120px' }).observe(svg);
  }

  for (const look of looks) look.setAttribute('transform', 'translate(0 0)');
  tilt.setAttribute('transform', 'translate(0 0) rotate(0 500 240)');

  scheduleBlinks(svg);
}

/**
 * Blinks are driven from here rather than a CSS loop. A fixed interval is the
 * clearest tell that a face is animated rather than alive — real blinking is
 * irregular, comes in occasional doubles, and speeds up under attention.
 */
function scheduleBlinks(svg) {
  let timer = 0;

  const blink = (then) => {
    if (document.hidden || svg.classList.contains('is-ringing')) return next();
    svg.classList.add('is-blinking');
    setTimeout(() => {
      svg.classList.remove('is-blinking');
      then ? setTimeout(() => blink(false), 90) : next();   // the second of a double
    }, 280);
  };

  const next = () => {
    const attentive = svg.classList.contains('is-awake');
    const gap = attentive
      ? 1900 + Math.random() * 2600     // watched faces blink more
      : 3200 + Math.random() * 4800;
    clearTimeout(timer);
    timer = setTimeout(() => blink(Math.random() < 0.22), gap);
  };

  next();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) next(); });
}

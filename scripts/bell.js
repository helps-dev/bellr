/* ==========================================================================
   BELLR — click Tolly and he rings himself
   Synthesised, not sampled. What makes a bell sound like a bell is not the
   pitch but four things a naive sine stack misses:

   1. Inharmonic partials. A bell's overtones are not whole multiples — the
      minor third above the strike note is what gives bells their sadness.
   2. Beating. Real castings are never perfectly symmetric, so each partial
      is really two a fraction of a hertz apart. That shimmer is the tell.
   3. Wildly uneven decay. The hum can ring for seconds after the upper
      partials have gone completely.
   4. A room. A dry bell sounds like a synthesiser.
   ========================================================================== */

import { reduceMotion } from './utils.js';

/**
 * Partials of a minor-third bell, relative to the strike note.
 * `detune` is the split in cents between the pair that produces the beating.
 */
const PARTIALS = [
  { name: 'hum',      ratio: 0.500, gain: 0.34, decay: 6.5, detune: 1.6 },
  { name: 'prime',    ratio: 1.000, gain: 0.40, decay: 4.6, detune: 2.4 },
  { name: 'tierce',   ratio: 1.183, gain: 0.32, decay: 3.4, detune: 3.2 },
  { name: 'quint',    ratio: 1.506, gain: 0.16, decay: 2.4, detune: 4.0 },
  { name: 'nominal',  ratio: 2.000, gain: 0.26, decay: 2.0, detune: 3.0 },
  { name: 'deciem',   ratio: 2.514, gain: 0.10, decay: 1.2, detune: 5.0 },
  { name: 'undecim',  ratio: 3.011, gain: 0.08, decay: 0.8, detune: 6.0 },
  { name: 'duodecim', ratio: 4.166, gain: 0.06, decay: 0.5, detune: 7.0 },
  { name: 'upper',    ratio: 5.433, gain: 0.04, decay: 0.28, detune: 9.0 },
  { name: 'top',      ratio: 6.800, gain: 0.025, decay: 0.16, detune: 11.0 },
];

let ctx = null;
let reverb = null;
let master = null;

/** Exponentially decaying noise makes a serviceable room without a file. */
function impulse(ac, seconds = 2.4, curve = 3.4) {
  const len = Math.floor(ac.sampleRate * seconds);
  const buf = ac.createBuffer(2, len, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, curve);
    }
  }
  return buf;
}

function audio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);

    reverb = ctx.createConvolver();
    reverb.buffer = impulse(ctx);
    const wet = ctx.createGain();
    wet.gain.value = 0.34;
    reverb.connect(wet).connect(master);
    master._wet = wet;
    master._reverb = reverb;
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function ring(base = 466.16 /* A#4 — a heavier bell than a bright C */) {
  const ac = audio();
  if (!ac) return;

  const t0 = ac.currentTime + 0.001;
  const bus = ac.createGain();
  bus.gain.value = 1;
  bus.connect(master);
  bus.connect(reverb);

  for (const p of PARTIALS) {
    // Two oscillators a few cents apart per partial: the beating is the point.
    for (const side of [-1, 1]) {
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = 'sine';
      osc.frequency.value = base * p.ratio;
      osc.detune.value = side * p.detune;

      // Struck metal sags slightly in pitch as the energy leaves it.
      osc.frequency.setValueAtTime(base * p.ratio, t0);
      osc.frequency.exponentialRampToValueAtTime(base * p.ratio * 0.9965, t0 + p.decay);

      const peak = p.gain * 0.5;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + p.decay);

      osc.connect(g).connect(bus);
      osc.start(t0);
      osc.stop(t0 + p.decay + 0.1);
    }
  }

  // The strike itself: a bright, very short metallic click that rings up
  // through a resonant filter rather than a flat noise burst.
  const n = ac.createBufferSource();
  const len = Math.floor(ac.sampleRate * 0.09);
  const nb = ac.createBuffer(1, len, ac.sampleRate);
  const d = nb.getChannelData(0);
  for (let i = 0; i < len; i++) {
    d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 5);
  }
  n.buffer = nb;

  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 2.2;
  bp.frequency.setValueAtTime(base * 7, t0);
  bp.frequency.exponentialRampToValueAtTime(base * 2.2, t0 + 0.08);

  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = base * 1.4;

  const ng = ac.createGain();
  ng.gain.setValueAtTime(0.5, t0);
  ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);

  n.connect(bp).connect(hp).connect(ng).connect(bus);
  n.start(t0);
  n.stop(t0 + 0.14);
}

export function initBellTap() {
  const svg = document.querySelector('svg.tolly');
  if (!svg) return;

  svg.setAttribute('tabindex', '0');
  svg.setAttribute('role', 'button');
  svg.setAttribute('aria-label', 'Ring the bell');

  // Chrome treats a click on a tabindexed SVG as keyboard-ish focus, so the
  // ring shows on mouse clicks. Track how the strike started and drop focus
  // when it came from a pointer.
  let viaPointer = false;
  svg.addEventListener('pointerdown', () => { viaPointer = true; });
  svg.addEventListener('blur', () => { viaPointer = false; });

  let busy = false;
  const strike = () => {
    if (busy) return;
    busy = true;
    // A touch of variation per strike — nothing is hit identically twice.
    ring(466.16 * (1 + (Math.random() - 0.5) * 0.012));
    if (!reduceMotion()) {
      svg.classList.remove('is-ringing');
      void svg.getBoundingClientRect();     // restart the animation cleanly
      svg.classList.add('is-ringing');
      setTimeout(() => svg.classList.remove('is-ringing'), 1400);
    }
    if (viaPointer) svg.blur();
    setTimeout(() => { busy = false; }, 300);
  };

  svg.addEventListener('click', strike);
  svg.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); strike(); }
  });

  initMarkTap();
}

/** The header mark rings too — a smaller bell, so a brighter, shorter tone. */
function initMarkTap() {
  const brand = document.querySelector('.hdr__brand');
  if (!brand) return;

  let busy = false;
  brand.addEventListener('click', () => {
    if (busy) return;
    busy = true;
    ring(698.46 * (1 + (Math.random() - 0.5) * 0.01));   // F5 — a handbell
    if (!reduceMotion()) {
      brand.classList.remove('is-ringing');
      void brand.getBoundingClientRect();
      brand.classList.add('is-ringing');
      setTimeout(() => brand.classList.remove('is-ringing'), 1000);
    }
    setTimeout(() => { busy = false; }, 280);
  });
}

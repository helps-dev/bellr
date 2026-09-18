/* ==========================================================================
   BELLR — mascot source
   The inline SVG is the fallback. If rendered art has been dropped into
   assets/character/ as tolly-<state>.png, the page swaps to it and follows
   the live session across the four files.
   ========================================================================== */

import { POLICY_KEY } from './session.js';

/** One image per armed regime — the four files the prompt doc produces. */
const FILES = {
  regular:  'assets/character/tolly-regular.png',
  extended: 'assets/character/tolly-extended.png',
  closed:   'assets/character/tolly-closed.png',
  weekend:  'assets/character/tolly-closed.png',
};

const available = new Map();
let img = null;

function probe(src) {
  if (available.has(src)) return available.get(src);
  const p = new Promise(resolve => {
    const test = new Image();
    test.onload = () => resolve(true);
    test.onerror = () => resolve(false);
    test.src = src;
  });
  available.set(src, p);
  return p;
}

/** Called by the clock whenever the regime changes. */
export async function setMascotState(state) {
  const svg = document.querySelector('svg.tolly');
  if (!svg) return;

  const src = FILES[POLICY_KEY[state]] ?? FILES.closed;
  if (!(await probe(src))) {
    // No rendered art present — keep the drawn fallback visible.
    if (img) { img.remove(); img = null; svg.style.display = ''; }
    return;
  }

  if (!img) {
    img = document.createElement('img');
    img.className = 'tolly tolly--img';
    img.alt = 'Tolly, the bell unit';
    svg.after(img);
    svg.style.display = 'none';
  }
  if (!img.src.endsWith(src)) img.src = src;
}

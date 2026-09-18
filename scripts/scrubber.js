/* ==========================================================================
   BELLR — session scrubber
   Drag across a week and watch the pool's rules change underneath you. The
   presets are chosen to land on the awkward weeks — a half-day, a holiday, a
   Friday-observed closure — because that is where the product earns its keep.
   ========================================================================== */

import { $, $$ } from './utils.js';
import { classifyDay, nyNow, PRE_OPEN_MIN, OPEN_MIN } from './calendar.js';
import { stateForDay, REGIME_META, POLICY_KEY } from './session.js';
import { DEFAULT_POLICY, REGIME_LABELS } from './config.js';

const DAYS = 7;
const WEEK_MIN = DAYS * 1440;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const utc = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const addDays = (dt, n) => new Date(dt.getTime() + n * 86400000);

/** Monday of the week containing this civil date. */
function mondayOf({ y, m, d }) {
  const dt = utc(y, m, d);
  const shift = (dt.getUTCDay() + 6) % 7;      // Mon = 0
  return addDays(dt, -shift);
}

function weekFrom(startDt) {
  return Array.from({ length: DAYS }, (_, i) => {
    const dt = addDays(startDt, i);
    const civil = { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
    return { ...civil, dow: dt.getUTCDay(), info: classifyDay(civil) };
  });
}

const state = { week: null, minute: 0, presets: [], active: 0 };

/* ---- presets ------------------------------------------------------------- */
function buildPresets() {
  const now = nyNow();
  const y = now.y;
  return [
    { label: 'This week',  start: mondayOf(now) },
    { label: 'Thanksgiving', start: mondayOf(thanksgiving(y >= 2026 ? y : y)) },
    { label: 'Christmas',  start: mondayOf({ y, m: 12, d: 24 }) },
    { label: 'July 4',     start: mondayOf({ y, m: 7, d: 4 }) },
  ];
}
function thanksgiving(y) {
  const first = utc(y, 11, 1);
  const shift = (4 - first.getUTCDay() + 7) % 7;     // Thursday
  const dt = addDays(first, shift + 21);
  return { y, m: 11, d: dt.getUTCDate() };
}

/* ---- rendering ----------------------------------------------------------- */
function bandsFor(day) {
  if (!day.info.trading) {
    const tone = day.info.reason === 'holiday' ? 'holiday' : 'weekend';
    return `<i class="band band--${tone}" style="left:0;width:100%"></i>`;
  }
  const pc = min => (min / 1440) * 100;
  const seg = (cls, a, b) =>
    `<i class="band band--${cls}" style="left:${pc(a).toFixed(2)}%;width:${(pc(b) - pc(a)).toFixed(2)}%"></i>`;
  return seg('pre', PRE_OPEN_MIN, OPEN_MIN)
       + seg('open', OPEN_MIN, day.info.closeMin)
       + seg('post', day.info.closeMin, day.info.postEndMin);
}

function renderTrack() {
  const track = $('#scrubTrack');
  track.innerHTML = state.week.map(day => `
    <div class="scrub__day${day.info.trading ? '' : ' is-shut'}">
      <span class="scrub__date">${DOW[day.dow]} ${day.d}</span>
      <span class="scrub__bands">${bandsFor(day)}</span>
      ${day.info.half ? '<span class="scrub__flag">half</span>' : ''}
      ${day.info.reason === 'holiday' ? `<span class="scrub__flag scrub__flag--hol">${day.info.label}</span>` : ''}
    </div>`).join('') + '<span class="scrub__head" id="scrubHead"></span>';
}

function renderReadout() {
  const dayIdx = Math.min(DAYS - 1, Math.floor(state.minute / 1440));
  const minuteOfDay = Math.floor(state.minute % 1440);
  const day = state.week[dayIdx];
  const st = stateForDay(day.info, minuteOfDay);
  const meta = REGIME_META[st];
  const policyKey = POLICY_KEY[st];
  const p = DEFAULT_POLICY[policyKey];

  const hh = String(Math.floor(minuteOfDay / 60)).padStart(2, '0');
  const mm = String(minuteOfDay % 60).padStart(2, '0');

  $('#scrubHead').style.left = `${((state.minute / WEEK_MIN) * 100).toFixed(3)}%`;
  $('#scrubHead').dataset.tone = meta.led;

  $('#scrubOut').innerHTML = `
    <div class="scrub__when">
      <span class="label">${DOW[day.dow]} ${MON[day.m - 1]} ${day.d}</span>
      <b class="mono">${hh}:${mm} ET</b>
    </div>
    <p class="scrub__state" data-tone="${meta.led}">
      <i class="led led--${meta.led}"></i>${meta.label}
    </p>
    <p class="scrub__day-note">${day.info.label}${day.info.half ? ' · closes 13:00' : ''}</p>
    <dl class="spec">
      <div><dt>Armed regime</dt><dd>${REGIME_LABELS[policyKey]}</dd></div>
      <div><dt>Pool fee</dt><dd class="mono">${p.fee.toFixed(2)}%</dd></div>
      <div><dt>Wallet cap</dt><dd class="mono">${p.cap >= 100 ? 'uncapped' : p.cap + '% supply'}</dd></div>
      <div><dt>Oracle band</dt><dd class="mono">±${p.band.toFixed(2)}%</dd></div>
    </dl>`;
}

function render() { renderTrack(); renderReadout(); }

/* ---- interaction --------------------------------------------------------- */
function setFromClientX(clientX) {
  const track = $('#scrubTrack');
  const r = track.getBoundingClientRect();
  const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  state.minute = f * WEEK_MIN;
  renderReadout();
}

export function initScrubber() {
  const track = $('#scrubTrack');
  if (!track) return;

  state.presets = buildPresets();
  state.week = weekFrom(state.presets[0].start);

  // Start the playhead at the current moment within this week.
  const now = nyNow();
  const idx = state.week.findIndex(d => d.y === now.y && d.m === now.m && d.d === now.d);
  state.minute = (idx >= 0 ? idx : 0) * 1440 + now.minutes;

  $('#scrubPresets').innerHTML = state.presets.map((p, i) =>
    `<button type="button" class="scrub__preset${i === 0 ? ' is-on' : ''}" data-preset="${i}">${p.label}</button>`
  ).join('');

  $('#scrubPresets').addEventListener('click', e => {
    const b = e.target.closest('[data-preset]');
    if (!b) return;
    state.active = Number(b.dataset.preset);
    state.week = weekFrom(state.presets[state.active].start);
    // Drop the playhead on the most interesting day of the chosen week.
    const pick = state.week.findIndex(d => d.info.half || d.info.reason === 'holiday');
    state.minute = (pick >= 0 ? pick : 2) * 1440 + 12 * 60;
    $$('.scrub__preset').forEach((x, i) => x.classList.toggle('is-on', i === state.active));
    render();
  });

  let dragging = false;
  track.addEventListener('pointerdown', e => {
    dragging = true; track.setPointerCapture(e.pointerId); setFromClientX(e.clientX);
  });
  track.addEventListener('pointermove', e => { if (dragging) setFromClientX(e.clientX); });
  track.addEventListener('pointerup', e => { dragging = false; track.releasePointerCapture(e.pointerId); });
  track.addEventListener('pointercancel', () => { dragging = false; });

  track.addEventListener('keydown', e => {
    const step = e.shiftKey ? 60 : 15;
    if (e.key === 'ArrowRight') { state.minute = Math.min(WEEK_MIN, state.minute + step); }
    else if (e.key === 'ArrowLeft') { state.minute = Math.max(0, state.minute - step); }
    else if (e.key === 'Home') { state.minute = 0; }
    else if (e.key === 'End') { state.minute = WEEK_MIN - 1; }
    else return;
    e.preventDefault();
    renderReadout();
  });

  render();
}

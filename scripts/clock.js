/* ==========================================================================
   BELLR — binds the resolved session to every readout on the page.
   ========================================================================== */

import { $ } from './utils.js';
import { resolveSession, formatCountdown } from './session.js';
import { PRE_OPEN_MIN, OPEN_MIN } from './calendar.js';
import { setMascotState } from './mascot.js';
import { DEFAULT_POLICY, REGIME_LABELS } from './config.js';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const pct = minutes => (minutes / 1440) * 100;

/** Rebuilds the 24h ribbon so a half-day actually looks like a half-day. */
function ribbonHTML(s) {
  if (!s.closeMin) return '';                       // weekend or holiday: no session at all
  const postEnd = Math.min(s.closeMin + (s.isHalfDay ? 240 : 240), 1440);
  const seg = (cls, from, to) =>
    `<div class="ribbon__seg ribbon__seg--${cls}" style="left:${pct(from).toFixed(3)}%;width:${(pct(to) - pct(from)).toFixed(3)}%"></div>`;
  return seg('pre', PRE_OPEN_MIN, OPEN_MIN)
       + seg('open', OPEN_MIN, s.closeMin)
       + seg('post', s.closeMin, postEnd);
}

export function initClock() {
  const el = {
    barState: $('#barState'), barLabel: $('#barLabel'), barCount: $('#barCount'),
    clockState: $('#clockState'), clockLabel: $('#clockLabel'),
    clockCount: $('#clockCount'), clockNow: $('#clockNow'),
    ribbon: $('#ribbon'),
    rowRegime: $('#rowRegime'), rowFee: $('#rowFee'), rowCap: $('#rowCap'),
    rowBand: $('#rowBand'), rowDay: $('#rowDay'), rowHoliday: $('#rowHoliday'),
    depthRegime: $('#depthRegime'),
    tolly: document.querySelector('.tolly'),
    brand: document.querySelector('.hdr__brand'),
  };
  if (!el.clockState) return;

  let lastState = null;
  let lastRibbonKey = null;

  const tick = () => {
    const s = resolveSession();

    el.barLabel.textContent = s.state === 'regular' ? 'MARKET OPEN' : `MARKET ${s.label}`;
    el.barCount.textContent = `${s.bellName} in ${formatCountdown(s.secondsToBell)}`.toUpperCase();
    el.clockLabel.textContent = s.label;
    el.clockCount.textContent = formatCountdown(s.secondsToBell);
    el.clockNow.textContent = s.clock;

    // The ribbon only changes shape when the day does, not every second.
    const rkey = `${s.closeMin}|${s.isHalfDay}`;
    if (rkey !== lastRibbonKey) {
      lastRibbonKey = rkey;
      el.ribbon.innerHTML = ribbonHTML(s) + '<div class="ribbon__now" id="ribbonNow"></div>';
    }
    $('#ribbonNow').style.left = `${(s.dayFraction * 100).toFixed(3)}%`;

    if (s.state !== lastState) {
      lastState = s.state;
      const tone = s.state === 'regular' ? 'open' : (s.led === 'pre' ? 'pre' : 'closed');
      el.barState.dataset.state = tone;
      el.clockState.dataset.state = tone;
      // The state word is a headline in this layout, so it may carry no LED.
      const dots = [el.barState, el.clockState]
        .map(n => n?.querySelector('.led')).filter(Boolean);
      dots.forEach(d => { d.className = `led led--${s.led}`; });

      const p = DEFAULT_POLICY[s.policyKey];
      el.rowRegime.textContent = REGIME_LABELS[s.policyKey];
      el.rowFee.textContent = `${p.fee.toFixed(2)}%`;
      el.rowCap.textContent = p.cap >= 100 ? 'None' : `${p.cap}%`;
      el.rowBand.textContent = `±${p.band.toFixed(2)}%`;
      if (el.depthRegime) el.depthRegime.textContent = s.label.toLowerCase();
      // the mascot reads the same regime the hooks would
      if (el.tolly) el.tolly.dataset.session = s.state;
      if (el.brand) el.brand.dataset.session = s.state;
      setMascotState(s.state);
    }

    el.rowDay.textContent = s.isHalfDay ? `${s.dayLabel} · half-day` : s.dayLabel;
    if (s.nextHoliday) {
      const h = s.nextHoliday;
      el.rowHoliday.textContent = `${h.name} · ${MONTHS[h.m - 1]} ${h.d}`;
    }
  };

  tick();
  setInterval(tick, 1000);
}

/* ==========================================================================
   BELLR — trading session resolver
   Turns "what time is it" into "which regime is the pool in", using the full
   exchange calendar: weekends, holidays, and half-day closes.
   ========================================================================== */

import {
  nyNow, classifyDay, nextTradingDay, nextHoliday,
  OPEN_MIN, PRE_OPEN_MIN,
} from './calendar.js';

/** Presentation for each regime. Numbers come from the armed policy, not here. */
export const REGIME_META = {
  regular:  { label: 'OPEN',        led: 'open'   },
  pre:      { label: 'PRE-MARKET',  led: 'pre'    },
  post:     { label: 'AFTER HOURS', led: 'pre'    },
  closed:   { label: 'CLOSED',      led: 'closed' },
  weekend:  { label: 'WEEKEND',     led: 'closed' },
  holiday:  { label: 'HOLIDAY',     led: 'closed' },
};

/** Maps a live session state onto the four regimes a pool is armed with. */
export const POLICY_KEY = {
  regular: 'regular', pre: 'extended', post: 'extended',
  closed: 'closed', weekend: 'weekend', holiday: 'weekend',
};

/**
 * Which state a given day is in at a given minute. Shared so the live clock and
 * the scrubber can never disagree about what a Thursday afternoon means.
 */
export function stateForDay(day, minutes) {
  if (!day.trading) return day.reason === 'holiday' ? 'holiday' : 'weekend';
  if (minutes >= OPEN_MIN && minutes < day.closeMin) return 'regular';
  if (minutes >= PRE_OPEN_MIN && minutes < OPEN_MIN) return 'pre';
  if (minutes >= day.closeMin && minutes < day.postEndMin) return 'post';
  return 'closed';
}

export function resolveSession(date = new Date()) {
  const t = nyNow(date);
  const today = classifyDay(t);
  const holiday = nextHoliday(t);

  const state = stateForDay(today, t.minutes);

  // Seconds to the bell that actually changes the regime.
  let minutesToBell, bellName;
  if (state === 'regular') {
    minutesToBell = today.closeMin - t.minutes;
    bellName = today.half ? 'early close' : 'closing bell';
  } else if (today.trading && t.minutes < OPEN_MIN) {
    minutesToBell = OPEN_MIN - t.minutes;
    bellName = 'opening bell';
  } else {
    const next = nextTradingDay(t);
    minutesToBell = next.offset * 1440 + OPEN_MIN - t.minutes;
    bellName = 'opening bell';
  }

  return {
    state,
    ...REGIME_META[state],
    policyKey: POLICY_KEY[state],
    // A holiday names itself; a plain weekend does not need to.
    dayLabel: today.trading ? today.label : (today.reason === 'holiday' ? today.label : 'Weekend'),
    isHalfDay: Boolean(today.half),
    closeMin: today.closeMin ?? null,
    bellName,
    secondsToBell: minutesToBell * 60 - t.second,
    dayFraction: (t.minutes * 60 + t.second) / 86400,
    clock: `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')} ET`,
    nextHoliday: holiday,
  };
}

export function formatCountdown(totalSeconds) {
  if (totalSeconds < 0) return '—';
  const d = Math.floor(totalSeconds / 86400);
  const h = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

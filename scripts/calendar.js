/* ==========================================================================
   BELLR — US equity market calendar
   Weekends, exchange holidays with their observance rules, and half-days.

   All arithmetic runs on civil dates (year/month/day) held in UTC Date objects.
   That keeps daylight saving out of the maths entirely — a calendar date in
   New York is a calendar date regardless of what the clock did that night.
   ========================================================================== */

const NY = 'America/New_York';

/** Civil date + wall clock in New York, whatever timezone the viewer is in. */
export function nyNow(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: NY, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(date).map(p => [p.type, p.value])
  );
  const hour = parts.hour === '24' ? 0 : Number(parts.hour);
  return {
    y: Number(parts.year), m: Number(parts.month), d: Number(parts.day),
    hour, minute: Number(parts.minute), second: Number(parts.second),
    minutes: hour * 60 + Number(parts.minute),
  };
}

const utc = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const key = dt => `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
const addDays = (dt, n) => new Date(dt.getTime() + n * 86400000);

/** nth weekday of a month, e.g. nth(2026, 1, 1, 3) = third Monday of January. */
function nth(year, month, weekday, n) {
  const first = utc(year, month, 1);
  const shift = (weekday - first.getUTCDay() + 7) % 7;
  return addDays(first, shift + (n - 1) * 7);
}

/** Last given weekday of a month, e.g. last Monday of May. */
function last(year, month, weekday) {
  const end = new Date(Date.UTC(year, month, 0));   // day 0 of next month
  const shift = (end.getUTCDay() - weekday + 7) % 7;
  return addDays(end, -shift);
}

/** Meeus/Jones/Butcher Gregorian Easter — Good Friday hangs off this. */
function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(year, month, day);
}

/**
 * Exchange observance: a holiday on Saturday moves to the Friday before, one on
 * Sunday to the Monday after. New Year's Day is the documented exception — the
 * exchange does not close the preceding 31 December.
 */
function observe(dt, { noSaturdayRollback = false } = {}) {
  const dow = dt.getUTCDay();
  if (dow === 6) return noSaturdayRollback ? null : addDays(dt, -1);
  if (dow === 0) return addDays(dt, 1);
  return dt;
}

/** Full-closure holidays for a calendar year, as { 'YYYY-MM-DD': name }. */
export function holidaysFor(year) {
  const out = {};
  const put = (dt, name) => { if (dt) out[key(dt)] = name; };

  put(observe(utc(year, 1, 1), { noSaturdayRollback: true }), "New Year's Day");
  put(nth(year, 1, 1, 3), 'Martin Luther King, Jr. Day');
  put(nth(year, 2, 1, 3), "Washington's Birthday");
  put(addDays(easterSunday(year), -2), 'Good Friday');
  put(last(year, 5, 1), 'Memorial Day');
  put(observe(utc(year, 6, 19)), 'Juneteenth');
  put(observe(utc(year, 7, 4)), 'Independence Day');
  put(nth(year, 9, 1, 1), 'Labor Day');
  put(nth(year, 11, 4, 4), 'Thanksgiving Day');
  put(observe(utc(year, 12, 25)), 'Christmas Day');
  return out;
}

/** Half-days — the exchange closes at 13:00 ET instead of 16:00. */
export function earlyClosesFor(year) {
  const out = {};
  const holidays = holidaysFor(year);
  const put = (dt, name) => {
    const k = key(dt);
    const dow = dt.getUTCDay();
    if (dow === 0 || dow === 6) return;   // never a session anyway
    if (holidays[k]) return;              // a full closure outranks a half-day
    out[k] = name;
  };

  put(addDays(nth(year, 11, 4, 4), 1), 'Day after Thanksgiving');
  put(utc(year, 12, 24), 'Christmas Eve');
  // 3 July is a half-day only when Independence Day itself is a session.
  const jul4 = utc(year, 7, 4);
  if (jul4.getUTCDay() !== 0 && jul4.getUTCDay() !== 6) put(utc(year, 7, 3), 'Day before Independence Day');
  return out;
}

const cache = new Map();
function yearData(year) {
  if (!cache.has(year)) {
    cache.set(year, { holidays: holidaysFor(year), early: earlyClosesFor(year) });
  }
  return cache.get(year);
}

export const OPEN_MIN      = 9 * 60 + 30;   // 09:30 ET
export const CLOSE_MIN     = 16 * 60;       // 16:00 ET
export const EARLY_CLOSE   = 13 * 60;       // 13:00 ET on half-days
export const PRE_OPEN_MIN  = 4 * 60;        // 04:00 ET
export const POST_END_MIN  = 20 * 60;       // 20:00 ET

/** What kind of day this civil date is, and when the bell rings on it. */
export function classifyDay({ y, m, d }) {
  const dt = utc(y, m, d);
  const k = key(dt);
  const dow = dt.getUTCDay();
  const { holidays, early } = yearData(y);

  if (dow === 0 || dow === 6) return { trading: false, reason: 'weekend', label: 'Weekend' };
  if (holidays[k])            return { trading: false, reason: 'holiday', label: holidays[k] };

  const half = Boolean(early[k]);
  return {
    trading: true,
    reason: half ? 'half-day' : 'full',
    label: half ? early[k] : 'Regular session',
    closeMin: half ? EARLY_CLOSE : CLOSE_MIN,
    postEndMin: half ? EARLY_CLOSE + 4 * 60 : POST_END_MIN,
    half,
  };
}

/** Walks forward to the next trading day, holidays and weekends skipped. */
export function nextTradingDay({ y, m, d }, startOffset = 1) {
  let dt = addDays(utc(y, m, d), startOffset);
  for (let i = 0; i < 30; i++) {
    const c = classifyDay({ y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() });
    if (c.trading) {
      return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), offset: startOffset + i, ...c };
    }
    dt = addDays(dt, 1);
  }
  return null;   // unreachable in practice: no 30-day exchange closure exists
}

/** The next full closure from today, for the "next holiday" readout. */
export function nextHoliday({ y, m, d }) {
  const today = utc(y, m, d);
  for (const year of [y, y + 1]) {
    const entries = Object.entries(holidaysFor(year)).sort(([a], [b]) => a.localeCompare(b));
    for (const [k, name] of entries) {
      const [hy, hm, hd] = k.split('-').map(Number);
      const dt = utc(hy, hm, hd);
      if (dt > today) {
        return { name, key: k, y: hy, m: hm, d: hd, inDays: Math.round((dt - today) / 86400000) };
      }
    }
  }
  return null;
}

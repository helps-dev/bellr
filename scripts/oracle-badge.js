/* Says plainly where the calendar came from — the oracle, or this browser. */

import { $ } from './utils.js';
import { getSession, state, sourceLabel } from './calendar-source.js';

export function initOracleBadge() {
  const badge = $('#oracleBadge');
  if (!badge) return;

  const paint = () => {
    badge.dataset.source = state.source;
    $('#oracleText').textContent =
      state.source === 'chain' ? `calendar from ${sourceLabel()}` : 'calendar computed locally';
  };

  // One probe now, then occasionally — the answer only changes on deploy or
  // when a wallet appears, neither of which needs a tight poll.
  getSession().then(paint).catch(paint);
  setInterval(() => getSession().then(paint).catch(paint), 60_000);
}

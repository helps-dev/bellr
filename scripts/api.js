/* ==========================================================================
   BELLR — the read API client.

   The indexer is the only thing the interface reads from. It is allowed to be
   absent: every call resolves to null rather than throwing, and the page shows
   its own computed calendar instead. A mockup that white-screens because a
   service is down is worse than one that quietly falls back.
   ========================================================================== */

import { API } from './config.js';

const TIMEOUT_MS = 6000;

let reachable = null; // null = not yet checked

async function get(path) {
  // No base means no indexer is reachable from wherever this page is served.
  // Saying so immediately is kinder than six seconds of timeout per call.
  if (!API.base) { reachable = false; return null; }
  try {
    const res = await fetch(`${API.base}${path}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`api ${res.status}`);
    reachable = true;
    return await res.json();
  } catch {
    reachable = false;
    return null;
  }
}

/** Whether the last call got through. Null before anything has been tried. */
export const isReachable = () => reachable;

export const health = () => get(API.routes.health);
export const session = () => get(API.routes.session);
export const pools = () => get(API.routes.pools);
export const pool = id => get(API.routes.pool(id));
export const swaps = id => get(API.routes.swaps(id));
export const tolls = () => get(API.routes.tolls);
export const halts = () => get(API.routes.halts);

/**
 * The session as the chain sees it, or null when the indexer is not there.
 * The caller decides what to do with a null — `session.js` keeps computing the
 * calendar locally, which is what the page has always done.
 */
export async function chainSession() {
  const s = await session();
  if (!s || typeof s.regime !== 'number') return null;
  return {
    regime: s.regime,
    regimeName: s.regimeName,
    secondsToNextBell: s.secondsToNextBell,
    at: s.at,
  };
}

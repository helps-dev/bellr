/* ==========================================================================
   BELLR — calendar source
   Reads the session calendar from the on-chain oracle when one is deployed,
   and falls back to the local computation otherwise. The rest of the app never
   needs to know which it got — only `source` differs, and the UI says so.
   ========================================================================== */

import { CONTRACTS, TARGET } from './config.js';
import { encodeCall, encodeUint, encodeAddress, decodeUint, decodeBool } from './abi.js';
import { resolveSession } from './session.js';

/** Contract enum order — must match SessionCalendar.Regime exactly. */
const CHAIN_REGIME = ['closed', 'pre', 'regular', 'post', 'holiday', 'weekend'];

export const state = { source: 'local', lastError: null };

function provider() {
  return window.ethereum ?? null;
}

async function ethCall(data) {
  const p = provider();
  if (!p || !CONTRACTS.calendar) throw new Error('no oracle');
  return p.request({
    method: 'eth_call',
    params: [{ to: CONTRACTS.calendar, data }, 'latest'],
  });
}

/** Regime straight from the oracle. Throws if there is no oracle to ask. */
export async function chainRegimeAt(timestampSeconds) {
  const hex = await ethCall(encodeCall('regimeAt(uint256)', [encodeUint(timestampSeconds)]));
  return CHAIN_REGIME[Number(decodeUint(hex))] ?? 'closed';
}

export async function chainSecondsToNextBell(timestampSeconds) {
  const hex = await ethCall(encodeCall('secondsToNextBell(uint256)', [encodeUint(timestampSeconds)]));
  return Number(decodeUint(hex));
}

export async function chainHalted(token) {
  const hex = await ethCall(encodeCall('halted(address)', [encodeAddress(token)]));
  return decodeBool(hex);
}

/**
 * The single entry point the UI uses. Always resolves — an oracle failure is
 * downgraded to the local calendar rather than left to break the page, because
 * a clock that stops is worse than a clock computed client-side.
 */
export async function getSession(date = new Date()) {
  const local = resolveSession(date);

  if (!CONTRACTS.calendar || !provider()) {
    state.source = 'local';
    return local;
  }

  try {
    const ts = Math.floor(date.getTime() / 1000);
    const [regime, toBell] = await Promise.all([
      chainRegimeAt(ts),
      chainSecondsToNextBell(ts).catch(() => null),
    ]);
    state.source = 'chain';
    state.lastError = null;
    return {
      ...local,
      state: regime,
      secondsToBell: toBell ?? local.secondsToBell,
    };
  } catch (err) {
    state.source = 'local';
    state.lastError = err?.message ?? String(err);
    return local;
  }
}

export const sourceLabel = () =>
  state.source === 'chain' ? `oracle · ${TARGET.chainName}` : 'computed locally';

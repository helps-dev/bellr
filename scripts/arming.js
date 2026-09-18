/* ==========================================================================
   BELLR — turning the arming form into two transactions.

   A pool is primed first and initialised second, because Uniswap v4 gives
   `beforeInitialize` no hookData: the policy cannot ride along with the
   initialize call, so it has to already be on record. The hook refuses to let
   an unprimed pool exist at all, which is the point — the curfew is committed
   before there is anything to trade in.

   Everything here is static ABI types, so the encoding is flat words. The
   output is checked byte-for-byte against `cast calldata`.
   ========================================================================== */

import { keccak256, toHex, selector } from './keccak.js';

const WORD = 64;
const pad = v => BigInt(v).toString(16).padStart(WORD, '0');
const padAddr = a => a.toLowerCase().replace(/^0x/, '').padStart(WORD, '0');

/** Uniswap's marker for a pool whose fee a hook sets per swap. */
export const DYNAMIC_FEE_FLAG = 0x800000;

/** Signatures taken from the compiled artifacts, not written from memory. */
export const SIGNATURES = {
  prime:
    'prime((address,address,uint24,int24,address),' +
    '(((uint24,uint16,uint16),(uint24,uint16,uint16),(uint24,uint16,uint16),(uint24,uint16,uint16)),' +
    'address,address,uint8,uint32,uint32,uint16))',
  initialize: 'initialize((address,address,uint24,int24,address),uint160)',
  rearmSetup:
    'rearmSetup(bytes32,(((uint24,uint16,uint16),(uint24,uint16,uint16),(uint24,uint16,uint16),' +
    '(uint24,uint16,uint16)),address,address,uint8,uint32,uint32,uint16))',
};

/* ---- the pool key -------------------------------------------------------- */

/**
 * Currencies must be sorted, and the sort is on the raw address. Getting this
 * backwards produces a different pool id, so it is done once here rather than
 * anywhere a caller might forget.
 */
export function poolKey({ tokenA, tokenB, hook, tickSpacing = 60 }) {
  const [currency0, currency1] =
    tokenA.toLowerCase() < tokenB.toLowerCase() ? [tokenA, tokenB] : [tokenB, tokenA];
  return { currency0, currency1, fee: DYNAMIC_FEE_FLAG, tickSpacing, hooks: hook };
}

/** int24 is signed; tickSpacing is always positive here but encode it properly. */
const encodeInt = v => {
  const n = BigInt(v);
  return pad(n < 0n ? (1n << 256n) + n : n);
};

export function encodePoolKey(key) {
  return (
    padAddr(key.currency0) +
    padAddr(key.currency1) +
    pad(key.fee) +
    encodeInt(key.tickSpacing) +
    padAddr(key.hooks)
  );
}

/** `PoolIdLibrary.toId` is keccak over the key's five words, nothing more. */
export function poolId(key) {
  const words = encodePoolKey(key);
  const bytes = new Uint8Array(words.match(/.{2}/g).map(b => parseInt(b, 16)));
  return toHex(keccak256(bytes));
}

/* ---- the policy ---------------------------------------------------------- */

/** Percent as a person types it, to the units the contract stores. */
export const pctToPips = pct => Math.round(pct * 10_000);   // 0.30% -> 3000
export const pctToBps = pct => Math.round(pct * 100);       // 0.25% -> 25

const encodeRegime = r => pad(r.feePips) + pad(r.maxSizeBps) + pad(r.bandBps);

export function regimeFrom({ fee, cap, band }) {
  return { feePips: pctToPips(fee), maxSizeBps: pctToBps(cap), bandBps: pctToBps(band) };
}

export function encodePolicy(policy) {
  return (
    encodeRegime(policy.regular) +
    encodeRegime(policy.extended) +
    encodeRegime(policy.closed) +
    encodeRegime(policy.weekend)
  );
}

export function encodeSetup(setup) {
  return (
    encodePolicy(setup.rules) +
    padAddr(setup.underlying) +
    padAddr(setup.capToken) +
    pad(setup.modules) +
    pad(setup.rampSeconds) +
    pad(setup.staleAfter) +
    pad(setup.carryBps)
  );
}

/* ---- the two calls ------------------------------------------------------- */

export function primeCalldata(key, setup) {
  return selector(SIGNATURES.prime) + encodePoolKey(key) + encodeSetup(setup);
}

export function initializeCalldata(key, sqrtPriceX96) {
  return selector(SIGNATURES.initialize) + encodePoolKey(key) + pad(sqrtPriceX96);
}

export function rearmCalldata(id, setup) {
  return selector(SIGNATURES.rearmSetup) + id.replace(/^0x/, '') + encodeSetup(setup);
}

/* ---- the opening price --------------------------------------------------- */

/** Integer square root by Newton's method — floats lose the low bits of a Q96. */
function isqrt(n) {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/**
 * The opening price as Uniswap wants it: sqrt(currency1 per currency0) in Q64.96.
 * A price of 1 gives exactly 2^96, which is the number every v4 example uses.
 */
export function sqrtPriceX96From(price) {
  const priceX18 = BigInt(Math.round(price * 1e18));
  const ratioX192 = (priceX18 << 192n) / 10n ** 18n;
  return isqrt(ratioX192);
}

export const SQRT_PRICE_1_1 = sqrtPriceX96From(1);

/**
 * The opening price, in the direction Uniswap actually wants it.
 *
 * A person thinks "one of my token is worth N of the pair asset". Uniswap wants
 * sqrt(currency1 per currency0), and which side is currency0 is decided by
 * comparing the two raw addresses — so half the time the person's number is
 * upside down. Initialising a real pool at an inverted price is arbitraged
 * away in one block, so the flip happens here rather than in anyone's head.
 *
 * @param key           the sorted pool key
 * @param token         the token being launched (either side of the pair)
 * @param pricePerToken how much of the OTHER asset one `token` is worth
 */
export function openingSqrtPrice(key, token, pricePerToken) {
  const tokenIsCurrency0 = key.currency0.toLowerCase() === token.toLowerCase();
  // currency1-per-currency0 is the person's number when their token sorts first,
  // and its reciprocal when it does not.
  const ratio = tokenIsCurrency0 ? pricePerToken : 1 / pricePerToken;
  return sqrtPriceX96From(ratio);
}

/** Which way round the pool reads, for labelling the form honestly. */
export function priceDirection(key, token, tokenSymbol, otherSymbol) {
  const tokenIsCurrency0 = key.currency0.toLowerCase() === token.toLowerCase();
  return {
    tokenIsCurrency0,
    // What the person is being asked for, always "other per token".
    asks: `${otherSymbol} per ${tokenSymbol}`,
    // What the pool will store, which may be the other way up.
    stores: tokenIsCurrency0
      ? `${otherSymbol} per ${tokenSymbol}`
      : `${tokenSymbol} per ${otherSymbol}`,
    inverted: !tokenIsCurrency0,
  };
}

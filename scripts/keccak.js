/* ==========================================================================
   Minimal Keccak-256 (the pre-NIST padding Ethereum uses, not SHA3-256).
   Only needed to derive 4-byte function selectors, so clarity beats speed and
   the state is held as BigInt lanes.
   ========================================================================== */

const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const ROT = [
   0n,  1n, 62n, 28n, 27n,
  36n, 44n,  6n, 55n, 20n,
   3n, 10n, 43n, 25n, 39n,
  41n, 45n, 15n, 21n,  8n,
  18n,  2n, 61n, 56n, 14n,
];
const M = (1n << 64n) - 1n;
const rotl = (x, n) => n === 0n ? x : ((x << n) | (x >> (64n - n))) & M;

function keccakF(A) {
  for (let round = 0; round < 24; round++) {
    const C = new Array(5);
    for (let x = 0; x < 5; x++) C[x] = A[x] ^ A[x + 5] ^ A[x + 10] ^ A[x + 15] ^ A[x + 20];
    for (let x = 0; x < 5; x++) {
      const D = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1n);
      for (let y = 0; y < 25; y += 5) A[x + y] ^= D;
    }
    const B = new Array(25);
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(A[x + 5 * y], ROT[x + 5 * y]);
      }
    }
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 25; y += 5) {
        A[x + y] = B[x + y] ^ ((~B[(x + 1) % 5 + y] & M) & B[(x + 2) % 5 + y]);
      }
    }
    A[0] ^= RC[round];
  }
  return A;
}

/** @param {Uint8Array} input @returns {Uint8Array} 32 bytes */
export function keccak256(input) {
  const RATE = 136;                       // 1088 bits for Keccak-256
  const padded = new Uint8Array(Math.ceil((input.length + 1) / RATE) * RATE);
  padded.set(input);
  padded[input.length] ^= 0x01;           // Keccak domain separator
  padded[padded.length - 1] ^= 0x80;

  let A = new Array(25).fill(0n);
  for (let off = 0; off < padded.length; off += RATE) {
    for (let i = 0; i < RATE / 8; i++) {
      let lane = 0n;
      for (let b = 7; b >= 0; b--) lane = (lane << 8n) | BigInt(padded[off + i * 8 + b]);
      A[i] ^= lane;
    }
    A = keccakF(A);
  }

  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) {
    let lane = A[i];
    for (let b = 0; b < 8; b++) { out[i * 8 + b] = Number(lane & 0xffn); lane >>= 8n; }
  }
  return out;
}

export const toHex = bytes => '0x' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

/** 4-byte selector for a canonical signature, e.g. "regimeAt(uint256)". */
export function selector(signature) {
  return toHex(keccak256(new TextEncoder().encode(signature)).slice(0, 4));
}

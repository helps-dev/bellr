/* Just enough ABI coding for the handful of calls this interface makes. */

import { selector } from './keccak.js';

const pad = hex => hex.replace(/^0x/, '').padStart(64, '0');

export const encodeUint = v => pad(BigInt(v).toString(16));
export const encodeAddress = a => pad(a.toLowerCase().replace(/^0x/, ''));

export function encodeCall(signature, args = []) {
  return selector(signature) + args.join('');
}

export function decodeUint(hex) {
  const clean = (hex ?? '0x').replace(/^0x/, '');
  return clean ? BigInt('0x' + clean.slice(0, 64)) : 0n;
}

export const decodeBool = hex => decodeUint(hex) === 1n;

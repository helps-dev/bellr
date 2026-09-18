/* ==========================================================================
   BELLR — wallet connection (EIP-1193)
   Real provider talk: connect, read the chain, switch or add Robinhood Chain,
   and sign a policy payload. No library, no bundler.
   ========================================================================== */

import { TARGET } from './config.js';

const listeners = new Set();
export const wallet = { provider: null, account: null, chainId: null, connecting: false };

function emit() { listeners.forEach(fn => fn({ ...wallet })); }
export function onWalletChange(fn) { listeners.add(fn); fn({ ...wallet }); return () => listeners.delete(fn); }

/** EIP-6963 announces providers; fall back to the injected singleton. */
function detect() {
  if (wallet.provider) return wallet.provider;
  const eth = window.ethereum;
  if (!eth) return null;
  // With several wallets installed, prefer the one the user set as default.
  const picked = eth.providers?.find(p => p.isMetaMask) ?? eth.providers?.[0] ?? eth;
  wallet.provider = picked;
  bind(picked);
  return picked;
}

let bound = false;
function bind(p) {
  if (bound || !p?.on) return;
  bound = true;
  p.on('accountsChanged', accounts => { wallet.account = accounts?.[0] ?? null; emit(); });
  p.on('chainChanged', id => { wallet.chainId = id; emit(); });
}

export function hasWallet() { return Boolean(window.ethereum); }
export function isRightChain() { return wallet.chainId?.toLowerCase() === TARGET.chainId.toLowerCase(); }

export async function connect() {
  const p = detect();
  if (!p) throw new Error('No EVM wallet found. Install one, then reload.');
  if (wallet.connecting) return wallet;
  wallet.connecting = true; emit();
  try {
    const accounts = await p.request({ method: 'eth_requestAccounts' });
    wallet.account = accounts?.[0] ?? null;
    wallet.chainId = await p.request({ method: 'eth_chainId' });
    return { ...wallet };
  } finally {
    wallet.connecting = false; emit();
  }
}

/** Reconnect silently if the site is already authorised — no popup. */
export async function restore() {
  const p = detect();
  if (!p) return;
  try {
    const accounts = await p.request({ method: 'eth_accounts' });
    if (accounts?.length) {
      wallet.account = accounts[0];
      wallet.chainId = await p.request({ method: 'eth_chainId' });
      emit();
    }
  } catch { /* wallet locked or refused — stay disconnected */ }
}

export function disconnect() {
  // EIP-1193 has no revoke; forget the session locally and let the wallet keep its grant.
  wallet.account = null;
  emit();
}

export async function switchToTarget() {
  const p = detect();
  if (!p) throw new Error('No EVM wallet found.');
  try {
    await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: TARGET.chainId }] });
  } catch (err) {
    // 4902 = chain unknown to the wallet, so add it and let the wallet switch.
    if (err?.code === 4902 || err?.data?.originalError?.code === 4902) {
      await p.request({ method: 'wallet_addEthereumChain', params: [TARGET] });
    } else {
      throw err;
    }
  }
  wallet.chainId = await p.request({ method: 'eth_chainId' });
  emit();
}

/** personal_sign over the policy — proves the flow end to end with no contract. */
export async function signPolicy(text) {
  const p = detect();
  if (!p || !wallet.account) throw new Error('Connect a wallet first.');
  const hex = '0x' + Array.from(new TextEncoder().encode(text))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  return p.request({ method: 'personal_sign', params: [hex, wallet.account] });
}

/**
 * Send one transaction and hand back its hash.
 *
 * No gas estimate is attached: wallets estimate better than this interface can,
 * and a hardcoded limit that is one fork too low fails in front of the user for
 * no reason.
 */
export async function sendTx({ to, data }) {
  const p = detect();
  if (!p || !wallet.account) throw new Error('Connect a wallet first.');
  if (!isRightChain()) throw new Error(`Switch to ${TARGET.chainName} first.`);
  return p.request({
    method: 'eth_sendTransaction',
    params: [{ from: wallet.account, to, data }],
  });
}

/** Poll for a receipt. Orbit blocks are sub-second, so this is quick. */
export async function waitForReceipt(hash, { timeoutMs = 60_000 } = {}) {
  const p = detect();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await p.request({ method: 'eth_getTransactionReceipt', params: [hash] });
    if (r) {
      if (BigInt(r.status ?? '0x0') === 0n) throw new Error(`Transaction ${hash} reverted`);
      return r;
    }
    await new Promise(res => setTimeout(res, 800));
  }
  throw new Error(`No receipt for ${hash} after ${timeoutMs / 1000}s`);
}

export const short = a => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');

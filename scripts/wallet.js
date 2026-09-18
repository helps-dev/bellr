/* ==========================================================================
   BELLR — wallet connection (EIP-1193)

   Two ways in, one interface. An injected extension is the fast path and needs
   nothing. WalletConnect covers everyone on a phone, which is most people, and
   it is the reason this file now knows the difference between "the provider"
   and "window.ethereum".

   The WalletConnect library is about 1.4 MB — six times this whole site — so
   it is imported only when someone chooses it. Everything else still runs with
   no library and no bundler.
   ========================================================================== */

import { TARGET, WALLETCONNECT } from './config.js';

const listeners = new Set();
export const wallet = { provider: null, account: null, chainId: null, connecting: false };

function emit() { listeners.forEach(fn => fn({ ...wallet })); }
export function onWalletChange(fn) { listeners.add(fn); fn({ ...wallet }); return () => listeners.delete(fn); }

/** EIP-6963 announces providers; fall back to the injected singleton. */
function detect() {
  // Once a provider is chosen — injected or WalletConnect — every later call
  // has to keep using it. Falling back to window.ethereum here would quietly
  // send a WalletConnect user's transaction to a different wallet.
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

/** WalletConnect v2 will not start without a project id. */
export function hasWalletConnect() { return Boolean(WALLETCONNECT.projectId); }

/** Which connector the current session came from, for disconnecting cleanly. */
let kind = null;
export function connectorKind() { return kind; }

/**
 * Connect over WalletConnect. The import is deliberately inside the function:
 * a visitor who never presses the button never downloads the library.
 */
export async function connectWalletConnect() {
  if (!WALLETCONNECT.projectId) {
    throw new Error('WalletConnect is not configured for this site yet.');
  }
  if (wallet.connecting) return wallet;
  wallet.connecting = true; emit();

  try {
    const { EthereumProvider } = await import(
      'https://cdn.jsdelivr.net/npm/@walletconnect/ethereum-provider@2/+esm'
    );

    const chainId = parseInt(TARGET.chainId, 16);
    const provider = await EthereumProvider.init({
      projectId: WALLETCONNECT.projectId,
      metadata: WALLETCONNECT.metadata,
      showQrModal: true,
      // Robinhood Chain is not a chain most wallets know, so it goes in
      // optionalChains: a wallet that cannot promise it up front can still
      // connect and be asked to add it afterwards.
      chains: [],
      optionalChains: [chainId],
      rpcMap: { [chainId]: WALLETCONNECT.rpc },
    });

    await provider.connect();

    wallet.provider = provider;
    kind = 'walletconnect';
    bound = false;
    bind(provider);

    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    wallet.account = accounts?.[0] ?? null;
    wallet.chainId = await provider.request({ method: 'eth_chainId' });

    provider.on('disconnect', () => { disconnect(); });

    return wallet;
  } finally {
    wallet.connecting = false; emit();
  }
}
export function isRightChain() { return wallet.chainId?.toLowerCase() === TARGET.chainId.toLowerCase(); }

export async function connect() {
  const p = detect();
  if (!p) throw new Error('No EVM wallet found. Install one, then reload.');
  if (wallet.connecting) return wallet;
  wallet.connecting = true; emit();
  try {
    const accounts = await p.request({ method: 'eth_requestAccounts' });
    kind = 'injected';
    wallet.account = accounts?.[0] ?? null;
    wallet.chainId = await p.request({ method: 'eth_chainId' });
    return { ...wallet };
  } finally {
    wallet.connecting = false; emit();
  }
}

/** Reconnect silently if the site is already authorised — no popup. */
/**
 * Bring back an injected session on reload. WalletConnect is deliberately not
 * restored: re-opening a pairing without being asked is surprising, and the
 * library would have to be downloaded on every page load to do it.
 */
export async function restore() {
  if (!window.ethereum) return;
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
  // An injected wallet has no revoke — forget the session locally and let the
  // wallet keep its grant. A WalletConnect session is a real pairing on the
  // other device, though: dropping it here without closing it leaves the user
  // with a connection their phone still thinks is live.
  if (kind === 'walletconnect' && wallet.provider?.disconnect) {
    Promise.resolve(wallet.provider.disconnect()).catch(() => { /* already gone */ });
  }
  if (kind === 'walletconnect') {
    wallet.provider = null;
    bound = false;
  }
  kind = null;
  wallet.account = null;
  wallet.chainId = null;
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

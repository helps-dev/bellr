/* Header wallet button: connect, show the account, flag the wrong network.
   Two ways in — an injected extension, or WalletConnect for a phone — so the
   button asks which when both are possible, and skips the question when only
   one is. */

import { $, toast } from './utils.js';
import {
  onWalletChange, connect, connectWalletConnect, restore, disconnect,
  isRightChain, switchToTarget, hasWallet, hasWalletConnect, short,
} from './wallet.js';
import { TARGET } from './config.js';

/* ---- the chooser --------------------------------------------------------- */

const OPTIONS = [
  {
    id: 'injected',
    name: 'Browser wallet',
    hint: 'MetaMask, Rabby, Brave — already in this browser',
    available: hasWallet,
    run: connect,
  },
  {
    id: 'walletconnect',
    name: 'WalletConnect',
    hint: 'Scan a code with a wallet on your phone',
    available: hasWalletConnect,
    run: connectWalletConnect,
  },
];

let open = null;

function closeChooser() {
  open?.remove();
  open = null;
  document.removeEventListener('keydown', onKey);
}

function onKey(e) { if (e.key === 'Escape') closeChooser(); }

/** Resolves to the chosen option's `run`, or null if the user backed out. */
function askWhich(choices) {
  return new Promise(resolve => {
    closeChooser();

    const wrap = document.createElement('div');
    wrap.className = 'connect';
    wrap.innerHTML = `
      <div class="connect__box" role="dialog" aria-modal="true" aria-label="Connect a wallet">
        <p class="kicker">Connect</p>
        <div class="connect__list">
          ${choices.map(c => `
            <button type="button" class="connect__opt" data-id="${c.id}">
              <b>${c.name}</b><span>${c.hint}</span>
            </button>`).join('')}
        </div>
        <button type="button" class="btn connect__cancel">Cancel</button>
      </div>`;

    wrap.addEventListener('click', e => {
      if (e.target === wrap || e.target.closest('.connect__cancel')) {
        closeChooser(); resolve(null); return;
      }
      const opt = e.target.closest('.connect__opt');
      if (!opt) return;
      const picked = choices.find(c => c.id === opt.dataset.id);
      closeChooser();
      resolve(picked ?? null);
    });

    document.body.appendChild(wrap);
    open = wrap;
    document.addEventListener('keydown', onKey);
    wrap.querySelector('.connect__opt')?.focus();
  });
}

/* ---- the button ---------------------------------------------------------- */

export function initWalletUI() {
  const btn = $('#walletBtn');
  if (!btn) return;

  onWalletChange(w => {
    if (w.connecting) { btn.textContent = 'Connecting…'; btn.dataset.state = ''; return; }
    if (!w.account) {
      const any = OPTIONS.some(o => o.available());
      btn.textContent = any ? 'Connect' : 'No wallet';
      btn.dataset.state = '';
      return;
    }
    if (!isRightChain()) {
      btn.innerHTML = '<i class="led led--closed"></i>Wrong network';
      btn.dataset.state = 'wrong';
      return;
    }
    btn.innerHTML = `<i class="led led--open"></i>${short(w.account)}`;
    btn.dataset.state = 'ok';
  });

  btn.addEventListener('click', async () => {
    try {
      if (btn.dataset.state === 'wrong') { await switchToTarget(); return; }
      if (btn.dataset.state === 'ok') { disconnect(); toast('Disconnected from this site'); return; }

      const choices = OPTIONS.filter(o => o.available());
      if (!choices.length) {
        toast('No wallet in this browser, and WalletConnect is not set up yet');
        return;
      }

      // One way in is not a choice worth making someone click through.
      const picked = choices.length === 1 ? choices[0] : await askWhich(choices);
      if (!picked) return;

      if (picked.id === 'walletconnect') toast('Opening WalletConnect…');
      await picked.run();

      if (!isRightChain()) toast(`Switch to ${TARGET.chainName} to arm a pool`);
    } catch (err) {
      const code = err?.code;
      toast(
        code === 4001 ? 'Request rejected in the wallet'
        : /user rejected|closed modal/i.test(err?.message ?? '') ? 'Connection cancelled'
        : (err?.message ?? 'Wallet error')
      );
    }
  });

  restore();
}

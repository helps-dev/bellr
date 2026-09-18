/* Header wallet button: connect, show the account, flag the wrong network.
   The chooser lists the wallets this browser actually has — announced over
   EIP-6963, icons and all — plus WalletConnect for a phone. The layout follows
   the pattern people already know from other apps: a dark centred card, a
   search field, and one row per wallet with its badge. */

import { $, toast } from './utils.js';
import {
  onWalletChange, connect, connectWalletConnect, restore, disconnect,
  isRightChain, switchToTarget, detectedWallets, hasWalletConnect, short,
} from './wallet.js';
import { TARGET } from './config.js';

/* ---- the chooser --------------------------------------------------------- */

const LAST_KEY = 'bellr.lastWallet';
const lastUsed = () => { try { return localStorage.getItem(LAST_KEY); } catch { return null; } };
const remember = id => { try { localStorage.setItem(LAST_KEY, id); } catch { /* private mode */ } };

const ICONS = {
  search: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/><path d="m20 20-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m9 5 7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  walletconnect: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 9.5C7.8 5.8 12.2 5.8 16 9.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M6.5 13c2.4-2.4 5.6-2.4 8 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="11.2" cy="16.8" r="1.6" fill="currentColor"/></svg>',
};

/** One row: icon, name, and on the right a badge or a chevron. */
function row({ id, name, icon, svgIcon, badge, chevron }) {
  const iconHtml = svgIcon
    ? `<span class="connect__icon connect__icon--svg" aria-hidden="true">${svgIcon}</span>`
    : icon
      ? `<img class="connect__icon" src="${icon}" alt="" width="28" height="28">`
      : `<span class="connect__icon connect__icon--letter" aria-hidden="true">${name[0]}</span>`;
  const right = badge
    ? `<span class="connect__badge${badge === 'Last used' ? ' connect__badge--last' : ''}"><i></i>${badge}</span>`
    : (chevron ? `<span class="connect__chevron">${ICONS.chevron}</span>` : '');
  return `
    <button type="button" class="connect__opt" data-id="${id}" data-name="${name.toLowerCase()}">
      ${iconHtml}
      <span class="connect__name">${name}</span>
      ${right}
    </button>`;
}

function options() {
  const last = lastUsed();
  const injected = detectedWallets().map(w => ({
    id: w.info.uuid,
    name: w.info.name,
    icon: w.info.icon,
    badge: last === w.info.uuid ? 'Last used' : 'Installed',
    run: () => connect(w.provider),
  }));
  // The one used last goes first; the rest stay in announcement order.
  injected.sort((a, b) => (b.badge === 'Last used') - (a.badge === 'Last used'));

  if (hasWalletConnect()) {
    injected.push({
      id: 'walletconnect',
      name: 'WalletConnect',
      icon: null,
      svgIcon: ICONS.walletconnect,
      chevron: true,
      badge: last === 'walletconnect' ? 'Last used' : null,
      run: connectWalletConnect,
    });
  }
  return injected;
}

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
        <div class="connect__head">
          <span class="connect__title">Connect a wallet</span>
          <button type="button" class="connect__close" aria-label="Close">${ICONS.close}</button>
        </div>
        <label class="connect__search">
          ${ICONS.search}
          <input type="text" placeholder="Search wallets…" aria-label="Search wallets">
        </label>
        <div class="connect__list">
          ${choices.map(c => row(c)).join('')}
        </div>
        <p class="connect__empty" hidden>No wallet matches that search.</p>
        <p class="connect__foot">${TARGET.chainName} · chain ${parseInt(TARGET.chainId, 16)}</p>
      </div>`;

    const list = wrap.querySelector('.connect__list');
    const empty = wrap.querySelector('.connect__empty');

    wrap.querySelector('.connect__search input').addEventListener('input', e => {
      const q = e.target.value.trim().toLowerCase();
      let visible = 0;
      list.querySelectorAll('.connect__opt').forEach(opt => {
        const show = !q || opt.dataset.name.includes(q);
        opt.hidden = !show;
        if (show) visible++;
      });
      empty.hidden = visible > 0;
    });

    wrap.addEventListener('click', e => {
      if (e.target === wrap || e.target.closest('.connect__close')) {
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
    wrap.querySelector('.connect__search input').focus();
  });
}

/* ---- the button ---------------------------------------------------------- */

export function initWalletUI() {
  const btn = $('#walletBtn');
  if (!btn) return;

  onWalletChange(w => {
    if (w.connecting) { btn.textContent = 'Connecting…'; btn.dataset.state = ''; return; }
    if (!w.account) {
      const any = detectedWallets().length > 0 || hasWalletConnect();
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

      const choices = options();
      if (!choices.length) {
        toast('No wallet in this browser, and WalletConnect is not set up yet');
        return;
      }

      // One way in is not a choice worth making someone click through.
      const picked = choices.length === 1 ? choices[0] : await askWhich(choices);
      if (!picked) return;

      remember(picked.id);
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

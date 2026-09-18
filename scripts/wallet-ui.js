/* Header wallet button: connect, show the account, flag the wrong network. */

import { $ } from './utils.js';
import { onWalletChange, connect, restore, disconnect, isRightChain, switchToTarget, hasWallet, short } from './wallet.js';
import { TARGET } from './config.js';
import { toast } from './utils.js';

export function initWalletUI() {
  const btn = $('#walletBtn');
  if (!btn) return;

  onWalletChange(w => {
    if (w.connecting) { btn.textContent = 'Connecting…'; btn.dataset.state = ''; return; }
    if (!w.account) {
      btn.textContent = hasWallet() ? 'Connect' : 'No wallet';
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
      if (!hasWallet()) { toast('No EVM wallet found in this browser'); return; }
      if (btn.dataset.state === 'wrong') { await switchToTarget(); return; }
      if (btn.dataset.state === 'ok') { disconnect(); toast('Disconnected from this site'); return; }
      await connect();
      if (!isRightChain()) {
        toast(`Switch to ${TARGET.chainName} to arm a pool`);
      }
    } catch (err) {
      toast(err?.code === 4001 ? 'Request rejected in the wallet' : (err?.message ?? 'Wallet error'));
    }
  });

  restore();
}

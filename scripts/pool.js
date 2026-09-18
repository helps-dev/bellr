/* ==========================================================================
   BELLR — "Open a pool" arming flow
   Four steps: pick the pair, set the policy, choose hooks, review and sign.
   Everything up to the transaction is real; the transaction itself waits for
   contracts, so the final step produces a wallet-signed policy instead.
   ========================================================================== */

import { $, $$, copy, toast } from './utils.js';
import {
  EQUITIES, HOOKS, LIMITS, TUNING, DEFAULT_POLICY, DEFAULT_TUNING,
  REGIME_LABELS, HOOK_ADDRESS_MASK, TARGET, CONTRACTS,
} from './config.js';
import {
  wallet, connect, isRightChain, switchToTarget, signPolicy, sendTx, waitForReceipt, short,
} from './wallet.js';
import {
  poolKey, poolId, primeCalldata, initializeCalldata, regimeFrom,
  openingSqrtPrice, priceDirection,
} from './arming.js';

const DRAFT = 'bellr.draft';
const STEPS = ['Pair', 'Policy', 'Hooks', 'Review'];

const state = {
  step: 0,
  token: '',
  pair: EQUITIES[0].sym,
  policy: structuredClone(DEFAULT_POLICY),
  hooks: ['TOLL', 'WIDEN', 'CURFEW'],
  tuning: { ...DEFAULT_TUNING },
  openingPrice: 1,
  signature: null,
  txs: [],
};

/* ---- persistence --------------------------------------------------------- */
function save() {
  try {
    localStorage.setItem(DRAFT, JSON.stringify({
      token: state.token, pair: state.pair, policy: state.policy,
      hooks: state.hooks, tuning: state.tuning, openingPrice: state.openingPrice,
    }));
  } catch { /* private mode — the draft just will not survive a reload */ }
}
function load() {
  try {
    const raw = localStorage.getItem(DRAFT);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (d.token) state.token = d.token;
    // A saved draft can name a pair that has since been renamed or dropped, and
    // a pair that is not in the list fails validation with no way to see why.
    if (d.pair && EQUITIES.some(e => e.sym === d.pair)) state.pair = d.pair;
    if (d.policy) state.policy = { ...structuredClone(DEFAULT_POLICY), ...d.policy };
    if (Array.isArray(d.hooks) && d.hooks.length) state.hooks = d.hooks;
    if (d.tuning) state.tuning = { ...DEFAULT_TUNING, ...d.tuning };
    if (Number.isFinite(d.openingPrice) && d.openingPrice > 0) state.openingPrice = d.openingPrice;
  } catch { /* corrupt draft — fall back to defaults */ }
}

/* ---- validation ---------------------------------------------------------- */
const isAddress = v => /^0x[0-9a-fA-F]{40}$/.test(v.trim());
const clampMsg = (label, v, lim, unit = '%') =>
  (v < lim.min || v > lim.max) ? `${label} must be between ${lim.min}${unit} and ${lim.max}${unit}` : null;

function policyErrors() {
  const errs = [];
  for (const [k, label] of Object.entries(REGIME_LABELS)) {
    const p = state.policy[k];
    const f = clampMsg(`${label} fee`, p.fee, LIMITS.fee);
    const c = clampMsg(`${label} cap`, p.cap, LIMITS.cap);
    const b = clampMsg(`${label} band`, p.band, LIMITS.band);
    [f, c, b].forEach(e => e && errs.push(e));
  }
  // A closed market should never be cheaper to trade than an open one.
  if (state.policy.closed.fee < state.policy.regular.fee) {
    errs.push('Closed fee must be at least the regular-hours fee, or the pool pays for the gap');
  }
  if (state.policy.weekend.fee < state.policy.closed.fee) {
    errs.push('Weekend fee must be at least the closed fee');
  }
  return errs;
}

function stepErrors(step = state.step) {
  if (step === 0) {
    const e = [];
    if (!isAddress(state.token)) e.push('Enter a valid 0x token address (40 hex characters)');
    if (!EQUITIES.some(x => x.sym === state.pair)) e.push('Pick a pair asset');
    return e;
  }
  if (step === 1) return policyErrors();
  if (step === 2) {
    const e = [];
    if (!state.hooks.includes('TOLL')) e.push('TOLL is required — every other module reads its verdict');
    for (const h of HOOKS) {
      if (!h.tune || !state.hooks.includes(h.id)) continue;
      const lim = TUNING[h.tune];
      const v = state.tuning[h.tune];
      if (!Number.isFinite(v) || v < lim.min || v > lim.max) {
        e.push(`${h.id}: ${lim.label.toLowerCase()} must be between ${lim.min} and ${lim.max} ${lim.unit}`);
      }
    }
    return e;
  }
  return [];
}

/* ---- derived ------------------------------------------------------------- */
/** BELLR's own per-pool module bits — see SessionModules.sol. */
function moduleMask() {
  return HOOKS.filter(h => state.hooks.includes(h.id)).reduce((m, h) => m | h.bit, 0);
}
function moduleHex() { return `0x${moduleMask().toString(16).toUpperCase().padStart(2, '0')}`; }

/**
 * Whether this can be broadcast rather than signed, and if not, what is missing.
 *
 * The interface does not guess at an address it has not been given. Every gap
 * below is a thing that has to exist on chain first, and saying which one is
 * missing is more useful than a disabled button.
 */
export function readiness() {
  const missing = [];
  if (!CONTRACTS.bellrPool) missing.push('the BELLR hook is not deployed yet');
  if (!CONTRACTS.poolManager) missing.push('no PoolManager address');
  const eq = EQUITIES.find(e => e.sym === state.pair);
  if (!eq?.address) missing.push(`${state.pair} has no token address on this chain yet`);
  return { canBroadcast: missing.length === 0, missing, equity: eq };
}

/** The pool key and setup exactly as the contracts will see them. */
export function armingArgs() {
  const { equity } = readiness();
  const key = poolKey({
    tokenA: state.token.trim(),
    tokenB: equity?.address ?? '0x' + '0'.repeat(40),
    hook: CONTRACTS.bellrPool ?? '0x' + '0'.repeat(40),
  });
  const setup = {
    rules: {
      regular: regimeFrom(state.policy.regular),
      extended: regimeFrom(state.policy.extended),
      closed: regimeFrom(state.policy.closed),
      weekend: regimeFrom(state.policy.weekend),
    },
    underlying: equity?.address ?? '0x' + '0'.repeat(40),
    // The cap is measured against the token being launched, not the equity.
    capToken: state.token.trim(),
    modules: moduleMask(),
    rampSeconds: state.hooks.includes('WIDEN') ? Math.round(state.tuning.rampMinutes * 60) : 0,
    staleAfter: state.hooks.includes('DRIFT') ? Math.round(state.tuning.staleMinutes * 60) : 0,
    carryBps: state.hooks.includes('CARRY') ? Math.round(state.tuning.carryPct * 100) : 0,
  };
  return { key, setup, id: poolId(key) };
}

function buildPayload() {
  return {
    protocol: 'bellr/v1',
    chainId: TARGET.chainId,
    chainName: TARGET.chainName,
    token: state.token.trim(),
    pair: state.pair,
    hooks: HOOKS.filter(h => state.hooks.includes(h.id)).map(h => h.id),
    modules: moduleHex(),
    hookAddressMask: HOOK_ADDRESS_MASK,
    policy: Object.fromEntries(Object.entries(state.policy).map(([k, v]) => [k, {
      feePct: v.fee, maxSwapPct: v.cap, oracleBandPct: v.band,
    }])),
    rampSeconds: state.hooks.includes('WIDEN') ? Math.round(state.tuning.rampMinutes * 60) : 0,
    staleAfter: state.hooks.includes('DRIFT') ? Math.round(state.tuning.staleMinutes * 60) : 0,
    carryBps: state.hooks.includes('CARRY') ? Math.round(state.tuning.carryPct * 100) : 0,
    openingPrice: state.openingPrice,
    priceInverted: readiness().canBroadcast
      ? priceDirection(armingArgs().key, state.token.trim(), 'token', state.pair).inverted
      : null,
    poolManager: CONTRACTS.poolManager,
    hook: CONTRACTS.bellrPool,
    armedBy: wallet.account,
    issuedAt: new Date().toISOString(),
  };
}

/* ---- rendering ----------------------------------------------------------- */
function renderStepper() {
  return `<ol class="stepper">${STEPS.map((s, i) => `
    <li class="stepper__item ${i === state.step ? 'is-on' : ''} ${i < state.step ? 'is-done' : ''}">
      <span class="stepper__dot">${i < state.step ? '✓' : i + 1}</span><span>${s}</span>
    </li>`).join('')}</ol>`;
}

function renderPair() {
  return `
    <div class="field">
      <label for="pToken">TOKEN ADDRESS <small>the token you launched on Pons or Pools.trade</small></label>
      <input id="pToken" type="text" spellcheck="false" autocomplete="off"
             placeholder="0x…" value="${state.token}">
    </div>
    <div class="field">
      <label for="pPrice">OPENING PRICE <small>how much ${state.pair} one of your token is worth at launch</small></label>
      <input id="pPrice" type="number" step="0.000001" min="0.000001"
             value="${state.openingPrice}">
    </div>
    <div class="field">
      <span class="field__label">PAIR ASSET <small>this is what gives the pool a calendar</small></span>
      <div class="equity-grid">
        ${EQUITIES.map(e => `
          <button type="button" class="equity ${state.pair === e.sym ? 'is-on' : ''}" data-pair="${e.sym}">
            <b>${e.sym}</b><span>${e.name}</span><i>${e.venue}</i>
          </button>`).join('')}
      </div>
    </div>`;
}

function renderPolicy() {
  return `
    <p class="sheet__hint">Each regime sets its own fee, swap-size cap and reference band.
       The cap bounds a single trade as a share of supply — a hook sees the router,
       never the person behind it, so it caps size rather than pretending to cap
       wallets. 100% means uncapped. The contracts clamp to
       ${LIMITS.fee.min}–${LIMITS.fee.max}% fee and ${LIMITS.band.min}–${LIMITS.band.max}% band.</p>
    <div class="policy">
      <div class="policy__head"><span>Regime</span><span>Fee %</span><span>Swap cap %</span><span>Band %</span></div>
      ${Object.entries(REGIME_LABELS).map(([k, label]) => `
        <div class="policy__row">
          <span class="policy__name">${label}</span>
          <input type="number" step="0.05" min="${LIMITS.fee.min}" max="${LIMITS.fee.max}" value="${state.policy[k].fee}" data-policy="${k}.fee">
          <input type="number" step="0.01" min="${LIMITS.cap.min}" max="${LIMITS.cap.max}" value="${state.policy[k].cap}" data-policy="${k}.cap">
          <input type="number" step="0.05" min="${LIMITS.band.min}" max="${LIMITS.band.max}" value="${state.policy[k].band}" data-policy="${k}.band">
        </div>`).join('')}
    </div>`;
}

function renderTune(h) {
  const lim = TUNING[h.tune];
  return `
    <div class="hook-tune">
      <label for="tune-${h.tune}">${lim.label}</label>
      <input id="tune-${h.tune}" type="number" data-tune="${h.tune}"
             min="${lim.min}" max="${lim.max}" step="${lim.step}" value="${state.tuning[h.tune]}">
      <span class="hook-tune__unit">${lim.unit}</span>
      <small>${lim.hint}</small>
    </div>`;
}

function renderHooks() {
  return `
    <p class="sheet__hint">Every BELLR pool shares one hook contract, because a Uniswap v4
       pool has exactly one hook address. These switches are stored per pool and the
       steward can change them; the address bits below are fixed at deployment and
       are the same for every pool.</p>
    <div class="hook-picker">
      ${HOOKS.map(h => `
        <div class="hook-row">
          <label class="hook-pick ${state.hooks.includes(h.id) ? 'is-on' : ''} ${h.required ? 'is-locked' : ''}">
            <input type="checkbox" data-hook="${h.id}" ${state.hooks.includes(h.id) ? 'checked' : ''} ${h.required ? 'disabled' : ''}>
            <span class="hook-pick__body">
              <b>${h.id}${h.required ? ' <i>required</i>' : ''}</b>
              <span>${h.title} — ${h.blurb}</span>
            </span>
            <code>${h.phase}</code>
          </label>
          ${h.tune && state.hooks.includes(h.id) ? renderTune(h) : ''}
        </div>`).join('')}
    </div>
    <div class="mask">
      <span class="label">Modules</span>
      <code id="maskOut">${moduleHex()}</code>
      <span class="mask__note">stored per pool · hook address carries
        <code>${HOOK_ADDRESS_MASK}</code>, its v4 callback bits</span>
    </div>`;
}

function renderReview() {
  const p = buildPayload();
  const { canBroadcast, missing } = readiness();
  const { id } = canBroadcast ? armingArgs() : { id: null };

  const hint = canBroadcast
    ? `<p class="sheet__hint">This sends <b>two transactions</b>: <code>prime</code> puts the
         policy on record, then <code>initialize</code> creates the pool. That order is not
         optional — the hook refuses to let an unprimed pool exist, so the curfew is committed
         before there is anything to trade in.</p>`
    : `<p class="sheet__hint">This step signs the policy with your wallet instead of
         broadcasting it, because ${missing.join('; and ')}. The signature is proof you
         authored these parameters — nothing is sent anywhere.</p>`;

  return `
    ${hint}
    <dl class="spec review">
      <div><dt>Token</dt><dd class="mono">${short(p.token)}</dd></div>
      <div><dt>Pair</dt><dd>${p.pair}</dd></div>
      <div><dt>Network</dt><dd>${p.chainName}</dd></div>
      <div><dt>Hooks</dt><dd>${p.hooks.join(' · ')}</dd></div>
      <div><dt>Modules</dt><dd class="mono">${p.modules} · address ${p.hookAddressMask}</dd></div>
      <div><dt>Regular hours</dt><dd class="mono">${p.policy.regular.feePct}% · cap ${p.policy.regular.maxSwapPct}%</dd></div>
      <div><dt>Closed</dt><dd class="mono">${p.policy.closed.feePct}% · cap ${p.policy.closed.maxSwapPct}%</dd></div>
      <div><dt>Weekend</dt><dd class="mono">${p.policy.weekend.feePct}% · cap ${p.policy.weekend.maxSwapPct}%</dd></div>
      ${p.rampSeconds ? `<div><dt>Ramp</dt><dd class="mono">${p.rampSeconds / 60} min into the bell</dd></div>` : ''}
      ${p.staleAfter ? `<div><dt>Feed silence</dt><dd class="mono">${p.staleAfter / 60} min before the band halves</dd></div>` : ''}
      ${p.carryBps ? `<div><dt>Carry</dt><dd class="mono">${p.carryBps / 100}% of each out-of-hours swap</dd></div>` : ''}
      <div><dt>Opening price</dt><dd class="mono">${p.openingPrice} ${p.pair} per token${p.priceInverted ? ' · stored inverted' : ''}</dd></div>
      ${id ? `<div><dt>Pool id</dt><dd class="mono">${id.slice(0, 18)}…</dd></div>` : ''}
      <div><dt>Armed by</dt><dd class="mono">${p.armedBy ? short(p.armedBy) : 'wallet not connected'}</dd></div>
    </dl>
    ${state.txs.length ? `
      <dl class="spec review">
        ${state.txs.map(t => `
          <div><dt>${t.label}</dt><dd class="mono">${t.hash.slice(0, 18)}…${t.status ? ` · ${t.status}` : ''}</dd></div>
        `).join('')}
      </dl>` : ''}
    ${state.signature ? `
      <div class="sig">
        <span class="label">Signature</span>
        <code>${state.signature.slice(0, 42)}…${state.signature.slice(-8)}</code>
        <button class="btn btn--line" type="button" id="copySig">Copy signature</button>
      </div>` : ''}
    <details class="raw"><summary>Raw payload</summary><pre class="code">${JSON.stringify(p, null, 2)}</pre></details>`;
}

const BODIES = [renderPair, renderPolicy, renderHooks, renderReview];

function render() {
  const sheet = $('#poolSheet');
  if (!sheet) return;
  $('#sheetSteps').innerHTML = renderStepper();
  $('#sheetBody').innerHTML = BODIES[state.step]();

  const errs = stepErrors();
  const errBox = $('#sheetErrors');
  errBox.innerHTML = errs.length ? `<ul>${errs.map(e => `<li>${e}</li>`).join('')}</ul>` : '';
  errBox.hidden = errs.length === 0;

  $('#sheetBack').disabled = state.step === 0;
  const next = $('#sheetNext');
  const last = state.step === STEPS.length - 1;
  if (last) {
    const { canBroadcast } = readiness();
    const verb = canBroadcast ? 'Arm the pool' : 'Sign policy';
    next.textContent = wallet.account ? verb : `Connect wallet to ${canBroadcast ? 'arm' : 'sign'}`;
  } else {
    next.textContent = 'Continue';
  }
  next.disabled = errs.length > 0;
  bindBody();
}

/* ---- per-step wiring ----------------------------------------------------- */
function bindBody() {
  $('#pToken')?.addEventListener('input', e => {
    state.token = e.target.value; save();
    const errs = stepErrors();
    $('#sheetNext').disabled = errs.length > 0;
    const box = $('#sheetErrors');
    box.innerHTML = errs.length ? `<ul>${errs.map(x => `<li>${x}</li>`).join('')}</ul>` : '';
    box.hidden = errs.length === 0;
  });

  $('#pPrice')?.addEventListener('input', e => {
    const v = Number(e.target.value);
    if (Number.isFinite(v) && v > 0) { state.openingPrice = v; save(); }
  });

  $$('[data-pair]').forEach(b => b.addEventListener('click', () => {
    state.pair = b.dataset.pair; save(); render();
  }));

  $$('[data-policy]').forEach(input => input.addEventListener('input', e => {
    const [regime, field] = e.target.dataset.policy.split('.');
    state.policy[regime][field] = Number(e.target.value);
    save();
    const errs = policyErrors();
    const box = $('#sheetErrors');
    box.innerHTML = errs.length ? `<ul>${errs.map(x => `<li>${x}</li>`).join('')}</ul>` : '';
    box.hidden = errs.length === 0;
    $('#sheetNext').disabled = errs.length > 0;
  }));

  $$('[data-hook]').forEach(cb => cb.addEventListener('change', e => {
    const id = e.target.dataset.hook;
    state.hooks = e.target.checked
      ? [...new Set([...state.hooks, id])]
      : state.hooks.filter(h => h !== id);
    save(); render();
  }));

  $$('[data-tune]').forEach(input => input.addEventListener('input', e => {
    state.tuning[e.target.dataset.tune] = Number(e.target.value);
    save();
    const errs = stepErrors();
    const box = $('#sheetErrors');
    box.innerHTML = errs.length ? `<ul>${errs.map(x => `<li>${x}</li>`).join('')}</ul>` : '';
    box.hidden = errs.length === 0;
    $('#sheetNext').disabled = errs.length > 0;
  }));

  $('#copySig')?.addEventListener('click', () => copy(state.signature, 'Signature copied'));
}

/**
 * Prime, then initialise.
 *
 * Each transaction is confirmed before the next is offered, because the second
 * one reverts if the first has not landed — and a wallet popup for a call that
 * cannot succeed is a confusing way to learn that.
 */
async function armOnChain() {
  const { key, setup } = armingArgs();

  state.txs = [];
  const step = async (label, to, data) => {
    toast(`${label}: confirm in your wallet…`);
    const hash = await sendTx({ to, data });
    state.txs.push({ label, hash, status: 'pending' });
    render();
    await waitForReceipt(hash);
    state.txs.at(-1).status = 'confirmed';
    render();
  };

  await step('Prime', CONTRACTS.bellrPool, primeCalldata(key, setup));
  await step(
    'Initialize',
    CONTRACTS.poolManager,
    initializeCalldata(key, openingSqrtPrice(key, state.token.trim(), state.openingPrice)),
  );

  toast('Pool armed and live');
}

/* ---- open / close -------------------------------------------------------- */
let lastFocus = null;

export function openSheet() {
  const sheet = $('#poolSheet');
  lastFocus = document.activeElement;
  sheet.removeAttribute('hidden');
  sheet.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  render();
  $('.sheet__close')?.focus();
}

function closeSheet() {
  const sheet = $('#poolSheet');
  sheet.setAttribute('hidden', '');
  sheet.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  lastFocus?.focus();
}

async function advance() {
  if (stepErrors().length) return;

  if (state.step < STEPS.length - 1) {
    state.step++; render(); $('.sheet__panel').scrollTop = 0;
    return;
  }

  // Final step: connect, be on the right chain, then either arm or sign.
  try {
    if (!wallet.account) { await connect(); render(); return; }
    if (!isRightChain()) {
      toast(`Switching to ${TARGET.chainName}…`);
      await switchToTarget();
    }

    if (readiness().canBroadcast) {
      await armOnChain();
      return;
    }

    const payload = JSON.stringify(buildPayload(), null, 2);
    state.signature = await signPolicy(payload);
    render();
    toast('Policy signed');
  } catch (err) {
    const msg = err?.code === 4001 ? 'Signature rejected in the wallet' : (err?.message ?? 'Wallet error');
    toast(msg);
  }
}

export function initPool() {
  if (!$('#poolSheet')) return;
  load();

  $$('[data-open-pool]').forEach(b => b.addEventListener('click', e => { e.preventDefault(); openSheet(); }));
  $$('[data-close-sheet]').forEach(b => b.addEventListener('click', closeSheet));
  $('#sheetBack').addEventListener('click', () => { if (state.step > 0) { state.step--; render(); } });
  $('#sheetNext').addEventListener('click', advance);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('#poolSheet').hasAttribute('hidden')) closeSheet();
  });

  // Keep tab focus inside the sheet while it is open.
  $('#poolSheet').addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const f = $$('button, a[href], input, select, textarea, summary', $('#poolSheet'))
      .filter(el => !el.disabled && el.offsetParent !== null);
    if (!f.length) return;
    const [first, lastEl] = [f[0], f[f.length - 1]];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); lastEl.focus(); }
    else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); first.focus(); }
  });
}

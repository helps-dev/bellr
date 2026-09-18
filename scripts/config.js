/* ==========================================================================
   BELLR — configuration
   Everything environment-specific lives here so nothing else has to guess.
   ========================================================================== */

/** Robinhood Chain network parameters, in the shape wallet_addEthereumChain wants. */
export const CHAINS = {
  mainnet: {
    chainId: '0x1237',                       // 4663
    chainName: 'Robinhood Chain',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://rpc.mainnet.chain.robinhood.com'],
    blockExplorerUrls: ['https://robinhoodchain.blockscout.com'],
  },
  testnet: {
    chainId: '0xB626',                       // 46630
    chainName: 'Robinhood Chain Testnet',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://rpc.testnet.chain.robinhood.com'],
    blockExplorerUrls: ['https://explorer.testnet.chain.robinhood.com'],
  },
};

/** Which network the interface targets. */
export const TARGET = CHAINS.mainnet;

/**
 * Uniswap v4 on Robinhood Chain mainnet. From the official deployment list and
 * confirmed against the chain: the PoolManager holds 24,009 bytes, answers
 * `extsload`, and its storage slot 0 matches `owner()`.
 *
 * Robinhood Chain testnet has no official v4 deployment, so there is no testnet
 * row here to fall back to.
 */
export const UNISWAP = {
  poolManager:     '0x8366a39CC670B4001A1121B8F6A443A643e40951',
  positionManager: '0x58daEC3116Aae6d93017BAaEA7749052e8a04fa7',
  stateView:       '0xf3334192d15450cdD385c8b70E03F9a6bD9e673b',
  quoter:          '0x8dc178eFb8111bb0973DD9d722EBEFf267c98f94',
  permit2:         '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  universalRouter: '0x8876789976DEcbFCbbBe364623c63652DB8C0904',
};

/**
 * BELLR's own contracts, live on Robinhood Chain mainnet since block 66,246,124.
 * The hook addresses end in 2080 and 20C4 because Uniswap v4 reads a hook's
 * permissions off its own address — they were mined, not chosen.
 */
export const CONTRACTS = {
  poolManager: UNISWAP.poolManager,
  calendar:    '0xd9c0421A5759b1aA2609162BD2178f147cd7E542',
  oracle:      '0x55F4B8e88B7F1C50740a6909dB25E187D79015d0',
  tollHook:    '0xC741bc587588981F096a8EB8b0bf374B5d22a080',
  bellrPool:   '0x5B515cD5121efcbd1bA037be5a62d76258d220c4',
};

/** The block the contracts went live in, for anything that scans logs. */
export const DEPLOYED_AT_BLOCK = 66246124;

/**
 * The read API. Everything the interface shows about live pools comes from here;
 * the chain is only touched for the wallet's own transactions.
 */
export const API = {
  /**
   * Where the read API lives.
   *
   * On a developer's machine the indexer runs beside the page, so localhost is
   * the right default. On a public origin it is not — pointing a visitor's
   * browser at their own 127.0.0.1 fails slowly, fills their console with
   * errors, and on an HTTPS page is blocked as mixed content before it even
   * tries. So the localhost default only applies when the page itself is on
   * localhost. Set BELLR_API on window, or edit this, once the indexer is
   * hosted somewhere with a certificate.
   */
  base: (() => {
    if (typeof window !== 'undefined' && window.BELLR_API) return window.BELLR_API;
    const local = typeof location !== 'undefined'
      && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    return local ? 'http://127.0.0.1:8787' : '';
  })(),
  routes: {
    health:   '/health',
    session:  '/session',
    pools:    '/pools',
    pool:     id => `/pools/${id}`,
    swaps:    id => `/pools/${id}/swaps`,
    tolls:    '/tolls',
    halts:    '/halts',
    sessions: '/sessions',
  },
};

/**
 * Tokenised equities available as a pair asset.
 *
 * Addresses come from Robinhood's own registry at
 * `https://api.robinhood.com/rhj/assets` and were each checked against the
 * chain: symbol, decimals and a non-zero supply. All 18 decimals.
 *
 * Robinhood does not tokenise its own stock, so there is no HOOD here however
 * well it would have fitted the theme.
 *
 * `multiplier` tracks corporate actions — a split changes it, and a price quote
 * has to be divided by it to line up with the token. It is read live; the value
 * here is only what it was when this list was written.
 */
export const EQUITIES = [
  { sym: 'NVDA',  name: 'NVIDIA',        venue: 'NASDAQ',    address: '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC' },
  { sym: 'TSLA',  name: 'Tesla',         venue: 'NASDAQ',    address: '0x322F0929c4625eD5bAd873c95208D54E1c003b2d' },
  { sym: 'AAPL',  name: 'Apple',         venue: 'NASDAQ',    address: '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9' },
  { sym: 'MSFT',  name: 'Microsoft',     venue: 'NASDAQ',    address: '0xe93237C50D904957Cf27E7B1133b510C669c2e74' },
  { sym: 'MSTR',  name: 'Strategy',      venue: 'NASDAQ',    address: '0xec262a75e413fAfD0dF80480274532C79D42da09' },
  { sym: 'SPY',   name: 'S&P 500 ETF',   venue: 'NYSE ARCA', address: '0x117cc2133c37B721F49dE2A7a74833232B3B4C0C' },
  { sym: 'COIN',  name: 'Coinbase',      venue: 'NASDAQ',    address: '0x6330D8C3178a418788dF01a47479c0ce7CCF450b' },
  { sym: 'AMD',   name: 'AMD',           venue: 'NASDAQ',    address: '0x86923f96303D656E4aa86D9d42D1e57ad2023fdC' },
];

/**
 * WalletConnect, so a phone can connect without a desktop extension.
 *
 * `projectId` comes from a free project at cloud.reown.com — WalletConnect v2
 * refuses to start without one. Leave it empty and the interface simply does
 * not offer the option, rather than offering a button that fails.
 *
 * The library is ~1.4 MB and is imported only when someone actually chooses
 * WalletConnect. Loading it on every visit would undo the work that made this
 * page feel quick.
 */
export const WALLETCONNECT = {
  projectId: 'f03c866a8282707d399c591136099922',
  /** What the wallet shows the user in its approval screen. */
  metadata: {
    name: 'BELLR',
    description: 'Uniswap v4 hooks that read the US trading calendar.',
    url: 'https://bellr.fun',
    icons: ['https://bellr.fun/assets/brand/apple-touch-icon.png'],
  },
  /** A wallet on someone else's network needs an RPC it can actually reach. */
  rpc: 'https://robinhood-rpc.publicnode.com',
};

/** Robinhood's own registry and quote feed. Both are public and unauthenticated. */
export const RH_API = {
  assets: 'https://api.robinhood.com/rhj/assets',
  price:  sym => `https://api.robinhood.com/rhj/prices/${sym}`,
};

/**
 * The six behaviours a pool can switch on.
 *
 * A Uniswap v4 pool has exactly one hook address, so these are not six
 * contracts — they are one contract, `BellrPool`, whose behaviour each pool
 * selects. `bit` is BELLR's own module bit, stored per pool. It is unrelated to
 * the v4 callback flags mined into the hook address, which are the same for
 * every pool and are shown separately as HOOK_ADDRESS_MASK.
 */
export const HOOKS = [
  { id: 'TOLL',   bit: 0x01, phase: 'beforeSwap', required: true,  title: 'Session regime',
    blurb: 'Prices every swap by what the equity market is doing at that block.' },
  { id: 'WIDEN',  bit: 0x02, phase: 'beforeSwap', required: false, title: 'Close-out fee ramp',
    tune: 'rampMinutes',
    blurb: 'Walks the fee up through the run-in to the bell instead of stepping at it.' },
  { id: 'DRIFT',  bit: 0x04, phase: 'beforeSwap', required: false, title: 'Reference band',
    tune: 'staleMinutes',
    blurb: 'Holds price near the reference feed, and halves the band when it goes quiet.' },
  { id: 'CURFEW', bit: 0x08, phase: 'afterSwap',  required: false, title: 'Out-of-hours size cap',
    blurb: 'Bounds what any single trade can do to a thin out-of-hours book.' },
  { id: 'HALT',   bit: 0x10, phase: 'beforeSwap', required: false, title: 'Halt mirror',
    blurb: 'Refuses every swap while the underlying equity is frozen.' },
  { id: 'CARRY',  bit: 0x20, phase: 'afterSwap',  required: false, title: 'Weekend carry',
    tune: 'carryPct',
    blurb: 'Takes an out-of-hours surcharge and returns it to the book as depth.' },
];

/**
 * The v4 callback bits every BELLR pool's hook address carries:
 * beforeInitialize | beforeSwap | afterSwap | afterSwapReturnDelta.
 * Fixed at deployment, identical for every pool, and verified in
 * `test_hookAddressCarriesExactlyItsPermissions`.
 */
export const HOOK_ADDRESS_MASK = '0x20C4';

/**
 * Hard limits. The contracts clamp to these, so the interface refuses to build
 * a payload that would revert on arming.
 */
export const LIMITS = {
  fee:  { min: 0.05, max: 5.00 },   // percent
  cap:  { min: 0.01, max: 100 },    // percent of supply, 100 = uncapped
  band: { min: 0.05, max: 5.00 },   // percent
};

/** Per-module settings, in the units a person reads rather than the contract's. */
export const TUNING = {
  rampMinutes:  { min: 0, max: 60, step: 5,    unit: 'min', label: 'Ramp starts',
                  hint: 'how long before the bell WIDEN begins to lift the fee' },
  staleMinutes: { min: 0, max: 60, step: 1,    unit: 'min', label: 'Silence tolerated',
                  hint: 'how long DRIFT accepts a quiet feed before halving the band' },
  carryPct:     { min: 0, max: 1,  step: 0.05, unit: '%',   label: 'Carry surcharge',
                  hint: 'share of an out-of-hours swap CARRY sets aside' },
};

/** Defaults the arming form starts from. */
export const DEFAULT_POLICY = {
  regular: { fee: 0.30, cap: 100,  band: 1.00 },
  extended:{ fee: 0.60, cap: 1.00, band: 0.25 },
  closed:  { fee: 1.20, cap: 0.25, band: 0.40 },
  weekend: { fee: 1.50, cap: 0.10, band: 0.60 },
};

/** Defaults for the per-module settings. */
export const DEFAULT_TUNING = { rampMinutes: 30, staleMinutes: 5, carryPct: 0.25 };

export const REGIME_LABELS = {
  regular:  'Regular hours',
  extended: 'Pre / after hours',
  closed:   'Closed',
  weekend:  'Weekend & holidays',
};

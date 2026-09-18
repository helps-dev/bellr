/* BELLR — entry point. */
import { initUI } from './ui.js';
import { initBackdrop } from './backdrop.js';
import { initClock } from './clock.js';
import { initWalletUI } from './wallet-ui.js';
import { initPool } from './pool.js';
import { initScrubber } from './scrubber.js';
import { initMascotEyes } from './mascot-eyes.js';
import { initBellTap } from './bell.js';
import { initOracleBadge } from './oracle-badge.js';

initUI();
initBackdrop();
initClock();
initWalletUI();
initPool();
initScrubber();
initMascotEyes();
initBellTap();
initOracleBadge();

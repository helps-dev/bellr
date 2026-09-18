/* Chrome: theme, sticky header, mobile nav, scroll reveals, clipboard. */

import { $, $$, copy, toast, reduceMotion } from './utils.js';

const THEME_KEY = 'bellr.theme';

/* Single theme by design — the palette is the identity, not a preference. */
function initTheme() {
  document.documentElement.removeAttribute('data-theme');
}

function initHeader() {
  const hdr = $('#hdr');
  const burger = $('#burger');
  const onScroll = () => hdr.classList.toggle('is-stuck', window.scrollY > 8);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  burger?.addEventListener('click', () => {
    const open = hdr.classList.toggle('is-open');
    burger.setAttribute('aria-expanded', String(open));
  });
  $$('.hdr__nav a').forEach(a => a.addEventListener('click', () => {
    hdr.classList.remove('is-open');
    burger?.setAttribute('aria-expanded', 'false');
  }));
}

function initReveal() {
  const targets = [
    ...$$('.block__head'), ...$$('.short'), ...$$('.step'), ...$$('.hook'),
    ...$$('.phase'), ...$$('.risk-item'), ...$$('.scrub'), ...$$('.figs'), ...$$('.uses'),
  ];
  targets.forEach(el => el.setAttribute('data-reveal', ''));

  if (reduceMotion() || !('IntersectionObserver' in window)) {
    targets.forEach(el => el.classList.add('is-in'));
    return;
  }

  const show = (el, delay = 0) => {
    if (el.classList.contains('is-in')) return;
    el.style.setProperty('--d', `${delay}ms`);
    el.classList.add('is-in');
  };

  // An anchor jump can carry an element from below the fold to above it between
  // two frames, so it never reports as intersecting. Treat "already scrolled
  // past" as revealed too, or deep links land on invisible content.
  const io = new IntersectionObserver(entries => {
    entries.forEach((entry, i) => {
      if (!entry.isIntersecting && entry.boundingClientRect.top > 0) return;
      show(entry.target, entry.isIntersecting ? i * 60 : 0);
      io.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });

  targets.forEach(el => io.observe(el));

  const sweep = () => targets.forEach(el => {
    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) {
      show(el);
      io.unobserve(el);
    }
  });
  let t;
  window.addEventListener('scroll', () => { clearTimeout(t); t = setTimeout(sweep, 120); }, { passive: true });
  window.addEventListener('hashchange', () => setTimeout(sweep, 600));
  sweep();
  window.addEventListener('load', () => setTimeout(sweep, 80));
  setTimeout(sweep, 500);
}

function initMisc() {
  $('#yr').textContent = new Date().getFullYear();

  const CA = $('#ca2')?.textContent.trim() ?? '';
  $('#copyCa')?.addEventListener('click', () => copy(CA, 'Contract address copied'));
  $('#copyCa2')?.addEventListener('click', () => copy(CA, 'Contract address copied'));

  $$('[data-noop]').forEach(el =>
    el.addEventListener('click', e => {
      e.preventDefault();
      toast('Mockup build — this action is not wired up yet');
    })
  );
}

export function initUI() {
  initTheme();
  initHeader();
  initReveal();
  initMisc();
}

/* iLEAD navigation + scroll restoration, shared by the home page and the programme pages.
 *
 * <html data-ilead-page="home">       index.html (content is rendered late by support.js/React)
 * <html data-ilead-page="program">    chuong-trinh/<slug>/index.html
 * <html data-ilead-page="not-found">  404.html
 *
 * Who restores what — exactly one owner at a time:
 *  - Back/forward served from the bfcache: the browser (page state is intact; we do nothing).
 *  - Full reloads / non-bfcache back-forward of a home entry: this script. On pagehide the home
 *    page snapshots its position into that history entry and switches the entry to
 *    history.scrollRestoration = 'manual', so the browser does not also try (it would restore
 *    too early, before React has rendered the page). The entry goes back to 'auto' once shown,
 *    so same-document #anchor back/forward keeps the browser's native behaviour.
 *  - Programme pages are static; the browser restores them natively.
 *
 * State lives per history entry (history.state[ileadNav]) with a per-tab sessionStorage copy.
 * Hand-offs between pages are one-shot sessionStorage records that are deleted on first read.
 */
(() => {
  'use strict';

  const root = document.documentElement;
  const role = root.dataset.ileadPage;
  if (!role) return;

  const NS = 'ileadNav';
  const TOKEN_KEY = 'ilead:card-token';   // home card click -> programme page (one-shot)
  const INTENT_KEY = 'ilead:home-intent'; // programme page -> home: 'restore' | 'registration' (one-shot)
  const SNAP_PREFIX = 'ilead:snap:';      // per home history entry, keyed by entry id
  const TOKEN_TTL = 2 * 60 * 1000;
  const INTENT_TTL = 60 * 1000;
  const CARD_CLICK_TTL = 15 * 1000;
  const MAX_SNAPSHOTS = 20;
  const READY_TIMEOUT = 8000;   // wait at most this long for the home page to render
  const SETTLE_MAX = 3000;      // keep correcting for late layout shifts at most this long
  const SETTLE_QUIET = 450;     // …and stop earlier once layout has been still this long after load
  const PASSTHROUGH_PARAM = /^(ref|utm_[a-z0-9_]+)$/i;

  // ---------------------------------------------------------------- utilities

  // Opt-in tracing for debugging: sessionStorage.setItem('ilead:debug', '1')
  const DEBUG = (() => { try { return sessionStorage.getItem('ilead:debug') === '1'; } catch { return false; } })();
  const log = (...args) => { if (DEBUG) console.debug('[ilead-nav]', ...args); };

  const store = {
    get(key) {
      try {
        const raw = sessionStorage.getItem(key);
        const value = raw ? JSON.parse(raw) : null;
        return value && typeof value === 'object' ? value : null;
      } catch { return null; }
    },
    set(key, value) {
      try { sessionStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
    },
    take(key) {
      const value = store.get(key);
      try { sessionStorage.removeItem(key); } catch {}
      return value;
    }
  };

  const historyState = () => {
    const s = history.state;
    return s && typeof s === 'object' && !Array.isArray(s) ? s : {};
  };
  const ownState = () => {
    const s = historyState()[NS];
    return s && typeof s === 'object' ? s : {};
  };
  // Merge into history.state without clobbering anything else stored there.
  const patchOwnState = patch => {
    try {
      const state = historyState();
      history.replaceState({ ...state, [NS]: { ...ownState(), ...patch } }, '');
      return true;
    } catch { return false; }
  };
  const setScrollRestoration = mode => {
    try { if ('scrollRestoration' in history) history.scrollRestoration = mode; } catch {}
  };
  // Hand scrolling back to the browser only after `load`: until then Chrome may still be holding a
  // pending restoration for this entry, and switching to 'auto' early would let it jump to the old
  // position after we (or the user) already scrolled.
  const releaseScrollRestoration = () => {
    const release = () => setTimeout(() => setScrollRestoration('auto'), 0);
    if (document.readyState === 'complete') release();
    else window.addEventListener('load', release, { once: true });
  };
  const navigationType = () => {
    try { return performance.getEntriesByType('navigation')[0]?.type || 'navigate'; } catch { return 'navigate'; }
  };
  const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const isFresh = (record, ttl) => record && typeof record.ts === 'number' && Date.now() - record.ts >= 0 && Date.now() - record.ts < ttl;
  const isPlainLeftClick = event => event.button === 0 && !event.defaultPrevented &&
    !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

  // Home URL = the site root this page was built against (data-ilead-root), same origin only.
  const homeUrl = new URL(role === 'home' ? './' : (root.dataset.ileadRoot || '/'), location.href);
  const isHomeUrl = value => {
    try {
      const url = new URL(value, location.href);
      if (url.origin !== location.origin) return false;
      return url.pathname === homeUrl.pathname || url.pathname === homeUrl.pathname + 'index.html';
    } catch { return false; }
  };
  const withoutHash = value => {
    const url = new URL(value, location.href);
    url.hash = '';
    return url.href;
  };

  // --------------------------------------------------------------- home page

  function initHome() {
    // Every home history entry gets a stable id so its snapshot can be found again.
    let entryId = ownState().id;
    if (!entryId) {
      entryId = newId();
      patchOwnState({ id: entryId });
    }

    let lastCardClick = null;

    const headerOffset = () => {
      const header = document.querySelector('.site-header');
      return header ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
    };
    const cardLink = slug => document.querySelector(`a[data-ilead-program="${CSS.escape(slug)}"]`);
    const cardOf = link => link && (link.closest('.ye-card') || link);
    const topBlocks = () => {
      const page = document.querySelector('.site-page');
      return page ? [...page.children].filter(el => el.offsetParent !== null || el.getClientRects().length) : [];
    };

    // What to anchor the snapshot to: the clicked card, else the top-level block at the viewport top.
    const describeAnchor = () => {
      if (lastCardClick && Date.now() - lastCardClick.ts < CARD_CLICK_TTL) {
        const card = cardOf(cardLink(lastCardClick.slug));
        if (card) return { type: 'card', slug: lastCardClick.slug, top: card.getBoundingClientRect().top };
      }
      const limit = headerOffset();
      const blocks = topBlocks();
      const index = blocks.findIndex(el => el.getBoundingClientRect().bottom > limit);
      if (index < 0) return null;
      const block = blocks[index];
      return { type: 'block', index, id: block.id || '', cls: block.className || '', top: block.getBoundingClientRect().top };
    };
    const findAnchor = anchor => {
      if (!anchor) return null;
      if (anchor.type === 'card') return cardOf(cardLink(anchor.slug));
      if (anchor.type === 'id') return document.getElementById(anchor.id);
      if (anchor.type === 'block') {
        if (anchor.id) return document.getElementById(anchor.id);
        const block = topBlocks()[anchor.index];
        // Only trust the index if it still points at the same kind of block.
        return block && block.className === anchor.cls ? block : null;
      }
      return null;
    };

    const takeSnapshot = () => ({
      x: window.scrollX,
      y: window.scrollY,
      vw: window.innerWidth,
      vh: window.innerHeight,
      url: location.href,
      anchor: describeAnchor(),
      ts: Date.now()
    });
    const saveSnapshot = () => {
      const snap = takeSnapshot();
      patchOwnState({ id: entryId, snap });
      store.set(SNAP_PREFIX + entryId, snap);
      pruneSnapshots();
      return snap;
    };
    // One snapshot per home history entry; keep only the most recent ones in this tab.
    const pruneSnapshots = () => {
      try {
        const keys = Object.keys(sessionStorage).filter(key => key.startsWith(SNAP_PREFIX));
        if (keys.length <= MAX_SNAPSHOTS) return;
        keys.map(key => ({ key, ts: (store.get(key) || {}).ts || 0 }))
          .sort((a, b) => a.ts - b.ts)
          .slice(0, keys.length - MAX_SNAPSHOTS)
          .forEach(({ key }) => sessionStorage.removeItem(key));
      } catch {}
    };
    const readSnapshot = id => {
      const fromState = ownState().snap;
      if (id === entryId && fromState && typeof fromState.y === 'number') return fromState;
      const fromStore = store.get(SNAP_PREFIX + id);
      return fromStore && typeof fromStore.y === 'number' ? fromStore : null;
    };

    // Card clicks: let the link navigate normally (same tab, real href, so Ctrl/Cmd-click,
    // middle-click and "open in new tab" keep working); only plain clicks hand over a token.
    document.addEventListener('click', event => {
      const link = event.target.closest && event.target.closest('a[data-ilead-program]');
      if (!link || !isPlainLeftClick(event)) return;
      lastCardClick = { slug: link.dataset.ileadProgram, ts: Date.now() };
      saveSnapshot();
      store.set(TOKEN_KEY, {
        slug: link.dataset.ileadProgram,
        entryId,
        url: location.href,
        ts: Date.now()
      });
    });

    // Leaving the page by any route: snapshot this entry and claim its restoration.
    window.addEventListener('pagehide', () => {
      saveSnapshot();
      setScrollRestoration('manual');
    });

    // Back/forward from the bfcache: the browser already restored everything.
    window.addEventListener('pageshow', event => {
      if (event.persisted) {
        setScrollRestoration('auto');
        lastCardClick = null;
      }
    });

    // Decide what (if anything) to restore on this load.
    const type = navigationType();
    const intent = store.take(INTENT_KEY);
    let plan = null;

    if ((type === 'back_forward' || type === 'reload') && readSnapshot(entryId)) {
      plan = { kind: 'snapshot', snap: readSnapshot(entryId) };
    } else if (type === 'navigate' && isFresh(intent, INTENT_TTL)) {
      if (intent.type === 'restore' && withoutHash(intent.url) === withoutHash(location.href)) {
        const snap = readSnapshot(intent.entryId);
        if (snap) plan = { kind: 'snapshot', snap };
      }
      // 'registration' intentionally never restores the roadmap: the #dang-ky hash wins below.
    }
    if (!plan && type === 'navigate' && location.hash.length > 1) {
      let id = '';
      try { id = decodeURIComponent(location.hash.slice(1)); } catch {}
      if (id) plan = { kind: 'hash', id };
    }

    log('home load', { type, entryId, plan, intent, viewport: `${window.innerWidth}x${window.innerHeight}` });
    if (!plan) {
      // Nothing of ours to restore: let the browser handle this entry natively.
      setScrollRestoration('auto');
      return;
    }
    restore(plan);

    function restore(plan) {
      const snap = plan.snap;
      const anchor = plan.kind === 'hash' ? { type: 'id', id: plan.id } : snap.anchor;
      const sameViewport = snap && snap.vw === window.innerWidth && snap.vh === window.innerHeight;
      const previousBehavior = root.style.scrollBehavior;
      const start = performance.now();
      let firstApplied = 0;
      let lastChange = 0;
      let lastSetY = null;
      let lastAnchorTop = null;
      let loaded = document.readyState === 'complete';
      let finished = false;
      // Animation frames stop in hidden tabs (e.g. a tab restored in the background); use a timer then.
      let frame = null;
      const schedule = callback => {
        frame = document.visibilityState === 'hidden'
          ? { timer: setTimeout(() => callback(performance.now()), 50) }
          : { raf: requestAnimationFrame(callback) };
      };
      const unschedule = () => {
        if (!frame) return;
        if (frame.raf) cancelAnimationFrame(frame.raf);
        if (frame.timer) clearTimeout(frame.timer);
        frame = null;
      };

      // Instant jumps only: the page sets `html { scroll-behavior: smooth }`.
      root.style.scrollBehavior = 'auto';
      // Returning to a saved position: hide the late-rendered content until it is in place, so the
      // top of the page never flashes. (Not for #hash loads — the target may not exist at all.)
      if (plan.kind === 'snapshot') root.classList.add('ilead-restoring');
      // Hard stop in case animation frames are throttled or something throws.
      const safetyTimer = setTimeout(() => finish('timeout'), READY_TIMEOUT + SETTLE_MAX + 1000);

      const desiredViewportTop = element => {
        if (plan.kind === 'hash') {
          return parseFloat(getComputedStyle(element).scrollMarginTop) || headerOffset();
        }
        const saved = anchor.top;
        if (sameViewport) return saved;
        const minTop = headerOffset() + 8;
        const maxTop = Math.max(minTop, window.innerHeight - 160);
        // Only the height changed (e.g. a mobile browser bar shown/hidden): same layout, same offset,
        // just keep the anchor on screen.
        if (snap.vw === window.innerWidth) return Math.min(saved, maxTop);
        // Width changed (rotation/resize), so the layout changed: keep the anchor at a comparable
        // place on screen rather than at the old pixel offset.
        const scaled = saved * (window.innerHeight / (snap.vh || window.innerHeight));
        return Math.min(Math.max(scaled, minTop), maxTop);
      };
      const maxScrollY = () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

      const finish = reason => {
        if (finished) return;
        finished = true;
        log('restore finished', { reason, scrollY: window.scrollY, elapsed: Math.round(performance.now() - start) });
        unschedule();
        clearTimeout(safetyTimer);
        stopListening();
        root.classList.remove('ilead-restoring');
        root.style.scrollBehavior = previousBehavior;
        releaseScrollRestoration();
        if (reason === 'done' && plan.kind === 'snapshot' && anchor && anchor.type === 'card') {
          const link = cardLink(anchor.slug);
          if (link) {
            try { link.focus({ preventScroll: true }); } catch {}
          }
        }
      };

      // Any user intent to scroll ends the restoration immediately.
      const onUserInput = event => {
        if (event.type === 'keydown' && !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar', 'Tab'].includes(event.key)) return;
        finish('user');
      };
      const userEvents = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
      userEvents.forEach(name => window.addEventListener(name, onUserInput, { passive: true, capture: true }));
      const onLoad = () => { loaded = true; };
      window.addEventListener('load', onLoad, { once: true });
      function stopListening() {
        userEvents.forEach(name => window.removeEventListener(name, onUserInput, { capture: true }));
        window.removeEventListener('load', onLoad);
      }

      const step = now => {
        if (finished) return;
        try {
          tick(now);
        } catch (error) {
          finish('error');
        }
      };
      const tick = now => {
        const element = findAnchor(anchor);
        const rendered = element && element.getBoundingClientRect().height > 0;

        let targetY = null;
        if (rendered) {
          const anchorTop = element.getBoundingClientRect().top + window.scrollY;
          // Scroll position moved but the anchor did not: someone else scrolled (the user).
          if (lastSetY !== null && Math.abs(window.scrollY - lastSetY) > 2 &&
              lastAnchorTop !== null && Math.abs(anchorTop - lastAnchorTop) < 1) {
            finish('user');
            return;
          }
          if (lastAnchorTop === null || Math.abs(anchorTop - lastAnchorTop) >= 1) lastChange = now;
          lastAnchorTop = anchorTop;
          targetY = anchorTop - desiredViewportTop(element);
        } else if (plan.kind === 'snapshot' && now - start > READY_TIMEOUT * .75) {
          // The anchor never appeared: fall back to the raw coordinates.
          targetY = snap.y;
        }

        if (targetY !== null) {
          const clamped = Math.round(Math.min(Math.max(0, targetY), maxScrollY()));
          const tallEnough = maxScrollY() >= Math.round(targetY) - 1;
          if (tallEnough || now - start > READY_TIMEOUT) {
            if (Math.abs(window.scrollY - clamped) > 1) {
              log('scrollTo', { from: window.scrollY, to: clamped, targetY, anchorFound: !!rendered });
              window.scrollTo(plan.kind === 'snapshot' ? snap.x : window.scrollX, clamped);
              lastChange = now;
            }
            lastSetY = window.scrollY;
            if (!firstApplied) {
              firstApplied = now;
              root.classList.remove('ilead-restoring');
            }
          }
        }

        if (firstApplied) {
          const settled = loaded && now - lastChange > SETTLE_QUIET;
          if (settled || now - firstApplied > SETTLE_MAX) {
            finish('done');
            return;
          }
        } else if (now - start > READY_TIMEOUT) {
          finish('timeout');
          return;
        }
        schedule(step);
      };
      schedule(step);
    }
  }

  // ---------------------------------------------------------- programme page

  function initProgram() {
    const slug = root.dataset.ileadSlug || '';

    // Adopt the card hand-off once, then keep it in this entry's history.state so that a reload
    // of this page still knows it was opened from the home page.
    let from = ownState().from;
    if (!from || !isHomeUrl(from.url)) {
      from = null;
      const token = store.take(TOKEN_KEY);
      const referrerOk = !document.referrer || isHomeUrl(document.referrer);
      if (navigationType() === 'navigate' && isFresh(token, TOKEN_TTL) &&
          token.slug === slug && isHomeUrl(token.url) && typeof token.entryId === 'string' && referrerOk) {
        from = { url: token.url, entryId: token.entryId, ts: token.ts };
        patchOwnState({ from });
      }
    }

    // Keep the referral / UTM parameters this page was opened with on the way to the form.
    const passthrough = new URLSearchParams();
    new URLSearchParams(location.search).forEach((value, key) => {
      if (PASSTHROUGH_PARAM.test(key) && value) passthrough.append(key, value);
    });
    const withPassthrough = href => {
      if (![...passthrough.keys()].length) return href;
      const url = new URL(href, location.href);
      passthrough.forEach((value, key) => { if (!url.searchParams.has(key)) url.searchParams.append(key, value); });
      return url.href;
    };
    document.querySelectorAll('a[data-ilead-cta]').forEach(link => {
      link.href = withPassthrough(link.getAttribute('href'));
    });

    document.addEventListener('click', event => {
      if (!isPlainLeftClick(event)) return;
      const link = event.target.closest && event.target.closest('a[data-ilead-cta], a[data-ilead-back]');
      if (!link) return;

      if (link.hasAttribute('data-ilead-cta')) {
        // Registration: go to the form; the home page must not restore the roadmap for this visit.
        store.set(INTENT_KEY, { type: 'registration', ts: Date.now() });
        return;
      }

      // "Quay lại lộ trình học"
      if (!from) return; // no known origin: plain link to #lo-trinh (never leaves the site)
      event.preventDefault();
      if (history.length > 1) {
        // The entry right before this one is the home entry the card was clicked on.
        history.back();
        return;
      }
      // Cannot go back safely: open the origin again and ask it to restore once.
      store.set(INTENT_KEY, { type: 'restore', url: withoutHash(from.url), entryId: from.entryId, ts: Date.now() });
      location.assign(withoutHash(from.url));
    });
  }

  if (role === 'home') {
    const style = document.createElement('style');
    style.textContent = 'html.ilead-restoring #dc-root{visibility:hidden}';
    document.head.appendChild(style);
    initHome();
  } else if (role === 'program') {
    initProgram();
  }
})();

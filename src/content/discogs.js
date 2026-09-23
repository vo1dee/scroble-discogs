// Injects a "Scrobble to Last.fm" button on Discogs release pages.
//
// Runs as a classic script (Firefox MV3 content scripts can't be ES modules), and knows
// nothing about Last.fm — it hands a release id to the picker and stays out of the way.

(() => {
  const api = globalThis.browser ?? globalThis.chrome;

  const BUTTON_ID = 'scroble-discogs-button';
  const OVERLAY_ID = 'scroble-discogs-overlay';
  const READY_TIMEOUT_MS = 2500;

  // Discogs serves localized paths such as /fr/release/123 and /ja_JP/release/123.
  const PATH = /^(?:\/[a-z]{2}(?:_[A-Z]{2})?)?\/(release|master)\/(\d+)/;

  const currentTarget = () => {
    const m = location.pathname.match(PATH);
    return m ? { type: m[1], id: m[2] } : null;
  };

  // ---- overlay ----

  function closeOverlay() {
    document.getElementById(OVERLAY_ID)?.remove();
    window.removeEventListener('keydown', onKeydown, true);
  }

  function onKeydown(e) {
    if (e.key === 'Escape') closeOverlay();
  }

  function openOverlay({ type, id }) {
    closeOverlay();

    const url = api.runtime.getURL('src/picker/picker.html') +
      `?${type === 'master' ? 'master' : 'release'}=${encodeURIComponent(id)}`;

    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOverlay(); });

    const frame = document.createElement('iframe');
    frame.src = url;
    frame.setAttribute('title', 'Scrobble to Last.fm');
    overlay.append(frame);
    document.body.append(overlay);
    window.addEventListener('keydown', onKeydown, true);

    // Some pages' Content-Security-Policy can refuse to frame an extension page. If the
    // picker hasn't announced itself shortly after mounting, fall back to a real window
    // rather than leaving the user staring at an empty panel.
    let ready = false;
    const onReady = (event) => {
      if (event.data?.source !== 'scroble-discogs') return;
      if (event.data.action === 'ready') ready = true;
      if (event.data.action === 'close') {
        closeOverlay();
        window.removeEventListener('message', onReady);
      }
      if (event.data.action === 'resize' && typeof event.data.height === 'number') {
        frame.style.height = `${Math.min(event.data.height, window.innerHeight * 0.85)}px`;
      }
    };
    window.addEventListener('message', onReady);

    setTimeout(() => {
      if (ready || !document.getElementById(OVERLAY_ID)) return;
      closeOverlay();
      window.removeEventListener('message', onReady);
      api.runtime.sendMessage({ type: 'openPickerWindow', payload: { id, type } });
    }, READY_TIMEOUT_MS);
  }

  // ---- button ----

  function makeButton(target) {
    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.textContent = 'Scrobble to Last.fm';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openOverlay(target);
    });
    return btn;
  }

  function inject() {
    const target = currentTarget();
    const existing = document.getElementById(BUTTON_ID);

    if (!target) {
      existing?.remove();
      return;
    }
    if (existing?.dataset.releaseId === target.id) return;
    existing?.remove();

    const btn = makeButton(target);
    btn.dataset.releaseId = target.id;

    // Discogs' class names are hashed and change between deploys, so anchor on the page's
    // <h1> instead. If the layout ever moves out from under us, the button becomes a
    // floating one rather than disappearing.
    const heading = document.querySelector('h1');
    if (heading?.parentElement) {
      btn.classList.add('sd-inline');
      // The release header is a grid, with the <h1> in the wide column. Inserting next to
      // the heading would make the button the following grid item, landing it in the narrow
      // cover-art column where the label is squeezed. Step out to the container instead.
      const parent = heading.parentElement;
      const { display } = getComputedStyle(parent);
      const laidOut = display.includes('grid') || display.includes('flex');
      // Never step out as far as <body>: inserting after it would put the button outside
      // the document body.
      const anchor = laidOut && parent !== document.body ? parent : heading;
      anchor.insertAdjacentElement('afterend', btn);
    } else {
      btn.classList.add('sd-floating');
      document.body.append(btn);
    }
  }

  // ---- react to Discogs' client-side navigation ----

  function watchNavigation(onChange) {
    let last = location.href;
    const fire = () => {
      if (location.href === last) return;
      last = location.href;
      onChange();
    };

    for (const method of ['pushState', 'replaceState']) {
      const original = history[method];
      history[method] = function (...args) {
        const result = original.apply(this, args);
        queueMicrotask(fire);
        return result;
      };
    }
    window.addEventListener('popstate', fire);

    // Belt and braces: some transitions swap content without touching history, and Discogs
    // re-renders enough that this fires constantly — coalesce to one check per frame.
    let queued = false;
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        fire();
        if (currentTarget() && !document.getElementById(BUTTON_ID)) inject();
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  const start = () => {
    inject();
    watchNavigation(inject);
  };

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();

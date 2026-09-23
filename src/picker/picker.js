// The tracklist picker. Used in two places: rendered into the toolbar popup, and loaded as a
// standalone page inside an overlay iframe on Discogs release pages.

import { formatDuration } from '../lib/tracklist.js';
import { send } from '../lib/messaging.js';

const el = (tag, props = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) node.append(c);
  return node;
};

const clockTime = (unix) =>
  new Date(unix * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * @param {HTMLElement} container
 * @param {{type?: string, id: string|number, onClose?: () => void}} opts
 */
export async function renderPicker(container, { type = 'release', id, onClose } = {}) {
  container.className = 'sd';
  container.replaceChildren(el('div', { class: 'sd-state', text: 'Loading release from Discogs…' }));

  let parsed;
  try {
    parsed = await send('loadRelease', { id, type });
  } catch (err) {
    container.replaceChildren(
      el('div', { class: 'sd-status', 'data-kind': 'err', text: err.message }),
    );
    return;
  }

  if (!parsed.tracks.length) {
    container.replaceChildren(
      el('div', { class: 'sd-status', 'data-kind': 'warn', text: 'This release has no tracklist on Discogs.' }),
    );
    return;
  }

  // State
  const selected = new Set(parsed.tracks.map((t) => t.id));
  let endedAt = Math.floor(Date.now() / 1000);
  let busy = false;

  // ---- header ----
  const head = el('div', { class: 'sd-head' }, [
    parsed.thumb ? el('img', { class: 'sd-cover', src: parsed.thumb, alt: '' }) : el('div', { class: 'sd-cover' }),
    el('div', { class: 'sd-titles' }, [
      el('p', { class: 'sd-album', text: parsed.album }),
      el('p', { class: 'sd-artist', text: parsed.albumArtist }),
      el('p', {
        class: 'sd-meta',
        text: [parsed.year, parsed.format].filter(Boolean).join(' · '),
      }),
    ]),
    onClose ? el('button', { class: 'sd-close', title: 'Close', text: '×', onclick: onClose }) : null,
  ]);

  // ---- selection shortcuts ----
  const chips = [
    el('span', { class: 'sd-bar-label', text: 'Select' }),
    el('button', { class: 'sd-chip', text: 'All', onclick: () => setSelection(() => true) }),
    el('button', { class: 'sd-chip', text: 'None', onclick: () => setSelection(() => false) }),
  ];
  // Only vinyl-style positions yield sides; CD-style releases get no side chips.
  for (const side of parsed.sides) {
    chips.push(el('button', {
      class: 'sd-chip', text: `Side ${side}`,
      onclick: () => setSelection((t) => t.side === side),
    }));
  }
  const bar = el('div', { class: 'sd-bar' }, chips);

  // ---- track rows ----
  const rows = new Map();
  const list = el('div', { class: 'sd-list' });
  for (const t of parsed.tracks) {
    const box = el('input', { type: 'checkbox', checked: 'checked' });
    box.addEventListener('change', () => {
      box.checked ? selected.add(t.id) : selected.delete(t.id);
      syncRow(t.id);
      refresh();
    });
    const titleNode = el('span', { class: 'sd-title' }, [
      document.createTextNode(t.title),
      // Only worth showing when it differs from the album artist (compilations, split LPs)
      t.artist !== parsed.albumArtist ? el('span', { class: 'sd-track-artist', text: t.artist }) : null,
    ]);
    const row = el('div', { class: 'sd-row', 'data-checked': 'true' }, [
      el('label', {}, [
        box,
        el('span', { class: 'sd-pos', text: t.position || '–' }),
        titleNode,
        el('span', {
          class: 'sd-dur',
          'data-estimated': String(t.durationEstimated),
          title: t.durationEstimated ? 'Not listed on Discogs — estimated' : '',
          text: formatDuration(t.duration),
        }),
      ]),
    ]);
    rows.set(t.id, { row, box });
    list.append(row);
  }

  function syncRow(trackId) {
    const r = rows.get(trackId);
    if (r) r.row.setAttribute('data-checked', String(selected.has(trackId)));
  }

  function setSelection(predicate) {
    selected.clear();
    for (const t of parsed.tracks) if (predicate(t)) selected.add(t.id);
    for (const [trackId, { box }] of rows) {
      box.checked = selected.has(trackId);
      syncRow(trackId);
    }
    refresh();
  }

  // ---- estimated-duration note ----
  const note = parsed.estimatedCount
    ? el('div', {
        class: 'sd-note',
        text:
          `${parsed.estimatedCount} of ${parsed.tracks.length} tracks have no duration on Discogs — ` +
          `estimated at ${formatDuration(parsed.estimateSeconds)} each ` +
          `(${parsed.estimateSource === 'release-average' ? "this release's average" : 'your default'}). ` +
          'Play counts are unaffected; only the clock times are approximate.',
      })
    : null;

  // ---- footer ----
  const whenText = el('span', {});
  const nudges = [15, 30, 60].map((mins) =>
    el('button', {
      class: 'sd-nudge', text: `−${mins}m`, title: `Finished ${mins} minutes ago`,
      onclick: () => { endedAt -= mins * 60; refresh(); },
    })
  );
  const resetNudge = el('button', {
    class: 'sd-nudge', text: 'now', title: 'Finished just now',
    onclick: () => { endedAt = Math.floor(Date.now() / 1000); refresh(); },
  });
  const when = el('div', { class: 'sd-when' }, [whenText, ...nudges, resetNudge]);

  const submit = el('button', { class: 'sd-submit', text: 'Scrobble' });
  const status = el('div', { class: 'sd-status', 'data-kind': 'warn' });
  status.hidden = true;

  submit.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    submit.disabled = true;
    submit.textContent = 'Scrobbling…';
    status.hidden = true;
    try {
      const res = await send('submit', { parsed, selectedIds: [...selected], endedAt });
      showResult(res);
    } catch (err) {
      status.hidden = false;
      status.setAttribute('data-kind', 'err');
      status.replaceChildren(el('span', { text: err.message }));
      if (/connect|api key|secret/i.test(err.message)) {
        status.append(
          document.createTextNode(' '),
          el('a', { class: 'sd-link', href: '#', text: 'Open settings', onclick: (e) => { e.preventDefault(); send('openOptions'); } })
        );
      }
    } finally {
      busy = false;
      submit.disabled = false;
      refresh();
    }
  });

  function showResult(res) {
    status.hidden = false;
    const ignored = res.results.filter((r) => r.status === 'ignored');
    const corrected = res.results.filter((r) => r.corrected);
    const kind = res.dryRun ? 'warn' : ignored.length ? 'warn' : 'ok';
    status.setAttribute('data-kind', kind);

    const lines = [];
    if (res.dryRun) {
      lines.push(el('span', { text: `Dry run: ${res.accepted} scrobbles prepared but NOT sent. Payload logged to the extension console.` }));
    } else {
      lines.push(el('span', {
        text: `Scrobbled ${res.accepted} track${res.accepted === 1 ? '' : 's'}` +
              (res.ignored ? `, ${res.ignored} ignored` : '') +
              (res.user ? ` as ${res.user}.` : '.'),
      }));
    }
    if (ignored.length) {
      lines.push(el('ul', {}, ignored.map((r) => el('li', { text: `${r.track} — ${r.reason}` }))));
    }
    if (corrected.length) {
      lines.push(el('div', { text: `${corrected.length} name${corrected.length === 1 ? '' : 's'} auto-corrected by Last.fm.` }));
    }
    if (!res.dryRun && res.user) {
      lines.push(el('div', {}, [
        el('a', {
          class: 'sd-link', target: '_blank', rel: 'noreferrer',
          href: `https://www.last.fm/user/${encodeURIComponent(res.user)}/library`,
          text: 'View your library',
        }),
      ]));
    }
    status.replaceChildren(...lines);
  }

  async function refresh() {
    const count = selected.size;
    submit.textContent = count ? `Scrobble ${count} track${count === 1 ? '' : 's'}` : 'Scrobble';
    submit.disabled = count === 0 || busy;

    if (!count) {
      whenText.replaceChildren(document.createTextNode('Nothing selected'));
      return;
    }
    try {
      const p = await send('preview', { parsed, selectedIds: [...selected], endedAt });
      whenText.replaceChildren(
        document.createTextNode('Plays as '),
        el('b', { text: `${clockTime(p.startsAt)} → ${clockTime(p.endsAt)}` }),
        document.createTextNode(` · ${formatDuration(p.totalSeconds)}`),
      );
      if (p.warnings.length) {
        status.hidden = false;
        status.setAttribute('data-kind', 'warn');
        status.replaceChildren(el('ul', {}, p.warnings.map((w) => el('li', { text: w }))));
      }
    } catch {
      whenText.replaceChildren(document.createTextNode(''));
    }
  }

  // `note` is null when nothing needed estimating — replaceChildren would turn that into a
  // literal "null" text node, so drop empties first.
  const parts = [head, bar, note, list, el('div', { class: 'sd-foot' }, [when, submit]), status];
  container.replaceChildren(...parts.filter(Boolean));
  refresh();
}

// Standalone mode: picker.html?release=123, loaded inside the on-page overlay.
if (document.body?.dataset.standalone === 'picker') {
  const params = new URLSearchParams(location.search);
  const isMaster = params.has('master');
  const id = params.get('master') ?? params.get('release');
  const post = (action, extra) => window.parent?.postMessage({ source: 'scroble-discogs', action, ...extra }, '*');

  // Sent immediately. The content script uses this to tell "loaded" apart from "the page's
  // CSP refused to frame us", and falls back to a real window if it never arrives.
  post('ready');

  const root = document.getElementById('root');
  new ResizeObserver(() => post('resize', { height: root.scrollHeight })).observe(root);

  renderPicker(root, { id, type: isMaster ? 'master' : 'release', onClose: () => post('close') });
}

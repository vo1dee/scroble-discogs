import { send } from '../lib/messaging.js';
import { renderPicker } from '../picker/picker.js';
import { parseReleaseInput } from '../lib/discogs.js';

const $ = (sel) => document.querySelector(sel);

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

const message = (container, text, kind = 'warn') =>
  container.replaceChildren(el('div', { class: 'sd-status', 'data-kind': kind, text }));

// ---- tabs ----

const collectionLoaded = { done: false };

function selectTab(name) {
  for (const btn of document.querySelectorAll('.sd-tab[data-tab]')) {
    btn.setAttribute('aria-selected', String(btn.dataset.tab === name));
  }
  for (const pane of document.querySelectorAll('.sd-pane')) {
    pane.hidden = pane.dataset.pane !== name;
  }
  if (name === 'collection' && !collectionLoaded.done) loadCollection();
  if (name === 'recent') loadRecent();
}

$('#tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.sd-tab[data-tab]');
  if (tab) selectTab(tab.dataset.tab);
});
$('#settings').addEventListener('click', () => send('openOptions'));

// ---- picker view ----

function openPicker(id, type = 'release') {
  $('#app').hidden = true;
  $('#picker').hidden = false;
  renderPicker($('#picker-root'), { id, type });
}

$('#back').addEventListener('click', () => {
  $('#picker').hidden = true;
  $('#app').hidden = false;
  $('#picker-root').replaceChildren();
});

function resultButton({ id, type = 'release', thumb, title, meta }) {
  return el('button', { class: 'sd-result', onclick: () => openPicker(id, type) }, [
    thumb ? el('img', { src: thumb, alt: '' }) : el('span', { class: 'sd-ph' }),
    el('span', { class: 'sd-result-body' }, [
      el('span', { class: 'sd-result-title', text: title }),
      meta ? el('span', { class: 'sd-result-meta', text: meta }) : null,
    ]),
  ]);
}

// ---- search ----

$('#search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = $('#search-input').value.trim();
  if (!query) return;
  const out = $('#search-results');
  message(out, 'Searching Discogs…');
  try {
    const results = await send('search', { query });
    if (!results.length) return message(out, 'Nothing found.');
    out.replaceChildren(...results.map((r) =>
      resultButton({
        id: r.id,
        type: r.type === 'master' ? 'master' : 'release',
        thumb: r.thumb,
        title: r.title,
        meta: [r.year, r.format, r.country].filter(Boolean).join(' · '),
      })
    ));
  } catch (err) {
    message(out, err.message, 'err');
  }
});

// ---- collection ----

async function loadCollection() {
  const out = $('#collection-results');
  message(out, 'Loading your collection…');
  try {
    const { items } = await send('collection', { page: 1 });
    collectionLoaded.done = true;
    if (!items.length) return message(out, 'Your collection is empty, or it is private and needs a Discogs token.');
    out.replaceChildren(...items.map((r) =>
      resultButton({
        id: r.id,
        thumb: r.thumb,
        title: `${r.artist} – ${r.title}`,
        meta: [r.year, r.format].filter(Boolean).join(' · '),
      })
    ));
  } catch (err) {
    out.replaceChildren(
      el('div', { class: 'sd-status', 'data-kind': 'err' }, [
        el('span', { text: err.message + ' ' }),
        el('a', { class: 'sd-link', href: '#', text: 'Open settings', onclick: (e) => { e.preventDefault(); send('openOptions'); } }),
      ])
    );
  }
}

// ---- paste ----

$('#paste-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const parsed = parseReleaseInput($('#paste-input').value);
  if (!parsed) {
    $('#paste-input').setCustomValidity('Not a Discogs release URL or id');
    $('#paste-input').reportValidity();
    setTimeout(() => $('#paste-input').setCustomValidity(''), 2000);
    return;
  }
  openPicker(parsed.id, parsed.type);
});

// ---- recent ----

async function loadRecent() {
  const out = $('#recent-results');
  const log = await send('getLog');
  if (!log.length) return message(out, 'Nothing scrobbled yet.');
  out.replaceChildren(...log.map((entry) => {
    const when = new Date(entry.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const detail = entry.dryRun
      ? `${entry.count} prepared (dry run)`
      : `${entry.accepted} scrobbled${entry.ignored ? `, ${entry.ignored} ignored` : ''}`;
    return resultButton({
      id: entry.releaseId,
      title: `${entry.albumArtist} – ${entry.album}`,
      meta: `${when} · ${detail}`,
    });
  }));
}

// ---- first-run notice ----

(async function init() {
  try {
    const s = await send('getSettings');
    if (!s.lastfmApiKey || !s.hasSecret || !s.lastfmSession) {
      const notice = $('#notice');
      notice.hidden = false;
      notice.replaceChildren(
        el('span', { text: 'Last.fm is not connected yet. ' }),
        el('a', { href: '#', text: 'Set it up', onclick: (e) => { e.preventDefault(); send('openOptions'); } }),
      );
    }
  } catch { /* background not ready; the picker will report it if it matters */ }
})();

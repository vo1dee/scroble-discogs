import { send } from '../lib/messaging.js';

const $ = (id) => document.getElementById(id);

const show = (node, text, kind) => {
  node.hidden = false;
  node.textContent = text;
  node.className = `status${kind ? ` ${kind}` : ''}`;
};

let flashTimer;
function flashSaved() {
  const el = $('saved');
  el.hidden = false;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { el.hidden = true; }, 1500);
}

// ---- load ----

async function load() {
  const s = await send('getSettings');

  $('apiKey').value = s.lastfmApiKey || '';
  // The secret is never sent back to the page. Show a placeholder when one is stored so it
  // is clear something is set, and only write it back if the user types a new value.
  $('secret').value = '';
  $('secret').placeholder = s.hasSecret ? '•••••••• (stored)' : '';

  $('discogsToken').value = s.discogsToken || '';
  $('discogsUser').value = s.discogsUser || '';
  $('fallbackDuration').value = s.fallbackDuration;
  $('expandSubTracks').checked = s.expandSubTracks;
  $('useAnv').checked = s.useAnv;
  $('dryRun').checked = s.dryRun;

  const connected = Boolean(s.lastfmSession);
  $('connected').hidden = !connected;
  $('disconnected').hidden = connected;
  $('userName').textContent = s.lastfmUser || '';
}

// ---- credentials ----

$('saveKeys').addEventListener('click', async () => {
  const patch = { lastfmApiKey: $('apiKey').value.trim() };
  const secret = $('secret').value.trim();
  if (secret) patch.lastfmSecret = secret;

  if (!patch.lastfmApiKey) return show($('keysStatus'), 'An API key is required.', 'err');
  await send('saveSettings', { patch });
  $('secret').value = '';
  await load();
  show($('keysStatus'), 'Credentials saved. Now connect your account below.', 'ok');
});

// ---- auth ----

$('connect').addEventListener('click', async () => {
  const status = $('authStatus');
  try {
    await send('lastfmConnect');
    $('finish').hidden = false;
    show(status, 'Approve the request in the tab that just opened, then click the finish button.');
    // Last.fm gives no callback in this flow, so poll quietly for a couple of minutes and let
    // the user click through if they get there first.
    poll(status);
  } catch (err) {
    show(status, err.message, 'err');
  }
});

$('finish').addEventListener('click', () => finish($('authStatus')));

let polling = false;
async function poll(status) {
  if (polling) return;
  polling = true;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const { user } = await send('lastfmFinish');
      polling = false;
      await load();
      show(status, `Connected as ${user}.`, 'ok');
      return;
    } catch {
      // Not approved yet — keep waiting.
    }
  }
  polling = false;
}

async function finish(status) {
  try {
    const { user } = await send('lastfmFinish');
    polling = false;
    await load();
    show(status, `Connected as ${user}.`, 'ok');
  } catch (err) {
    show(status, `${err.message} — approve the request on Last.fm first, then try again.`, 'err');
  }
}

$('disconnect').addEventListener('click', async () => {
  await send('lastfmDisconnect');
  await load();
});

// ---- preferences (save as you change them) ----

const autosave = {
  discogsToken: (v) => ({ discogsToken: v.trim() }),
  discogsUser: (v) => ({ discogsUser: v.trim() }),
  fallbackDuration: (v) => ({ fallbackDuration: Math.min(1800, Math.max(30, Number(v) || 240)) }),
};

for (const [id, toPatch] of Object.entries(autosave)) {
  $(id).addEventListener('change', async (e) => {
    await send('saveSettings', { patch: toPatch(e.target.value) });
    flashSaved();
  });
}

for (const id of ['expandSubTracks', 'useAnv', 'dryRun']) {
  $(id).addEventListener('change', async (e) => {
    await send('saveSettings', { patch: { [id]: e.target.checked } });
    flashSaved();
  });
}

load();

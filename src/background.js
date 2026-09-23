// Event page. All network and every secret live here.
//
// The content script runs inside discogs.com, so it must never see the Last.fm shared secret
// or session key. It sends a release id and gets back rendered data; nothing more.

import * as discogs from './lib/discogs.js';
import * as lastfm from './lib/lastfm.js';
import { parseRelease, buildScrobbles } from './lib/tracklist.js';
import { getSettings, setSettings, appendLog, getLog } from './lib/settings.js';

const api = globalThis.browser ?? globalThis.chrome;

// Pending Last.fm auth token, held between "connect" and "finish".
let pendingToken = null;

const handlers = {
  async getSettings() {
    const s = await getSettings();
    // Never hand the secret back out to a UI surface; only whether one is set.
    const { lastfmSecret, ...safe } = s;
    return { ...safe, hasSecret: Boolean(lastfmSecret) };
  },

  async saveSettings({ patch }) {
    await setSettings(patch);
    return handlers.getSettings();
  },

  // ---- Last.fm auth ----

  async lastfmConnect() {
    const { lastfmApiKey, lastfmSecret } = await getSettings();
    if (!lastfmApiKey || !lastfmSecret) throw new Error('Add your Last.fm API key and shared secret first.');
    pendingToken = await lastfm.getToken({ apiKey: lastfmApiKey, secret: lastfmSecret });
    const url = lastfm.authUrl(lastfmApiKey, pendingToken);
    await api.tabs.create({ url });
    return { ok: true };
  },

  async lastfmFinish() {
    const { lastfmApiKey, lastfmSecret } = await getSettings();
    if (!pendingToken) throw new Error('Start the connection first.');
    const session = await lastfm.getSession({ apiKey: lastfmApiKey, secret: lastfmSecret, token: pendingToken });
    pendingToken = null;
    await setSettings({ lastfmSession: session.key, lastfmUser: session.name });
    return { user: session.name };
  },

  async lastfmDisconnect() {
    await setSettings({ lastfmSession: '', lastfmUser: '' });
    return { ok: true };
  },

  // ---- Discogs ----

  async loadRelease({ id, type = 'release' }) {
    const s = await getSettings();
    const raw = type === 'master'
      ? await discogs.getMaster(id, { token: s.discogsToken })
      : await discogs.getRelease(id, { token: s.discogsToken });
    return parseRelease(raw, {
      expandSubTracks: s.expandSubTracks,
      useAnv: s.useAnv,
      fallbackDuration: s.fallbackDuration,
    });
  },

  async search({ query }) {
    const s = await getSettings();
    return discogs.search(query, { token: s.discogsToken });
  },

  async collection({ page = 1 }) {
    const s = await getSettings();
    let user = s.discogsUser;
    if (!user && s.discogsToken) {
      user = await discogs.identity({ token: s.discogsToken });
      await setSettings({ discogsUser: user });
    }
    if (!user) throw new Error('Set your Discogs username in options (or add a token).');
    return discogs.getCollection(user, { token: s.discogsToken, page });
  },

  // ---- scrobbling ----

  async preview({ parsed, selectedIds, endedAt }) {
    return buildScrobbles(parsed, { selectedIds, endedAt });
  },

  async submit({ parsed, selectedIds, endedAt }) {
    const s = await getSettings();
    if (!s.lastfmApiKey || !s.lastfmSecret) throw new Error('Last.fm API key and secret are not set.');
    if (!s.lastfmSession) throw new Error('Connect your Last.fm account first.');

    const { scrobbles, warnings, startsAt, endsAt, totalSeconds } =
      buildScrobbles(parsed, { selectedIds, endedAt });
    if (!scrobbles.length) throw new Error('No tracks selected.');

    const result = await lastfm.scrobble(scrobbles, {
      apiKey: s.lastfmApiKey,
      secret: s.lastfmSecret,
      session: s.lastfmSession,
      dryRun: s.dryRun,
    });

    await appendLog({
      album: parsed.album,
      albumArtist: parsed.albumArtist,
      releaseId: parsed.id,
      url: parsed.url,
      count: scrobbles.length,
      accepted: result.accepted,
      ignored: result.ignored,
      dryRun: result.dryRun,
      startsAt,
      endsAt,
    });

    if (result.dryRun) {
      // Surface the exact signed payload so it can be inspected before going live.
      console.log('[scroble-discogs] DRY RUN — payload not sent:', result.payloads);
    }

    return { ...result, warnings, totalSeconds, startsAt, endsAt, user: s.lastfmUser };
  },

  async getLog() {
    return getLog();
  },

  /** Fallback when a page's CSP refuses to frame the picker overlay. */
  async openPickerWindow({ id, type = 'release' }) {
    const url = api.runtime.getURL('src/picker/picker.html') +
      `?${type === 'master' ? 'master' : 'release'}=${encodeURIComponent(id)}`;
    await api.windows.create({ url, type: 'popup', width: 460, height: 700 });
    return { ok: true };
  },

  async openOptions() {
    await api.runtime.openOptionsPage();
    return { ok: true };
  },
};

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = handlers[msg?.type];
  if (!handler) return false;
  handler(msg.payload ?? {})
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
  return true; // keep the channel open for the async reply
});

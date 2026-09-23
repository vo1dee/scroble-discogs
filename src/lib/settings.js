// Thin wrapper over browser.storage.local with defaults in one place.

export const DEFAULTS = {
  lastfmApiKey: '',
  lastfmSecret: '',
  lastfmSession: '',      // session key ("sk"), infinite lifetime
  lastfmUser: '',
  discogsToken: '',       // optional: private collections + 60 req/min instead of 25
  discogsUser: '',
  fallbackDuration: 240,  // seconds, used only when a release has no durations at all
  expandSubTracks: true,  // scrobble movements of a multi-part work individually
  useAnv: false,          // prefer each artist's canonical name over the per-release variation
  dryRun: false,          // sign and log the payload, but don't POST
};

const api = globalThis.browser ?? globalThis.chrome;

export async function getSettings() {
  const stored = await api.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored };
}

export async function setSettings(patch) {
  await api.storage.local.set(patch);
  return getSettings();
}

// Local log of what we submitted. Last.fm has no delete-scrobble API, so this is the only
// record of what went out — it exists so a mistake can be found and removed by hand.
const LOG_KEY = 'scrobbleLog';
const LOG_MAX = 50;

export async function appendLog(entry) {
  const { [LOG_KEY]: log = [] } = await api.storage.local.get(LOG_KEY);
  log.unshift({ at: Date.now(), ...entry });
  await api.storage.local.set({ [LOG_KEY]: log.slice(0, LOG_MAX) });
}

export async function getLog() {
  const { [LOG_KEY]: log = [] } = await api.storage.local.get(LOG_KEY);
  return log;
}

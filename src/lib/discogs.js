// Discogs API client.
//
// Note we never touch discogs.com HTML — it sits behind Cloudflare and the markup's class
// names are hashed and unstable. api.discogs.com is open, CORS-friendly, and authoritative.

const BASE = 'https://api.discogs.com';

// Unauthenticated: 25 requests/minute. With a personal access token: 60.
// Spacing requests keeps us clear of both without needing a token.
const MIN_GAP_MS = 1100;
let lastRequestAt = 0;
let queue = Promise.resolve();

const api = globalThis.browser ?? globalThis.chrome;

class DiscogsError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'DiscogsError';
    this.status = status;
  }
}

/** Serialize requests with a minimum gap, so bursts can't trip the rate limit. */
function throttle(fn) {
  queue = queue.then(async () => {
    const wait = MIN_GAP_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
    return fn();
  });
  return queue;
}

async function request(path, { token } = {}) {
  return throttle(async () => {
    const headers = { Accept: 'application/json' };
    // User-Agent is a forbidden header in fetch, so the browser's own UA is sent.
    // Discogs accepts that, so there is nothing to work around here.
    if (token) headers.Authorization = `Discogs token=${token}`;

    const res = await fetch(`${BASE}${path}`, { headers });

    if (res.status === 429) throw new DiscogsError('Discogs rate limit hit — wait a minute and retry.', 429);
    if (res.status === 404) throw new DiscogsError('Not found on Discogs.', 404);
    if (res.status === 401) throw new DiscogsError('Discogs rejected the token.', 401);

    const json = await res.json().catch(() => null);
    if (!res.ok) throw new DiscogsError(json?.message || `Discogs HTTP ${res.status}`, res.status);
    return json;
  });
}

// ---- release cache ----
// Releases are effectively immutable, and the same record gets scrobbled repeatedly.

const CACHE_KEY = 'releaseCache';
const CACHE_MAX = 40;

async function cacheGet(id) {
  const { [CACHE_KEY]: cache = {} } = await api.storage.local.get(CACHE_KEY);
  return cache[id]?.data ?? null;
}

async function cachePut(id, data) {
  const { [CACHE_KEY]: cache = {} } = await api.storage.local.get(CACHE_KEY);
  cache[id] = { at: Date.now(), data };
  const entries = Object.entries(cache).sort((a, b) => b[1].at - a[1].at).slice(0, CACHE_MAX);
  await api.storage.local.set({ [CACHE_KEY]: Object.fromEntries(entries) });
}

export async function getRelease(id, { token, fresh = false } = {}) {
  if (!fresh) {
    const hit = await cacheGet(id);
    if (hit) return hit;
  }
  const data = await request(`/releases/${encodeURIComponent(id)}`, { token });
  await cachePut(id, data);
  return data;
}

/** A master is an abstract work; scrobbling needs a concrete pressing, so resolve to main_release. */
export async function getMaster(id, { token } = {}) {
  const master = await request(`/masters/${encodeURIComponent(id)}`, { token });
  if (!master?.main_release) throw new DiscogsError('That master has no main release.', 404);
  return getRelease(master.main_release, { token });
}

export async function search(query, { token, page = 1 } = {}) {
  const params = new URLSearchParams({
    q: query, type: 'release', per_page: '25', page: String(page),
  });
  const json = await request(`/database/search?${params}`, { token });
  return (json.results ?? []).map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,              // Discogs returns "Artist - Album" here
    year: r.year || '',
    thumb: r.thumb || '',
    format: (r.format ?? []).join(', '),
    country: r.country || '',
  }));
}

export async function getCollection(username, { token, page = 1, folder = 0 } = {}) {
  const params = new URLSearchParams({
    per_page: '50', page: String(page), sort: 'added', sort_order: 'desc',
  });
  const json = await request(
    `/users/${encodeURIComponent(username)}/collection/folders/${folder}/releases?${params}`,
    { token }
  );
  return {
    pagination: json.pagination,
    items: (json.releases ?? []).map((r) => ({
      id: r.id,
      title: r.basic_information?.title ?? '',
      artist: (r.basic_information?.artists ?? []).map((a) => a.name).join(', '),
      year: r.basic_information?.year || '',
      thumb: r.basic_information?.thumb || '',
      format: (r.basic_information?.formats ?? []).map((f) => f.name).join(', '),
    })),
  };
}

/** Resolve the username behind a personal access token. */
export async function identity({ token }) {
  const json = await request('/oauth/identity', { token });
  return json.username;
}

/**
 * Pull a release id out of whatever the user pasted: a full URL (including localized paths
 * like /fr/release/123), a [r123] marker, or a bare number.
 */
export function parseReleaseInput(input) {
  const str = String(input ?? '').trim();
  if (!str) return null;

  const url = str.match(/discogs\.com\/(?:[a-z]{2}(?:_[A-Z]{2})?\/)?(release|master)\/(\d+)/i);
  if (url) return { type: url[1].toLowerCase(), id: url[2] };

  const marker = str.match(/^\[?([rm])(\d+)\]?$/i);
  if (marker) return { type: marker[1].toLowerCase() === 'm' ? 'master' : 'release', id: marker[2] };

  if (/^\d+$/.test(str)) return { type: 'release', id: str };
  return null;
}

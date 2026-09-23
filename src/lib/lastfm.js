// Last.fm API client: request signing, the desktop auth flow, and batch scrobbling.

import { md5 } from './md5.js';

const ENDPOINT = 'https://ws.audioscrobbler.com/2.0/';
export const MAX_BATCH = 50;               // track.scrobble accepts at most 50 per call

/**
 * Build the api_sig: sort params by ASCII key order, concatenate key+value with no
 * separators, append the shared secret, MD5 the UTF-8 bytes.
 *
 * `format` and `callback` are excluded from the signature — including them is the single
 * most common cause of "Invalid method signature supplied".
 */
export function signParams(params, secret) {
  const keys = Object.keys(params)
    .filter((k) => k !== 'format' && k !== 'callback' && k !== 'api_sig')
    .filter((k) => params[k] !== undefined && params[k] !== null)
    .sort();
  let base = '';
  for (const k of keys) base += k + params[k];
  return md5(base + secret);
}

class LastfmError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'LastfmError';
    this.code = code;
  }
}

async function call(method, params, { apiKey, secret, post = false }) {
  const full = { ...params, method, api_key: apiKey };
  full.api_sig = signParams(full, secret);
  full.format = 'json'; // added after signing, never part of the signature

  const body = new URLSearchParams(full);
  const res = post
    ? await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body,
      })
    : await fetch(`${ENDPOINT}?${body}`);

  let json;
  try {
    json = await res.json();
  } catch {
    throw new LastfmError(`Last.fm returned a non-JSON response (HTTP ${res.status})`);
  }
  if (json.error) throw new LastfmError(json.message || `Last.fm error ${json.error}`, json.error);
  if (!res.ok) throw new LastfmError(`Last.fm HTTP ${res.status}`);
  return json;
}

// ---- auth (token flow; needs no registered callback URL) ----

export async function getToken({ apiKey, secret }) {
  const json = await call('auth.getToken', {}, { apiKey, secret });
  return json.token;
}

export function authUrl(apiKey, token) {
  return `https://www.last.fm/api/auth/?api_key=${encodeURIComponent(apiKey)}&token=${encodeURIComponent(token)}`;
}

export async function getSession({ apiKey, secret, token }) {
  const json = await call('auth.getSession', { token }, { apiKey, secret });
  return { key: json.session.key, name: json.session.name };
}

// ---- scrobbling ----

/**
 * Last.fm's JSON collapses a single-element list into a bare object. Normalize so callers
 * can always treat it as an array.
 */
function asArray(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Flatten one batch of scrobbles into artist[0], track[0], timestamp[0], ... */
export function buildScrobbleParams(batch) {
  const params = {};
  batch.forEach((s, i) => {
    params[`artist[${i}]`] = s.artist;
    params[`track[${i}]`] = s.track;
    params[`timestamp[${i}]`] = String(s.timestamp);
    if (s.album) params[`album[${i}]`] = s.album;
    if (s.albumArtist && s.albumArtist !== s.artist) params[`albumArtist[${i}]`] = s.albumArtist;
    if (s.trackNumber) params[`trackNumber[${i}]`] = String(s.trackNumber);
    if (s.duration) params[`duration[${i}]`] = String(s.duration);
  });
  return params;
}

export function chunk(list, size = MAX_BATCH) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * Submit scrobbles, chunked to 50 per request.
 * With dryRun, the payload is signed and returned but never sent.
 */
export async function scrobble(scrobbles, { apiKey, secret, session, dryRun = false }) {
  const batches = chunk(scrobbles);
  const result = { accepted: 0, ignored: 0, results: [], dryRun, payloads: [] };

  for (const batch of batches) {
    const params = { ...buildScrobbleParams(batch), sk: session };

    if (dryRun) {
      const signed = { ...params, method: 'track.scrobble', api_key: apiKey };
      signed.api_sig = signParams(signed, secret);
      result.payloads.push(signed);
      result.accepted += batch.length;
      result.results.push(
        ...batch.map((s) => ({ ...s, status: 'dry-run' }))
      );
      continue;
    }

    const json = await call('track.scrobble', params, { apiKey, secret, post: true });
    const attr = json.scrobbles?.['@attr'] ?? {};
    result.accepted += Number(attr.accepted ?? 0);
    result.ignored += Number(attr.ignored ?? 0);

    asArray(json.scrobbles?.scrobble).forEach((s, i) => {
      const code = Number(s.ignoredMessage?.code ?? 0);
      result.results.push({
        artist: s.artist?.['#text'] ?? batch[i]?.artist,
        track: s.track?.['#text'] ?? batch[i]?.track,
        timestamp: Number(s.timestamp ?? batch[i]?.timestamp),
        // Last.fm sets corrected=1 when it remapped the name to its canonical spelling
        corrected: s.artist?.corrected === '1' || s.track?.corrected === '1',
        status: code ? 'ignored' : 'accepted',
        reason: code ? (s.ignoredMessage?.['#text'] || IGNORE_REASONS[code] || `code ${code}`) : null,
      });
    });
  }

  return result;
}

export const IGNORE_REASONS = {
  1: 'Artist was ignored',
  2: 'Track was ignored',
  3: 'Timestamp too far in the past',
  4: 'Timestamp too far in the future',
  5: 'Daily scrobble limit exceeded',
};

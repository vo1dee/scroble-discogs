// Turns a Discogs release into Last.fm scrobbles.
//
// This is where the awkwardness lives. Discogs tracklists are a user-maintained database of
// physical objects, not a clean media catalogue: durations are frequently absent, artist
// credits carry internal disambiguation numbers, multi-part works nest, and vinyl positions
// encode sides rather than track numbers.

export const BACKDATE_LIMIT_DAYS = 14;    // Last.fm rejects older timestamps (ignore code 3)
const LASTFM_MIN_TRACK_SECONDS = 30; // Last.fm silently drops anything shorter

/**
 * Discogs appends a disambiguation number when two artists share a name:
 * "Vibe Tribe (2)", "Nirvana (2)". That suffix is internal to Discogs — leaving it on
 * means Last.fm files the play under an artist that doesn't exist there.
 */
export function cleanArtistName(name) {
  return String(name ?? '').replace(/\s*\(\d+\)\s*$/, '').trim();
}

/**
 * Join Discogs artist credits. Each entry's `join` is the separator that connects it to the
 * NEXT artist: [{name:"Alien vs. The Cat", join:"Vs."}, {name:"Shanti"}] → "Alien vs. The Cat Vs. Shanti"
 */
export function formatArtists(artists, { useAnv = false } = {}) {
  const list = (artists ?? []).filter(Boolean);
  if (!list.length) return '';

  let out = '';
  list.forEach((a, i) => {
    const raw = useAnv && a.anv ? a.anv : a.name;
    out += cleanArtistName(raw);
    if (i === list.length - 1) return;
    const join = String(a.join ?? '').trim();
    if (!join) out += ', ';
    else if (join === ',') out += ', ';
    else out += ` ${join} `;
  });
  return out.replace(/\s+/g, ' ').trim();
}

/** "3:32" → 212, "1:02:33" → 3753, "" → null */
export function parseDuration(value) {
  const str = String(value ?? '').trim();
  if (!str) return null;
  const parts = str.split(':').map((p) => p.trim());
  if (!parts.every((p) => /^\d+$/.test(p))) return null;
  const nums = parts.map(Number);
  let seconds = 0;
  for (const n of nums) seconds = seconds * 60 + n;
  return seconds > 0 ? seconds : null;
}

export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * Vinyl positions encode the side: "A1" → A, "B" → B, "AA" → AA (12" singles).
 * CD-style positions ("1", "1-1") have no side, so callers hide the side shortcuts.
 */
export function sideOf(position) {
  const p = String(position ?? '').trim();
  if (!p) return null;
  const m = p.match(/^([A-Za-z]{1,3})[\s\-._]*\d*[a-z]?$/);
  return m ? m[1].toUpperCase() : null;
}

/**
 * Walk the tracklist into a flat list of playable tracks.
 * - "heading" entries are section titles, not music — skipped.
 * - "index" entries are multi-part works whose movements live in sub_tracks. Expanded by
 *   default, since scrobbling four movements matches what actually played better than one
 *   entry for the whole work.
 * Ids are positional paths ("3", "3.1") so they stay unique even when a release lists the
 * same position twice, which happens in real Discogs data.
 */
export function flattenTracklist(tracklist, { expandSubTracks = true } = {}) {
  const out = [];

  const walk = (entries, prefix) => {
    (entries ?? []).forEach((entry, i) => {
      const id = prefix ? `${prefix}.${i}` : String(i);
      const type = entry.type_ ?? 'track';
      if (type === 'heading') return;

      const subs = entry.sub_tracks ?? [];
      if (subs.length) {
        if (expandSubTracks) walk(subs, id);
        else out.push({ ...entry, __id: id });
        return;
      }

      // An "index" with nothing beneath it is a section label, not a track.
      if (type === 'index') return;
      out.push({ ...entry, __id: id });
    });
  };

  walk(tracklist, '');
  return out;
}

/**
 * Normalize a Discogs release into everything the UI and the scrobbler need.
 * Durations missing from Discogs are estimated: first from the average of the durations this
 * release does carry, and only if it has none at all from the configured fallback.
 */
export function parseRelease(release, { expandSubTracks = true, useAnv = false, fallbackDuration = 240 } = {}) {
  const raw = flattenTracklist(release?.tracklist, { expandSubTracks });

  const releaseArtists = release?.artists ?? [];
  let albumArtist = formatArtists(releaseArtists, { useAnv });
  // Discogs files compilations under the literal "Various"; Last.fm's canonical name differs.
  if (/^various$/i.test(albumArtist)) albumArtist = 'Various Artists';

  const known = raw.map((t) => parseDuration(t.duration)).filter((d) => d !== null);
  const average = known.length ? Math.round(known.reduce((a, b) => a + b, 0) / known.length) : null;
  const estimate = average ?? fallbackDuration;

  const tracks = raw.map((t, index) => {
    const parsed = parseDuration(t.duration);
    const trackArtist = (t.artists ?? []).length
      ? formatArtists(t.artists, { useAnv })
      : albumArtist;
    return {
      id: t.__id,
      position: String(t.position ?? '').trim(),
      side: sideOf(t.position),
      title: String(t.title ?? '').trim(),
      artist: trackArtist,
      trackNumber: index + 1,
      duration: parsed ?? estimate,
      durationEstimated: parsed === null,
    };
  });

  const sides = [...new Set(tracks.map((t) => t.side).filter(Boolean))];

  return {
    id: release?.id,
    album: String(release?.title ?? '').trim(),
    albumArtist,
    year: release?.year || null,
    format: (release?.formats ?? []).map((f) => [f.name, ...(f.descriptions ?? [])].join(', ')).join(' / '),
    thumb: release?.thumb || release?.images?.[0]?.uri150 || '',
    url: release?.uri || (release?.id ? `https://www.discogs.com/release/${release.id}` : ''),
    tracks,
    sides,
    estimatedCount: tracks.filter((t) => t.durationEstimated).length,
    estimateSeconds: estimate,
    estimateSource: average !== null ? 'release-average' : 'default',
  };
}

/**
 * Lay the selected tracks out so the last one ends at `endedAt` — the "I just took the record
 * off" model. Last.fm wants the time each track STARTED, so we walk forward from the
 * computed start of the run.
 */
export function buildScrobbles(parsed, {
  selectedIds = null,
  endedAt = Math.floor(Date.now() / 1000),
  now = Math.floor(Date.now() / 1000),
} = {}) {
  const warnings = [];
  const selected = selectedIds
    ? parsed.tracks.filter((t) => selectedIds.includes(t.id))
    : parsed.tracks.slice();

  if (!selected.length) return { scrobbles: [], totalSeconds: 0, warnings: ['Nothing selected.'], startsAt: null, endsAt: null };

  let end = Math.floor(endedAt);
  if (end > now) {
    end = now; // can't have finished listening in the future
    warnings.push('End time was in the future; using now instead.');
  }

  const totalSeconds = selected.reduce((sum, t) => sum + t.duration, 0);
  const start = end - totalSeconds;

  const oldestAllowed = now - BACKDATE_LIMIT_DAYS * 86400;
  if (start < oldestAllowed) {
    warnings.push(
      `Some tracks fall outside Last.fm's ${BACKDATE_LIMIT_DAYS}-day backdating window and will be rejected.`
    );
  }

  const tooShort = selected.filter((t) => t.duration < LASTFM_MIN_TRACK_SECONDS);
  if (tooShort.length) {
    warnings.push(
      `${tooShort.length} track${tooShort.length > 1 ? 's are' : ' is'} under 30 seconds; Last.fm ignores those.`
    );
  }

  let cursor = start;
  const scrobbles = selected.map((t) => {
    const s = {
      artist: t.artist,
      track: t.title,
      album: parsed.album,
      albumArtist: parsed.albumArtist,
      trackNumber: t.trackNumber,
      duration: t.duration,
      timestamp: cursor,
    };
    cursor += t.duration;
    return s;
  });

  return { scrobbles, totalSeconds, warnings, startsAt: start, endsAt: end };
}

// Run: node --test test/tracklist.test.mjs
// Fixtures are real Discogs API responses, chosen for the cases that actually break things.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  parseRelease, buildScrobbles, parseDuration, formatDuration,
  cleanArtistName, formatArtists, sideOf, flattenTracklist, BACKDATE_LIMIT_DAYS,
} from '../src/lib/tracklist.js';
import { signParams, buildScrobbleParams, chunk, MAX_BATCH } from '../src/lib/lastfm.js';
import { md5 } from '../src/lib/md5.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => JSON.parse(readFileSync(join(here, 'fixtures', name), 'utf8'));

const RICK = fixture('249504-rick-astley-7inch.json');
const VARIOUS = fixture('1873573-various-no-durations.json');
const DUPES = fixture('2116114-duplicate-positions.json');
const CYRILLIC = fixture('8339427-cyrillic.json');
const JOINS = fixture('1728127-multi-artist-joins.json');
const BIG = fixture('1487689-34-tracks.json');

// ---------- helpers ----------

test('parseDuration handles the shapes Discogs emits', () => {
  assert.equal(parseDuration('3:32'), 212);
  assert.equal(parseDuration('1:02:33'), 3753);
  assert.equal(parseDuration('0:45'), 45);
  assert.equal(parseDuration(''), null);
  assert.equal(parseDuration(null), null);
  assert.equal(parseDuration(undefined), null);
  assert.equal(parseDuration('  4:10 '), 250);
  assert.equal(parseDuration('unknown'), null);
  assert.equal(parseDuration('0:00'), null);
});

test('formatDuration round-trips', () => {
  assert.equal(formatDuration(212), '3:32');
  assert.equal(formatDuration(3753), '1:02:33');
  assert.equal(formatDuration(45), '0:45');
});

test('cleanArtistName strips the Discogs disambiguation number only', () => {
  assert.equal(cleanArtistName('Vibe Tribe (2)'), 'Vibe Tribe');
  assert.equal(cleanArtistName('Nirvana (2)'), 'Nirvana');
  // must NOT eat legitimate parenthetical names
  assert.equal(cleanArtistName('Sunn O)))'), 'Sunn O)))');
  assert.equal(cleanArtistName('!!!'), '!!!');
  assert.equal(cleanArtistName('Ozric Tentacles'), 'Ozric Tentacles');
});

test('sideOf reads vinyl sides and ignores CD-style positions', () => {
  assert.equal(sideOf('A1'), 'A');
  assert.equal(sideOf('A'), 'A');
  assert.equal(sideOf('B12'), 'B');
  assert.equal(sideOf('AA'), 'AA');
  assert.equal(sideOf('C-3'), 'C');
  assert.equal(sideOf('D.2'), 'D');
  assert.equal(sideOf('1'), null);
  assert.equal(sideOf('1-1'), null);
  assert.equal(sideOf(''), null);
});

test('formatArtists applies Discogs join separators', () => {
  assert.equal(
    formatArtists([{ name: 'Alien vs. The Cat', join: 'Vs.' }, { name: 'Shanti', join: '' }]),
    'Alien vs. The Cat Vs. Shanti'
  );
  assert.equal(formatArtists([{ name: 'A', join: ',' }, { name: 'B' }]), 'A, B');
  assert.equal(formatArtists([{ name: 'A', join: '&' }, { name: 'B' }]), 'A & B');
  assert.equal(formatArtists([{ name: 'Solo (3)' }]), 'Solo');
  assert.equal(formatArtists([]), '');
  assert.equal(formatArtists([{ name: 'X', anv: 'Xavier' }], { useAnv: true }), 'Xavier');
  assert.equal(formatArtists([{ name: 'X', anv: 'Xavier' }], { useAnv: false }), 'X');
});

// ---------- real releases ----------

test('7" single: bare A/B positions, durations present', () => {
  const p = parseRelease(RICK);
  assert.equal(p.albumArtist, 'Rick Astley');
  assert.equal(p.tracks.length, 2);
  assert.deepEqual(p.sides, ['A', 'B']);
  assert.equal(p.tracks[0].duration, 212);
  assert.equal(p.tracks[0].durationEstimated, false);
  assert.equal(p.estimatedCount, 0);
});

test('compilation: per-track artists override the release artist', () => {
  const p = parseRelease(VARIOUS);
  // Discogs says "Various"; Last.fm files these under "Various Artists"
  assert.equal(p.albumArtist, 'Various Artists');
  assert.equal(p.tracks[0].artist, 'Mary Lou Williams');
  assert.equal(p.tracks[1].artist, 'Earl Hines');
  assert.notEqual(p.tracks[0].artist, p.albumArtist);
});

test('compilation with no durations at all falls back to the configured default', () => {
  const p = parseRelease(VARIOUS, { fallbackDuration: 240 });
  assert.equal(p.estimatedCount, p.tracks.length, 'every track should be estimated');
  assert.equal(p.estimateSource, 'default');
  assert.ok(p.tracks.every((t) => t.duration === 240));
});

test('real 2LP reissue: heading rows are dropped, real tracks kept', () => {
  assert.equal(BIG.tracklist.length, 34, 'fixture has 34 raw entries');
  assert.equal(BIG.tracklist.filter((t) => t.type_ === 'heading').length, 3);
  const p = parseRelease(BIG);
  assert.equal(p.tracks.length, 31, 'the 3 headings must not become scrobbles');
  assert.equal(p.estimatedCount, 0, 'this release carries every duration');
  assert.ok(!p.tracks.some((t) => t.title === 'Bonus Tracks'));
});

test('a release with SOME durations estimates the rest from its own average', () => {
  const partial = {
    title: 'Half Documented',
    artists: [{ name: 'Someone' }],
    tracklist: [
      { position: 'A1', type_: 'track', title: 'One', duration: '4:00' },   // 240
      { position: 'A2', type_: 'track', title: 'Two', duration: '6:00' },   // 360
      { position: 'B1', type_: 'track', title: 'Three', duration: '' },     // estimated
    ],
  };
  const p = parseRelease(partial, { fallbackDuration: 999 });
  assert.equal(p.estimateSource, 'release-average');
  assert.equal(p.estimateSeconds, 300, 'average of 240 and 360');
  assert.equal(p.estimatedCount, 1);
  assert.equal(p.tracks[2].duration, 300);
  assert.equal(p.tracks[2].durationEstimated, true);
  assert.notEqual(p.tracks[2].duration, 999, 'the default must not win when the release has data');
});

test('duplicate positions still produce unique ids', () => {
  const p = parseRelease(DUPES);
  assert.equal(p.tracks.length, 2);
  assert.equal(p.tracks[0].position, p.tracks[1].position, 'fixture really does repeat "A"');
  assert.notEqual(p.tracks[0].id, p.tracks[1].id);
  assert.equal(new Set(p.tracks.map((t) => t.id)).size, 2);
});

test('multi-artist joins and (2) disambiguation survive into scrobbles', () => {
  const p = parseRelease(JOINS);
  assert.equal(p.albumArtist, 'Vibe Tribe', 'release artist "Vibe Tribe (2)" must be cleaned');
  const joined = p.tracks.find((t) => t.title.includes('The Purist'));
  assert.equal(joined.artist, 'Alien vs. The Cat Vs. Shanti');
  assert.ok(!p.tracks.some((t) => /\(\d+\)$/.test(t.artist)), 'no artist may keep a (n) suffix');
});

test('cyrillic titles pass through intact and sign correctly', () => {
  const p = parseRelease(CYRILLIC);
  assert.equal(p.tracks[0].title, 'Ярап борка');
  const { scrobbles } = buildScrobbles(p);
  const params = buildScrobbleParams(scrobbles.slice(0, 1));
  assert.equal(params['track[0]'], 'Ярап борка');
  // signing must hash UTF-8 bytes; compare against an independently computed digest
  const sig = signParams({ ...params, method: 'track.scrobble', api_key: 'K' }, 'S');
  const keys = Object.keys({ ...params, method: 'track.scrobble', api_key: 'K' }).sort();
  let base = ''; for (const k of keys) base += k + { ...params, method: 'track.scrobble', api_key: 'K' }[k];
  assert.equal(sig, md5(base + 'S'));
  assert.match(sig, /^[0-9a-f]{32}$/);
});

// ---------- timestamps ----------

test('timestamps end exactly at endedAt and step strictly forward', () => {
  const p = parseRelease(BIG);
  const endedAt = 1_700_000_000;
  const { scrobbles, totalSeconds, startsAt, endsAt } = buildScrobbles(p, { endedAt, now: endedAt });

  assert.equal(endsAt, endedAt);
  assert.equal(startsAt, endedAt - totalSeconds);
  assert.equal(scrobbles[0].timestamp, startsAt);

  for (let i = 1; i < scrobbles.length; i++) {
    assert.ok(scrobbles[i].timestamp > scrobbles[i - 1].timestamp, `track ${i} must start after ${i - 1}`);
    assert.equal(scrobbles[i].timestamp, scrobbles[i - 1].timestamp + scrobbles[i - 1].duration);
  }
  const last = scrobbles.at(-1);
  assert.equal(last.timestamp + last.duration, endedAt, 'final track must finish exactly at endedAt');
});

test('selecting one side scrobbles only that side', () => {
  const p = parseRelease(VARIOUS);
  const sideA = p.tracks.filter((t) => t.side === 'A');
  assert.ok(sideA.length > 1);
  const { scrobbles } = buildScrobbles(p, { selectedIds: sideA.map((t) => t.id) });
  assert.equal(scrobbles.length, sideA.length);
  assert.deepEqual(scrobbles.map((s) => s.track), sideA.map((t) => t.title));
});

test('a future end time is clamped to now, with a warning', () => {
  const p = parseRelease(RICK);
  const now = 1_700_000_000;
  const { endsAt, warnings } = buildScrobbles(p, { endedAt: now + 9999, now });
  assert.equal(endsAt, now);
  assert.match(warnings.join(' '), /future/i);
});

test('backdating past the 14-day window warns', () => {
  const p = parseRelease(RICK);
  const now = 1_700_000_000;
  const { warnings } = buildScrobbles(p, { endedAt: now - (BACKDATE_LIMIT_DAYS + 1) * 86400, now });
  assert.match(warnings.join(' '), /14-day/);
});

test('empty selection is reported rather than silently submitting nothing', () => {
  const p = parseRelease(RICK);
  const { scrobbles, warnings } = buildScrobbles(p, { selectedIds: [] });
  assert.equal(scrobbles.length, 0);
  assert.match(warnings.join(' '), /Nothing selected/);
});

// ---------- batching + payload ----------

test('scrobbles chunk at Last.fm\'s 50-per-request limit', () => {
  assert.equal(MAX_BATCH, 50);
  const fake = Array.from({ length: 34 }, (_, i) => ({ artist: 'a', track: 't' + i, timestamp: i }));
  assert.equal(chunk(fake).length, 1);
  const many = Array.from({ length: 120 }, (_, i) => ({ artist: 'a', track: 't' + i, timestamp: i }));
  assert.deepEqual(chunk(many).map((c) => c.length), [50, 50, 20]);
});

test('payload uses array notation and omits a redundant albumArtist', () => {
  const p = parseRelease(RICK);
  const { scrobbles } = buildScrobbles(p);
  const params = buildScrobbleParams(scrobbles);
  assert.equal(params['artist[0]'], 'Rick Astley');
  assert.equal(params['album[0]'], 'Never Gonna Give You Up');
  assert.equal(params['trackNumber[0]'], '1');
  assert.ok(!('albumArtist[0]' in params), 'same as artist, so it should be left out');

  const v = buildScrobbles(parseRelease(VARIOUS));
  const vp = buildScrobbleParams(v.scrobbles);
  assert.equal(vp['albumArtist[0]'], 'Various Artists', 'differs from track artist, so it must be sent');
});

test('sub_tracks expand into movements, or collapse when asked', () => {
  const work = {
    title: 'Sym',
    artists: [{ name: 'Composer' }],
    tracklist: [
      { position: '', type_: 'heading', title: 'Side One' },
      {
        position: 'A', type_: 'index', title: 'Symphony No. 1', duration: '',
        sub_tracks: [
          { position: 'A1', type_: 'track', title: 'I. Allegro', duration: '8:00' },
          { position: 'A2', type_: 'track', title: 'II. Adagio', duration: '10:00' },
        ],
      },
    ],
  };
  const expanded = parseRelease(work, { expandSubTracks: true });
  assert.deepEqual(expanded.tracks.map((t) => t.title), ['I. Allegro', 'II. Adagio']);

  const collapsed = parseRelease(work, { expandSubTracks: false });
  assert.deepEqual(collapsed.tracks.map((t) => t.title), ['Symphony No. 1']);

  // headings are never scrobbled either way
  assert.ok(!expanded.tracks.some((t) => t.title === 'Side One'));
  assert.ok(!collapsed.tracks.some((t) => t.title === 'Side One'));
});

test('flattenTracklist drops headings and childless index entries', () => {
  const list = [
    { type_: 'heading', title: 'Part One' },
    { type_: 'index', title: 'Orphan index', sub_tracks: [] },
    { type_: 'track', title: 'Real', position: 'A1' },
  ];
  const flat = flattenTracklist(list);
  assert.equal(flat.length, 1);
  assert.equal(flat[0].title, 'Real');
});

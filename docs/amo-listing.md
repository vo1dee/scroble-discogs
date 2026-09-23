# AMO listing copy

Paste-ready values for the submission form at
<https://addons.mozilla.org/developers/addon/submit/>. Field-by-field guidance is in
[PUBLISHING.md](../PUBLISHING.md).

---

## Name

```
Scroble Discogs
```

## Add-on URL slug

```
scroble-discogs
```

Permanent once chosen.

## Summary

250 character limit. This is 133.

```
Scrobble vinyl to Last.fm from Discogs release pages. Put the record on, click once when the side ends, and the plays land backdated.
```

## Description

```
Scroble Discogs scrobbles vinyl to Last.fm using Discogs tracklists.

Put the record on. When the side finishes, click once — the tracks land in your Last.fm history with the right album, artists and running order, backdated so the last track ends at the moment you clicked.

WHERE IT WORKS

On any Discogs release page, a "Scrobble to Last.fm" button appears under the title and opens the tracklist over the page. From the toolbar icon you get four tabs: Search (find a release on Discogs), Collection (browse your own), Paste (a Discogs URL, an [r249504] marker, or a bare release id), and Recent (what you have scrobbled).

ONE CLICK PER SIDE

Everything starts ticked. Use Side A / Side B to scrobble just the side you played, or untick individual tracks. The footer shows the window the plays will occupy, and −15m / −30m / −60m shift it back if you didn't click straight away.

BUILT FOR HOW DISCOGS ACTUALLY LOOKS

Most vinyl releases list no track times. Where some are present, the missing ones are estimated from that release's own average; where none are, your configured fallback is used. This shifts only the clock times — play counts, album attribution and running order are unaffected. Disambiguation suffixes like "Vibe Tribe (2)" are stripped, "Various" becomes "Various Artists", multi-artist credits use Discogs' own separators, section headings are never scrobbled, and localized URLs work.

TRY IT WITHOUT TOUCHING YOUR PROFILE

Turn on Dry run in settings. Scrobbles are built and signed but never sent, and the payload is logged to the extension console. Worth doing once, because Last.fm has no delete-scrobble API — a mistake has to be removed by hand from your library.

WHAT YOU NEED

Your own Last.fm API key and shared secret, created free at last.fm/api/account/create. A Discogs token is optional but recommended — without one, Discogs returns no cover art with search results.

WHAT GETS TRANSMITTED

Your Last.fm credentials go to Last.fm. The releases you open go to Discogs, and what you played goes to Last.fm. Nothing goes anywhere else. There is no server, no analytics, and no data of any kind reaches the author. The source is unminified and readable at github.com/vo1dee/scroble-discogs.
```

## Categories

Pick from AMO's fixed list; up to two.

```
Photos, Music & Videos
```

## Support

- **Support website:** `https://github.com/vo1dee/scroble-discogs/issues`
- **Support email:** optional if the website is given

## License

```
MIT
```

Matches [LICENSE](../LICENSE).

## Privacy policy

Required, because the manifest declares data collection. Paste the contents of
[PRIVACY.md](../PRIVACY.md).

## Source code submission

**No.** Required only for minified, obfuscated or build-tool-generated code. This extension
ships plain ES modules with no build step.

## Compatibility

Firefox desktop. Leave Android unchecked unless it has actually been tested there.

## Screenshots

In [screenshots/](screenshots/), in the order they read best:

1. `03-side-b-only.png` — Side B selected; the clearest single explanation of the product
2. `04-on-discogs-pages.png` — the button on a real Discogs release page
3. `01-pick-a-side.png` — the full tracklist ready to scrobble

`02-search-discogs.png` shows blank thumbnails, because Discogs returns no cover art for
unauthenticated search. Retake it with a Discogs token set before using it.

## Version notes for 1.0.0

```
First release.
```

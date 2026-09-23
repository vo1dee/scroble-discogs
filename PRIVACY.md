# Privacy Policy — Scroble Discogs

_Last updated: 2026-09-23_

Scroble Discogs has no server. There is no account to create, no analytics, no telemetry, and
no data of any kind is sent to the extension's author. Everything below is verifiable in
[the source](src/) — the code that ships is the code in this repository, unminified.

## What is stored, and where

All of it lives in the extension's own local storage (`browser.storage.local`) on your machine,
and nowhere else:

| Stored | Why |
|---|---|
| Last.fm API key and shared secret | Yours, created by you at last.fm. Needed to sign requests |
| Last.fm session key and username | Obtained when you click *Connect*; identifies you to Last.fm |
| Discogs token and username (optional) | Only if you enter them — for a private collection and a higher rate limit |
| Preferences | Fallback track length, multi-part works, artist name variations, dry run |
| A log of the last 50 scrobbles you sent | So a mistake can be found later. Last.fm has no delete-scrobble API |

None of this is synced, backed up, or transmitted anywhere except as described below.

## What leaves your machine

Exactly two hosts, both of them services you are deliberately using:

**`ws.audioscrobbler.com` (Last.fm)** — receives your API key, a signature, your session key,
and the artist/track/album/timestamp of the plays you choose to scrobble. This is the point of
the extension. Connecting also opens `www.last.fm` in a tab so you can approve access.

**`api.discogs.com` (Discogs)** — receives the release ids you open, your search terms, your
Discogs username when you browse your collection, and your Discogs token if you set one. Needed
to fetch the tracklist you are about to scrobble.

That is the complete list. No third-party endpoint is contacted, and nothing is sent in the
background — every request follows an action you took.

Each service's own handling of what it receives is covered by their policies:
[Last.fm](https://www.last.fm/legal/privacy) · [Discogs](https://www.discogs.com/pages/privacy).

## The install prompt

Firefox asks you to accept two data-collection categories, declared in `manifest.json`:

- **`authenticationInfo`** — the Last.fm credentials and session key, and the Discogs token,
  which the extension stores and sends to those services on your behalf
- **`browsingActivity`** — the Discogs release pages you choose to scrobble from, whose ids go
  to the Discogs API

The content script that adds the button to Discogs pages never receives your Last.fm secret; it
sends a release id to the background page and nothing more.

## Removing your data

*Settings → Disconnect* clears the Last.fm session. Uninstalling the extension removes
everything listed above from your browser. Scrobbles already accepted by Last.fm live in your
Last.fm library and must be deleted there — the API cannot remove them.

## Contact

Questions or concerns: open an issue on the project's repository.

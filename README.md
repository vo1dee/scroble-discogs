# Scroble Discogs

A Firefox extension that scrobbles vinyl to Last.fm using Discogs tracklists.

Put the record on. When the side finishes, click once — the tracks land in your Last.fm
history with the right album, artists and running order, backdated so the last track ends at
the moment you clicked.

Requires Firefox 142 or newer.

## Install

Not on [addons.mozilla.org](https://addons.mozilla.org) yet — see [PUBLISHING.md](PUBLISHING.md).
Until then, install it by hand.

### Manual install — temporary

Gone when Firefox restarts, but the fastest way to try it:

1. Download this repo (`git clone …`, or *Code → Download ZIP* and unzip it)
2. Open `about:debugging#/runtime/this-firefox`
3. **Load Temporary Add-on…** → pick `manifest.json` in the folder

The vinyl icon appears in your toolbar.

### Manual install — permanent

To survive restarts, Firefox needs a signed `.xpi`. Mozilla signs unlisted add-ons for free:
get API credentials from <https://addons.mozilla.org/developers/addon/api/key/>, then

```bash
npm install
npm run sign -- --api-key=YOUR_JWT_ISSUER --api-secret=YOUR_JWT_SECRET
```

The signed `.xpi` lands in `web-ext-artifacts/`. Open it with Firefox to install for good.

## Set up

### 1. Last.fm API key

Go to <https://www.last.fm/api/account/create>. Any name and description will do; leave the
callback URL blank. You get an **API key** and a **shared secret** — keep the tab open.

The key is yours alone. It never leaves this extension's local storage except to talk to Last.fm.

### 2. Connect

1. Toolbar icon → the gear, or `about:addons` → Scroble Discogs → Preferences
2. Paste the API key and shared secret → **Save credentials**
3. **Connect Last.fm** → a tab opens → **Yes, allow access**
4. Back on the settings tab it picks up the approval within a few seconds, or click
   **I've allowed access — finish**

It should say *Connected as \<you\>*.

## Use

**From a release page** — on any `discogs.com/release/…` page, click **Scrobble to Last.fm**
under the title. The tracklist opens over the page.

**From the toolbar** — click the icon for four tabs:

| Tab | What it does |
|---|---|
| Search | Search Discogs by artist or album |
| Collection | Your own Discogs collection (needs your username in settings) |
| Paste | A Discogs URL, a `[r249504]` marker, or a bare release id |
| Recent | What you've scrobbled recently |

In the tracklist everything starts ticked. **Side A** / **Side B** scrobble just the side you
played; individual tracks can be unticked. The footer shows the window the plays will occupy —
`−15m` / `−30m` / `−60m` shift it back if you didn't click straight away. Then hit **Scrobble**.

### Try it without touching your profile

Settings → tick **Dry run**. Scrobbles are built and signed but never sent; the payload is
logged to the extension console (`about:debugging` → Inspect). Worth doing once, because
**Last.fm has no delete-scrobble API** — a mistake has to be removed by hand from your library.

## Settings

| Setting | Default | Notes |
|---|---|---|
| Discogs token | empty | Optional, but worth setting: without one Discogs returns **no cover art with search results**, so the Search tab shows blank thumbnails. Also needed for a **private** collection, and raises the rate limit from 25 to 60 requests a minute. From <https://www.discogs.com/settings/developers> |
| Discogs username | empty | Needed to browse your collection without a token |
| Fallback track length | 240s | Used only when a release lists *no* durations at all |
| Multi-part works | on | Scrobble movements of a suite or symphony separately |
| Artist name variations | off | Off uses each artist's canonical name, which matches Last.fm better |
| Dry run | off | Build and log scrobbles without sending |

## Things worth knowing

**Durations are often missing.** Most vinyl releases on Discogs have no track times. When some
are present the missing ones are estimated from that release's own average; when none are, your
fallback is used. This shifts the clock times only — play counts, album attribution and running
order are unaffected.

**Last.fm won't accept scrobbles older than about 14 days.** The picker warns you before
submitting anything that would fall outside the window.

**No undo.** Last.fm's API can add scrobbles but not remove them. The Recent tab records what
was sent so you can find a mistake, but deleting it means visiting your Last.fm library.

**Discogs quirks are handled.** Disambiguation suffixes (`Vibe Tribe (2)`) are stripped,
`Various` becomes `Various Artists`, multi-artist credits are joined using Discogs' own
separators, section headings are never scrobbled, and localized URLs (`/fr/release/…`) work.

**What gets transmitted.** Your Last.fm credentials go to Last.fm. The releases you open go to
Discogs, and what you played goes to Last.fm. Nothing goes anywhere else — that is what the
Firefox permission prompt is describing. Full detail in [PRIVACY.md](PRIVACY.md).

## Development

No build step — the source that ships is the source in this repo.

```bash
npm install
npm test            # 22 tests over real Discogs fixtures
npm run lint        # Mozilla's add-on validator
npm start           # launch Firefox with the extension loaded
npm run build       # package into web-ext-artifacts/
```

`test/fixtures/` holds real Discogs API responses picked for the cases that break things: a
compilation with no durations and per-track artists, a release that repeats a position, Cyrillic
titles, multi-artist join separators, and a 34-entry reissue where 3 rows are section headings.

### Layout

```
src/
├── background.js      event page — all network, and the only place secrets live
├── lib/
│   ├── tracklist.js   Discogs tracklist → Last.fm scrobbles (the core)
│   ├── lastfm.js      signing, auth, batch scrobbling
│   ├── discogs.js     API client, throttle, release cache
│   ├── md5.js         Last.fm signs with MD5, which Web Crypto doesn't offer
│   ├── messaging.js   background messaging
│   └── settings.js    storage + defaults
├── picker/            the tracklist UI, used by both the popup and the page overlay
├── popup/             search / collection / paste / recent
├── options/           credentials and preferences
└── content/           injects the button on Discogs pages
```

The content script never sees your Last.fm secret — it sends a release id to the background
page and nothing more.

## Publishing

Steps for submitting to addons.mozilla.org are in [PUBLISHING.md](PUBLISHING.md).

## License

[MIT](LICENSE).

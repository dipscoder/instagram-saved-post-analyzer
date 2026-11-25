# Saved Index

Your Instagram saved posts, organised and searchable. Three parts:

1. **The web app** is the product. It shows your library, searches it, indexes posts
   (each one gets a topic, a one-line summary and tags), and holds your account, spend
   and settings.
2. **The Chrome extension** is a collector. It finds the posts you saved on Instagram
   and syncs them to your account. It also gives Instagram videos real seek controls.
3. **The Supabase backend** holds the library and runs indexing on the server.

The extension is loaded unpacked and not published.

New contributor or maintainer? Start with [`PROJECT_INDEX.md`](PROJECT_INDEX.md) for the
documentation map, current state, code ownership, known risks, and release checklist.

---

## Install

```bash
npm install
npm run build
```

The build prints the exact folder to load. Then in Chrome:

1. Go to `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked**
4. Select **`extension/dist/`** — ⚠️ **not the repo root.** The root has no
   `manifest.json`; it is generated into `extension/dist/` by the build. Selecting the root gives
   *"Manifest file is missing or unreadable"*. On macOS, `Cmd+Shift+G` in the picker lets
   you paste the path the build printed.

Needs **Chrome 111 or newer** (that's when manifest-declared `world: "MAIN"` content
scripts landed). Run everything locally with `npm run app` (installs, builds the extension into `extension/dist/`, starts the web app on http://localhost:3000); deploy the server with `npm run deploy`.

`npm run watch` rebuilds on save; hit the reload icon on the extension card to pick
changes up.

## First run

Installing the extension opens the web app, whose empty library walks through these steps.

1. Click the extension icon and **Create Account** or **Sign In**.
2. Press **Find new posts**. It opens your saved posts on Instagram if they are not open
   already, and scrolls them for you. Posts sync to your account as they are found.
3. Press **Open your library** to go to the web app. It brings the library forward if it
   is already open in a tab.
4. In the web app, press **Organise N posts**. It shows the most it can cost first and asks
   you to confirm. Posts the free keyword rules can file cost nothing.

---

## How it works

Two jobs, in two places. Only the second one costs money.

**1 — Find (the extension, free).** Instagram sends about a dozen posts per network
request. A post cannot be found before it has loaded, so *the library fills as you
scroll*. Find new posts scrolls to the bottom with randomised 800–2000 ms pauses and stops
immediately if Instagram returns a 429. It makes no requests of its own; it reads the
responses the page was fetching anyway.

Capture only runs on your saved page, only reads the part of a response that Instagram
names as the saved feed, and only scrapes inside the saved grid. All three matter, because
`/graphql/query` is one endpoint for the whole site.

**Something in your library you never saved?** Open **All posts**, press **Find new
posts** and let it run to the end. A completed sweep of the full feed sees everything still
saved, so the pill offers to remove anything it didn't find, after a second press.

**2 — Organise (the web app, the part that costs).** Hashtag and keyword rules label
whatever they can for nothing. Everything else goes to the model on the server in small
batches, newest saved first, and **Stop** ends a run after the batch in flight. Every
summary is kept in a ledger keyed by the exact text the model was shown, so the same post
is never paid for twice. Bringing older posts up to date (search by meaning, a reel's
words) is a separate, optional offer under the main button, so the number you are asked to
pay for only counts posts never organised.

**Needs a category.** When the AI isn't sure, it doesn't guess: the post waits in Needs a
category with the categories it most likely belongs in. **Sort them one by one** shows one
post at a time; press 1, 2 or 3 to file it, or S to skip.

**Change category** in a post's panel is free and sticks. Its **Undo** puts the post back
exactly as it was, subcategory included, and drops the correction.

**Clear library** (web app → Settings) erases every post, picture, collection and summary
in your account. Each browser running the extension empties its own copy on its next
sync, so nothing comes back. Your spend record is kept.

---

## Finding things again

**Search** understands meaning as well as words. Each indexed post is embedded from its
summary, category, tags and its own text, and a search ranks posts by keyword match and by
meaning together. So "quick dinner" finds a post summarised *sheet-pan harissa chicken*,
while an exact handle or hashtag still comes first. Until the `search` function is
deployed, the web app falls back to matching every word you type.

**Dates.** Instagram sends no save timestamp anywhere in the saved feed, so nothing here
claims one. What you get instead:

| | |
|---|---|
| **Posted** | the post's own publish date, on every card |
| **Added** | when this library first saw it — hover any date, or use the list view |
| **Save order** | the order Instagram lists your saves in, newest first. Exact as an *order*, which is why it isn't shown as a date |

Save order is the default sort, because ordering saved posts by publish date buries a 2019
clip you saved yesterday. **Newest post** and **Oldest post** use the publish date.

**Where it appears on Instagram.** Nothing shows on the feed, on profiles or on the Saved
overview. Open a collection (All posts, Audio, or one of your own) and a small pill in the
bottom-right names it, offers **Find new posts**, and links to your library. The extension
never listens to keys you type on Instagram.

**Your collections carry over.** Each time you browse one of your own collections, its
posts are tagged with it, and it appears under **Collections** in the web app's sidebar.
Categories still work inside a collection. Taking a post out of a collection on Instagram
is not noticed yet, so a post stays listed under every collection it was seen in.

**Light and dark.** Everything starts light. The web app and the extension popup each have
a sun/moon button, and the choice is remembered.

---

## Is it safe?

**The OpenAI key** lives only in the Supabase Edge Function secrets. It is never in the
extension, the web app, or the repository. Indexing calls the server, which checks your
session and a daily spend cap before it calls OpenAI.

**Your session.** The extension keeps its Supabase session in `chrome.storage.local`,
locked to `TRUSTED_CONTEXTS` on every worker start, so not even our own content script on
instagram.com can read it. Account requests from a content script are refused, and every
error runs through `redact()` before it is logged or shown.

**Your posts.** The extension keeps a working copy in its own IndexedDB and mirrors it to
your account, which Row Level Security limits to you. The only analysis traffic goes from
the server to OpenAI: post text, plus a small thumbnail for a post with too little text.
There is no telemetry.

**Your account (optional).** Signed in, the extension mirrors three things to your
Supabase account, readable only by you under Row Level Security: the post metadata, the
summaries and categories you paid for, and one small WebP thumbnail per post (about 50 KB,
800 px on the long edge) in a private bucket. Never videos. Thumbnails are copied a few at
a time, one download after another with a pause between them, from the same CDN URLs the
page already loaded. Summaries are never deleted from the account, so a new browser, or a
post you unsave and save again, never pays for the same answer twice.

Indexing runs on the server, never in the extension: the post text, a thumbnail when the
text is too thin, and a reel's audio go to OpenAI from there, with a daily spending limit per
user. The extension holds no OpenAI key. If an older version stored one, it is deleted the
first time this version starts.

**Your Instagram account.** The extension never calls Instagram's API. It reads the
responses the page fetches for itself, which is why no `doc_id` is ever forged and no
request pattern is added. The one active behaviour is auto-scroll, which is randomised
rather than metronomic and halts on the first 429.

---

## How it works under the hood

The full design rationale is in [`ARCHITECTURE.md`](ARCHITECTURE.md). The short version:

**Capture is interception, not scraping.** Instagram's private GraphQL identifiers and
response shapes change over time, so this never manufactures its own Instagram requests.
A `MAIN`-world content script patches `window.fetch` and `XMLHttpRequest` at
`document_start` and reads the responses the page fetches for itself. Identifier changes
do not require a hard-coded request update.

**Extraction is shape-driven, not schema-driven.** The URL matcher decides *whether* to
look at a payload; a recursive walker decides *what counts* — any node with a post code
and an owner. That's why it handles both the REST (`items[].media`) and GraphQL
(`data.xdt_api__v1__feed__saved__posts.…`) shapes, and survives either being renamed.
`npm run verify` proves this against a deliberately made-up GraphQL field name.

**Your session never enters a page context.** `chrome.storage.local` is readable by content
scripts *by default*; the service worker calls
`chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })` on every start
to close that. The OpenAI key is not in the extension at all: it lives only in the server's
secrets.

**Indexing is cheapest-first, on the server.** Local hashtag/keyword rules → batched text
analysis (25 posts per request) → a thumbnail, but only for posts with too little text, and
a transcript for reels. The web app's How it works page walks through it with your own
posts.

---

## Where each piece lives

```
package.json               npm workspaces: shared, extension, supabase, web
tsconfig.base.json         compiler options every package extends

shared/src/                pure code for the extension, backend and web app alike
  hash.ts                  short stable digest, for "is this the same input as before?"
  taxonomy.ts              12 categories + the free rule-based pre-pass

web/                       the web app: library, search, Index, Settings
supabase/                  database migrations + the analyze, sort and search functions

extension/src/
  types.ts                 PostRecord schema (incl. the nullable pipeline fields)
  routes.ts                which Instagram routes capture is allowed to run on
  messaging.ts             typed contracts for all three contexts
  content.ts               ISOLATED-world entry: bridge + video + pill + SPA routing

  capture/
    main-world.ts          MAIN world: patches fetch + XHR, reports 429s   → capture-main.js
    extract.ts             shape-driven JSON → PostRecord walker
    dom-scrape.ts          first-screenful fallback
    bridge.ts              ISOLATED receiver + auto-scroll harvester

  background/
    index.ts               service worker: message router, port broadcasts → background.js
    db.ts                  IndexedDB store, dedupe + gap-filling merge
    ledger.ts              paid-for verdicts, kept apart from the disposable post cache
    settings.ts            appearance settings and the TRUSTED_CONTEXTS lockdown
    account.ts             Supabase sign-in; the session never leaves the worker
    sync.ts                mirrors posts, the ledger and thumbnails to the account
    media.ts               bounded thumbnail downloads and the stored WebP
    sync-plan.ts           pure diff: which posts to upload or delete
    order.ts               feed position -> save order, across visits
    collections.ts         names of your Instagram collections
    redact.ts              strips credentials from every surfaced error

  page/
    pill.ts                the in-page pill (Shadow DOM): Find new posts, strays, link to the web app
    pill.css.ts            its styles
    flow.ts                pure: the pill's button and status rules
    video.ts               body-level control bar, geometric targeting, observers
    frames.ts              pure: frame length, step targets, timecodes, still filenames

  popup/popup.ts           sign in, then Find new posts and Open your library            → popup.js

extension/public/
  manifest.json  popup.html  icons/

extension/tools/
  make-icons.mjs           regenerates the icons (npm run icons -w extension)
  verify.ts                302 regression checks across the critical flows

design/                    the source design docs this was built from

PROJECT_INDEX.md           maintainer entry point and file map
ARCHITECTURE.md            technical decisions and invariants
TODO.md                    chronological delivery record + remaining work
CLAUDE.md                  compact coding-agent orientation
```

## Scripts

| | |
|---|---|
| `npm run app` | install, build the extension, start the web app |
| `npm run deploy` | install, bundle and deploy every Edge Function |
| `npm run build` | production bundle into `extension/dist/` |
| `npm run watch` | rebuild on save |
| `npm run typecheck` | `tsc` across every workspace |
| `npm run verify` | run 302 pure-function regression checks |
| `npm run icons -w extension` | regenerate `extension/public/icons/*.png` |

## Permissions, and why

| | |
|---|---|
| `storage` | settings and the account session |
| `unlimitedStorage` | thousands of posts in IndexedDB |
| `https://www.instagram.com/*` | the content scripts |
| `https://*.cdninstagram.com/*`, `https://*.fbcdn.net/*` | copying each thumbnail to your account |
| `https://siwmxcsrzdvvtouolvph.supabase.co/*` | account sign-in and library sync |

No `tabs`, no `scripting`, no `activeTab`, no `<all_urls>`. Service-worker pushes go over
`chrome.runtime` ports specifically so `tabs` isn't needed.

---

## Troubleshooting

**Nothing is being captured.** Open DevTools on the Instagram tab and check the console for
errors from `capture-main.js`. If Instagram has moved its saved-feed endpoints, the URL
patterns are one list at the top of `extension/src/capture/main-world.ts` — widen `URL_PATTERNS` and
rebuild. The extractor downstream is shape-driven and won't need touching.

**A post couldn't be organised.** The web app says so on the post and in the Organise bar, and keeps the
reason. Press Try again; the real error text is in Supabase → Edge Functions → `sort` → Logs.

**Reels keep muting themselves when I pause.** Fixed — but the fix only applies to the mute
button on *our* control bar, which is what records that you want sound. Instagram's own
speaker icon doesn't.

**Only a handful of posts show up.** That is capture working as designed — see *How
indexing actually works* above. Press **Find new posts** and leave the tab open.

**The video scrubber won't seek.** You are looking at the browser's own control strip, not
ours. Tell them apart by the buttons: Chrome's has a fullscreen icon and a `⋮` menu, ours
has neither. Instagram's click-catcher swallows clicks on Chrome's strip, which is why our
bar renders outside their DOM. Extension video controls are on by default; profiles created
before v2 are switched over automatically on the next worker start.

**Stepping and stills** are switched off for now (`FRAME_TOOLS` in `page/video.ts`) while
they are redesigned. When on: hover a video: the bar's ⏮ ⏭ buttons, or `,` and `.`, pause and
move exactly one frame; hold the key to keep going. The camera button saves the frame on
screen as a PNG at the video's own resolution (a 1080 × 1920 reel gives a 1080 × 1920
image), named after the post and the moment. Shift-click it to copy the frame instead.
The video is only read, never reloaded or re-requested.

**Reels stop at the end instead of looping.** Deliberate: `loop` is removed, because a
looping video restarts under you mid-scrub and hides where the end is.

---

## Known limits

- **Endpoint matching is the one brittle seam.** Everything downstream tolerates change;
  the URL patterns are a best-effort list and may need a line updated if Instagram
  reorganises its API paths. This is a deliberate trade — see `ARCHITECTURE.md` §2.
- **There is no save date.** Instagram doesn't expose one, so the library gives you the
  post's publish date, the date it was added here, and exact save *order* — see
  *Finding things again*. Saving a post and returning to the grid without reloading the
  page files it below the backlog until the next load.
- **Capture depends on one naming assumption**: that Instagram's saved-feed GraphQL field
  keeps the word "saved" in it, as it has through every rename so far. Everything else in
  the pipeline is shape-driven — this one fence has to read names, because it is the only
  thing separating your saves from the rest of the site. See `ARCHITECTURE.md` §2a.
- **Reels are transcribed by the account, not by Instagram,** which exposes no transcript
  on the web. Indexing a reel transcribes it once with `gpt-transcribe`, so it is filed
  and searchable by what is said in it.
- **`ocrText`, `perceptualHash`** are in the extension's schema and always `null`. They
  exist so a later pipeline can backfill without a migration.
- **The library overlays rather than replaces** Instagram's grid nodes. Tearing nodes out
  of React's tree is a fight you lose on the next re-render; the visual result is the same.
- Fonts are the system UI stack, not Geist — a content script can't pull a webfont past
  Instagram's CSP.

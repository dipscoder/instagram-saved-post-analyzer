# Saved Index

A Chrome extension (Manifest V3, TypeScript) that does two things to Instagram:

1. **Turns the saved-posts grid into a searchable library.** Every saved post gets a
   one-line summary and a category, so you can find the pasta recipe without scrolling
   through 400 identical thumbnails.
2. **Gives Instagram videos real seek controls.** A scrubber, arrow-key seeking, and no
   more forced looping.

Loaded unpacked. Not published. Your API key stays in your browser.

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
4. Select **`dist/`** — ⚠️ **not the repo root.** The root has no `manifest.json`; it is
   generated into `dist/` by the build. Selecting the root gives
   *"Manifest file is missing or unreadable"*. On macOS, `Cmd+Shift+G` in the picker lets
   you paste the path the build printed.

Needs **Chrome 111 or newer** (that's when manifest-declared `world: "MAIN"` content
scripts landed).

`npm run watch` rebuilds on save; hit the reload icon on the extension card to pick
changes up.

## First run

1. Click the extension icon. Pick a provider and model, paste a key, press **Test and
   save** — it saves and round-trips one token so you find out immediately if the key
   works.
2. Open your saved posts on Instagram: your profile → **Saved**.
3. The library takes over the page. Scroll and posts are captured automatically, or press
   **Index now** and it scrolls for you.

Roughly **$0.37 per 1,000 posts** on Claude Haiku 4.5 — and that is the ceiling, because
posts caught by the free local rules never reach the model. The popup and the in-page panel
both show what you have actually spent, metered from the token counts the provider returns.

---

## How indexing actually works

This is the part that looks like one thing and is really two. Only the second half costs
money.

**1 — Capture (free).** Instagram sends about a dozen posts per network request. A post
cannot be captured before it has loaded, so *the library fills as you scroll*. If you have
1,000 saved posts and 30 are on screen, 30 is what exists so far. **Index now** does the
scrolling for you: it pages to the bottom with randomised 800–2000 ms pauses and stops
immediately if Instagram returns a 429. It makes no requests of its own — it reads the
responses the page was fetching anyway.

Capture only runs on your saved page, only reads the part of a response that Instagram
names as the saved feed, and only scrapes inside the saved grid. All three matter, because
`/graphql/query` is one endpoint for the whole site: without them, opening a saved reel
meant the "more from this creator" strip got indexed too.

**Something in your library you never saved?** Press **Index now** and let it run to the
end. A completed sweep sees everything still saved, so anything it doesn't find is offered
up for removal — posts you have unsaved since, and anything an older build picked up
elsewhere. Everything genuine keeps the summary you already paid for.

**2 — Categorise (the part that costs).** Hashtag and keyword rules label whatever they can
for nothing. Everything else goes to your model in batches of 25 captions. Only posts with
no usable caption *and* no alt text cost a look at the thumbnail. Nothing is ever
categorised twice, and a paused run resumes exactly where it stopped — progress lives in
the database, not in memory, so closing the tab or letting Chrome kill the service worker
costs you at most the in-flight batch.

Both halves can be paused and resumed from either the popup or the in-page panel, and a
pause in one stops the other.

---

## Finding things again

**Search** matches every word you type, in any order, across the summary, caption,
category, subcategory, tags, hashtags, handle, alt text and audio track. So "pasta recipe"
finds a post summarised *recipe for creamy pasta*, and a caption-less reel is still
findable by Instagram's own alt text or the track playing over it. Results past the first
200 are behind **Show more**; the header always shows the true total, so `200 / 412` means
there are 412.

**Dates.** Instagram sends no save timestamp anywhere in the saved feed, so nothing here
claims one. What you get instead:

| | |
|---|---|
| **Posted** | the post's own publish date, on every card |
| **Added** | when this library first saw it — hover any date, or use the list view |
| **Save order** | the order Instagram lists your saves in, newest first. Exact as an *order*, which is why it isn't shown as a date |

Save order is the default sort, because ordering saved posts by publish date buries a 2019
clip you saved yesterday. **Newest post** and **Oldest post** use the publish date.

**Library ↔ Instagram** in the header switches between the two; `⌥S` / `Alt+S` does the
same from the keyboard. Instagram's own grid is underneath either way, untouched.

---

## Is it safe?

**Your API key.** It lives in `chrome.storage.local` under the extension's own origin — not
in `localStorage`, which would put it on instagram.com's doorstep. It is not encrypted at
rest, and encrypting it would be theatre: the decryption key would have to ship in the same
bundle. The protection is the access boundary instead, and it holds in three places at
once: page scripts can't call `chrome.storage` at all; `setAccessLevel({
TRUSTED_CONTEXTS })` means even *our own* content script can't read it; and every model
call is made by the background worker, so the key is never passed over a message or into a
page. Errors run through a `redact()` that strips key-shaped strings before anything is
logged or shown.

It does not protect against someone at your unlocked computer opening the service-worker
console — that is true of every extension holding a credential. Scope the key, set a spend
cap at your provider, and use **Remove** in the popup when you're done; it clears the key
without touching anything you've indexed.

**Your posts.** Everything captured sits in this extension's own IndexedDB, in your
browser. Nothing is uploaded anywhere. The only outbound traffic is the caption text sent
to the provider you chose. There is no server in this project and no telemetry.

**Your Instagram account.** The extension never calls Instagram's API. It reads the
responses the page fetches for itself, which is why no `doc_id` is ever forged and no
request pattern is added. The one active behaviour is auto-scroll, which is randomised
rather than metronomic and halts on the first 429.

---

## How it works under the hood

The full design rationale is in [`ARCHITECTURE.md`](ARCHITECTURE.md). The short version:

**Capture is interception, not scraping.** Instagram rotates its GraphQL `doc_id` every
2–4 weeks specifically to break scrapers. So this never calls their API. A `MAIN`-world
content script patches `window.fetch` and `XMLHttpRequest` at `document_start` and reads
the responses the page fetches for itself. Rotating a `doc_id` changes nothing for us.

**Extraction is shape-driven, not schema-driven.** The URL matcher decides *whether* to
look at a payload; a recursive walker decides *what counts* — any node with a post code
and an owner. That's why it handles both the REST (`items[].media`) and GraphQL
(`data.xdt_api__v1__feed__saved__posts.…`) shapes, and survives either being renamed.
`npm run verify` proves this against a deliberately made-up GraphQL field name.

**The API key never enters a page context.** `chrome.storage.local` is readable by content
scripts *by default*; the service worker calls
`chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })` on every start
to close that. Every model call happens in the service worker.

**Categorisation is cheapest-first.** Local hashtag/keyword rules → batched text-only LLM
(25 posts per request) → vision, but only for posts whose caption is empty or under 15
characters, and always with the smallest available thumbnail.

---

## Where each piece lives

```
src/
  types.ts                 PostRecord schema (incl. the nullable pipeline fields)
  routes.ts                which Instagram routes capture is allowed to run on
  taxonomy.ts              12 categories + the free rule-based pre-pass
  messaging.ts             typed contracts for all three contexts
  content.ts               ISOLATED-world entry: bridge + video + library + SPA routing

  capture/
    main-world.ts          MAIN world: patches fetch + XHR, reports 429s   → capture-main.js
    extract.ts             shape-driven JSON → PostRecord walker
    dom-scrape.ts          first-screenful fallback
    bridge.ts              ISOLATED receiver + auto-scroll harvester

  background/
    index.ts               service worker: message router, port broadcasts → background.js
    db.ts                  IndexedDB store, dedupe + gap-filling merge
    settings.ts            settings, the TRUSTED_CONTEXTS lockdown, key masking
    order.ts               feed position -> save order, across visits
    spend.ts               metered tokens + dollars, survives worker restarts
    categorize.ts          the three-tier pipeline, concurrency, backoff
    providers/
      index.ts             adapter interface, registry, pricing, key redaction
      anthropic.ts         (sends anthropic-dangerous-direct-browser-access)
      openai.ts  gemini.ts  openrouter.ts

  page/
    library.ts             in-page library (Shadow DOM), filters, sort, indexing panel
    library.css.ts         its styles
    video.ts               body-level control bar, geometric targeting, observers

  popup/popup.ts           setup screen + control room                 → popup.js

public/
  manifest.json  popup.html  icons/

tools/
  make-icons.mjs           regenerates the icons (npm run icons)
  verify.ts                checks for the extractor + rule matcher (npm run verify)

design/                    the source design docs this was built from
```

## Scripts

| | |
|---|---|
| `npm run build` | production bundle into `dist/` |
| `npm run watch` | rebuild on save |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run verify` | run the extractor / taxonomy checks |
| `npm run icons` | regenerate `public/icons/*.png` |

## Permissions, and why

| | |
|---|---|
| `storage` | settings and the API key |
| `unlimitedStorage` | thousands of posts in IndexedDB |
| `https://www.instagram.com/*` | the content scripts |
| `https://*.cdninstagram.com/*`, `https://*.fbcdn.net/*` | reading thumbnail bytes for the vision fallback |
| the four model endpoints | categorisation calls |

No `tabs`, no `scripting`, no `activeTab`, no `<all_urls>`. Service-worker pushes go over
`chrome.runtime` ports specifically so `tabs` isn't needed.

---

## Troubleshooting

**Nothing is being captured.** Open DevTools on the Instagram tab and check the console for
errors from `capture-main.js`. If Instagram has moved its saved-feed endpoints, the URL
patterns are one list at the top of `src/capture/main-world.ts` — widen `URL_PATTERNS` and
rebuild. The extractor downstream is shape-driven and won't need touching.

**"Key rejected — provider returned 401."** The key is wrong or has no credit. For
Anthropic, also confirm you're not stripping the
`anthropic-dangerous-direct-browser-access` header via a proxy — without it the browser
preflight fails.

**Indexing stops with "returned nothing usable".** The chosen model isn't returning
parseable JSON. Switch to a stronger model; progress is kept, so it resumes where it
stopped.

**The library covers something I need.** Switch to **Instagram** in the header, or press
`⌥S` / `Alt+S`. Instagram's own grid is underneath, untouched, and a chip in the
bottom-right switches back.

**Reels keep muting themselves when I pause.** Fixed — but the fix only applies to the mute
button on *our* control bar, which is what records that you want sound. Instagram's own
speaker icon doesn't.

**Only a handful of posts show up.** That is capture working as designed — see *How
indexing actually works* above. Press **Index now** and leave the tab open.

**The video scrubber won't seek.** You are looking at the browser's own control strip, not
ours. Tell them apart by the buttons: Chrome's has a fullscreen icon and a `⋮` menu, ours
has neither. Instagram's click-catcher swallows clicks on Chrome's strip, which is why our
bar renders outside their DOM. Turn **Extension video controls** on in the popup; profiles
created before v2 are switched over automatically on the next worker start.

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
- **No transcription.** Instagram doesn't expose transcripts on web.
- **`transcript`, `ocrText`, `embedding`, `perceptualHash`** are in the schema and always
  `null`. They exist so a later pipeline can backfill without a migration.
- **The library overlays rather than replaces** Instagram's grid nodes. Tearing nodes out
  of React's tree is a fight you lose on the next re-render; the visual result is the same.
- Fonts are the system UI stack, not Geist — a content script can't pull a webfont past
  Instagram's CSP.

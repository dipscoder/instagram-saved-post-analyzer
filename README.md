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

Then in Chrome:

1. Go to `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the **`dist/`** folder — not the repo root

Needs **Chrome 111 or newer** (that's when manifest-declared `world: "MAIN"` content
scripts landed).

`npm run watch` rebuilds on save; hit the reload icon on the extension card to pick
changes up.

## First run

1. Click the extension icon. Pick a provider, paste a key, press **Test**.
2. Open your saved posts on Instagram (`instagram.com/<you>/saved/`).
3. The library takes over the page. Scroll and posts are captured automatically, or press
   **Index now** to auto-scroll the whole collection in one pass.

Costs run roughly **$0.10–0.15 per 1,000 posts** on a small model — the popup shows a live
estimate before you start. Most posts are categorised by free local rules and never reach
the model at all.

---

## How it works

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
    settings.ts            settings + the TRUSTED_CONTEXTS lockdown
    categorize.ts          the three-tier pipeline, concurrency, backoff
    providers/
      index.ts             adapter interface, registry, key redaction
      anthropic.ts         (sends anthropic-dangerous-direct-browser-access)
      openai.ts  gemini.ts  openrouter.ts

  page/
    library.ts             in-page library (Shadow DOM)
    library.css.ts         its styles
    video.ts               controls, observers, arrow keys, thin scrubber skin

  popup/popup.ts           3-step onboarding + index controls          → popup.js

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

**The library covers something I need.** Press **Hide** in its header — Instagram's own
grid is underneath, untouched. A chip in the bottom-right brings the library back.

**Video controls disappear after a while.** They shouldn't — each video has its own
attribute observer that re-applies them after React re-renders. If it happens, note the
page and open an issue against `src/page/video.ts`.

---

## Known limits

- **Endpoint matching is the one brittle seam.** Everything downstream tolerates change;
  the URL patterns are a best-effort list and may need a line updated if Instagram
  reorganises its API paths. This is a deliberate trade — see `ARCHITECTURE.md` §2.
- **`savedAt` is the post's own timestamp**, not when you saved it. Instagram does not
  expose save time in the saved feed.
- **No transcription.** Instagram doesn't expose transcripts on web.
- **`transcript`, `ocrText`, `embedding`, `perceptualHash`** are in the schema and always
  `null`. They exist so a later pipeline can backfill without a migration.
- **The library overlays rather than replaces** Instagram's grid nodes. Tearing nodes out
  of React's tree is a fight you lose on the next re-render; the visual result is the same.
- Fonts are the system UI stack, not Geist — a content script can't pull a webfont past
  Instagram's CSP.

# Architecture — Saved Index

A Chrome MV3 extension (TypeScript, unpacked) that turns Instagram's blind saved-posts
grid into a searchable, AI-categorised library, and gives Instagram videos real seek
controls.

Two surfaces, per `design/Saved Index - Journey v2.dc.html`:

- **Popup** (380×560) — connect a provider, pick a model, paste a key, run/pause indexing.
- **In-page library** — replaces the thumbnail grid on `instagram.com/saved`, rendered by a
  content script into a Shadow DOM.

---

## 1. Trust boundary

This is the constraint everything else bends around.

```
┌─ MAIN world (page JS context) ─────────────┐
│ capture-main.js                            │   Sees Instagram's fetch/XHR.
│   patches window.fetch + XMLHttpRequest    │   Instagram's own JS can read it.
│   postMessage(JSON) ──────────┐            │   NEVER holds the API key.
└───────────────────────────────┼────────────┘
                                │ window.postMessage
┌─ ISOLATED world (content script) ──────────┐
│ content.js                                 │   Same DOM, separate JS heap.
│   receives → chrome.runtime.sendMessage    │   Cannot read the API key
│   video controls + library UI              │   (storage.local is TRUSTED_CONTEXTS).
└───────────────────────────────┼────────────┘
                                │ chrome.runtime
┌─ Service worker (extension context) ───────┐
│ background/index.js                        │   Holds the API key.
│   IndexedDB · categoriser · provider calls │   Only place that talks to model APIs.
└────────────────────────────────────────────┘
```

`chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })` runs on every
service-worker start. `storage.local` is content-script-readable **by default** — without
that call, any script on instagram.com in the ISOLATED world could read the key. It is
called on every startup, not just install, because the setting is per-storage-area and
cheap to re-assert.

The MAIN-world script is a **declared file** in `web_accessible_resources`, never a
`<script>` tag with a string body. A string-body injection would be blocked by
Instagram's CSP and is a code-injection smell besides.

---

## 2. Data capture — intercept, never scrape

Instagram rotates its GraphQL `doc_id` every 2–4 weeks as a deliberate anti-scraping
measure. Calling their API directly means re-reversing it monthly. So we never call it —
we read the responses the page fetches for itself while you scroll.

**Three layers, most-reliable first:**

| Layer | File | Survives |
|---|---|---|
| 1. fetch/XHR patch | `capture/main-world.ts` | doc_id rotation, endpoint renames (broad URL match) |
| 2. Shape-driven extraction | `capture/extract.ts` | response-shape changes (REST vs GraphQL) |
| 3. DOM fallback | `capture/dom-scrape.ts` | anything that loaded before the patch landed |

**Layer 1** patches `window.fetch` and `XMLHttpRequest.prototype.open/send` at
`document_start`, before Instagram's bundle runs. On a URL match it `.clone()`s the
response (so the page still gets its body intact) and posts the JSON out. The patch is
transparent: errors in our handler never propagate to the page.

**Layer 2** is the important one. Rather than parsing a known response shape, `extract.ts`
walks *any* JSON tree and collects objects that look like a media item — `code` (or
`shortcode`) plus an owner/user field. This makes the extractor indifferent to whether
the payload arrived as `items[].media` (REST) or
`data.xdt_api__v1__feed__saved__posts.edges[].node.media` (GraphQL), and to Instagram
renaming either. URL matching only decides *whether to look*; shape decides *what counts*.

**Layer 3** reads the first screenful of `<a href="/p/...">` tiles for the case where the
grid painted before our patch attached.

**Harvest modes:**
- *Passive* — everything above runs as you scroll. Zero extra requests.
- *Active* ("Index now") — auto-scrolls with randomised **800–2000 ms** delays and halts
  immediately on any 429. Randomised because a fixed cadence is itself a bot signal.

---

## 3. Storage

**IndexedDB**, not `chrome.storage.local` — the latter caps at ~10 MB, and a few thousand
posts with captions blows past that. `unlimitedStorage` is requested so the browser
doesn't evict the DB under pressure.

One store, `posts`, keyed on `shortcode` (dedupe is therefore free — a re-`put` of an
already-categorised post is skipped in `db.putIfNew`). Indexes on `category`, `savedAt`,
`categorizedAt`.

Record schema (`src/types.ts`) — the nullable tail exists so a later pipeline can
backfill without a migration:

```ts
shortcode, permalink, handle, caption, hashtags[], thumbnailUrl,
isVideo, durationSec, audioTrackName, altText, savedAt,
category, subcategory, tags[], summary, categorizedAt, modelUsed,
// declared, never populated by this extension:
transcript, ocrText, embedding, perceptualHash
```

`schemaVersion` is stored per record so a future migration can be selective.

---

## 4. Categorisation — cheapest thing that works

Three tiers, in cost order. A post that settles at tier 1 never reaches tier 2.

**Tier 1 — deterministic pre-pass** (`taxonomy.ts`, free, instant).
Hashtag and keyword rules against the fixed taxonomy. A post matches only when its
winning category clears both a score floor and a margin over the runner-up — a weak or
ambiguous match falls through to the LLM rather than being guessed at.

**Tier 2 — text-only LLM** (`categorize.ts`).
Caption + hashtags + handle, batched **25 posts per request**, JSON-only response with
fixed keys. Text tokens are ~1/50th the cost of image tokens, so this is where the bulk
of posts should land.

**Tier 3 — vision fallback.**
Only when the caption is empty or under **15 characters**. Sends the *smallest available*
thumbnail — image tokens dominate cost, and a 150px thumbnail is enough to tell a recipe
from a gym reel.

No transcription: Instagram does not expose transcripts on web, and audio download is
both fragile and a separate cost centre.

**Execution:** concurrency limit of **3** in-flight requests, exponential backoff with
jitter on 429/5xx, and resume-on-failure — progress lives in IndexedDB, so a crashed
service worker or closed tab loses at most the in-flight batch. Already-categorised posts
are never re-sent (`categorizedAt != null` is the guard).

---

## 5. Provider adapter

`background/providers/` — one interface, four implementations:

```ts
interface Provider {
  chat(req: ChatRequest, key: string, model: string): Promise<string>
}
```

| Provider | Endpoint | Note |
|---|---|---|
| Anthropic | `api.anthropic.com/v1/messages` | needs `anthropic-dangerous-direct-browser-access: true` or CORS fails |
| OpenAI | `api.openai.com/v1/chat/completions` | |
| Gemini | `generativelanguage.googleapis.com/v1beta/…:generateContent` | key as query param |
| OpenRouter | `openrouter.ai/api/v1/chat/completions` | OpenAI-shaped |

Every call happens in the service worker. The key is masked after save (`sk-ant-…4f2c`)
and never logged — `providers/index.ts` has a `redact()` used on every error path.

---

## 6. Video controls

`page/video.ts`, ISOLATED world, `instagram.com/*`.

Per video: `controls = true`; remove `controlsList`, `disablePictureInPicture`, `loop`;
raise `z-index` above Instagram's click-catcher overlay so scrubber clicks reach the
player instead of opening the post.

- **Global `MutationObserver`** for videos added by React.
- **Per-video attribute observer** re-applies the flags when React re-renders and strips
  them — a one-shot pass loses the fight within seconds.
- Scans are throttled through `requestAnimationFrame` so a mutation storm costs one pass
  per frame, not one per mutation.
- Arrow keys seek ±5 s on the video under the pointer.

Two skins, toggled in settings: **native** (default) and **thin scrubber** — 3 px at rest,
7 px on hover, 9 px knob, accent fill while dragging, flush to the bottom edge inside the
video's rounded corners, per `design/…Journey v2` S6.

---

## 7. Permissions

```
storage           settings + IndexedDB quota
unlimitedStorage  thousands of posts
host_permissions  https://www.instagram.com/*  + the four model endpoints
```

No `tabs`, no `scripting`, no `<all_urls>`, no `activeTab`. The popup reaches the active
tab through `chrome.runtime` messaging from the content script, which needs no extra
permission. `sidePanel` is **not** requested — this build uses popup + in-page library.

---

## 8. Build

esbuild → `dist/`, four bundles (`capture-main`, `content`, `background`, `popup`), each
IIFE, no code splitting (MV3 service workers and content scripts can't share chunks).
`npm run build` for production, `npm run watch` for a rebuild-on-save loop. No runtime
dependencies.

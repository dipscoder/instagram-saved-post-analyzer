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

### Where the key lives, and what that does and doesn't protect against

`chrome.storage.local`, under the extension's own origin — **not** `localStorage`, which is
per-site and would put the key on instagram.com's own doorstep. It is **not encrypted at
rest**, and encrypting it would be theatre: the key that decrypted it would have to sit in
the same bundle, so anything able to read one could read the other. What actually carries
the security is the access boundary, and there are three layers of it:

| Threat | What stops it |
|---|---|
| Instagram's own page JS reading the key | Different world *and* different origin — page script cannot call `chrome.storage` at all |
| Our own content script being tricked into leaking it | `setAccessLevel({ TRUSTED_CONTEXTS })` — even *we* cannot read the key from a content script |
| A model call leaking it into a page | Every call is `fetch` from the service worker; the key is never passed over any message |
| It appearing in a log or an error toast | `redact()` on every error path, and only `SafeSettings` (mask + boolean) ever leaves the worker |
| Another extension reading it | Extension storage is per-extension; there is no cross-extension read |

What it does **not** protect against, stated plainly: anyone with your unlocked computer and
your Chrome profile can load `chrome://extensions`, open the service worker console, and
print the key. That is true of every browser extension that holds a credential. The
mitigation is the provider's own: scope the key, set a spend limit, and rotate it — the
popup's **Remove** button clears it in one click without touching your indexed posts.

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

### 2a. Scope — the difference between "a post" and "a post you saved"

Everything above is good at finding media in a payload. None of it, on its own, knows
whether you *saved* that media, and the first version shipped without asking. The result
was a library full of posts the user had never saved — mostly other reels by a creator
they had saved once, picked up when they opened a saved post and Instagram loaded the
related strip. Wrong twice over: a library you don't recognise, and a bill for it.

Three fences, because no single one of them is sufficient:

| Fence | Where | Rejects |
|---|---|---|
| Route | `bridge.ts` via `routes.ts` | anything captured while you are not on `/saved` |
| Payload scope | `extract.ts` (`scope: 'saved'`) | GraphQL bodies with no saved-feed container |
| Element scope | `dom-scrape.ts` | post links outside the saved grid's `<main>` |

The payload fence is the interesting one. `/graphql/query` is **one endpoint for the whole
site** — home feed, explore, profile grids, comments, related posts — so the URL tells you
nothing, and the old body sniff only asked "does this look like media", which they all do.
Under `'saved'` scope the walker first collects subtrees hanging off a key that *names* the
saved feed (`edge_saved_media`, `xdt_api__v1__feed__saved__posts`) and only then looks for
media inside them.

That is the one naming assumption in the pipeline, and it is a deliberate trade against
§2's shape-driven principle: Instagram's codegen'd field names describe what they return,
and have through every rename we have seen. The REST saved and collection paths still prove
themselves by URL and are read whole, so they are unaffected either way.

**Reconciliation.** Every captured record is stamped `seenInSavedFeed`. A sweep that
reaches the end of the feed is therefore a census, and anything it did not touch is either
unsaved since or was swept up by an older build — the library offers to remove exactly
those, which keeps the summaries already paid for on everything genuine. Only a *completed*
sweep may prune; an interrupted one has simply not reached the rest of the feed yet. The
in-page dedupe cache is cleared when a sweep starts, or posts already seen this page
session would be missing from the census and look like strays.

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
already-categorised post never overwrites its summary in `db.putIfNew`). Indexes on
`category`, `postedAt`, `categorizedAt`.

Record schema (`src/types.ts`) — the nullable tail exists so a later pipeline can
backfill without a migration:

```ts
shortcode, permalink, handle, caption, hashtags[], thumbnailUrl,
isVideo, durationSec, audioTrackName, altText,
postedAt, firstSeenAt, savedRank, seenInSavedFeed,
category, subcategory, tags[], summary, categorizedAt, modelUsed,
// declared, never populated by this extension:
transcript, ocrText, embedding, perceptualHash
```

`schemaVersion` is stored per record, and `db.upgrade()` is a pure function of
`(record, fromVersion)` so `npm run verify` can exercise every migration without a browser.

### 3a. Time, and what we are allowed to claim about it

Instagram sends **no save timestamp** in the saved feed — not in the REST shape, not in the
GraphQL one. Three fields carry what can honestly be said:

- `postedAt` — the post's own publish time (`taken_at`). Previously misnamed `savedAt`,
  which is exactly the confusion this split exists to end.
- `firstSeenAt` — when this extension first stored the record. Not a save date, but for
  anything saved while it is installed, within a browse of one.
- `savedRank` — the feed's *order*, which Instagram does send: newest-saved first. Each
  visit to the grid gets a session number and the rank folds session with position
  (`session * STRIDE - index`), so one descending sort reads "latest visit first, feed
  order within a visit". A record keeps the rank it was first given, so re-sweeping walks
  the whole feed without shuffling anything.

Save order is the library's default sort — ordering a saved library by publish date files a
2019 clip you saved yesterday at the very bottom. The migration leaves `firstSeenAt` and
`savedRank` null on older records rather than back-dating them from `postedAt`: a guess
that reads like a fact is worse than a blank.

**Known gap.** Saving a post and returning to the grid without a page load files it below
the backlog until the next load, because it is still the same session. Living with that is
cheaper than every alternative, all of which involve guessing.

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

**Accuracy.** The prompt carries each category's subcategory list, which turns that field
from free text into a closed vocabulary. Every post is described with its handle, caption,
hashtags, media type, audio track and — importantly — Instagram's own alt text, which on a
caption-less reel is usually the strongest signal available and costs nothing. The model
returns a `confidence`; a `low` answer keeps its summary but drops the category, so an
unplaceable post lands in Uncategorized rather than somewhere you would never look for it.

**Execution:** concurrency limit of **3** in-flight requests, exponential backoff with
jitter on 429/5xx, and resume-on-failure — progress lives in IndexedDB, so a crashed
service worker or closed tab loses at most the in-flight batch. Already-categorised posts
are never re-sent (`categorizedAt != null` is the guard).

---

## 4a. Cost accounting

Estimates were a placeholder; spend is now metered. Every provider returns token counts on
its response, so `Provider.chat` hands back `{ text, usage }` and `background/spend.ts`
accumulates tokens and dollars in `storage.local` — outliving the service worker, which is
killed between batches.

| Number | Where it comes from |
|---|---|
| **spent** | reported `usage` × the model's published per-million list price |
| **left, at most** | pending posts × ~145 input + ~50 output tokens each, at list price |

The estimate is deliberately an upper bound: it assumes every pending post reaches the
model, when in practice the free rule pre-pass takes a large share first. Spend is recorded
in `callWithRetry`, so a response that then fails to parse still counts — the provider
billed for it either way.

The cost of a **capture** is zero: it reads responses the page was already fetching.

---

## 5. Provider adapter

`background/providers/` — one interface, four implementations:

```ts
interface Provider {
  chat(req: ChatRequest, key: string, model: string): Promise<ChatResult>
}
type ChatResult = { text: string; usage: { inputTokens: number; outputTokens: number } }
```

| Provider | Endpoint | Note |
|---|---|---|
| Anthropic | `api.anthropic.com/v1/messages` | needs `anthropic-dangerous-direct-browser-access: true` or CORS fails; usage on `usage.{input,output}_tokens` |
| OpenAI | `api.openai.com/v1/chat/completions` | usage on `usage.{prompt,completion}_tokens` |
| Gemini | `generativelanguage.googleapis.com/v1beta/…:generateContent` | key in the `x-goog-api-key` header, never the URL; usage on `usageMetadata` |
| OpenRouter | `openrouter.ai/api/v1/chat/completions` | OpenAI-shaped; upstream list price passed through |

The adapter is hand-written against each REST API rather than pulling in four vendor SDKs:
an MV3 service worker bundle has to stay small, and three of the four SDKs assume a Node or
bundler runtime this doesn't have.

Every call happens in the service worker. The key is masked after save (`sk-ant-a…9f2c`)
and never logged — `providers/index.ts` has a `redact()` used on every error path, which
strips `sk-*`, `AIza*` and `Bearer …` shapes out of anything headed for a log or the UI.

---

## 6. Video controls

`page/video.ts`, ISOLATED world, `instagram.com/*`.

**The problem is the click-catcher.** Instagram covers every player with a full-bleed
overlay whose job is to open the post. Two consequences, and the first build lost to both:

1. `pointerenter` on the `<video>` never fires — the pointer is over the catcher, not the
   video — so a scrubber that waited for it appeared only intermittently.
2. Clicks on the browser's own control strip land on the catcher, so the native scrubber
   looks live and does nothing. Raising the video's `z-index` only wins when no ancestor
   has opened its own stacking context, which on Instagram is a coin flip.

**The fix is to stop playing on their field.** The control bar is a `<div>` appended to
`document.body` — a *sibling* of React's root container, not a descendant. Two things
follow for free: React's delegated handlers never see our clicks, because they are bound at
that root container; and no stacking context inside their tree can bury us.

Targeting is **geometric, not event-driven**: a `document`-level `pointermove` listener in
the **capture phase** records the cursor, and the bar binds to the smallest visible
`<video>` whose rect contains it. A capture-phase listener cannot be suppressed by the page,
so this holds whatever the catcher does with events. The bar sits *inside* the player's
bottom edge, so the cursor is still within the video's rect while using it.

Per video, still: remove `controlsList`, `disablePictureInPicture` and `loop`; a global
`MutationObserver` for players React adds later; a per-video attribute observer to re-apply
after a re-render; both rAF-throttled. Arrow keys seek ±5 s.

Two modes, toggled in settings:

| | |
|---|---|
| **overlay** (default) | our bar: play/pause, elapsed/duration, drag-to-seek, mute |
| **native** | the browser's own strip, plus the old `z-index` lift — volume and PiP, at the mercy of the catcher |

Ending a drag installs a one-shot capture-phase `click` swallow, or releasing the scrubber
would open the post underneath.

**Sound has to be held down.** Unmuting a reel only lasted until the next pause. Nothing
here sets `muted`; Instagram does, as part of its own play/pause handling — autoplay policy
only lets it *start* a muted video, and the same helper runs when you resume one by hand.
Our mute button therefore records the intent per player, and a `play`/`playing`/`pause`
listener plus any `volumechange` within 600 ms of one puts it back. The window is the whole
design: outside it, a mute is yours and stands. Per player rather than global, so scrolling
to the next reel never starts playing audio you did not ask for.

**Two boundaries worth naming.** Targeting is geometric, so a player *behind* the library
overlay is still "under" the cursor — `elementFromPoint` is checked first, or the bar would
draw over the library. And keyboard guards read `composedPath()[0]` rather than `ev.target`,
because `ev.target` retargets to the shadow host for anything inside our own UI: arrow keys
typed in the library's search box were seeking the video instead of moving the caret.

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

# TODO — Saved Index

Ordered. Each phase is one commit. `[x]` = done and committed.

## Phase 0 — Scaffold
- [x] `package.json`, `tsconfig.json`, `build.mjs` (esbuild, 4 entry points)
- [x] `.gitignore`, `git init`
- [x] `manifest.json` — MV3, two content scripts (MAIN + ISOLATED), web_accessible_resources

## Phase 1 — Schema + taxonomy
- [x] `src/types.ts` — PostRecord incl. nullable `transcript` / `ocrText` / `embedding` / `perceptualHash`
- [x] `src/taxonomy.ts` — 12 categories, hashtag + keyword rules, scored matcher with margin floor
- [x] `src/messaging.ts` — typed message contracts between the three contexts

## Phase 2 — Capture
- [x] `src/capture/main-world.ts` — patch fetch + XHR at document_start, postMessage out
- [x] `src/capture/extract.ts` — shape-driven walker (URL decides *whether*, shape decides *what*)
- [x] `src/capture/dom-scrape.ts` — first-screenful fallback
- [x] `src/capture/bridge.ts` — ISOLATED receiver → service worker
- [x] Auto-scroll harvester: randomised 800–2000 ms, halt on 429

## Phase 3 — Storage
- [x] `src/background/db.ts` — IndexedDB, keyPath `shortcode`, indexes on category/savedAt/categorizedAt
- [x] `putIfNew` — dedupe by shortcode, never clobber a categorised record
- [x] `src/background/settings.ts` — storage.local + `setAccessLevel({TRUSTED_CONTEXTS})` on every SW start

## Phase 4 — Providers
- [x] `providers/index.ts` — adapter interface, registry, `redact()`, model catalogue
- [x] `anthropic.ts` (+ `anthropic-dangerous-direct-browser-access: true`), `openai.ts`, `gemini.ts`, `openrouter.ts`
- [x] Vision support per provider (smallest thumbnail, base64)
- [x] `testKey()` — one cheap round-trip for the popup's Test button

## Phase 5 — Categoriser
- [x] Tier 1 deterministic pre-pass
- [x] Tier 2 text batch (25/request, JSON-only, fixed keys)
- [x] Tier 3 vision fallback (caption empty or < 15 chars)
- [x] Concurrency 3, exponential backoff + jitter, resume on failure
- [x] Progress events → popup + in-page strip

## Phase 6 — Service worker wiring
- [x] `background/index.ts` — message router, run/pause/resume, stats

## Phase 7 — In-page library
- [x] Shadow-DOM mount over `instagram.com/saved`, SPA-navigation aware
- [x] Rail (categories + counts + Uncategorized), search, grid/list toggle
- [x] Cards fill in as they categorise — no reflow, "in queue" → summary in place
- [x] Indexing strip: running / paused / done / error
- [x] Empty + error states (nothing captured, key rejected, no matches)

## Phase 8 — Video
- [x] `page/video.ts` — controls=true, strip controlsList/disablePictureInPicture/loop, z-index fix
- [x] Global MutationObserver + per-video attribute observer, rAF-throttled
- [x] Arrow keys ±5 s
- [x] Thin-scrubber skin (3px/7px/9px, accent drag fill), toggleable in settings

## Phase 9 — Popup
- [x] 3-step onboarding: provider → model + key + Test → index control
- [x] Key masked after save, never logged
- [x] Settings: auto-index toggle, scrubber skin toggle

## Phase 10 — Ship
- [x] Icons (generated, `npm run icons`)
- [x] `README.md` — load steps, where each piece lives, cost notes, troubleshooting
- [x] Typecheck + build clean, `npm run verify` green

---

## Next, if this gets used in anger

- [ ] Sort control in the library header (design shows "Recently saved"; currently fixed
      to newest-first)
- [ ] Post detail view — summary beside the video, "Change category" (design §05)
- [ ] Virtualised grid: the library renders up to 200 rows at a time; past a few thousand
      posts that wants windowing
- [ ] `db.all()` is read fully on every query and every categoriser round — fine at a few
      thousand posts, wants an index-backed cursor beyond that
- [ ] Offline state: detect `navigator.onLine` and show the design's offline card with
      auto-retry
- [ ] Export the library as JSON/CSV
- [ ] Collections — Instagram's saved posts can be grouped; currently flattened

## Deliberately out of scope
- Transcription (Instagram doesn't expose transcripts on web)
- Publishing to the Web Store (loaded unpacked)
- `sidePanel` (superseded by popup + in-page library)
- Populating `transcript` / `ocrText` / `embedding` / `perceptualHash` — schema accepts them
  so a later pipeline can backfill without a migration

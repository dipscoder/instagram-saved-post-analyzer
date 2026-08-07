# TODO — Saved Index

Ordered. Each phase is one commit. `[x]` = done and committed.

## Phase 0 — Scaffold
- [ ] `package.json`, `tsconfig.json`, `build.mjs` (esbuild, 4 entry points)
- [ ] `.gitignore`, `git init`
- [ ] `manifest.json` — MV3, two content scripts (MAIN + ISOLATED), web_accessible_resources

## Phase 1 — Schema + taxonomy
- [ ] `src/types.ts` — PostRecord incl. nullable `transcript` / `ocrText` / `embedding` / `perceptualHash`
- [ ] `src/taxonomy.ts` — 12 categories, hashtag + keyword rules, scored matcher with margin floor
- [ ] `src/messaging.ts` — typed message contracts between the three contexts

## Phase 2 — Capture
- [ ] `src/capture/main-world.ts` — patch fetch + XHR at document_start, postMessage out
- [ ] `src/capture/extract.ts` — shape-driven walker (URL decides *whether*, shape decides *what*)
- [ ] `src/capture/dom-scrape.ts` — first-screenful fallback
- [ ] `src/capture/bridge.ts` — ISOLATED receiver → service worker
- [ ] Auto-scroll harvester: randomised 800–2000 ms, halt on 429

## Phase 3 — Storage
- [ ] `src/background/db.ts` — IndexedDB, keyPath `shortcode`, indexes on category/savedAt/categorizedAt
- [ ] `putIfNew` — dedupe by shortcode, never clobber a categorised record
- [ ] `src/background/settings.ts` — storage.local + `setAccessLevel({TRUSTED_CONTEXTS})` on every SW start

## Phase 4 — Providers
- [ ] `providers/index.ts` — adapter interface, registry, `redact()`, model catalogue
- [ ] `anthropic.ts` (+ `anthropic-dangerous-direct-browser-access: true`), `openai.ts`, `gemini.ts`, `openrouter.ts`
- [ ] Vision support per provider (smallest thumbnail, base64)
- [ ] `testKey()` — one cheap round-trip for the popup's Test button

## Phase 5 — Categoriser
- [ ] Tier 1 deterministic pre-pass
- [ ] Tier 2 text batch (25/request, JSON-only, fixed keys)
- [ ] Tier 3 vision fallback (caption empty or < 15 chars)
- [ ] Concurrency 3, exponential backoff + jitter, resume on failure
- [ ] Progress events → popup + in-page strip

## Phase 6 — Service worker wiring
- [ ] `background/index.ts` — message router, run/pause/resume, stats

## Phase 7 — In-page library
- [ ] Shadow-DOM mount over `instagram.com/saved`, SPA-navigation aware
- [ ] Rail (categories + counts + Uncategorized), search, grid/list toggle, sort
- [ ] Cards fill in as they categorise — no reflow, "in queue" → summary in place
- [ ] Indexing strip: running / paused / done / offline
- [ ] Empty + error states (nothing indexed, no key, key rejected, offline)

## Phase 8 — Video
- [ ] `page/video.ts` — controls=true, strip controlsList/disablePictureInPicture/loop, z-index fix
- [ ] Global MutationObserver + per-video attribute observer, rAF-throttled
- [ ] Arrow keys ±5 s
- [ ] Thin-scrubber skin (3px/7px/9px, accent drag fill), toggleable in settings

## Phase 9 — Popup
- [ ] 3-step onboarding: provider → model + key + Test → index control
- [ ] Key masked after save, never logged
- [ ] Settings: auto-index toggle, scrubber skin toggle

## Phase 10 — Ship
- [ ] Icons
- [ ] `README.md` — load steps, where each piece lives, cost notes, troubleshooting
- [ ] Typecheck + build clean

## Deliberately out of scope
- Transcription (Instagram doesn't expose transcripts on web)
- Publishing to the Web Store (loaded unpacked)
- `sidePanel` (superseded by popup + in-page library)
- Populating `transcript` / `ocrText` / `embedding` / `perceptualHash` — schema accepts them
  so a later pipeline can backfill without a migration

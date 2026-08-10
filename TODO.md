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

# Round 2 — first-run feedback

Filed after using the built extension. Each phase is one commit.

## Phase 11 — Key visibility and removal
- [x] `maskKey` result must render as *text*, not inside a `type="password"` field —
      the mask was there all along but drawn as `•••••`
- [x] Connected state is its own row: provider · masked key · Test · Replace · Remove
- [x] `settings:clear-key` request; clearing wipes only the key, never the DB

## Phase 12 — Cost accounting (real, not guessed)
- [x] `Provider.chat` returns `{ text, usage: { inputTokens, outputTokens } }`
- [x] `ModelInfo` carries `inputPer1M` / `outputPer1M` list prices, not a made-up
      per-1k-posts figure
- [x] `background/spend.ts` — cumulative tokens + USD in `storage.local`, per model
- [x] Progress carries `spentUsd` and `estimateUsd`; popup and library both show them

## Phase 13 — Onboarding rewrite
- [x] First screen answers "what is this and what do I do first" before asking for a key
- [x] Provider + model + key on one screen, not three
- [x] Explicit "you can browse without a key" path
- [x] Post-setup screen is the control room: found / indexed / pending, spend, controls

## Phase 14 — Library filters and stable rendering
- [x] Categories are **single-select** — a click replaces the selection
- [x] ⌘/Ctrl-click adds a second category; chips row shows and clears the combination
- [x] Re-render preserves scroll position and focus (progress pushes were bouncing the
      grid back to the top mid-scroll — the "glitchy" scrolling)
- [x] Coalesce refreshes so a burst of writes costs one re-render

## Phase 15 — Indexing you can see and steer
- [x] Explain the two halves in-product: capture (scroll-driven) vs categorise (worker)
- [x] Pause/Resume stops and restarts *both* halves — `harvest-stop` / `harvest-start`
      broadcasts so a pause in the popup stops the page auto-scroll too
- [x] Show captured-so-far, pending, spend, and estimate while running

## Phase 16 — Video controls that actually seek
- [x] Root cause: Instagram's click-catcher sits above `<video>`, so `pointerenter`
      never fired and native control clicks never reached the player
- [x] Own control bar rendered into `document.body` — hit-tested by geometry, immune to
      Instagram's stacking contexts. Play/pause, elapsed/duration, drag-to-seek
- [x] Swallow the click that ends a scrub so the post doesn't open

## Phase 17 — Categorisation accuracy
- [x] Feed the model `altText`, media type, and audio track — Instagram's alt text is
      often the strongest signal on a caption-less reel
- [x] Give the model the subcategory vocabulary instead of free text
- [x] `confidence` field; low confidence lands in Uncategorized rather than guessing

## Phase 18 — Docs
- [x] ARCHITECTURE.md: cost accounting, the video rework, the trust boundary as drawn
- [x] README: how indexing works, what it costs, security answers

---

# Round 3 — second-run feedback

Filed after living with it. Each phase is one commit.

## Phase 19 — Sound that stays on
- [x] Bug: unmute, then pause/play, and Instagram re-mutes the player
- [x] Hold the user's unmute intent per video and re-assert it, but *only* inside the
      play/pause window — a deliberate mute during steady playback must stand

## Phase 20 — Only index what is actually saved
- [x] Bug: posts the user never saved were being captured and paid for. Three leaks:
      the GraphQL URL patterns match *every* Instagram query (home feed, explore,
      profile grids, related reels); the bridge ingests on every route, not just
      `/saved`; and the DOM fallback scrapes `a[href^="/p/"]` across the whole document
- [x] Route gate — capture only while the saved grid is the page
- [x] Payload scope — a GraphQL body only counts inside a container named for the saved
      feed; the REST saved/collections paths stay trusted whole
- [x] DOM fallback scoped to the saved grid, not the document
- [x] Stamp `seenInSavedFeed` on capture; after a *complete* sweep, offer to remove
      records the feed no longer lists (strays and unsaved posts) — keeps the
      categorisation already paid for on the genuine ones

## Phase 21 — Search that finds things
- [x] Multi-word queries AND together instead of matching one literal substring
- [x] Search subcategory, hashtags, alt text and audio track too — not just summary,
      caption, handle, category, tags
- [x] Return the true match count and stop silently truncating at 200

## Phase 22 — Dates, and the order the library is in
- [x] `savedAt` is misnamed: it is the post's own timestamp. Rename to `postedAt`
- [x] Add `firstSeenAt` (when this extension first stored it) and show both
- [x] Instagram does not expose a save *timestamp*, but the feed is ordered newest-saved
      first — capture that order as `savedRank` and make it the default sort
- [x] Sort control: Save order / Newest post / Oldest post

## Phase 23 — The overlay is a view, not a takeover
- [x] One obvious segmented control: Library ↔ Instagram, replacing the quiet Hide button
- [x] The restore chip moves into the Shadow DOM so it shares the design system
- [x] `⌥/Alt + S` toggles, guarded so it never fires inside a text field

## Phase 24 — Visual pass
- [ ] Calmer type scale, one accent, more restful spacing
- [ ] Cards carry the information the new fields make available

## Phase 25 — Docs
- [ ] ARCHITECTURE: capture scoping as a trust boundary of its own
- [ ] README: what the search covers, what the dates mean, what save order is

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

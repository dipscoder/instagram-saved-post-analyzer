# TODO — Saved Index

Ordered delivery record. `[x]` = implemented; use Git history for exact commit boundaries.
Start at [`PROJECT_INDEX.md`](PROJECT_INDEX.md) for the current state and file map. The
small remaining backlog is grouped at the end of this file.

## Phase 0 — Scaffold
- [x] `package.json`, `tsconfig.json`, `build.mjs` (esbuild, 4 entry points)
- [x] `.gitignore`, `git init`
- [x] `manifest.json` — MV3, two content scripts (MAIN + ISOLATED)
      (`web_accessible_resources` was removed in Phase 30 — a manifest-declared MAIN-world
      script does not need it, and it let instagram.com fingerprint the extension)

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
- [x] `src/background/db.ts` — IndexedDB, keyPath `shortcode`, indexes on
      category/postedAt/categorizedAt (`savedAt` renamed in Phase 22)
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
- [x] Five-step type scale, 4px spacing grid — no more sizes between 9px and 14px
- [x] Accent moves from green to a desaturated indigo, shared by popup and library
- [x] Category hues assigned by taxonomy position, not a name hash (which gave three
      near-identical blues and nothing in the greens)
- [x] Visible `:focus-visible` rings — the whole library is tab-reachable
- [x] Cards: softer corners, hover surface that bleeds past the content, aligned gutters

## Phase 25 — Docs
- [x] ARCHITECTURE: capture scoping as a trust boundary of its own
- [x] README: what the search covers, what the dates mean, what save order is

---

# Round 4 — hardening pass

A full audit across capture, storage, categorisation, providers, both UIs and the video
layer, plus the free-tier persistence question. Findings were verified against the code
before being acted on.

## Phase 26 — The ledger (answers "stop paying for the same post twice")
- [x] Evaluated the managed options first. Supabase pauses free projects after a week of
      inactivity; Turso is mid-pivot with guarantees scoped to paying customers; Cloudflare
      D1 needs a Worker, which makes "there is no server in this project" false; Firestore
      Spark's 20K writes/day cap is consumed by a single 20k-post first sync. None of them
      fixed the actual leak, which was local.
- [x] `src/background/ledger.ts` — split the store along the line that matters: `posts` is
      a disposable view, `analysis` is work that was bought. `prune` and `resetCategories`
      may not touch the second
- [x] `src/hash.ts` + `inputHash` — a verdict records a digest of the exact text the model
      was shown, so "is this still valid?" is a comparison rather than a guess
- [x] `TAXONOMY_HASH` derived from the definitions at load, never hand-bumped, pinned in
      `verify.ts` so a taxonomy edit that re-bills every library is a line in the diff
- [x] `index:quote` — Re-index states what it will actually charge, then confirms
- [x] Export / import as a JSON file, via a Blob from the popup — no new permission
- [x] `markUnclassifiable` is no longer terminal: banked as `skipped`, which is deliberately
      never reused, so a re-index retries what was usually just an expired thumbnail

## Phase 27 — Money and correctness in the categoriser
- [x] Resume was a no-op — `cancelled` was cleared *after* the early return
- [x] Model-chosen `r.id` indexed the batch array unvalidated: floats, negatives and repeats
      all accepted, so one response could file 25 posts under one neighbour's answer
- [x] `applyResult` coerces every field — `tags: "a, b"` reached `.map` on a string, threw,
      and ended the run with a TypeError after the batch had been paid for
- [x] A billed response survives a storage failure; a network `TypeError` is retryable and
      sets the `offline` phase that was declared and never used
- [x] `retry-after` is honoured; three retries no longer burn 7s of a 60s cooldown
- [x] Unanswered posts are bounded, so a model that answers for part of a batch cannot
      re-bill the remainder every round
- [x] Thumbnail fetch: CDN allowlist, size cap, timeout

## Phase 28 — Capture, storage and ordering
- [x] `isSavedRoute` was unanchored — `/explore/tags/saved/` passed both fences, so a
      hashtag grid could be captured as saved posts *and* counted as a census of them
- [x] A stalled load looked identical to end-of-feed; the terminal round now pays for a
      settle before authorising deletion. Sweeps also latch their starting route
- [x] The 429 latch is per-sweep, not per-tab — one rate-limit no longer disables Index now
      for the life of the page
- [x] `main-ready` closes the handshake in both directions
- [x] Resident read cache: `getAll()` on every keystroke, every stat and every census
      became one read per worker wake, with the haystack memoised
- [x] `savedRank` is backfillable — every migrated record was scoring 0 and sorting last
      forever under the default sort
- [x] One cursor per page load, so two open saved tabs stop resetting each other's session
      and inverting the library
- [x] `resetCategories` runs in one transaction; the read-modify-write could revert a
      `seenInSavedFeed` stamp and manufacture a false stray census
- [x] Migration fills every field the schema promises; `onblocked`; promise-cached open

## Phase 29 — Providers
- [x] Claude Sonnet 5 was priced at Sonnet 4.6's $3/$15 — it is $2/$10, a 50% over-report
      on a figure the docs sell as metered rather than estimated
- [x] Gemini's `thoughtsTokenCount` is billed at the output rate and was never counted
- [x] Add GPT-5.6 Luna and Terra through the reasoning-aware Responses API; keep 4o on its
      proven Chat Completions path so existing selections do not change underneath users
- [x] Add Gemini 3.8 Flash with low thinking and an automatic switch from its 2026
      introductory price to the announced 2027 standard price
- [x] Make Claude Sonnet 5's adaptive thinking explicit at low effort instead of silently
      accepting its high-effort default for a short classification task
- [x] A non-JSON 200 (captive portal, proxy) is a retryable ProviderError, not a raw
      SyntaxError shown verbatim
- [x] `redact()` runs before truncation, so a key straddling character 400 cannot survive
      as a fragment
- [x] Unknown provider/model ids are clamped on read — an unknown model made `usdFor`
      return 0, so real calls were billed while the UI reported $0.00

## Phase 30 — The two UIs
- [x] **The $0.00 button.** The finished-state primary routed straight to `index:reindex`,
      unconfirmed, under a "left, at most" readout that reads `pending` — which is 0 in
      exactly that state. ~$7.90 on a 20k library, one click
- [x] `[hidden]` never worked (author `display:flex` beats the UA rule), so the second key
      field sat permanently on screen and Replace looked broken
- [x] Toggles were `<div>`s: unfocusable, unannounced, keyboard-dead — including the one
      that stops the extension spending money automatically
- [x] Dark-mode primary button was white-on-lavender at 2.05:1; `--text-3` was 3.30:1 and
      carried every money label and both destructive links
- [x] One five-step type scale across popup and library; hit areas to 24px
- [x] Library: worker-unreachable no longer renders as "you have nothing saved"; query
      generation guard; list rebuilt only when it changed; Escape dismisses; Instagram
      goes `inert` behind the overlay; `aria-live` on the counts
- [x] Search folds diacritics, debounces past its own round trip, and skips the stats
      request it never needed
- [x] Video: arrow keys no longer steal story and carousel navigation; fullscreen keeps
      controls; retarget on scroll; the bar stays clear of Instagram's reel chrome
- [x] `web_accessible_resources` removed — unnecessary for a manifest-declared MAIN-world
      script, and it let the page confirm the extension is installed

## Phase 31 — Tests and docs
- [x] `verify.ts` 61 → 118 checks: route anchoring, hash stability, the pinned taxonomy
      hash, ledger freshness, migration completeness, diacritic folding, two-tab ordering
- [x] `CLAUDE.md` — orientation for a new session: the five invariants, the trust
      boundary, and the deliberate oddities that look like bugs
- [x] `PROJECT_INDEX.md` — canonical reading order, code map, live-smoke checklist, and
      concise handoff state for humans and coding agents
- [x] ARCHITECTURE §3b — the ledger; README — corrected cost figure ($0.37 → $0.40) and
      the honest framing that it is a typical price, not a ceiling

## Phase 32 — Media resilience and visual redesign
- [x] Fresh saved-feed captures replace expired Instagram CDN URLs without touching paid
      summaries, categories, first-seen dates, or established save order
- [x] Broken previews render an accessible, intentional placeholder instead of the
      browser's broken-image icon and full alt-text spill
- [x] DOM capture prefers the browser-selected `currentSrc`; untrusted media URLs are
      bounded and restricted to Instagram-owned HTTPS hosts before storage or model use
- [x] Library redesigned around a search-first header, structured navigation, responsive
      surfaced cards, restrained category colour, and clearer detail/indexing states
- [x] Popup redesigned with one visual hierarchy, compact setup copy, grouped statistics,
      clearer key actions, and accessible light/dark contrast
- [x] New reproducible indexed-bookmark icon at 16, 48, and 128 px

## Phase 33 — Repo layout for extension + backend + web app
- [x] npm workspaces: `extension/` (the existing extension, unchanged in behaviour) and
      `shared/` (taxonomy + input digest, needed by the backend and web app too)
- [x] `web/` and `supabase/` reserved with a README each; no code until their phase
- [x] OpenAI is the only provider. Anthropic, Gemini and OpenRouter adapters, host
      permissions and checks removed; a stored non-OpenAI provider migrates to OpenAI and
      drops its key
- [x] 147 checks (catalogue checks replaced, settings-migration checks added)

## Phase 34 — Accounts and sync (Phase 2a of the web app plan)
- [x] `public.posts` in Supabase with Row Level Security; tested against Postgres that
      another user and an anonymous caller can neither read nor write someone's posts
- [x] Email + password sign-in in the popup; the session stays in the service worker
- [x] The local library mirrors to the account as a diff: only new or changed posts are
      uploaded, pruned posts are deleted, and an interrupted sync resumes from the last
      confirmed batch
- [x] Create Account signs straight in (an existing email with the right password falls
      through to sign-in); the email-confirmation step is a project setting, documented in
      `supabase/README.md`
- [x] Popup restyled around a new brand: coral-to-violet icon, violet tint, warm neutrals;
      "Open Library" goes to the saved feed last seen capturing
- [x] Check for an Instagram-provided transcript: there is none on web; reels need
      speech-to-text on their audio

## Phase 35 — Thumbnails and the ledger in the account (Phase 2b)
- [x] One JPEG per post (480 px long edge) in a private Storage bucket, copied 20 at a time
      with a jittered pause between downloads; expired URLs wait for a fresh capture
- [x] `public.verdicts` mirrors the ledger, with no delete policy; the first sync for an
      account pulls it back, so a new browser never re-pays for a summary
- [x] Post text columns widened to the ledger's 2,000-character import limit
- [x] 166 checks

## Phase 36 — Analysis through the account (Phase 3)
- [x] `analyze` Edge Function: the Decisions API picks the category (with `unknown` and a
      0.6 probability floor), one batched call writes summary, tags and subcategory
- [x] The OpenAI key lives only in the function's secrets; the function uses the caller's
      session, so RLS applies and no service-role key is needed
- [x] `public.usage` and `record_usage`: spend per user per UTC day, add-only, with a
      `DAILY_CAP_USD` limit enforced before any call
- [x] Signed in, the extension indexes without a key; your own key still works signed out
- [ ] Deploy the function from CI on push to main
- [x] 183 checks
- [ ] Reel transcription with `gpt-transcribe`, on audio the page already loads
- [ ] A labelled test set and an accuracy eval for the two-call filing

## Phase 37 — A better video player
- [x] Smooth scrubbing: one seek in flight per video, the slider follows the pointer, and
      playback pauses for the drag
- [x] Frame-by-frame stepping from the bar or `,` / `.`, anchored on the presented frame,
      with a precise timecode while paused
- [x] Save the frame on screen as a full-resolution PNG, or copy it with Shift-click
- [ ] Frame stepping and stills are off (`FRAME_TOOLS = false`) pending a redesign
- [x] 200 checks

## Phase 38 — Light theme and a calmer design
- [x] Light by default with a dark toggle in the library and the popup, synced through
      the worker (`theme:set`, the only setting the library may change)
- [x] Library redesign: warm neutral canvas, boxless cards with 4:5 thumbnails, coloured
      category dots, a plain-language progress line, details folded away
- [x] Popup redesign on the same tokens, ink primary buttons, no glow
- [x] 203 checks

---

## Phase 39 — The web app is the product
- [x] Extension popup cut to sign in, Find new posts and Open your library
- [x] In-page library overlay removed; the pill only finds posts, removes strays, and links to the web app
- [x] The extension never indexes on its own; indexing runs from the web app on the server
- [x] Web app: Index bar on every view, Settings sheet (account, spend, Clear library)
- [x] `library_state.cleared_at`: a clear in the web app empties each extension's copy on its next sync
- [x] Delete the extension's now-dormant indexing code: see Phase 42

## Phase 40 — Analysis v2: search by meaning, better vision, an eval
- [x] Embeddings (text-embedding-3-small, 512 dims) on every indexed post, written by `sort`
- [x] `search_posts`: keyword and meaning rankings fused with RRF; `search` Edge Function
- [x] Web search uses it, falling back to keyword search when the function is missing
- [x] Thin captions (under six words, no alt text) are filed with their picture too
- [x] `supabase/eval/labeled.json` + `npm run eval`; verify pins that rules misfile none
- [x] Reel transcripts: see Phase 41
- [x] Grow the eval set from real mistakes: **Wrong category?** in the post panel files the
      post by hand (a verdict that sticks) and keeps it in `corrections`; Settings downloads
      them, `npm run eval -- --with <file>` runs them
- [x] `/how-it-works` in the web app: the pipeline step by step with the library's own
      counts, one of the user's posts taken apart, prices and guardrails. Steps from a
      migration not yet run are left out; verify pins its models and prices to the server's constants

## Phase 41 — Reels are filed and searched by what is said in them
- [x] The extension captures each reel's smallest video rendition and syncs it (`video_url`)
- [x] `sort` transcribes up to four reels a request with `gpt-transcribe`, then files the
      reel from caption + transcript + cover image, and embeds the transcript
- [x] Transcribed once: silence and over-ten-minute reels are recorded, an expired address
      is retried when a sync brings a fresh one; only Instagram's CDN is fetched
- [x] Transcripts are in keyword search, in the meaning embedding, and in the post panel
- [x] The quote adds each reel's transcription by its length; the Index bar counts reels
      still to transcribe
- [x] Indexing failures are recorded on the post with a reason; three failures and Index
      leaves it out until it changes or the user presses Try again
- [x] A full batch no longer runs out of output tokens mid-answer (and a cut-off answer
      keeps every complete post); one failed batch no longer ends the whole run
- [ ] Several frames per reel rather than only the cover (needs video decoding on the server)

## Phase 42 — The extension only collects
- [x] Removed the categoriser, the OpenAI adapter, spend metering, the own-key settings, the
      local run queue, local search and ledger import/export (about 1,900 lines net)
- [x] Settings v3 keeps only the theme and video controls, and deletes the OpenAI key an
      older build stored; DB v9 drops the `indexQueue` store
- [x] `api.openai.com` is gone from the manifest's host permissions
- [x] Kept: capture, Find new posts, Remove for unsaved posts, sync, thumbnails, the ledger
      pull, and following Clear library
- [x] Checked by loading the old build into a browser profile, then the new one: posts and
      verdicts survive, the key and the queue are gone

## Phase 43 — Polish pass for the beta
- [x] Every enabled button and link shows a pointer (Tailwind v4 had dropped it)
- [x] Search has a clear button; icons have real tooltips; How it works is linked from the
      Index bar and the empty library
- [x] Change category is a visible button with a menu; a toast confirms the move and can undo it
- [x] ← and → step through posts in the panel
- [x] Plain words: To review (was Needs a look), "ready to index", "reels to listen to"
- [ ] Edit a post's tags (needs a verdict write; goes with the categories work)

## Phase 44 — Index one post
- [x] Index this post in the panel of a post never indexed, with its price (and "including
      listening to the reel" when it has one to transcribe); Try again for one given up on
- [x] Index again beside Change category on a filed post, with a confirm that says what it
      replaces and what it costs
- [x] `sort` takes `refile: true` for one post only: the model files it whatever it holds,
      never the keyword rules

## Phase 45 — Fixes from the first user test (2026-11-25)
- [x] One word per idea: **Organise** (was Index) and **Needs a category** (was Unknown, To
      review and "the AI wasn't sure")
- [x] The Organise bar counts only posts never organised; improving search for older posts
      is a separate, optional line
- [x] Root cause of counts that grew after a scan found nothing new: a grid tile's alt text
      and alt-parsed hashtags overwrote Instagram's own data on every page load, so the
      server re-embedded those posts. Grid captures now only fill gaps
- [x] Undo after Change category restores the full previous verdict and drops the
      correction (`undo_correction`, migration 20261125090000)
- [x] Confirm buttons that spend or erase never land under the cursor, and arm after 0.5 s;
      Organise this post shows its price on the button
- [x] The header shows the real count; Settings counts organised posts correctly and calls
      spend "AI runs"; the eval tools sit under For developers
- [x] Search says which category it searched, with Search all; the category menu is
      alphabetical like the sidebar; the post panel shows the summary and tags first

## Phase 46 — A way in from zero (user test, 2026-11-25)
- [x] An empty library is a three-step welcome (account, collect, organise) that turns into
      the library on its own when the first posts sync
- [x] A ? Help menu in the header: adding saves, search, fixing a category, cost, and How it
      works as "Under the hood"
- [x] The extension opens the web app on first install
- [x] The pill sits bottom centre, clear of Instagram's Messages dock; a finished sweep says
      "no new saves" or "N new posts" and its link becomes "Organise them"
- [x] Open library brings an open library tab forward instead of opening another (host
      permission for the web app's own origin; `verify` pins it to `WEB_APP_URL`)

## Phase 47 — Suggest, don't guess (user test, 2026-11-25)
- [x] Unsure posts keep the AI's likeliest categories (`posts.suggestions`, from the
      Decisions API probabilities the filing call already paid for); still filed as no
      category, so a wrong guess never hides a post
- [x] Needs a category → Sort them one by one: one post at a time, keys 1/2/3 and S, free,
      each with Undo; the post panel shows the same suggestions
- [x] `sort` with `suggest: true` asks for suggestions for posts filed before this, category
      decisions only, quoted and confirmed, each post asked at most once
- [x] The category question steers food places in city guides to Food & Recipes (why
      "9 late-night eateries" split between Food and Travel and was left unfiled)
- [ ] A Places category: deferred; adding a category changes TAXONOMY_HASH

## Phase 48 — The library as a place you can come back to (2026-11-26)
- [x] The address holds the view, the search and the open post (`web/lib/url-state.ts`):
      a reload, a bookmark or Back lands in the same place; a new view is a Back step,
      typing and opening a post are not
- [x] Opening the post panel focuses the panel, not its first button, and tooltips open on
      keyboard focus only, so no tip pops up by itself
- [x] An Organise menu beside the title: new posts, everything in Needs a category, and
      Re-organise all. Needs a category also offers Ask the AI again beside Sort them one
      by one. Every run is quoted and confirmed; categories the user chose are never touched
- [x] `sort` takes `againBefore: <time the user confirmed>` for many posts: each post filed
      before it goes to the model once, so a batch sent twice bills once
- [x] Motion (`motion`): the sidebar highlight slides, the Organise panel opens and closes
      smoothly, cards glide out when posts move, the post panel cross-fades when stepping,
      and a refresh keeps the grid on screen instead of blinking to a skeleton. Reduced
      motion is respected
- [x] The next page loads as the grid's end comes into view; a new view starts at the top;
      the tab title names the view; the open post stays outlined in the grid

## Phase 49 — Categories that fit the library (audit, 2026-11-26)
- [x] Audit of a real 293-post library: 62 posts sat in Needs a category although the AI's
      summaries were right. About 47 had no category to go to (dating, local places and
      events, mindset and astrology, film, explainers); about 14 fit an existing one but the
      model only saw subcategory lists. A sample of 45 filed posts: about 36 right, 5 wrong
      (forced into the nearest bucket), 4 dumped in Humor & Misc
- [x] Five categories: Relationships & Dating, Places & Events, Entertainment, Mindset & Self,
      Learning & Science. Film and music moved from Art & Photography to Entertainment;
      Humor & Misc is for posts whose point is to be funny
- [x] Every category has a description (what belongs, examples, edges) sent as the Decisions
      API choice description and in the summary prompt
- [x] Eval set relabelled for the new categories, with 12 new cases from the audit's misses
- [ ] Re-run `npm run eval` with the key and tune MIN_PROBABILITY if Needs a category stays large

## Not done — needs the user

- [ ] **Revoke the committed OpenAI key.** A real key exists in repository history,
      including an old build configuration and design artifact. It is removed from the
      current tree; history cleanup does not make an exposed credential safe. Revoke it at
      the provider.

## Next, if this gets used in anger

- [x] Post detail view — metadata, caption, explicit Instagram link, back action, and a
      confirmed per-post re-index that bypasses cached/rule verdicts
- [x] Fixed indexing snapshot — a run processes exactly the pending shortcodes detected at
      start; new posts found by auto-scroll wait for the next run, across worker restarts
- [x] Auto-scroll lifecycle — natural completion clears worker state; quick pause/resume
      cannot let an older sweep stop a newer one
- [x] Verification expanded to 145 checks for carousel scoping, ambiguous rules,
      model-output coercion, current model availability, price schedules, and request contracts
- [ ] The resident cache (Phase 28) removed the per-keystroke full read, at the cost of
      holding ~30 MB for a 20k library. An index-backed cursor would trade that back
- [x] Export the library — done as the ledger export in Phase 26 (verdicts, not posts;
      the posts themselves are reproducible by scrolling)
- [ ] Collections — Instagram's saved posts can be grouped; currently flattened

## Deliberately out of scope
- Publishing to the Web Store (loaded unpacked)
- `sidePanel` (superseded by popup + in-page library)
- Populating `transcript` / `ocrText` / `embedding` / `perceptualHash` — schema accepts them
  so a later pipeline can backfill without a migration

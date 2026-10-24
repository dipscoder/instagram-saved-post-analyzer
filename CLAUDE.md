# Saved Index — orientation

Chrome MV3 extension (TypeScript, esbuild, **loaded unpacked — not published**), growing
into extension + Supabase backend + web app. The repo is npm workspaces: `extension/`,
`shared/` (pure taxonomy, digest, filing prompt) and `supabase/` (migrations and the
`analyze` Edge Function), with `web/` reserved. **OpenAI is the
only model provider** — don't add others back. It turns
Instagram's saved-posts grid into a searchable, AI-categorised library, and gives Instagram
videos real seek controls.

Read `PROJECT_INDEX.md` first for the current state, reading order, code map, and release
checklist. `ARCHITECTURE.md` explains how it works and why, `TODO.md` records what has been
done and what remains, and `README.md` is the user-facing guide. This file is the short
version plus the things that are easy to break without noticing.

```bash
npm run typecheck    # tsc across every workspace
npm run verify       # 183 pure-function checks, no browser needed — run this
npm run build        # writes extension/dist/, then Load unpacked in chrome://extensions
npm run watch        # unminified rebuild on save
```

`npm run verify` is the real test suite. It exercises the extractor, the search, the rules,
the route fences, record migration, save order, settings migration and the ledger, all as
pure functions in plain Node. **Anything you can express as a pure function belongs there.**

---

## The five invariants

Breaking any of these is a real bug, not a style question. Each one is load-bearing and
each has been broken at least once.

**1. The API key never leaves the service worker.** It is read in three places, all in the
worker, and only ever passed to a provider as a request header. `getSafeSettings()` is the
only settings shape returned across a message boundary — it destructures `apiKey` out and
returns a mask. The popup sends a candidate key directly to the worker to test/save it;
the content script and MAIN world never receive it.
Every error path runs through `redact()` before it reaches a log or the UI. `storage.local`
is locked to `TRUSTED_CONTEXTS` on **every** worker wake, not just on install, because one
of our content scripts runs on instagram.com. The Supabase session (access + refresh
tokens) is a credential too and follows the same rule: it lives in that storage, only the
signed-in email leaves the worker, and `account:*` requests from a content script are
refused.

**2. Capture only ever runs on the saved grid.** Instagram serves the home feed, explore,
profile grids and related-posts strips through the *same* GraphQL endpoint as the saved
feed, so the request URL proves almost nothing. Three fences: the route (`isSavedRoute`),
the payload (an untrusted body is read only inside a subtree named for the saved feed), and
the element (the DOM fallback is scoped inside `<main>`). Widening any of them means paying
the model for posts the user never saved.

**3. A census may only follow a completed sweep of the *full* feed.** `prune()` deletes
records the last sweep did not re-confirm. A sweep of one collection reaches the end of that
collection — counting that as "I have now seen everything you saved" offers the rest of the
library for deletion. `isFullSavedFeed` is a deliberate whitelist, and the sweep latches
both its start time *and* whether it began on the full feed, because the user can navigate
mid-sweep.

**4. Nothing deletes from the ledger.** `posts` is a disposable view of what is currently
saved — free to rebuild by scrolling. `analysis` is work that was *bought* with the user's
own API key and is irreproducible. `prune` and `resetCategories` touch only the first. The account's
`verdicts` table has no delete policy for the same reason.
See ARCHITECTURE §3b.

**5. Every spend is the user's money.** Before writing anything that calls a model, ask
what happens when it runs twice. Anything that can re-bill a library needs a quote *and* a
confirmation — the finished-state "Re-index" button once spent ~$7.90 on a 20k library from
a single unconfirmed click, under a readout that said `$0.00`.

---

## The shape of it

Three contexts, and the boundary between the first two is a trust boundary:

```
MAIN world (shares the page's JS context with Instagram — hostile)
  └─ patches window.fetch + XMLHttpRequest at document_start, reads res.clone()
        │ window.postMessage
ISOLATED world (content script: bridge, library, video controls)
        │ chrome.runtime port
Service worker (holds the key, the database, every model call)
```

Anything arriving from the MAIN world is page-controlled: Instagram's own bundle, or
anything that gets code onto that origin, can forge it. Validate shape, bound size, and
never trust a field because it looks right.

**MV3 kills the worker when idle.** Nothing in `extension/src/background/` may assume continuity.
Progress lives in IndexedDB, including the exact members of the active run. On wake, ask
the run queue what remains; do not rebuild it from every currently uncategorised post,
because capture may have discovered more after the run began.

**Instagram is a React SPA.** Do not fight it. The library mounts as a fixed overlay
sibling to React's root rather than replacing grid nodes, and the video bar goes in
`document.body` — React re-renders tear anything else straight back out. Note that patching
`history.pushState` from the ISOLATED world does *nothing*: DOM wrappers are per-world, so
Instagram calls its own copy. Route changes are detected by polling.

---

## Things that look like bugs and are not

The code is heavily commented and several oddities are deliberate. Read the comment before
"fixing":

- `savedRank = session * 1_000_000 - positionInSession`. Instagram sends **no save
  timestamp** anywhere. It does send newest-saved first, which answers the same question
  for every purpose except putting a date on it.
- `transcript` / `ocrText` / `embedding` / `perceptualHash` are declared and always null, so
  a later pipeline can backfill without a migration.
- The harvester's scroll delay is *randomised* (800–2000 ms) because a metronomic cadence is
  itself a signal.
- Low model confidence deliberately files a post as Uncategorized rather than guessing — a
  wrong category buries a post somewhere you will never look.
- `SCHEMA_VERSION` (record shape) and `DB_VERSION` (store shape) are separate on purpose and
  no longer move together.

## State

The work through Phase 36 is the current implementation: paid-result ledger,
bounded/resumable indexing, provider hardening and current model support, capture/media
resilience, per-post re-index, the redesigned popup/library, and the Supabase account (sync, thumbnails,
the ledger, and server-side analysis with a daily cap). `npm run verify` currently
contains 183 checks. See `PROJECT_INDEX.md` for the handoff checklist and `TODO.md` for the
small remaining backlog.

**Outstanding, not fixable in code:** a live OpenAI key was committed in repository
history, including a build configuration and design artifact. It is gone from the current
tree, but it must still be revoked at the provider; rewriting history does not un-leak it.

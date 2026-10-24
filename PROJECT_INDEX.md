# Saved Index — project map

Start here when taking over the project. This file answers **what to read**, **where a
feature lives**, **what is complete**, and **what still needs attention**. It deliberately
links to the detailed source of truth instead of repeating it.

Last reviewed: **2026-10-24**.

## Reading order

| Need | Read |
|---|---|
| Install, configure, and use the extension | [`README.md`](README.md) |
| Understand boundaries and design decisions | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| See completed phases and the remaining backlog | [`TODO.md`](TODO.md) |
| Make code changes safely | [`CLAUDE.md`](CLAUDE.md) |
| Compare with the original UI direction | [`design/`](design/) |

`README.md` is the user guide, `ARCHITECTURE.md` is the technical source of truth,
`TODO.md` is the chronological delivery record, and `CLAUDE.md` is the compact maintainer
brief. When behaviour changes, update the smallest authoritative document rather than
copying the same explanation into all four.

## Current product state

- Chrome Manifest V3 extension, TypeScript + esbuild, loaded unpacked from `extension/dist/`.
- npm workspaces: `extension/`, `shared/` (taxonomy, digest, filing prompt) and
  `supabase/` (migrations and the `analyze` Edge Function). `web/` is reserved for the
  planned web app. OpenAI is the only model provider.
- Saved-post capture is restricted by route, payload context, and DOM scope.
- An indexing run freezes its initial pending shortcodes, processes exactly that set, and
  leaves posts discovered while scrolling for the next run.
- Classification uses deterministic rules first, batched text analysis second, and a
  bounded thumbnail fallback only when text is insufficient.
- Individual posts can be re-indexed from their detail view. The action intentionally
  bypasses rules and the paid-result ledger to obtain a fresh judgment.
- Indexed posts and purchased analysis live in IndexedDB and, when signed in, mirror to a
  Supabase account (posts, thumbnails, and the ledger). Signed in, analysis runs through
  the account's `analyze` function and no OpenAI key is needed in the browser.
- The library and popup share one responsive visual system. Expired or unavailable media
  uses a deliberate placeholder; later saved-feed captures refresh signed media URLs.
- The regression suite currently contains **183 checks**. It does not replace a live
  Instagram/provider smoke test.

## Code map by question

Paths are under `extension/` unless they start with `shared/`.

| If you are changing… | Start with |
|---|---|
| Saved-page detection or capture scope | `src/routes.ts`, `src/capture/main-world.ts`, `src/capture/bridge.ts` |
| Instagram response parsing | `src/capture/extract.ts`, `src/capture/dom-scrape.ts` |
| IndexedDB records, migration, media refresh | `src/background/db.ts`, `src/types.ts` |
| Fixed-run queue and pause/resume | `src/background/index.ts`, `src/background/categorize.ts` |
| Paid-result reuse and re-index charging | `src/background/ledger.ts`, `shared/src/hash.ts`, `shared/src/taxonomy.ts` |
| Model support, requests, prices, token usage | `src/background/providers/`, `src/background/spend.ts` |
| Own key vs. account analysis | `src/background/analysts.ts`, `src/background/filing.ts`, `shared/src/filing.ts` |
| Server analysis, daily cap, deploy | `supabase/functions/analyze/`, `supabase/migrations/` |
| In-page library and post detail | `src/page/library.ts`, `src/page/library.css.ts` |
| Popup setup and controls | `src/popup/popup.ts`, `public/popup.html` |
| Reel controls | `src/page/video.ts` |
| Account sign-in and sync to Supabase | `src/background/account.ts`, `src/background/sync.ts`, `src/background/sync-plan.ts`, `src/background/media.ts`, `src/config.ts` |
| Database schema and access rules | `supabase/migrations/` |
| Cross-context contracts | `src/messaging.ts` |
| Extension assets and packaging | `public/manifest.json`, `tools/make-icons.mjs`, `build.mjs` |
| Regression coverage | `tools/verify.ts` |

## Non-negotiable invariants

The detailed version is in [`CLAUDE.md`](CLAUDE.md). In short:

1. After entry in the popup, provider keys are stored and read only by the service worker;
   they never enter Instagram's page or the content script. All surfaced errors are
   redacted.
2. Capture is accepted only from the saved grid and a saved-feed payload context.
3. Pruning is allowed only after a completed sweep of the full saved feed.
4. Post cleanup never deletes purchased analysis from the ledger.
5. Any operation that can re-bill many posts shows an estimate and requires confirmation.
6. The members of an active indexing run come from its persisted starting snapshot, not
   from a fresh query of every currently pending post.

## Important open items

1. **Revoke the historical OpenAI key.** A real key was committed in repository history.
   It has been removed from the current tree, but deleting or rewriting Git history cannot
   make an exposed credential safe again. Revoke it at OpenAI before using this repository.
2. **Run one live smoke test before distribution.** Automated checks mock provider calls
   and cannot prove the current Instagram DOM, an actual account session, CORS behaviour,
   or a real provider key. Follow the checklist below.
3. **Virtualise only when needed.** Rendering is capped and avoids redundant rebuilds, but
   a library of several thousand posts will eventually benefit from windowed rows.
4. **Collections are flattened.** Folder-aware browsing has not been implemented.
5. **Offline recovery is manual.** Network failures are represented correctly, but an
   indexing run does not automatically resume when connectivity returns.

## Release / handoff checklist

```bash
npm install
npm run typecheck
npm run verify
npm run build
```

Then reload `extension/dist/` in `chrome://extensions` and verify:

1. Test and save an OpenAI key; confirm the key never appears in page DevTools.
2. Open the full Instagram Saved page and confirm only saved posts enter the library.
3. Start with a known pending count; confirm the run stops at that count while newly
   discovered posts remain pending.
4. Search, filter, sort, switch Library ↔ Instagram, and open/close a post detail view.
5. Re-index one post and confirm the quote, confirmation, fresh category, and spend update.
6. Confirm image placeholders are clean, then revisit the saved feed and verify available
   thumbnails refresh.
7. Pause/resume from both surfaces and reload the extension during a run once.

## Documentation maintenance

- Behaviour or setup changed: update `README.md`.
- Trust boundary, storage, provider contract, or major flow changed: update
  `ARCHITECTURE.md`.
- Work completed or intentionally deferred: update `TODO.md`.
- A new easy-to-break invariant appeared: update `CLAUDE.md`.
- File ownership or the recommended reading path changed: update this index.

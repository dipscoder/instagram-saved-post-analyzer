# Saved Index — project map

Start here when taking over the project. This file answers **what to read**, **where a
feature lives**, **what is complete**, and **what still needs attention**. It deliberately
links to the detailed source of truth instead of repeating it.

Last reviewed: **2026-11-21**.

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

- The web app (`web/`, Next.js) is the product: the library, search, indexing, corrections,
  Settings and Clear library all live there. `npm run app` starts it.
- The Chrome MV3 extension is a collector (TypeScript + esbuild, loaded unpacked from
  `extension/dist/`). It signs in, finds saved posts by scrolling the open collection, and
  syncs them, with thumbnails, to the account. It calls no model and holds no model key.
- npm workspaces: `extension/`, `shared/` (taxonomy, digest, filing prompt, search,
  transcripts, corrections), `supabase/` (migrations and the `analyze`, `sort` and `search`
  Edge Functions) and `web/`. OpenAI is the only model provider; its key lives only in the
  Edge Functions' secrets. `npm run deploy` deploys every function.
- Saved-post capture is restricted by route, payload context, and DOM scope.
- Indexing runs on the server: keyword rules first, then the Decisions API for the category
  and a summary model for the rest, a thumbnail when the text is too thin, and a transcript
  for reels. Every run is quoted and confirmed, failures are recorded, and a daily cap
  bounds spend.
- Posts and verdicts live in IndexedDB and mirror to the Supabase account. The extension
  pulls each verdict filed on the server so its uploads never carry an older category.
- The regression suite currently contains **302 checks**. It does not replace a live
  Instagram smoke test.

## Code map by question

Paths are under `extension/` unless they start with `shared/`.

| If you are changing… | Start with |
|---|---|
| Saved-page detection or capture scope | `src/routes.ts`, `src/capture/main-world.ts`, `src/capture/bridge.ts` |
| Instagram response parsing | `src/capture/extract.ts`, `src/capture/dom-scrape.ts` |
| IndexedDB records, migration, media refresh | `src/background/db.ts`, `src/types.ts` |
| Ledger of verdicts, pulled from the account | `src/background/ledger.ts`, `src/background/sync-plan.ts` |
| Filing logic, prices, transcripts | `shared/src/filing.ts`, `shared/src/transcript.ts`, `shared/src/embedding.ts` |
| Server indexing, daily cap, failures | `supabase/functions/sort/`, `supabase/functions/analyze/`, `supabase/migrations/` |
| The web app: library, Index, Settings | `web/components/`, `web/lib/` |
| The pill on instagram.com and the Find button | `src/page/pill.ts`, `src/page/flow.ts` |
| Popup: sign in, Find new posts, open the library | `src/popup/popup.ts`, `public/popup.html` |
| Reel controls, frame stepping, stills | `src/page/video.ts`, `src/page/frames.ts` |
| Account sign-in and sync to Supabase | `src/background/account.ts`, `src/background/sync.ts`, `src/background/sync-plan.ts`, `src/background/media.ts`, `src/config.ts` |
| Database schema and access rules | `supabase/migrations/` |
| Cross-context contracts | `src/messaging.ts` |
| Extension assets and packaging | `public/manifest.json`, `tools/make-icons.mjs`, `build.mjs` |
| Regression coverage | `tools/verify.ts` |

## Non-negotiable invariants

The detailed version is in [`CLAUDE.md`](CLAUDE.md). In short:

1. The OpenAI key lives only in the Edge Functions' secrets. The account session stays in
   the service worker's locked storage, and all surfaced errors are redacted.
2. Capture is accepted only from the saved grid and a saved-feed payload context.
3. Pruning is allowed only after a completed sweep of the full saved feed.
4. Post cleanup never deletes purchased analysis from the ledger.
5. Any operation that can re-bill many posts shows an estimate and requires confirmation.

## Important open items

1. **Revoke the historical OpenAI key.** A real key was committed in repository history.
   It has been removed from the current tree, but deleting or rewriting Git history cannot
   make an exposed credential safe again. Revoke it at OpenAI before using this repository.
2. **Run one live smoke test before distribution.** Automated checks mock provider calls
   and cannot prove the current Instagram DOM, an actual account session, or CORS
   behaviour. Follow the checklist below.
3. **Collection membership only grows.** Posts record the Instagram collections they were seen in, but removing a post from a collection is not detected.

## Release / handoff checklist

```bash
npm install
npm run typecheck
npm run verify
npm run build
```

Then reload `extension/dist/` in `chrome://extensions` and verify:

1. Sign in from the popup; confirm no token or key appears in Instagram's DevTools.
2. Open a saved collection, press Find new posts in the pill, and confirm only saved posts
   are found and the count rises.
3. Let a sweep of All posts finish and confirm Remove offers only posts you unsaved.
4. Open the web app and confirm the posts and thumbnails arrived; index a few.
5. Confirm the extension adopts those categories on its next sync and does not overwrite
   them.
6. Reload the extension mid-sweep once and confirm it stops cleanly.

## Documentation maintenance

- Behaviour or setup changed: update `README.md`.
- Trust boundary, storage, provider contract, or major flow changed: update
  `ARCHITECTURE.md`.
- Work completed or intentionally deferred: update `TODO.md`.
- A new easy-to-break invariant appeared: update `CLAUDE.md`.
- File ownership or the recommended reading path changed: update this index.

# supabase

Database migrations and the server function for the Saved Index backend.

| Path | What it is |
| --- | --- |
| `migrations/20261023120000_posts.sql` | `public.posts`: one row per saved post per user, protected by Row Level Security |
| `migrations/20261024090000_thumbnails_and_verdicts.sql` | The private `thumbnails` bucket, `public.verdicts` (the paid-analysis ledger, never deleted), and `posts.thumbnail_stored` |
| `migrations/20261024140000_usage.sql` | `public.usage` (spend per user per UTC day) and `record_usage()`, which only ever adds |
| `migrations/20261119120000_collections.sql` | `posts.collections` (ids of the Instagram collections a post was seen in) and `public.collections` (their names) |
| `migrations/20261119150000_sharper_thumbnails.sql` | `posts.thumbnail_format` and WebP in the `thumbnails` bucket (800px copies, replacing the first 480px JPEGs) |
| `migrations/20261119160000_library_facets.sql` | `library_facets()`: the web app's sidebar counts in one grouped query, under the caller's own RLS |
| `migrations/20261119170000_server_sorting.sql` | Categorisations never go backwards (triggers on `posts` and `verdicts`), `apply_verdicts()` for the `sort` function, and `library_facets()` counting "not sorted yet" by `categorized_at` |
| `functions/analyze/` | The `analyze` Edge Function: files up to 25 posts per call for the signed-in user |
| `functions/sort/` | The `sort` Edge Function: sorts the caller's own unsorted posts by shortcode and saves the verdicts (web app) |
| `functions/_shared/` | Caller check, daily cap, usage and the OpenAI call, used by both functions |

## Applying a migration

Until the Supabase CLI is set up, paste each file in `migrations/` into the project's
**SQL Editor** (Dashboard → SQL Editor → New query) and run it, oldest first. Each file
runs once.

## Auth settings

Turn off email confirmation so **Create Account** in the popup signs you straight in:
Dashboard → Authentication → Sign In / Providers → Email → **Confirm email** off → Save.
With it on, sign-up sends a link first and the popup asks you to open it before signing in.

An account created while confirmation was on stays unconfirmed. Open the link in that email
(the account is confirmed even if the page it lands on fails to load), or delete the user
under Authentication → Users and create it again.

Turn it back on before the app goes public, once the web app exists to land the link on.

## The analyze function

Signed in, the extension sends posts here instead of calling OpenAI with a key in the
browser. Two calls per batch: the Decisions API (`gpt-6-luna`) picks the category, with
`unknown` and a 0.6 probability floor, and `gpt-5.6-luna` writes the summary, tags and
subcategory. The function uses the caller's own session for the database, so Row Level
Security applies and it needs no service-role key.

**Secrets** (Dashboard → Edge Functions → Secrets):

| Name | Value |
| --- | --- |
| `OPENAI_API_KEY` | The OpenAI key that pays for analysis. Required. |
| `DAILY_CAP_USD` | Spend limit per user per UTC day. Optional, default `1`. |

**Deploying**, from the repository root:

```bash
npm run build:functions        # bundles shared/ into functions/*/dist/
npx supabase login
npx supabase functions deploy analyze --project-ref siwmxcsrzdvvtouolvph --use-api
npx supabase functions deploy sort --project-ref siwmxcsrzdvvtouolvph --use-api
npx supabase functions deploy search --project-ref siwmxcsrzdvvtouolvph --use-api
```

`search` needs the `20261120090000_hybrid_search.sql` migration (pgvector, the full-text
document, `search_posts`). Until it is deployed the web app falls back to keyword search.

**Measuring accuracy.** `npm run eval` files `eval/labeled.json` with the keyword rules
for free. `OPENAI_API_KEY=… npm run eval -- --model` runs the full pipeline (about a tenth
of a cent) and lists every post filed in the wrong category. Export the key in your own
shell only; never write it to a file here.

The bundle is needed because `shared/` uses extensionless imports, which Deno does not
resolve; `config.toml` points the function at it. `verify_jwt` is off because the function
checks the caller itself, against `/auth/v1/user`, and the newer publishable keys are not
JWTs.

## The sort function

The web app's **Sort** button in Needs a look. It takes up to 25 shortcodes, reads those
posts itself (so the caller cannot choose what the model sees), skips any already sorted,
and files the rest exactly as the extension would: keyword rules first for free, then text
in one batch, then up to four caption-less posts from their stored thumbnail. The verdicts
go to `verdicts` and `posts` in one `apply_verdicts` call. The input hash is built by the
same `signature()` the extension uses, so the extension treats the answer as already paid
for and picks it up on its next sync. Same secrets and daily cap as `analyze`.

Before any run the web app shows the most it can cost (`SERVER_QUOTE_USD_PER_POST` in
`shared/src/filing.ts`) and spends nothing until a second press.

## Keys

The project URL and publishable key are public and live in `extension/src/config.ts`.
Secrets (the OpenAI key, the service-role key) live in Supabase project secrets, never in
this repo.

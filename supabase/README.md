# supabase

Database migrations and the server function for the Saved Index backend.

| Path | What it is |
| --- | --- |
| `migrations/20261023120000_posts.sql` | `public.posts`: one row per saved post per user, protected by Row Level Security |
| `migrations/20261024090000_thumbnails_and_verdicts.sql` | The private `thumbnails` bucket, `public.verdicts` (the paid-analysis ledger, never deleted), and `posts.thumbnail_stored` |
| `migrations/20261024140000_usage.sql` | `public.usage` (spend per user per UTC day) and `record_usage()`, which only ever adds |
| `functions/analyze/` | The `analyze` Edge Function: files up to 25 posts per call for the signed-in user |

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
npm run build:functions        # bundles shared/ into functions/analyze/dist/
npx supabase login
npx supabase functions deploy analyze --project-ref siwmxcsrzdvvtouolvph --use-api
```

The bundle is needed because `shared/` uses extensionless imports, which Deno does not
resolve; `config.toml` points the function at it. `verify_jwt` is off because the function
checks the caller itself, against `/auth/v1/user`, and the newer publishable keys are not
JWTs.

## Keys

The project URL and publishable key are public and live in `extension/src/config.ts`.
Secrets (the OpenAI key, the service-role key) live in Supabase project secrets, never in
this repo.

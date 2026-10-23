# supabase

Database migrations and, later, server functions for the Saved Index backend.

| Path | What it is |
| --- | --- |
| `migrations/20261023120000_posts.sql` | `public.posts`: one row per saved post per user, protected by Row Level Security |

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

## Keys

The project URL and publishable key are public and live in `extension/src/config.ts`.
Secrets (the OpenAI key, the service-role key) live in Supabase project secrets, never in
this repo.

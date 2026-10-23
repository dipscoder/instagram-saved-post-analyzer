# supabase

Database migrations and, later, server functions for the Saved Index backend.

| Path | What it is |
| --- | --- |
| `migrations/20261023120000_posts.sql` | `public.posts`: one row per saved post per user, protected by Row Level Security |

## Applying a migration

Until the Supabase CLI is set up, paste each file in `migrations/` into the project's
**SQL Editor** (Dashboard → SQL Editor → New query) and run it, oldest first. Each file
runs once.

## Keys

The project URL and publishable key are public and live in `extension/src/config.ts`.
Secrets (the OpenAI key, the service-role key) live in Supabase project secrets, never in
this repo.

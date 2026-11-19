# web

The Saved Index web app: your library outside Instagram. It reads the same Supabase account
the extension syncs to, so there is nothing to import.

```bash
npm run dev:web      # http://localhost:3000
npm run build:web
npm run typecheck -w web
```

**What is here.** Sign in with the extension's account; a sidebar of All saved, Needs a look
(no confident category), your Instagram collections and the categories; a grid newest-saved
first; search (⌘K or `/`) across caption, handle, summary, category, alt text, audio, tags and
hashtags; a side panel with the summary, tags, caption and a link back to Instagram. Light
by default, dark toggle in the header.

**How it is built.** Next.js App Router, Tailwind v4, shadcn-style components in
`components/ui/`, Geist. Colours are the Notch tokens in `app/globals.css` using shadcn's
token names. Everything runs in the browser with the public publishable key; Row Level
Security limits every query to the signed-in user's rows. Thumbnails come from the private
`thumbnails` bucket as one batch of hour-long signed URLs per page.

The search filter is built in `@saved-index/shared/search` and tested by `npm run verify`.
Terms are reduced to letters and digits before they reach PostgREST, so a query can never
change the filter's structure.

**Not yet.** Vector search (Phase 3 adds embeddings and hybrid search behind the same box),
editing a category from the panel, and deployment to Vercel.

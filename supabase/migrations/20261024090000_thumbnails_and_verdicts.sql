-- Thumbnails in Storage, and the paid-analysis ledger in the account.
--
-- Instagram's thumbnail URLs are signed and expire within days, so the web app cannot rely
-- on them. The extension copies one small JPEG per post into a private bucket instead,
-- under `{user_id}/{shortcode}.jpg`.
--
-- `verdicts` mirrors the extension's ledger: every summary and category a model was paid
-- to produce. It outlives the post it describes, so unsaving and re-saving a post, or
-- signing in on a new browser, never pays for the same answer twice. For that reason it
-- has no delete policy: rows go only when the user's account does.

-- A ledger import can carry text up to 2,000 characters (extension/src/background/ledger.ts)
-- and is applied to the post, so the post's columns must accept it too.
alter table public.posts
  drop constraint posts_category_check,
  drop constraint posts_subcategory_check,
  drop constraint posts_summary_check,
  add constraint posts_category_check check (char_length(category) <= 2000),
  add constraint posts_subcategory_check check (char_length(subcategory) <= 2000),
  add constraint posts_summary_check check (char_length(summary) <= 2000),
  add column thumbnail_stored boolean not null default false;

comment on column public.posts.thumbnail_stored is
  'True once the thumbnail is in the thumbnails bucket at {user_id}/{shortcode}.jpg.';

create table public.verdicts (
  user_id         uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  shortcode       text        not null check (shortcode ~ '^[A-Za-z0-9_-]{1,64}$'),
  category        text        check (char_length(category) <= 2000),
  subcategory     text        check (char_length(subcategory) <= 2000),
  tags            text[]      not null default '{}' check (cardinality(tags) <= 50),
  summary         text        check (char_length(summary) <= 2000),
  model_used      text        not null check (char_length(model_used) <= 128),
  categorized_at  timestamptz not null,
  -- What the verdict was produced from; see isFresh() in the extension's ledger.ts.
  input_hash      text        not null check (char_length(input_hash) <= 64),
  taxonomy_hash   text        not null check (char_length(taxonomy_hash) <= 64),
  rules_hash      text        not null check (char_length(rules_hash) <= 64),
  ledger_version  integer     not null,
  updated_at      timestamptz not null default now(),

  primary key (user_id, shortcode)
);

comment on table public.verdicts is 'Every categorisation a user has paid for, kept even after the post is unsaved.';

create trigger verdicts_touch_updated_at
  before update on public.verdicts
  for each row execute function public.touch_updated_at();

alter table public.verdicts enable row level security;

create policy "Users read their own verdicts" on public.verdicts
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "Users add their own verdicts" on public.verdicts
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "Users update their own verdicts" on public.verdicts
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Private bucket, JPEG only, 256 KB a file. The extension uploads about 30 KB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('thumbnails', 'thumbnails', false, 262144, array['image/jpeg'])
on conflict (id) do nothing;

-- Each user owns the folder named after their id, and nothing else in the bucket.
create policy "Users read their own thumbnails" on storage.objects
  for select to authenticated
  using (bucket_id = 'thumbnails' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users add their own thumbnails" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'thumbnails' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users replace their own thumbnails" on storage.objects
  for update to authenticated
  using (bucket_id = 'thumbnails' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'thumbnails' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users delete their own thumbnails" on storage.objects
  for delete to authenticated
  using (bucket_id = 'thumbnails' and (storage.foldername(name))[1] = (select auth.uid())::text);

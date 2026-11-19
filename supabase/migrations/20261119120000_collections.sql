-- The user's own Instagram collections: which posts sit in which, and what each is called.
--
-- Membership rides on the post as an array of collection ids, because the extension only
-- ever adds to it (a collection is never swept as a census, so leaving one can't be
-- detected). Names live in their own small table, keyed by Instagram's collection id.

alter table public.posts
  add column collections text[] not null default '{}' check (cardinality(collections) <= 200);

create index posts_user_collections on public.posts using gin (collections);

create table public.collections (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id         text        not null check (id ~ '^[0-9]{1,30}$'),
  name       text        not null check (char_length(name) between 1 and 100),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

comment on table public.collections is 'Names of a user''s Instagram saved collections, by Instagram''s id.';

create trigger collections_touch_updated_at
  before update on public.collections
  for each row execute function public.touch_updated_at();

alter table public.collections enable row level security;

create policy "Users read their own collections" on public.collections
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "Users add their own collections" on public.collections
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "Users update their own collections" on public.collections
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users delete their own collections" on public.collections
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Saved posts, one row per (user, Instagram shortcode).
--
-- The extension uploads what it captured and categorised; the web app reads it. Row Level
-- Security is the whole access model: the browser holds only the public publishable key,
-- so every policy below is what stops one user reading or overwriting another's library.

create table public.posts (
  user_id          uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  shortcode        text        not null check (shortcode ~ '^[A-Za-z0-9_-]{1,64}$'),
  permalink        text        not null check (char_length(permalink) <= 300),
  handle           text        not null default '' check (char_length(handle) <= 100),
  caption          text        not null default '' check (char_length(caption) <= 5000),
  hashtags         text[]      not null default '{}' check (cardinality(hashtags) <= 100),
  thumbnail_url    text        not null default '' check (char_length(thumbnail_url) <= 2000),
  is_video         boolean     not null default false,
  duration_sec     real,
  audio_track_name text        check (char_length(audio_track_name) <= 300),
  alt_text         text        check (char_length(alt_text) <= 5000),
  posted_at        timestamptz,
  first_seen_at    timestamptz,
  -- Instagram sends no save timestamp, only save order. See extension/src/background/order.ts.
  saved_rank       bigint,

  category         text        check (char_length(category) <= 100),
  subcategory      text        check (char_length(subcategory) <= 100),
  tags             text[]      not null default '{}' check (cardinality(tags) <= 50),
  summary          text        check (char_length(summary) <= 1000),
  categorized_at   timestamptz,
  model_used       text        check (char_length(model_used) <= 100),

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  primary key (user_id, shortcode)
);

comment on table public.posts is 'A user''s Instagram saved posts, as captured by the extension.';

-- The library's default sort: most recently saved first.
create index posts_user_saved_rank on public.posts (user_id, saved_rank desc nulls last);
create index posts_user_category on public.posts (user_id, category);

create function public.touch_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger posts_touch_updated_at
  before update on public.posts
  for each row execute function public.touch_updated_at();

alter table public.posts enable row level security;

-- `(select auth.uid())` rather than `auth.uid()`: Postgres evaluates it once per query
-- instead of once per row.
create policy "Users read their own posts" on public.posts
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "Users add their own posts" on public.posts
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "Users update their own posts" on public.posts
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users delete their own posts" on public.posts
  for delete to authenticated using ((select auth.uid()) = user_id);

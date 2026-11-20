-- Analysis v2, part one: search by meaning as well as by words.
--
-- Each indexed post gets an embedding (text-embedding-3-small, 512 dimensions) written by
-- the `sort` function, and a weighted full-text document kept up to date by a trigger.
-- `search_posts` fuses the two rankings with reciprocal rank fusion, so an exact handle
-- or hashtag still wins and "quick dinner" also finds "sheet-pan harissa chicken".
--
-- Safe to run again: every statement replaces or skips what is already there.

create extension if not exists vector with schema extensions;

alter table public.posts
  add column if not exists embedding   extensions.vector(512),
  add column if not exists embedded_at timestamptz,
  add column if not exists search_doc  tsvector;

comment on column public.posts.embedding is
  'text-embedding-3-small at 512 dimensions, of the summary, category, tags and the post''s own text. Null until indexed.';

-- No vector index on purpose. Search always runs inside one user's library (Row Level
-- Security adds the user_id filter), which the primary key already narrows to at most a
-- few thousand rows; an exact scan of those is fast and never misses. A shared HNSW
-- index would be searched first and filtered by user after, returning too few results.

-- --- the full-text document -------------------------------------------------------------

create or replace function public.posts_search_doc() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.search_doc :=
    setweight(to_tsvector('english', concat_ws(' ', new.summary, new.category, new.subcategory,
      array_to_string(new.tags, ' '))), 'A') ||
    setweight(to_tsvector('english', concat_ws(' ', new.caption, array_to_string(new.hashtags, ' '),
      new.handle)), 'B') ||
    setweight(to_tsvector('english', concat_ws(' ', new.alt_text, new.audio_track_name)), 'C');
  return new;
end;
$$;

drop trigger if exists posts_search_doc on public.posts;
create trigger posts_search_doc
  before insert or update on public.posts
  for each row execute function public.posts_search_doc();

create index if not exists posts_search_doc on public.posts using gin (search_doc);

-- --- an embedding follows what it describes ----------------------------------------------

-- When a post's filing or text changes, its embedding no longer describes it: clear it so
-- the next Index run embeds it again. An update that is itself writing the embedding
-- (embedded_at changes) is left alone. Named to run after posts_keep_newer_verdict, which
-- may restore the old filing; triggers on one event fire in name order.
create or replace function public.reset_stale_embedding() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.embedded_at is not distinct from old.embedded_at
     and (new.summary is distinct from old.summary
       or new.category is distinct from old.category
       or new.subcategory is distinct from old.subcategory
       or new.tags is distinct from old.tags
       or new.caption is distinct from old.caption
       or new.alt_text is distinct from old.alt_text) then
    new.embedding := null;
    new.embedded_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists posts_reset_stale_embedding on public.posts;
create trigger posts_reset_stale_embedding
  before update on public.posts
  for each row execute function public.reset_stale_embedding();

-- Fill the document for posts that already exist. Touches no filing or text column, so
-- no embedding is reset and no verdict moves.
update public.posts set search_doc = null where search_doc is null;

-- --- writing embeddings --------------------------------------------------------------

-- Runs as the caller, so Row Level Security limits it to their own posts.
create or replace function public.set_embeddings(p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  written integer;
begin
  if jsonb_array_length(p_rows) > 50 then
    raise exception 'At most 50 embeddings at a time.';
  end if;
  update public.posts p set
    embedding = (r.embedding)::extensions.vector(512),
    embedded_at = now()
  from jsonb_to_recordset(p_rows) as r (shortcode text, embedding text)
  where p.shortcode = r.shortcode and p.user_id = (select auth.uid());
  get diagnostics written = row_count;
  return written;
end;
$$;

revoke execute on function public.set_embeddings(jsonb) from public, anon;
grant execute on function public.set_embeddings(jsonb) to authenticated;

-- --- hybrid search -------------------------------------------------------------------

-- Reciprocal rank fusion of a keyword ranking and a meaning ranking: each list contributes
-- 1 / (60 + rank). A post near the top of either list rises; one in both rises most. The
-- meaning list keeps only posts within a similarity floor, so a query with no good match
-- does not return the whole library ranked by distance.
drop function if exists public.search_posts(text, extensions.vector, text, text, boolean, integer);
create function public.search_posts(
  p_query text,
  p_embedding extensions.vector(512) default null,
  p_category text default null,
  p_collection text default null,
  p_needs_look boolean default false,
  p_limit integer default 100
)
returns table (
  shortcode text, permalink text, handle text, caption text, hashtags text[], thumbnail_url text,
  thumbnail_stored boolean, is_video boolean, thumbnail_format text, duration_sec real,
  audio_track_name text, category text, subcategory text, tags text[], summary text,
  collections text[], saved_rank bigint, categorized_at timestamptz, score double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  with base as (
    select p.* from public.posts p
    where (p_category is null or p.category = p_category)
      and (p_collection is null or p.collections @> array[p_collection])
      and (not p_needs_look or p.category is null or p.category = 'Uncategorized')
  ),
  q as (select websearch_to_tsquery('english', p_query) as tsq),
  keyword as (
    select b.shortcode, row_number() over (order by ts_rank_cd(b.search_doc, q.tsq, 32) desc) as rank
    from base b, q
    where b.search_doc @@ q.tsq
    order by rank
    limit 200
  ),
  meaning as (
    select b.shortcode,
           row_number() over (order by b.embedding operator(extensions.<=>) p_embedding) as rank
    from base b
    where p_embedding is not null
      and b.embedding is not null
      and b.embedding operator(extensions.<=>) p_embedding < 0.65
    order by rank
    limit 200
  ),
  fused as (
    select shortcode, sum(1.0 / (60 + rank)) as score
    from (select * from keyword union all select * from meaning) ranked
    group by shortcode
  )
  select b.shortcode, b.permalink, b.handle, b.caption, b.hashtags, b.thumbnail_url,
         b.thumbnail_stored, b.is_video, b.thumbnail_format, b.duration_sec,
         b.audio_track_name, b.category, b.subcategory, b.tags, b.summary,
         b.collections, b.saved_rank, b.categorized_at, f.score::double precision
  from fused f
  join base b using (shortcode)
  order by f.score desc, b.saved_rank desc nulls last
  limit least(greatest(p_limit, 1), 200);
$$;

revoke execute on function public.search_posts(text, extensions.vector, text, text, boolean, integer) from public, anon;
grant execute on function public.search_posts(text, extensions.vector, text, text, boolean, integer) to authenticated;

-- --- the Index bar counts posts that are filed but not yet searchable by meaning ----------

create or replace function public.library_facets()
returns table (kind text, key text, count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select 'total', '', count(*) from public.posts
  union all
  select 'unsorted', '', count(*) from public.posts where categorized_at is null
  union all
  select 'unembedded', '', count(*) from public.posts where categorized_at is not null and embedded_at is null
  union all
  select 'unsure', '', count(*) from public.posts
    where categorized_at is not null and (category is null or category = 'Uncategorized')
  union all
  select 'category', category, count(*) from public.posts
    where category is not null and category <> 'Uncategorized' group by category
  union all
  select 'collection', c, count(*) from public.posts, unnest(collections) as c group by c;
$$;
